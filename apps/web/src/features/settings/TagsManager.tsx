"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TagDto } from "@crm/shared";
import { createTag, deleteTag, fetchTags, updateTag } from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";

const DEFAULT_COLOR = "#2c4b7a";

export function TagsManager() {
  const queryClient = useQueryClient();
  const { data: tags = [], isPending, isError, error } = useQuery({
    queryKey: ["tags"],
    queryFn: fetchTags,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tags"] });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Etiquetas</h3>
        <p style={muted}>
          Organiza y segmenta tus contactos. Las etiquetas se usan en la bandeja,
          en los contactos y al construir audiencias de difusiones.
        </p>
      </header>

      <CreateTag onCreated={refresh} />

      {isPending && <p style={muted}>Cargando…</p>}
      {isError && <p style={{ color: "var(--danger)" }}>{(error as Error).message}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tags.map((t) => (
          <TagRow key={t.id} tag={t} onChanged={refresh} />
        ))}
        {!isPending && tags.length === 0 && (
          <div style={empty}>
            <div style={{ color: "var(--muted)", opacity: 0.6 }}>
              <NavIcon name="tag" size={30} />
            </div>
            <p style={muted}>Aún no hay etiquetas. Crea la primera arriba.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateTag({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);

  const create = useMutation({
    mutationFn: () => createTag({ name: name.trim(), color }),
    onSuccess: () => {
      setName("");
      setColor(DEFAULT_COLOR);
      onCreated();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div style={{ ...card, display: "flex", gap: 8, alignItems: "center" }}>
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        style={swatch}
        title="Color"
      />
      <input
        style={input}
        value={name}
        placeholder="Nueva etiqueta (ej. VIP, Frío, Mayorista)"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) create.mutate();
        }}
      />
      <button
        onClick={() => create.mutate()}
        disabled={!name.trim() || create.isPending}
        style={primaryBtn}
      >
        {create.isPending ? "Añadiendo…" : "Añadir"}
      </button>
    </div>
  );
}

function TagRow({ tag, onChanged }: { tag: TagDto; onChanged: () => void }) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color ?? DEFAULT_COLOR);
  const dirty = name.trim() !== tag.name || color !== (tag.color ?? DEFAULT_COLOR);

  const save = useMutation({
    mutationFn: () => updateTag(tag.id, { name: name.trim(), color }),
    onSuccess: () => {
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

  return (
    <div style={{ ...card, display: "flex", gap: 10, alignItems: "center" }}>
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        style={swatch}
        title="Color"
      />
      <input
        style={{ ...input, fontWeight: 600 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <span style={{ ...muted, fontSize: 12.5, whiteSpace: "nowrap" }}>
        {tag.contactCount} contacto{tag.contactCount === 1 ? "" : "s"}
      </span>
      {dirty && (
        <button onClick={() => save.mutate()} disabled={save.isPending} style={primaryBtn}>
          {save.isPending ? "…" : "Guardar"}
        </button>
      )}
      <button
        onClick={() => {
          void confirmDialog({
            message: `¿Eliminar la etiqueta "${tag.name}"?${tag.contactCount > 0 ? ` Se quitará de ${tag.contactCount} contacto(s).` : ""}`,
            danger: true,
          }).then((ok) => ok && remove.mutate());
        }}
        disabled={remove.isPending}
        style={dangerBtn}
        title="Eliminar"
      >
        <NavIcon name="x" size={14} />
      </button>
    </div>
  );
}

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14, marginTop: 0 };

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 12,
  boxShadow: "var(--shadow-card)",
};

const empty: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
  textAlign: "center",
  padding: "50px 24px",
  border: "1px dashed var(--border)",
  borderRadius: 12,
};

const input: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
};

const swatch: React.CSSProperties = {
  width: 38,
  height: 38,
  padding: 0,
  border: "none",
  background: "none",
  cursor: "pointer",
  flexShrink: 0,
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dangerBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "1px solid #5a2a2a",
  background: "transparent",
  color: "#e08a8a",
  cursor: "pointer",
  fontSize: 13,
  flexShrink: 0,
};
