"use client";

import Link from "next/link";
import { NavIcon } from "@/components/NavIcons";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SOURCE_KIND_LABEL, type SourceDto, type SourceKind } from "@crm/shared";
import { createSource, deleteSource, fetchSources, updateSource } from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { CustomFieldsEditor } from "@/features/contacts/CustomFieldsEditor";
import { ChannelMark } from "@/features/inbox/ChannelMark";

const DEFAULT_COLOR = "#2c4b7a";

// ── Fuentes ──────────────────────────────────────────────────
/**
 * Dos listas: las fuentes que crean los canales (una por vía de entrada; se
 * renombran, no se borran, y cada canal puede apuntar a otra desde Canales) y
 * las que crea la empresa para lo que no entra solo.
 */
export function SourcesSettings() {
  const queryClient = useQueryClient();
  const { data: sources = [], isPending } = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["sources"] });
    queryClient.invalidateQueries({ queryKey: ["sellers"] });
  };

  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const create = useMutation({
    mutationFn: () => createSource({ name: name.trim(), color }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const automatic = sources.filter((s) => s.kind);
  const own = sources.filter((s) => !s.kind);

  return (
    <Panel
      title="Fuentes"
      subtitle="De dónde viene cada contacto. Sirven para repartir el trabajo (cada vendedor ve los contactos de las fuentes que atiende) y para filtrar la bandeja, los contactos y las difusiones."
    >
      <section className="src-section" aria-labelledby="src-auto">
        <header className="src-section__head">
          <h4 id="src-auto">De tus canales</h4>
          <p>
            Se crean solas al conectar un canal y reciben a quien escribe por él. Puedes cambiarles el nombre y el color. Para que un
            número o una página use otra fuente, elígela en{" "}
            <Link href="/settings?tab=channels" className="cp-link">
              Canales
            </Link>{" "}
            («Configurar» en cada número; la fila de cada página).
          </p>
        </header>
        {!isPending && automatic.length === 0 && (
          <p className="src-empty">Aún no hay canales conectados. Al conectar WhatsApp, Messenger, Instagram o los formularios de Facebook aparecerán aquí.</p>
        )}
        {automatic.map((s) => (
          <SourceRow key={s.id} source={s} onChanged={refresh} />
        ))}
      </section>

      <section className="src-section" aria-labelledby="src-own">
        <header className="src-section__head">
          <h4 id="src-own">Tuyas</h4>
          <p>Para lo que no entra solo (Web, Referidos, Feria…) o para apuntarle un canal. La fuente de un contacto se cambia desde su ficha.</p>
        </header>
        <div className="src-new">
          <input type="color" className="src-swatch" value={color} onChange={(e) => setColor(e.target.value)} title="Color" aria-label="Color de la nueva fuente" />
          <input
            className="field field-sm"
            value={name}
            placeholder="Nueva fuente (ej. Referidos)"
            aria-label="Nombre de la nueva fuente"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            Añadir
          </button>
        </div>
        {isPending && <p className="src-empty">Cargando…</p>}
        {own.map((s) => (
          <SourceRow key={s.id} source={s} onChanged={refresh} />
        ))}
      </section>
    </Panel>
  );
}

function SourceRow({ source, onChanged }: { source: SourceDto; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(source.name);
  const [color, setColor] = useState(source.color ?? DEFAULT_COLOR);
  useEffect(() => {
    setName(source.name);
    setColor(source.color ?? DEFAULT_COLOR);
  }, [source.name, source.color]);
  const dirty = name.trim() !== source.name || color !== (source.color ?? DEFAULT_COLOR);

  const save = useMutation({
    mutationFn: () => updateSource(source.id, { name: name.trim(), color }),
    onSuccess: () => {
      setEditing(false);
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
  const cancel = () => {
    setName(source.name);
    setColor(source.color ?? DEFAULT_COLOR);
    setEditing(false);
  };
  const count = source.contactCount;

  return (
    <div className="src-row" data-source={source.name}>
      <input type="color" className="src-swatch" value={color} onChange={(e) => setColor(e.target.value)} title="Color" aria-label={`Color de ${source.name}`} />
      <div className="src-row__main">
        {editing ? (
          <input
            className="field field-sm"
            autoFocus
            value={name}
            maxLength={80}
            aria-label="Nombre de la fuente"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) save.mutate();
              if (e.key === "Escape") cancel();
            }}
          />
        ) : (
          <strong className="src-row__name">{source.name}</strong>
        )}
        <div className="src-row__meta">
          {source.kind && (
            <span className="src-kind">
              <SourceKindMark kind={source.kind} />
              {SOURCE_KIND_LABEL[source.kind]}
            </span>
          )}
          {source.channels.map((c, i) => (
            <span key={`${c.kind}-${c.label}-${i}`} className="src-chip" title={`Trae contactos desde ${SOURCE_KIND_LABEL[c.kind]}`}>
              <SourceKindMark kind={c.kind} />
              {c.label}
            </span>
          ))}
          <span>
            {count} contacto{count === 1 ? "" : "s"}
          </span>
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
          <button type="button" className="cp-iconbtn" onClick={() => setEditing(true)} title="Renombrar" aria-label={`Renombrar ${source.name}`}>
            <NavIcon name="pencil" size={13} />
          </button>
        )}
        {source.kind ? (
          <span className="src-lock" title="La crean tus canales: puedes renombrarla, no borrarla." aria-label="No se puede borrar">
            <NavIcon name="lock" size={13} />
          </span>
        ) : (
          <button
            type="button"
            className="cp-iconbtn is-danger"
            onClick={() => {
              void confirmDialog({
                message:
                  count > 0
                    ? `¿Eliminar la fuente «${source.name}»? Sus ${count} contacto${count === 1 ? "" : "s"} se quedan sin fuente.`
                    : `¿Eliminar la fuente «${source.name}»?`,
                danger: true,
              }).then((ok) => ok && remove.mutate());
            }}
            title="Eliminar"
            aria-label={`Eliminar ${source.name}`}
          >
            <NavIcon name="x" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/** La marca de la vía de entrada: el canal, el megáfono de los anuncios o el formulario. */
function SourceKindMark({ kind }: { kind: SourceKind }) {
  if (kind === "ad") return <NavIcon name="megaphone" size={11} />;
  if (kind === "form") return <NavIcon name="file" size={11} />;
  if (kind === "whatsapp") return <NavIcon name="whatsapp" size={11} />;
  return <ChannelMark kind={kind} size={11} />;
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
function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>{title}</h3>
        <p style={muted}>{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14, marginTop: 0, maxWidth: "70ch", lineHeight: 1.5 };
