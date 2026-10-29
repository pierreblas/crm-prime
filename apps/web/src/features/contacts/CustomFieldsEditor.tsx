"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FIELD_KEY_RE, customFieldTypes, fieldKeyFromLabel, type CustomFieldDto, type CustomFieldType } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { createCustomField, deleteCustomField, fetchCustomFields, fetchUnmappedFields, updateCustomField } from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";

const TYPE_LABEL: Record<CustomFieldType, string> = { text: "Texto", number: "Número", date: "Fecha", select: "Lista" };

/** «utm_campaign» → «Utm campaign»; «presupuesto_mensual» → «Presupuesto mensual». */
const humanize = (key: string) => {
  const s = key.replace(/_+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Campos personalizados de los contactos. Cada campo tiene una CLAVE estable
 * (la que usan la API, los webhooks y la importación) que no cambia al
 * renombrarlo. Debajo, los datos que llegan con una clave sin campo, para
 * convertirlos en campo con un clic.
 */
export function CustomFieldsEditor() {
  const qc = useQueryClient();
  const { data: fields = [], isPending } = useQuery({ queryKey: ["custom-fields"], queryFn: fetchCustomFields });
  const { data: unmapped = [] } = useQuery({ queryKey: ["custom-fields-unmapped"], queryFn: fetchUnmappedFields });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["custom-fields"] });
    qc.invalidateQueries({ queryKey: ["custom-fields-unmapped"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
  };

  // ── Nuevo campo ──
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const [key, setKey] = useState("");
  const [editKey, setEditKey] = useState(false);
  const autoKey = fieldKeyFromLabel(label);
  const finalKey = editKey && key ? key : autoKey;
  const keyTaken = fields.some((f) => f.key === finalKey);
  const keyBad = editKey && !!key && !FIELD_KEY_RE.test(key);

  const create = useMutation({
    mutationFn: (input: { label: string; type: CustomFieldType; options: string[]; key?: string }) => createCustomField(input),
    onSuccess: (f) => {
      setLabel("");
      setType("text");
      setOptions("");
      setKey("");
      setEditKey(false);
      toast.success(`Campo «${f.label}» creado · clave ${f.key}`);
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: deleteCustomField,
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const opts = options.split(",").map((o) => o.trim()).filter(Boolean);
  const canCreate = !!label.trim() && (type !== "select" || opts.length > 0) && !keyBad && !(editKey && keyTaken);

  return (
    <div className="cfe" data-fields-editor>
      <div className="cfe__list">
        {isPending && <div className="skeleton" style={{ height: 48, borderRadius: 10 }} />}
        {!isPending && fields.length === 0 && <p className="cfe__hint">Aún no hay campos. Crea el primero abajo.</p>}
        {fields.map((f) => (
          <FieldRow
            key={f.id}
            field={f}
            onSaved={refresh}
            onDelete={() =>
              void confirmDialog({
                title: `Eliminar «${f.label}»`,
                message: "El campo deja de verse en las fichas. Los datos guardados con esta clave no se borran: si vuelves a crear un campo con la misma clave, reaparecen.",
                confirmLabel: "Eliminar",
                danger: true,
              }).then((ok) => ok && remove.mutate(f.id))
            }
          />
        ))}
      </div>

      <form
        className="cfe__new"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) create.mutate({ label: label.trim(), type, options: type === "select" ? opts : [], ...(editKey && key ? { key } : {}) });
        }}
      >
        <div className="cfe__new-row">
          <input className="field" value={label} maxLength={80} placeholder="Nombre del campo (ej. Ciudad)" onChange={(e) => setLabel(e.target.value)} aria-label="Nombre del campo" />
          <select className="field" style={{ flex: "0 0 130px" }} value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} aria-label="Tipo">
            {customFieldTypes.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={!canCreate || create.isPending}>
            Añadir
          </button>
        </div>
        {type === "select" && (
          <input className="field" value={options} placeholder="Opciones separadas por coma (ej. Pequeña, Mediana, Grande)" onChange={(e) => setOptions(e.target.value)} aria-label="Opciones" />
        )}
        {label.trim() && (
          <div className="cfe__keyline" data-new-key>
            <span>Clave para API e importación:</span>
            {editKey ? (
              <input
                className="field field-sm cfe__keyinput"
                value={key}
                autoFocus
                maxLength={40}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                placeholder={autoKey}
                aria-label="Clave"
              />
            ) : (
              <code>{finalKey}</code>
            )}
            {!editKey && (
              <button type="button" className="cfe__link" onClick={() => { setEditKey(true); setKey(autoKey); }}>
                cambiar
              </button>
            )}
            {keyBad && <em>Solo minúsculas, números y _, empezando por letra.</em>}
            {!keyBad && keyTaken && <em>{editKey ? "Ya existe un campo con esa clave." : `Ya existe: se usará ${finalKey}_1.`}</em>}
            {!keyBad && !keyTaken && <small>No cambia aunque renombres el campo.</small>}
          </div>
        )}
      </form>

      {unmapped.length > 0 && (
        <div className="cfe__unmapped" data-unmapped>
          <div className="cfe__unmapped-head">
            <strong>Datos que llegan sin campo</strong>
            <span>Vienen de la API, webhooks, formularios de Meta o importaciones. No se ven en la ficha hasta que crees su campo.</span>
          </div>
          {unmapped.map((u) => (
            <div key={u.key} className="cfe__unmapped-row">
              <code>{u.key}</code>
              <span className="cfe__muted">
                {u.contacts} contacto{u.contacts === 1 ? "" : "s"}
                {u.sample ? ` · ej. «${u.sample}»` : ""}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={create.isPending || !FIELD_KEY_RE.test(u.key)}
                title={FIELD_KEY_RE.test(u.key) ? "Crea un campo de texto con esta clave" : "Esta clave tiene caracteres no válidos"}
                onClick={() => create.mutate({ label: humanize(u.key).slice(0, 80), type: "text", options: [], key: u.key })}
                data-adopt={u.key}
              >
                Crear campo
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="cfe__hint">
        En la API y los webhooks envía <code>{`"fields": { "${fields[0]?.key ?? "ciudad"}": "…" }`}</code>. También se acepta el nombre del campo tal cual («{fields[0]?.label ?? "Ciudad"}»).
      </p>
    </div>
  );
}

function FieldRow({ field: f, onSaved, onDelete }: { field: CustomFieldDto; onSaved: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(f.label);
  const [options, setOptions] = useState(f.options.join(", "));
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      updateCustomField(f.id, {
        label: label.trim(),
        ...(f.type === "select" ? { options: options.split(",").map((o) => o.trim()).filter(Boolean) } : {}),
      }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const copy = () => {
    void navigator.clipboard?.writeText(f.key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="cfe__row" data-field-row={f.key}>
      {editing ? (
        <form
          className="cfe__edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) save.mutate();
          }}
        >
          <input className="field field-sm" value={label} maxLength={80} autoFocus onChange={(e) => setLabel(e.target.value)} aria-label="Nombre" />
          {f.type === "select" && (
            <input className="field field-sm" value={options} onChange={(e) => setOptions(e.target.value)} aria-label="Opciones" placeholder="Opciones separadas por coma" />
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={!label.trim() || save.isPending}>
            Guardar
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setLabel(f.label); setOptions(f.options.join(", ")); }}>
            Cancelar
          </button>
        </form>
      ) : (
        <>
          <div className="cfe__main">
            <strong>{f.label}</strong>
            <span className="cfe__type">{TYPE_LABEL[f.type]}</span>
            {f.type === "select" && f.options.length > 0 && <span className="cfe__muted">{f.options.join(" · ")}</span>}
          </div>
          <button type="button" className="cfe__key" onClick={copy} title="Clave para la API y la importación. Clic para copiar." data-copy-key>
            <code>{f.key}</code>
            <NavIcon name={copied ? "check" : "copy"} size={12} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setEditing(true)} title="Renombrar" aria-label={`Renombrar ${f.label}`}>
            <NavIcon name="pencil" size={14} />
          </button>
          <button type="button" className="icon-btn" onClick={onDelete} title="Eliminar" aria-label={`Eliminar ${f.label}`}>
            <NavIcon name="x" size={14} />
          </button>
        </>
      )}
    </div>
  );
}
