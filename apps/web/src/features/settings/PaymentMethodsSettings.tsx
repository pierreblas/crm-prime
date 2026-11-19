"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COUNTRIES,
  PAYMENT_METHODS_MAX,
  paymentMethodsFor,
  paymentMethodsText,
  type CreatePaymentMethodInput,
  type PaymentMethodDto,
} from "@crm/shared";
import {
  createPaymentMethod,
  deletePaymentMethod,
  fetchPaymentMethods,
  mediaSrc,
  reorderPaymentMethods,
  updatePaymentMethod,
  uploadMedia,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";

const COUNTRY_NAME = new Map(COUNTRIES.map((c) => [c.code, c.name]));
const countriesLabel = (codes: string[]) => (codes.length ? codes.map((c) => COUNTRY_NAME.get(c) ?? c).join(" · ") : "Todos los países");

/**
 * Métodos de pago: las cuentas y números a los que pagan los clientes. El
 * agente no los escribe: con «Enviar métodos de pago» el sistema manda este
 * texto tal cual, solo con los del país del cliente (por el prefijo de su
 * teléfono). Abajo, cómo lo recibe un cliente de cada país.
 */
export function PaymentMethodsSettings() {
  const qc = useQueryClient();
  const { data: methods, isPending, isError, error } = useQuery({ queryKey: ["payment-methods"], queryFn: fetchPaymentMethods });
  const [editing, setEditing] = useState<PaymentMethodDto | "new" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["payment-methods"] });
  const fail = (e: unknown) => toast.error((e as Error).message);

  const remove = useMutation({ mutationFn: deletePaymentMethod, onSuccess: refresh, onError: fail });
  const toggle = useMutation({
    mutationFn: (m: PaymentMethodDto) => updatePaymentMethod(m.id, { isActive: !m.isActive }),
    onSuccess: refresh,
    onError: fail,
  });
  const reorder = useMutation({
    mutationFn: reorderPaymentMethods,
    onSuccess: (list) => qc.setQueryData(["payment-methods"], list),
    onError: fail,
  });
  const move = (i: number, by: -1 | 1) => {
    if (!methods) return;
    const ids = methods.map((m) => m.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };

  const full = (methods?.length ?? 0) >= PAYMENT_METHODS_MAX;
  return (
    <div className="pay" data-pay>
      <div className="pay__head">
        <p>
          Las cuentas y números a los que te pagan. Tu agente <strong>no los escribe</strong>: cuando un cliente quiere pagar, el sistema le
          envía estos datos tal cual, solo los de su país. Actívalo en <Link href="/agentes">Agentes IA</Link> › Qué puede hacer ›{" "}
          <em>Enviar métodos de pago</em>.
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing("new")} disabled={full} data-pay-new>
          + Nuevo
        </button>
      </div>

      {editing && (
        <MethodForm
          method={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}

      {isPending && <p className="pay__empty">Cargando…</p>}
      {isError && <p className="pay__empty is-error">{(error as Error).message}</p>}
      {methods && methods.length === 0 && !editing && (
        <p className="pay__empty" data-pay-empty>
          Todavía no hay métodos de pago. Sin ellos, cuando un cliente pide los datos para pagar, el agente lo pasa a una persona.
        </p>
      )}

      <ul className="pay__list">
        {(methods ?? []).map((m, i) => (
          <li key={m.id} className={`pay__item${m.isActive ? "" : " is-off"}`} data-pay-item={m.name}>
            <div className="pay__item-main">
              <div className="pay__item-title">
                <strong>{m.name}</strong>
                <span className="pay__countries">{countriesLabel(m.countries)}</span>
                {!m.isActive && <span className="pay__off">No se envía</span>}
              </div>
              <pre className="pay__details">{m.details}</pre>
              {m.instructions && <p className="pay__instructions">{m.instructions}</p>}
            </div>
            {m.imageUrl && mediaSrc(m.imageUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pay__qr" src={mediaSrc(m.imageUrl)!} alt={`Imagen de ${m.name}`} loading="lazy" />
            )}
            <div className="pay__item-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0 || reorder.isPending} aria-label={`Subir ${m.name}`}>
                <NavIcon name="arrow-up" size={13} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => move(i, 1)}
                disabled={i === (methods?.length ?? 0) - 1 || reorder.isPending}
                aria-label={`Bajar ${m.name}`}
              >
                <NavIcon name="arrow-down" size={13} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(m)} disabled={toggle.isPending}>
                {m.isActive ? "Pausar" : "Activar"}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(m)} data-pay-edit>
                Editar
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm pay__delete"
                onClick={() => void confirmDialog({ message: `¿Eliminar «${m.name}»?`, danger: true }).then((ok) => ok && remove.mutate(m.id))}
              >
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {methods && methods.length > 0 && <Preview methods={methods} />}
    </div>
  );
}

/** Lo que recibe un cliente de un país: el mismo texto que envía el sistema. */
function Preview({ methods }: { methods: PaymentMethodDto[] }) {
  // Los países que tienen algo propio primero; «otro país» enseña lo de «todos».
  const options = useMemo(() => {
    const used = new Set(methods.flatMap((m) => m.countries));
    return COUNTRIES.filter((c) => used.has(c.code));
  }, [methods]);
  // null: todavía no eligió (se enseña el primer país con métodos); "": «otro país».
  const [code, setCode] = useState<string | null>(null);
  const current = code ?? options[0]?.code ?? "";
  const chosen = paymentMethodsFor(methods, current || null);
  const text = paymentMethodsText(chosen);
  return (
    <section className="pay__preview" data-pay-preview>
      <div className="pay__preview-head">
        <h3>Así lo recibe un cliente de</h3>
        <select className="field" value={current} onChange={(e) => setCode(e.target.value)} aria-label="País del cliente" data-pay-preview-country>
          {options.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
          <option value="">{options.length ? "Otro país" : "Cualquier país"}</option>
        </select>
      </div>
      {chosen.length ? (
        <div className="pay__bubble" data-pay-preview-text>
          <WaText text={text} />
          {chosen
            .filter((m) => m.imageUrl && mediaSrc(m.imageUrl))
            .map((m) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.id} src={mediaSrc(m.imageUrl)!} alt={`Imagen de ${m.name}`} loading="lazy" />
            ))}
        </div>
      ) : (
        <p className="pay__empty" data-pay-preview-none>
          Un cliente de {current ? COUNTRY_NAME.get(current) : "otro país"} no recibiría ninguno: el agente le dirá que una persona del equipo se
          los envía y pasará el chat.
        </p>
      )}
    </section>
  );
}

