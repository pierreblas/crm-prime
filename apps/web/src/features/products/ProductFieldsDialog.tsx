"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FIELD_KEY_RE,
  isListFieldType,
  MULTI_SEPARATOR,
  nextProductFieldKey,
  productFieldTypes,
  splitMulti,
  type CreateProductFieldInput,
  type ProductFieldDto,
  type ProductFieldType,
} from "@crm/shared";
import { NavIcon, type IconName as NavIconName } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { createProductField, deleteProductField, reorderProductFields, updateProductField } from "@/lib/bff";

export const TYPE_INFO: Record<ProductFieldType, { label: string; example: string; icon: NavIconName }> = {
  text: { label: "Texto corto", example: "Marca, color, lugar", icon: "note" },
  longtext: { label: "Texto largo", example: "Qué incluye, requisitos", icon: "file" },
  number: { label: "Número", example: "Duración, cupos, peso", icon: "chart" },
  date: { label: "Fecha", example: "Inicio de un taller", icon: "clock" },
  time: { label: "Hora", example: "Horario de la clase", icon: "hourglass" },
  boolean: { label: "Sí / No", example: "Incluye certificado", icon: "check" },
  select: { label: "Una opción", example: "Modalidad: presencial u online", icon: "chevron-down" },
  multiselect: { label: "Varias opciones", example: "Días: lun, mié, vie", icon: "check-double" },
  url: { label: "Enlace", example: "Ficha técnica, video", icon: "link" },
};

type Draft = {
  label: string;
  /** Clave elegida a mano al crear; vacío = la propuesta a partir del nombre. */
  key: string;
  type: ProductFieldType;
  options: string[];
  unit: string;
  help: string;
  required: boolean;
  showOnCard: boolean;
  aiVisible: boolean;
};

const EMPTY: Draft = { label: "", key: "", type: "text", options: [], unit: "", help: "", required: false, showOnCard: true, aiVisible: true };

// Puntos de partida por tipo de negocio. Nada es fijo: todo se puede editar.
const TEMPLATES: { name: string; fields: (Partial<Draft> & { label: string; type: ProductFieldType })[] }[] = [
  {
    name: "Productos",
    fields: [
      { label: "Talla", type: "select", options: ["XS", "S", "M", "L", "XL"] },
      { label: "Color", type: "text" },
      { label: "Marca", type: "text" },
      { label: "Material", type: "text" },
      { label: "Garantía", type: "number", unit: "meses" },
    ],
  },
  {
    name: "Servicios",
    fields: [
      { label: "Duración", type: "number", unit: "min" },
      { label: "Modalidad", type: "select", options: ["Presencial", "Online", "A domicilio"] },
      { label: "Qué incluye", type: "longtext", showOnCard: false },
      { label: "Requisitos", type: "longtext", showOnCard: false },
    ],
  },
  {
    name: "Talleres y cursos",
    fields: [
      { label: "Fecha de inicio", type: "date" },
      { label: "Horario", type: "time" },
      { label: "Días", type: "multiselect", options: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] },
      { label: "Cupos", type: "number", unit: "cupos" },
      { label: "Lugar", type: "text" },
      { label: "Certificado", type: "boolean" },
    ],
  },
  {
    name: "Uso interno",
    fields: [
      { label: "Costo", type: "number", showOnCard: false, aiVisible: false, help: "Solo para el equipo" },
      { label: "Proveedor", type: "text", showOnCard: false, aiVisible: false },
    ],
  },
];

const toInput = (d: Draft): CreateProductFieldInput => ({
  label: d.label.trim(),
  ...(d.key ? { key: d.key } : {}),
  type: d.type,
  options: isListFieldType(d.type) ? d.options : [],
  unit: d.type === "number" ? d.unit.trim() || null : null,
  help: d.help.trim() || null,
  required: d.required,
  showOnCard: d.showOnCard,
  aiVisible: d.aiVisible,
});

