"use client";

import { NavIcon } from "@/components/NavIcons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SourceDto,
} from "@crm/shared";
import {
  createSource,
  createStage,
  deleteSource,
  deleteStage,
  fetchSources,
  reorderStages,
  updateSource,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { CustomFieldsEditor } from "@/features/contacts/CustomFieldsEditor";

// ── Fuentes ──────────────────────────────────────────────────
export function SourcesSettings() {
  const queryClient = useQueryClient();
  const { data: sources = [], isPending } = useQuery({
    queryKey: ["sources"],
    queryFn: fetchSources,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["sources"] });
    queryClient.invalidateQueries({ queryKey: ["sellers"] });
  };

  const [name, setName] = useState("");
  const [color, setColor] = useState("#2c4b7a");

  const create = useMutation({
    mutationFn: () => createSource({ name: name.trim(), color }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Panel
      title="Fuentes de leads"
      subtitle="El origen de tus contactos (Facebook Ads, Instagram, Web, Referido…). Cada fuente se asigna a los vendedores que la atienden."
    >
      <div style={{ ...card, display: "flex", gap: 8, alignItems: "center" }}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={swatch} title="Color" />
        <input
          style={input}
          value={name}
          placeholder="Nueva fuente (ej. Facebook Ads)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()}
        />
        <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} style={primaryBtn}>
          Añadir
        </button>
      </div>
      {isPending && <p style={muted}>Cargando…</p>}
      {sources.map((s) => (
        <SourceRow key={s.id} source={s} onChanged={refresh} />
      ))}
    </Panel>
  );
}

function SourceRow({ source, onChanged }: { source: SourceDto; onChanged: () => void }) {
  const [name, setName] = useState(source.name);
  const [color, setColor] = useState(source.color ?? "#2c4b7a");
  const dirty = name.trim() !== source.name || color !== (source.color ?? "#2c4b7a");

  const save = useMutation({
    mutationFn: () => updateSource(source.id, { name: name.trim(), color }),
    onSuccess: () => {
      toast.success("Fuente actualizada");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => deleteSource(source.id),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div style={{ ...card, display: "flex", gap: 10, alignItems: "center" }}>
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={swatch} title="Color" />
      <input style={{ ...input, fontWeight: 600 }} value={name} onChange={(e) => setName(e.target.value)} />
      <span style={{ ...muted, fontSize: 12.5, whiteSpace: "nowrap" }}>
        {source.contactCount} contacto{source.contactCount === 1 ? "" : "s"}
      </span>
      {dirty && (
        <button onClick={() => save.mutate()} disabled={save.isPending} style={primaryBtn}>
          {save.isPending ? "…" : "Guardar"}
        </button>
      )}
      <button
        onClick={() => {
          void confirmDialog({ message: `¿Eliminar la fuente "${source.name}"?`, danger: true }).then(
            (ok) => ok && remove.mutate(),
          );
        }}
        style={dangerBtn}
        title="Eliminar"
      >
        <NavIcon name="x" size={14} />
      </button>
    </div>
  );
}

// ── Campos personalizados ────────────────────────────────────
export function CustomFieldsSettings() {
  return (
    <Panel
      title="Campos personalizados"
      subtitle="Datos extra de cada contacto (cumpleaños, ciudad, talla…). Cada campo tiene una clave fija para la API, los webhooks y la importación."
    >
      <CustomFieldsEditor />
    </Panel>
  );
}

// ── Etapas del pipeline ──────────────────────────────────────
// Los embudos y sus etapas viven en PipelinesSettings.tsx.

// ── Layout compartido ────────────────────────────────────────
function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>{title}</h3>
        <p style={muted}>{subtitle}</p>
      </header>
      {children}
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


function badge(bg: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: "#eaf2ff",
    whiteSpace: "nowrap",
  };
}
