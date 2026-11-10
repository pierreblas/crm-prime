"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TagDto } from "@crm/shared";
import { createTag, deleteTag, fetchTags, updateTag } from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { readableInk } from "@/lib/readable-ink";

/**
 * Colores que se leen bien sobre el noir y entre sí: el lima de la marca, el
 * cian de los datos y seis más. El selector libre sigue ahí para quien quiera
 * otro.
 */
const PALETTE = ["#e2f80d", "#00e5ff", "#1fa855", "#f0a84a", "#e8475c", "#8a6cf2", "#2c7be5", "#9aa5b1"];
const DEFAULT_COLOR = PALETTE[6]!;

/**
 * Ajustes › Etiquetas. Cada etiqueta se ve como se verá en la bandeja (su
 * chip con su color), con cuántos contactos la llevan; se renombra con el
 * lápiz y se recolorea con la paleta. Las que vienen de la app de WhatsApp
 * (coexistencia) lo dicen.
 */
export function TagsManager() {
  const queryClient = useQueryClient();
  const { data: tags = [], isPending, isError, error } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const create = useMutation({
    mutationFn: () => createTag({ name: name.trim(), color }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const total = tags.reduce((n, t) => n + t.contactCount, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Etiquetas</h3>
        <p style={muted}>
          Para marcar y segmentar contactos: filtran la bandeja y los contactos, arman las audiencias de las difusiones y las usan los flujos y el
          agente de IA. Un contacto puede llevar varias.
        </p>
      </header>

      <div className="src-new tag-new">
        <div className="tag-new__row">
          <Palette value={color} onChange={setColor} />
          <input
            className="field field-sm"
            value={name}
            maxLength={60}
            placeholder="Nueva etiqueta (ej. VIP, Frío, Mayorista)"
            aria-label="Nombre de la nueva etiqueta"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            {create.isPending ? "Añadiendo…" : "Añadir"}
          </button>
        </div>
        {name.trim() && (
          <div className="tag-new__preview">
            <span style={muted}>Así se verá:</span>
            <TagChip name={name.trim()} color={color} />
          </div>
        )}
      </div>

      {isPending && <p className="src-empty">Cargando…</p>}
      {isError && <p style={{ color: "var(--danger)" }}>{(error as Error).message}</p>}
      {!isPending && tags.length > 0 && (
        <p style={{ ...muted, fontSize: 13 }}>
          {tags.length} etiqueta{tags.length === 1 ? "" : "s"} · {total} uso{total === 1 ? "" : "s"} en contactos
        </p>
      )}
      <div className="src-section">
        {tags.map((t) => (
          <TagRow key={t.id} tag={t} onChanged={refresh} />
        ))}
        {!isPending && tags.length === 0 && (
          <p className="src-empty">Aún no hay etiquetas. Crea la primera arriba: «Interesado», «VIP» o «Mayorista» son un buen comienzo.</p>
        )}
      </div>
    </div>
  );
}

function TagRow({ tag, onChanged }: { tag: TagDto; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color ?? DEFAULT_COLOR);
  useEffect(() => {
    setName(tag.name);
    setColor(tag.color ?? DEFAULT_COLOR);
  }, [tag.name, tag.color]);
  const dirty = name.trim() !== tag.name || color !== (tag.color ?? DEFAULT_COLOR);

  const save = useMutation({
    mutationFn: () => updateTag(tag.id, { name: name.trim(), color }),
    onSuccess: () => {
      setEditing(false);
      toast.success("Etiqueta actualizada");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => deleteTag(tag.id),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const cancel = () => {
    setName(tag.name);
    setColor(tag.color ?? DEFAULT_COLOR);
    setEditing(false);
  };
  const n = tag.contactCount;

  return (
    <div className={`src-row tag-row${editing ? " is-editing" : ""}`} data-tag={tag.name}>
      <div className="src-row__main">
        {editing ? (
          <div className="tag-edit">
            <input
              className="field field-sm"
              autoFocus
              value={name}
              maxLength={60}
              aria-label="Nombre de la etiqueta"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) save.mutate();
                if (e.key === "Escape") cancel();
              }}
            />
            <Palette value={color} onChange={setColor} />
          </div>
        ) : (
          <TagChip name={tag.name} color={tag.color ?? DEFAULT_COLOR} />
        )}
        <div className="src-row__meta">
          <span>
            {n} contacto{n === 1 ? "" : "s"}
          </span>
          {tag.waLabel && (
            <span className="src-chip" title="Viene de las etiquetas de la app de WhatsApp (coexistencia) y se mantiene sincronizada">
              <NavIcon name="whatsapp" size={11} />
              De la app de WhatsApp
            </span>
          )}
        </div>
      </div>
      <div className="src-row__actions">
        {dirty && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {save.isPending ? "…" : "Guardar"}
          </button>
        )}
        {editing || dirty ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
            Cancelar
          </button>
        ) : (
          <button type="button" className="cp-iconbtn" onClick={() => setEditing(true)} title="Renombrar o cambiar el color" aria-label={`Editar ${tag.name}`}>
            <NavIcon name="pencil" size={13} />
          </button>
        )}
        <button
          type="button"
          className="cp-iconbtn is-danger"
          disabled={remove.isPending}
          onClick={() => {
            void confirmDialog({
              message: n > 0 ? `¿Eliminar la etiqueta «${tag.name}»? Se quitará de ${n} contacto${n === 1 ? "" : "s"}.` : `¿Eliminar la etiqueta «${tag.name}»?`,
              danger: true,
            }).then((ok) => ok && remove.mutate());
          }}
          title="Eliminar"
          aria-label={`Eliminar ${tag.name}`}
        >
          <NavIcon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}

/** La etiqueta tal como se pinta en la bandeja: píldora con su color y la tinta que se lea. */
export function TagChip({ name, color }: { name: string; color: string }) {
  const bg = /^#?[0-9a-fA-F]{3,8}$/.test(color) ? (color.startsWith("#") ? color : `#${color}`) : DEFAULT_COLOR;
  return (
    <span className="tag-chip" style={{ background: bg, color: readableInk(bg) }}>
      {name}
    </span>
  );
}

/** Ocho colores de un golpe y, al final, el selector libre con el color actual. */
function Palette({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const custom = !PALETTE.includes(value.toLowerCase());
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          className={`swatch-btn${value.toLowerCase() === c ? " is-on" : ""}`}
          style={{ background: c }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className={`swatch-btn swatch-btn--custom${custom ? " is-on" : ""}`} title="Otro color" style={custom ? { background: value } : undefined}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Otro color" />
        {!custom && <NavIcon name="plus" size={11} />}
      </label>
    </div>
  );
}

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14, marginTop: 0, maxWidth: "70ch", lineHeight: 1.5 };