/** El texto como lo pinta WhatsApp: *negrita* y _cursiva_ en las líneas que las llevan. */
function WaText({ text }: { text: string }) {
  return (
    <div className="pay__wa">
      {text.split("\n").map((line, i) => {
        const bold = /^\*(.+)\*$/.exec(line);
        const italic = /^_(.+)_$/.exec(line);
        // Una línea vacía conserva su alto: es la separación entre métodos.
        return <div key={i}>{bold ? <strong>{bold[1]}</strong> : italic ? <em>{italic[1]}</em> : line || <br />}</div>;
      })}
    </div>
  );
}

function MethodForm({ method, onClose, onSaved }: { method?: PaymentMethodDto; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(method?.name ?? "");
  const [countries, setCountries] = useState<string[]>(method?.countries ?? []);
  const [details, setDetails] = useState(method?.details ?? "");
  const [instructions, setInstructions] = useState(method?.instructions ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(method?.imageUrl ?? null);
  const [uploading, setUploading] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const payload: CreatePaymentMethodInput = { name, countries, details, instructions, imageUrl };
      return method ? updatePaymentMethod(method.id, payload) : createPaymentMethod(payload);
    },
    onSuccess: onSaved,
    onError: (e) => toast.error((e as Error).message),
  });
  const available = COUNTRIES.filter((c) => !countries.includes(c.code));

  return (
    <div className="pay__form" data-pay-form>
      <div className="pay__form-row">
        <label className="pay__field">
          <span>Nombre</span>
          <input className="field" value={name} maxLength={60} placeholder="Yape, Transferencia BCP, PayPal…" onChange={(e) => setName(e.target.value)} data-pay-name />
        </label>
        <div className="pay__field">
          <span>Países</span>
          <div className="pay__chips">
            {countries.length === 0 && <span className="pay__chip is-all">Todos los países</span>}
            {countries.map((c) => (
              <span key={c} className="pay__chip">
                {COUNTRY_NAME.get(c) ?? c}
                <button type="button" onClick={() => setCountries(countries.filter((x) => x !== c))} aria-label={`Quitar ${COUNTRY_NAME.get(c) ?? c}`}>
                  <NavIcon name="x" size={11} />
                </button>
              </span>
            ))}
            <select
              className="field pay__add-country"
              value=""
              onChange={(e) => e.target.value && setCountries([...countries, e.target.value])}
              aria-label="Añadir un país"
              data-pay-country
            >
              <option value="">{countries.length ? "+ Otro país" : "Solo para un país…"}</option>
              {available.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <label className="pay__field">
        <span>Datos que recibe el cliente (tal cual)</span>
        <textarea
          className="field"
          value={details}
          maxLength={1000}
          rows={4}
          placeholder={"Número: 987 654 321\nA nombre de: Mi Empresa SAC"}
          onChange={(e) => setDetails(e.target.value)}
          data-pay-details
        />
      </label>

      <label className="pay__field">
        <span>Indicación (opcional)</span>
        <input className="field" value={instructions} maxLength={300} placeholder="Envía tu comprobante por aquí" onChange={(e) => setInstructions(e.target.value)} />
      </label>

      <div className="pay__field">
        <span>Imagen o QR (opcional): se envía como foto</span>
        <div className="pay__upload">
          {imageUrl && mediaSrc(imageUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pay__qr" src={mediaSrc(imageUrl)!} alt="Imagen del método de pago" />
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              void uploadMedia(file)
                .then((m) => (m.kind === "IMAGE" ? setImageUrl(m.mediaUrl) : toast.error("Sube una imagen (JPG, PNG o WebP)")))
                .catch((err: Error) => toast.error(err.message))
                .finally(() => setUploading(false));
            }}
          />
          {imageUrl && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImageUrl(null)}>
              Quitar
            </button>
          )}
        </div>
      </div>

      <div className="pay__form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={save.isPending || uploading || !name.trim() || !details.trim()} onClick={() => save.mutate()} data-pay-save>
          {save.isPending ? "Guardando…" : method ? "Guardar" : "Crear"}
        </button>
      </div>
    </div>
  );
}