/**
 * Campos del catálogo: los datos que el negocio quiera guardar en cada
 * producto, servicio o taller. Se rellenan en cada ficha, se importan por CSV
 * y, si se permite, el agente de IA los usa para responder.
 *
 * Ventana centrada con lista a la izquierda y editor a la derecha: se abre
 * igual desde la lista de productos que desde la ficha de uno, siempre por
 * encima de todo.
 */
export function ProductFieldsDialog({ fields, onClose }: { fields: ProductFieldDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  // null = inicio (ideas); "new" = campo nuevo; un id = ese campo.
  const [selected, setSelected] = useState<string | null>(fields.length ? fields[0]!.id : null);
  // Confirmación en el propio pie ("Guardado"), no con avisos flotantes que
  // taparían los botones de la ventana.
  const [saved, setSaved] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 2500);
    return () => clearTimeout(t);
  }, [saved]);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    // En captura: que Esc cierre esta ventana y no también la ficha de debajo.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  // Si el campo abierto desaparece (borrado en otra pestaña), volver al inicio.
  useEffect(() => {
    if (selected && selected !== "new" && !fields.some((f) => f.id === selected)) setSelected(null);
  }, [fields, selected]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["product-fields"] });
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  };
  // La lista se actualiza al momento (sin esperar a recargarla), para que el
  // campo recién creado quede abierto y el borrado desaparezca ya.
  const upsert = (list: ProductFieldDto[]) =>
    queryClient.setQueryData<ProductFieldDto[]>(["product-fields"], (old = []) => {
      const next = old.map((x) => list.find((f) => f.id === x.id) ?? x);
      return [...next, ...list.filter((f) => !old.some((x) => x.id === f.id))];
    });
  const drop = (id: string) =>
    queryClient.setQueryData<ProductFieldDto[]>(["product-fields"], (old = []) => old.filter((x) => x.id !== id));
  const addTemplate = useMutation({
    mutationFn: async (list: Partial<Draft>[]) => {
      const created: ProductFieldDto[] = [];
      for (const f of list) created.push(await createProductField(toInput({ ...EMPTY, ...f })));
      return created;
    },
    onSuccess: (created) => {
      upsert(created);
      toast.success(created.length === 1 ? `Campo «${created[0]!.label}» añadido` : `${created.length} campos añadidos`);
      if (created.length === 1) setSelected(created[0]!.id);
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: refresh,
  });
  const reorder = useMutation({
    mutationFn: reorderProductFields,
    onMutate: (ids) => {
      const byId = new Map(fields.map((f) => [f.id, f]));
      queryClient.setQueryData(["product-fields"], ids.map((id) => byId.get(id)!));
    },
    onSettled: refresh,
  });
  const move = (i: number, dir: -1 | 1) => {
    const ids = fields.map((f) => f.id);
    [ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!];
    reorder.mutate(ids);
  };

  if (!mounted) return null;
  const taken = new Set(fields.map((f) => f.label.trim().toLowerCase()));
  const current = fields.find((f) => f.id === selected);
  const view = selected ? "detail" : "list";

  return createPortal(
    <div className="pf-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="pf-title" className="pf-modal" data-view={view}>
        <header className="pf-modal__head">
          <div>
            <strong id="pf-title">Campos del catálogo</strong>
            <span>Decide qué datos guardas de cada producto, servicio o taller.</span>
          </div>
          <button type="button" className="pf-icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)">
            <NavIcon name="x" size={17} />
          </button>
        </header>

        <div className="pf-modal__body">
          <nav className="pf-side" aria-label="Tus campos">
            <button type="button" className={`pf-side__new${selected === "new" ? " is-on" : ""}`} onClick={() => setSelected("new")}>
              <NavIcon name="plus" size={15} /> Nuevo campo
            </button>
            {fields.length === 0 ? (
              <p className="pf-side__empty">Todavía no hay campos. Crea el primero o elige una idea.</p>
            ) : (
              <ol className="pf-items">
                {fields.map((f, i) => (
                  <li key={f.id} className={`pf-item${selected === f.id ? " is-on" : ""}`}>
                    <button type="button" className="pf-item__main" aria-current={selected === f.id} onClick={() => setSelected(f.id)} title={`Clave: ${f.key}`}>
                      <span className="pf-item__icon" aria-hidden>
                        <NavIcon name={TYPE_INFO[f.type].icon} size={14} />
                      </span>
                      <span className="pf-item__text">
                        <strong>
                          {f.label}
                          {f.required && <span className="pf-req" title="Obligatorio"> *</span>}
                          {!f.aiVisible && (
                            <span className="pf-flag" title="El agente de IA no ve este campo">
                              <NavIcon name="lock" size={10} /> Interno
                            </span>
                          )}
                        </strong>
                        <small>{describe(f)}</small>
                      </span>
                    </button>
                    <span className="pf-item__move">
                      <button type="button" className="pf-mini-btn" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Subir ${f.label}`} title="Subir">
                        <NavIcon name="arrow-up" size={13} />
                      </button>
                      <button type="button" className="pf-mini-btn" disabled={i === fields.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Bajar ${f.label}`} title="Bajar">
                        <NavIcon name="arrow-down" size={13} />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {fields.length > 0 && (
              <button type="button" className={`pf-side__ideas${selected === null ? " is-on" : ""}`} onClick={() => setSelected(null)}>
                <NavIcon name="sparkles" size={14} /> Ideas de campos
              </button>
            )}
          </nav>

          {selected === "new" || current ? (
            <FieldForm
              // La clave reinicia el formulario al cambiar de campo.
              key={selected}
              field={current}
              fields={fields}
              onBack={() => setSelected(null)}
              notice={saved && saved.id === current?.id ? saved.text : null}
              onSaved={(f, created) => {
                upsert([f]);
                setSaved({ id: f.id, text: created ? "Campo creado" : "Cambios guardados" });
                setSelected(f.id);
                refresh();
              }}
              onDeleted={(id) => {
                drop(id);
                setSelected(null);
                refresh();
              }}
            />
          ) : (
            <section className="pf-pane" aria-label="Ideas de campos">
              <div className="pf-pane__scroll">
                <div className="pf-intro">
                  <strong>Crea los campos que necesites</strong>
                  <p>
                    Nada viene creado: tú decides qué datos tiene tu catálogo. Empieza desde cero o toma
                    una idea y cámbiale lo que quieras.
                  </p>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setSelected("new")}>
                    <NavIcon name="plus" size={14} /> Crear campo desde cero
                  </button>
                </div>
                <div className="pf-templates">
                  {TEMPLATES.map((t) => {
                    const free = t.fields.filter((f) => !taken.has(f.label.toLowerCase()));
                    if (!free.length) return null;
                    return (
                      <div key={t.name} className="pf-template">
                        <div className="pf-template__head">
                          <span>{t.name}</span>
                          {free.length > 1 && (
                            <button type="button" className="pf-link" disabled={addTemplate.isPending} onClick={() => addTemplate.mutate(free)}>
                              Añadir los {free.length}
                            </button>
                          )}
                        </div>
                        <div className="pf-examples">
                          {free.map((f) => (
                            <button
                              key={f.label}
                              type="button"
                              className="agent-chip"
                              disabled={addTemplate.isPending}
                              onClick={() => addTemplate.mutate([f])}
                              title={`${TYPE_INFO[f.type].label}. Se añade y puedes editarlo.`}
                            >
                              <NavIcon name="plus" size={12} /> {f.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function describe(f: ProductFieldDto): string {
  const parts: string[] = [TYPE_INFO[f.type].label];
  if (isListFieldType(f.type) && f.options.length) {
    parts.push(f.options.slice(0, 3).join(", ") + (f.options.length > 3 ? ` +${f.options.length - 3}` : ""));
  }
  if (f.type === "number" && f.unit) parts.push(f.unit);
  return parts.join(" · ");
}

/**
 * Crear o editar un campo. Los botones quedan fijos abajo; borrar se confirma
 * ahí mismo, sin otra ventana encima.
 */
function FieldForm({
  field,
  fields,
  notice,
  onBack,
  onSaved,
  onDeleted,
}: {
  field?: ProductFieldDto;
  fields: ProductFieldDto[];
  onBack: () => void;
  notice: string | null;
  onSaved: (f: ProductFieldDto, created: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  // La clave de un campo existente no se edita: solo se elige al crear.
  const initial: Draft = field ? { ...field, key: "", unit: field.unit ?? "", help: field.help ?? "" } : EMPTY;
  const [d, setD] = useState<Draft>(initial);
  const [editKey, setEditKey] = useState(false);
  const [preview, setPreview] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => (field ? updateProductField(field.id, toInput(d)) : createProductField(toInput(d))),
    onSuccess: (f) => onSaved(f, !field),
  });
  const remove = useMutation({
    mutationFn: () => deleteProductField(field!.id),
    onSuccess: () => {
      toast.success(`Campo «${field!.label}» eliminado`);
      onDeleted(field!.id);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const needsOptions = isListFieldType(d.type) && d.options.length === 0;
  // Clave: la propuesta a partir del nombre (sin chocar con las que hay) o la que se escriba.
  const autoKey = nextProductFieldKey(d.label, fields.map((x) => x.key));
  const finalKey = editKey && d.key ? d.key : autoKey;
  const keyBad = editKey && !!d.key && !FIELD_KEY_RE.test(d.key);
  const keyTaken = editKey && !!d.key && fields.some((x) => x.key === d.key);
  const dirty = JSON.stringify(toInput(d)) !== JSON.stringify(toInput(initial));
  const canSave = d.label.trim().length > 0 && !needsOptions && !keyBad && !keyTaken && dirty && !save.isPending;
  const typeChanged = field && field.type !== d.type;

  return (
    <form
      className="pf-pane"
      aria-label={field ? `Editar ${field.label}` : "Nuevo campo"}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save.mutate();
      }}
    >
      <div className="pf-pane__head">
        <button type="button" className="pf-back" onClick={onBack} aria-label="Volver a la lista">
          <NavIcon name="arrow-left" size={15} />
        </button>
        <strong>{field ? `Editar «${field.label}»` : "Nuevo campo"}</strong>
      </div>

      <div className="pf-pane__scroll">
        <label className="pf-label">
          <span>Nombre</span>
          <input
            className="field"
            value={d.label}
            autoFocus={!field}
            maxLength={80}
            placeholder="Ej: Duración, Talla, Cupos, Modalidad…"
            onChange={(e) => set("label", e.target.value)}
          />
        </label>

        {field ? (
          <div className="cfe__keyline pf-keyline" data-field-key>
            <span>Clave para la API y la importación:</span>
            <KeyChip value={field.key} />
            <small>
              Fija: no cambia aunque renombres el campo. En la API: <code>{`"fields": { "${field.key}": "…" }`}</code>
            </small>
          </div>
        ) : d.label.trim() ? (
          <div className="cfe__keyline pf-keyline" data-field-key>
            <span>Clave para la API y la importación:</span>
            {editKey ? (
              <input
                className="field field-sm cfe__keyinput"
                value={d.key}
                autoFocus
                maxLength={40}
                placeholder={autoKey}
                aria-label="Clave"
                onChange={(e) => set("key", e.target.value.toLowerCase().replace(/\s+/g, "_"))}
              />
            ) : (
              <code>{finalKey}</code>
            )}
            {!editKey && (
              <button
                type="button"
                className="cfe__link"
                onClick={() => {
                  setEditKey(true);
                  set("key", autoKey);
                }}
              >
                cambiar
              </button>
            )}
            {keyBad && <em>Solo minúsculas, números y _, empezando por letra.</em>}
            {!keyBad && keyTaken && <em>Ya existe un campo con esa clave.</em>}
            {!keyBad && !keyTaken && <small>Propuesta a partir del nombre. Una vez creado el campo no cambia, aunque lo renombres.</small>}
          </div>
        ) : null}

        <fieldset className="pf-fieldset">
          <legend>Tipo de dato</legend>
          <div className="pf-types" role="radiogroup" aria-label="Tipo de dato">
            {productFieldTypes.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={d.type === t}
                className={`pf-type${d.type === t ? " is-on" : ""}`}
                onClick={() => {
                  set("type", t);
                  setPreview("");
                }}
              >
                <NavIcon name={TYPE_INFO[t].icon} size={15} />
                <span>
                  <strong>{TYPE_INFO[t].label}</strong>
                  <small>{TYPE_INFO[t].example}</small>
                </span>
              </button>
            ))}
          </div>
          {typeChanged && <p className="pf-note">Los valores ya guardados se conservan. Revisa que encajen con el nuevo tipo.</p>}
        </fieldset>

        {isListFieldType(d.type) && (
          <div className="pf-label">
            <span>Opciones</span>
            <OptionsEditor options={d.options} onChange={(o) => set("options", o)} />
            <small className="pf-hint">{needsOptions ? "Añade al menos una opción." : "Escribe y pulsa Enter o coma. La ✕ quita una opción."}</small>
          </div>
        )}

        {d.type === "number" && (
          <label className="pf-label">
            <span>Unidad (opcional)</span>
            <input className="field" value={d.unit} maxLength={20} placeholder="min, horas, cupos, kg, m²…" onChange={(e) => set("unit", e.target.value)} />
          </label>
        )}

        <label className="pf-label">
          <span>Ayuda (opcional)</span>
          <input className="field" value={d.help} maxLength={200} placeholder="Ej: Duración total de la sesión" onChange={(e) => set("help", e.target.value)} />
          <small className="pf-hint">Se muestra al rellenar el campo. El agente de IA también la lee.</small>
        </label>

        <div className="pf-switches">
          <Switch checked={d.required} onChange={(v) => set("required", v)} title="Obligatorio" hint="No se puede guardar un producto sin este dato." />
          <Switch checked={d.showOnCard} onChange={(v) => set("showOnCard", v)} title="Mostrar en la tarjeta" hint="Aparece como etiqueta en la lista del catálogo." />
          <Switch
            checked={d.aiVisible}
            onChange={(v) => set("aiVisible", v)}
            title="Lo usa el agente de IA"
            hint="Apágalo para datos internos, como el costo o el proveedor."
          />
        </div>

        {d.label.trim() && !needsOptions && (
          <div className="pf-preview">
            <span className="pf-preview__tag">Vista previa</span>
            <div className="pf-label">
              <span>
                {d.label}
                {d.required && <span className="pf-req"> *</span>}
              </span>
              <ProductFieldInput field={{ label: d.label, type: d.type, options: d.options, unit: d.unit || null }} value={preview} onChange={setPreview} />
              {d.help.trim() && <small className="pf-hint">{d.help}</small>}
            </div>
          </div>
        )}

        {save.isError && <p className="pf-error">{(save.error as Error).message}</p>}
      </div>

      <footer className="pf-pane__foot">
        {confirmDelete ? (
          <div className="pf-confirm" role="alert">
            <span>
              ¿Eliminar «{field!.label}»? Los productos conservan sus valores y reaparecen si lo vuelves a crear
              con la misma clave ({field!.key}).
            </span>
            <div className="pf-confirm__actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)} autoFocus>
                Cancelar
              </button>
              <button type="button" className="btn btn-danger btn-sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? "Eliminando…" : "Sí, eliminar"}
              </button>
            </div>
          </div>
        ) : (
          <>
            {field && (
              <button type="button" className="pf-delete" onClick={() => setConfirmDelete(true)}>
                Eliminar campo
              </button>
            )}
            <span className="pf-saved" role="status" aria-live="polite">
              {notice && !dirty && (
                <>
                  <NavIcon name="check" size={14} /> {notice}
                </>
              )}
            </span>
            {dirty && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (field ? setD(initial) : onBack())}>
                {field ? "Descartar cambios" : "Cancelar"}
              </button>
            )}
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSave}>
              {save.isPending ? "Guardando…" : field ? (dirty ? "Guardar cambios" : "Sin cambios") : "Crear campo"}
            </button>
          </>
        )}
      </footer>
    </form>
  );
}

/** La clave del campo, con copiar al pulsar: es lo que se pega en una integración. */
function KeyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="cfe__key"
      title="Clic para copiar"
      aria-label={`Copiar la clave ${value}`}
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error("No se pudo copiar"),
        )
      }
    >
      <code>{value}</code>
      <NavIcon name={copied ? "check" : "copy"} size={12} />
    </button>
  );
}

function Switch({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <label className="pf-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="pf-switch__track" aria-hidden />
      <span className="pf-switch__text">
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );
}

/** Opciones como etiquetas: Enter o coma añade; pegar "a, b, c" añade varias. */
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const next = [...options];
    for (const o of splitMulti(raw)) if (!next.some((x) => x.toLowerCase() === o.toLowerCase())) next.push(o.slice(0, 80));
    onChange(next);
    setText("");
  };
  return (
    <div className="pf-options">
      {options.map((o, i) => (
        <span key={o} className="pf-option">
          {o}
          <button type="button" aria-label={`Quitar ${o}`} onClick={() => onChange(options.filter((_, k) => k !== i))}>
            <NavIcon name="x" size={11} />
          </button>
        </span>
      ))}
      <input
        className="pf-options__input"
        value={text}
        placeholder={options.length ? "Otra opción…" : "Escribe una opción y pulsa Enter"}
        aria-label="Nueva opción"
        onChange={(e) => (/[,;]/.test(e.target.value) ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (text.trim()) add(text);
          } else if (e.key === "Backspace" && !text && options.length) {
            onChange(options.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
    </div>
  );
}

type InputField = Pick<ProductFieldDto, "type" | "options" | "unit" | "label"> & { required?: boolean };

/** El control que corresponde a cada tipo de campo, para la ficha del producto. */
export function ProductFieldInput({
  field,
  value,
  onChange,
  style,
}: {
  field: InputField;
  value: string;
  onChange: (v: string) => void;
  style?: CSSProperties;
}) {
  const cls = style ? undefined : "field";
  switch (field.type) {
    case "select":
      return (
        <select className={cls} style={style} value={value} required={field.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {!field.options.includes(value) && value && <option value={value}>{value}</option>}
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const picked = splitMulti(value);
      const toggle = (o: string) => onChange((picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o]).join(MULTI_SEPARATOR));
      return (
        <div className="pf-chipset" role="group" aria-label={field.label}>
          {[...field.options, ...picked.filter((p) => !field.options.includes(p))].map((o) => (
            <button key={o} type="button" aria-pressed={picked.includes(o)} className={`agent-chip${picked.includes(o) ? " is-on" : ""}`} onClick={() => toggle(o)}>
              {o}
            </button>
          ))}
        </div>
      );
    }
    case "boolean":
      return (
        <div className="seg pf-bool" role="radiogroup" aria-label={field.label}>
          {["Sí", "No"].map((o) => (
            <button key={o} type="button" role="radio" aria-checked={value === o} aria-selected={value === o} onClick={() => onChange(value === o ? "" : o)}>
              {o}
            </button>
          ))}
        </div>
      );
    case "longtext":
      return (
        <textarea
          className={cls}
          style={{ ...style, minHeight: 72, resize: "vertical", fontFamily: "inherit" }}
          value={value}
          maxLength={2000}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <span className="pf-unit">
          <input
            className={cls}
            style={style}
            type="number"
            step="any"
            inputMode="decimal"
            value={value}
            required={field.required}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.unit && <span className="pf-unit__suffix">{field.unit}</span>}
        </span>
      );
    default:
      return (
        <input
          className={cls}
          style={style}
          type={field.type === "date" ? "date" : field.type === "time" ? "time" : field.type === "url" ? "url" : "text"}
          placeholder={field.type === "url" ? "https://…" : undefined}
          value={value}
          maxLength={500}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
