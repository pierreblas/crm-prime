"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { metaEventLabel, type ConversionFormChannel, type ConversionsOverview } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { card, ghostBtn, primaryBtn, smBtn } from "@/components/ui";
import {
  disableConversions,
  disableFormConversions,
  enableConversions,
  enableFormConversions,
  fetchConversions,
  retryConversion,
} from "@/lib/bff";
import { toast } from "@/lib/toast";

/** El conjunto de datos que se está conectando o cambiando en una página. */
type FormDraft = { id: string; datasetId: string; token: string };

/**
 * Conversiones de anuncios: cuando un cliente que vino de un anuncio avanza en
 * el embudo, Driony se lo cuenta a Meta para que la campaña optimice hacia
 * clientes reales. Dos vías: los chats de anuncios de clic a WhatsApp (se
 * activa por número) y los leads de formularios de Meta (cada página lleva el
 * conjunto de datos del Administrador de eventos y su token).
 */
export function MetaConversionsCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["conversions"], queryFn: fetchConversions });
  const set = (fresh: ConversionsOverview) => queryClient.setQueryData(["conversions"], fresh);
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => (on ? enableConversions(id) : disableConversions(id)),
    onSuccess: (fresh, v) => {
      set(fresh);
      toast.success(v.on ? "Conversiones activadas en este número" : "Conversiones desactivadas");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const saveForm = useMutation({
    mutationFn: (d: FormDraft) => enableFormConversions(d.id, { datasetId: d.datasetId.trim(), ...(d.token.trim() ? { accessToken: d.token.trim() } : {}) }),
    onSuccess: (fresh) => {
      set(fresh);
      setDraft(null);
      toast.success("Conversiones de formularios activadas en esta página");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const turnOffForm = useMutation({
    mutationFn: disableFormConversions,
    onSuccess: (fresh) => {
      set(fresh);
      toast.success("Conversiones de formularios desactivadas");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const retry = useMutation({
    mutationFn: retryConversion,
    onSuccess: set,
    onError: (e) => toast.error((e as Error).message),
  });
  const forms = data?.forms ?? [];
  const busy = saveForm.isPending || turnOffForm.isPending;

  return (
    <div style={card} data-conversions-card>
      <h3 style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <NavIcon name="target" size={16} /> Conversiones de anuncios (Meta)
      </h3>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
        Cuando un cliente que vino de un anuncio avanza en el embudo, Driony envía a Meta los eventos de cada etapa:{" "}
        <strong>Lead interesado</strong> al llegar a Potencial y <strong>Compra</strong> con el valor al llegar a Ganada, más los que
        tú añadas. Así tus campañas aprenden de los clientes que compran, no solo de los clics. Los eventos de cada etapa se
        eligen en <a href="/settings?tab=stages" style={{ color: "var(--accent-text)" }}>Ajustes › Embudos y etapas</a>.
      </p>

      <h4 style={groupTitle}>Anuncios de clic a WhatsApp</h4>
      {!data ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando…</p>
      ) : data.channels.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Conecta un número de WhatsApp para activarlas.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.channels.map((c) => (
            <div key={c.id} style={row} data-conversions-channel={c.id}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{c.label ?? c.displayPhoneNumber ?? "Número"}</strong>
                {c.label && c.displayPhoneNumber && <span style={{ color: "var(--muted)" }}> · {c.displayPhoneNumber}</span>}
                <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                  {c.enabled
                    ? `Activas · dataset ${c.datasetId}`
                    : c.wabaId
                      ? "Desactivadas"
                      : "Sin cuenta de WhatsApp Business: vuelve a conectar el número"}
                </span>
              </span>
              <button
                type="button"
                style={c.enabled ? { ...ghostBtn, ...smBtn } : { ...primaryBtn, ...smBtn }}
                disabled={toggle.isPending || !c.wabaId}
                onClick={() => toggle.mutate({ id: c.id, on: !c.enabled })}
              >
                {c.enabled ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
        </div>
      )}

      <h4 style={{ ...groupTitle, marginTop: 18 }}>Formularios de clientes potenciales</h4>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
        Para las campañas con formulario de Facebook o Instagram. Driony avisa a Meta en cuanto entra cada lead y cada vez que
        su oportunidad llega a una etapa con eventos, usando el identificador que Meta le dio al lead.
      </p>
      {data && forms.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Conecta una página en{" "}
          <a href="/settings?tab=channels&channel=facebook" style={{ color: "var(--accent-text)" }}>
            Ajustes › Canales › Formularios
          </a>{" "}
          para activarlas.
        </p>
      )}
      {forms.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {forms.map((p) => (
            <FormRow
              key={p.id}
              page={p}
              draft={draft?.id === p.id ? draft : null}
              busy={busy}
              onDraft={setDraft}
              onSave={(d) => saveForm.mutate(d)}
              onOff={() => turnOffForm.mutate(p.id)}
            />
          ))}
        </div>
      )}
      {forms.length > 0 && (
        <details className="ch-details" style={{ marginTop: 10 }} data-conversions-help>
          <summary>
            Dónde están el identificador y el token <small>· en el Administrador de eventos de Meta</small>
          </summary>
          <ol className="ch-details__body" style={{ margin: 0, paddingLeft: 32, lineHeight: 1.6 }}>
            <li>
              En el Administrador de eventos, pulsa <strong>Conectar orígenes de datos</strong>, elige <strong>CRM</strong> y crea un
              conjunto de datos nuevo para Driony (Meta recomienda no mezclarlo con el del sitio web).
            </li>
            <li>
              Copia el <strong>identificador del conjunto de datos</strong>: el número que aparece bajo su nombre.
            </li>
            <li>
              En su pestaña <strong>Configuración</strong>, sección «API de conversiones», pulsa <strong>Generar token de acceso</strong> y
              cópialo entero. Hace falta ser administrador del negocio.
            </li>
            <li>
              Pégalos aquí. Cuando Meta haya recibido eventos (tarda hasta una hora en mostrarlos), te pedirá en ese mismo sitio
              ordenar las etapas del embudo y elegir cuál quieres optimizar.
            </li>
          </ol>
        </details>
      )}

      {data && data.events.length > 0 && (
        <>
          <h4 style={{ margin: "16px 0 8px", fontSize: 13 }}>Últimos eventos enviados</h4>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }} data-conversions-events>
              <thead>
                <tr>
                  {["Evento", "Vino de", "Oportunidad", "Valor", "Estado", "Fecha"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id} data-conversion-event={e.eventName}>
                    <td style={td}>{metaEventLabel(e.eventName)}</td>
                    <td style={td}>
                      {e.channel === "form" ? "Formulario" : "WhatsApp"}
                      {e.channelLabel && <span style={{ color: "var(--muted)" }}> · {e.channelLabel}</span>}
                    </td>
                    <td style={td}>
                      {e.dealTitle ?? "—"}
                      {e.contactName && <span style={{ color: "var(--muted)" }}> · {e.contactName}</span>}
                    </td>
                    <td style={td}>{e.value != null ? `${e.value.toFixed(2)} ${e.currency ?? ""}` : "—"}</td>
                    <td style={td}>
                      {e.status === "sent" ? (
                        <span style={{ color: "var(--positive)" }}>Enviado</span>
                      ) : e.status === "waiting" ? (
                        <span style={{ color: "var(--muted)" }} title="Sale sola en cuanto pongas el valor de la oportunidad">
                          Espera el valor
                        </span>
                      ) : (
                        <span style={{ color: "var(--danger)" }} title={e.error ?? undefined}>
                          Falló{" "}
                          <button
                            type="button"
                            style={{ ...ghostBtn, ...smBtn, padding: "2px 8px", marginLeft: 6 }}
                            onClick={() => retry.mutate(e.id)}
                            disabled={retry.isPending}
                          >
                            Reintentar
                          </button>
                          {e.error && <span style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>{e.error}</span>}
                        </span>
                      )}
                    </td>
                    <td style={td}>{new Date(e.sentAt ?? e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Una página de Facebook: su estado y, al conectar o cambiar, los dos datos
 * que se copian del Administrador de eventos. El token guardado nunca vuelve
 * al navegador: para cambiar solo el conjunto de datos se deja vacío.
 */
function FormRow({
  page,
  draft,
  busy,
  onDraft,
  onSave,
  onOff,
}: {
  page: ConversionFormChannel;
  draft: FormDraft | null;
  busy: boolean;
  onDraft: (d: FormDraft | null) => void;
  onSave: (d: FormDraft) => void;
  onOff: () => void;
}) {
  const ready = !!page.datasetId && page.hasToken;
  const open = () => onDraft({ id: page.id, datasetId: page.datasetId ?? "", token: "" });
  const idOk = !!draft && /^\d{5,25}$/.test(draft.datasetId.trim());
  const tokenOk = !!draft && (draft.token.trim().length >= 20 || (page.hasToken && !draft.token.trim()));
  return (
    <div style={{ ...row, flexWrap: "wrap" }} data-conversions-form={page.id}>
      <span style={{ flex: "1 1 220px", minWidth: 0 }}>
        <strong>{page.name}</strong>
        <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }} data-form-state>
          {page.enabled && ready ? `Activas · conjunto de datos ${page.datasetId}` : ready ? `Desactivadas · conjunto de datos ${page.datasetId}` : "Sin conjunto de datos conectado"}
        </span>
      </span>
      {!draft && (
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ready && (
            <button type="button" style={{ ...ghostBtn, ...smBtn }} disabled={busy} onClick={open} data-form-change>
              Cambiar
            </button>
          )}
          {page.enabled && ready ? (
            <button type="button" style={{ ...ghostBtn, ...smBtn }} disabled={busy} onClick={onOff} data-form-off>
              Desactivar
            </button>
          ) : ready ? (
            <button type="button" style={{ ...primaryBtn, ...smBtn }} disabled={busy} onClick={() => onSave({ id: page.id, datasetId: page.datasetId!, token: "" })} data-form-on>
              Activar
            </button>
          ) : (
            <button type="button" style={{ ...primaryBtn, ...smBtn }} disabled={busy} onClick={open} data-form-connect>
              Conectar
            </button>
          )}
        </span>
      )}
      {draft && (
        <form
          style={{ flex: "1 1 100%", display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "start" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (idOk && tokenOk) onSave(draft);
          }}
        >
          <label>
            <span className="label">Identificador del conjunto de datos</span>
            <input
              className="field"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={draft.datasetId}
              placeholder="Solo números"
              onChange={(e) => onDraft({ ...draft, datasetId: e.target.value })}
              data-form-dataset
            />
            {draft.datasetId.trim() && !idOk && <small style={fieldError}>Son solo números: cópialo del Administrador de eventos.</small>}
          </label>
          <label>
            <span className="label">Token de acceso</span>
            <input
              className="field"
              type="password"
              autoComplete="off"
              value={draft.token}
              placeholder={page.hasToken ? "Vacío: se conserva el guardado" : "Pégalo entero"}
              onChange={(e) => onDraft({ ...draft, token: e.target.value })}
              data-form-token
            />
            {draft.token.trim() && !tokenOk && <small style={fieldError}>Parece incompleto: cópialo entero.</small>}
          </label>
          <span style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="submit" style={{ ...primaryBtn, ...smBtn }} disabled={busy || !idOk || !tokenOk} data-form-save>
              {busy ? "Guardando…" : "Guardar y activar"}
            </button>
            <button type="button" style={{ ...ghostBtn, ...smBtn }} disabled={busy} onClick={() => onDraft(null)}>
              Cancelar
            </button>
            <small style={{ color: "var(--muted)" }}>Se guarda cifrado y no se vuelve a mostrar.</small>
          </span>
        </form>
      )}
    </div>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
};
const groupTitle: React.CSSProperties = { margin: "0 0 8px", fontSize: 13 };
const fieldError: React.CSSProperties = { display: "block", marginTop: 4, color: "var(--danger)", fontSize: 12 };
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 500, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--border)" };
