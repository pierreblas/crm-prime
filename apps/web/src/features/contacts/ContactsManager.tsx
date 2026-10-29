"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "@/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmDialog } from "@/lib/confirm";
import {
  contactOriginLabels,
  type ContactListItem,
  type SourceDto,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { ImportContactsDialog } from "./ImportContactsDialog";
import {
  ContactDrawer,
  ORIGIN_COLORS,
  hasAttribution,
  initials,
} from "./ContactDrawer";
import {
  createContact,
  createDeal,
  fetchContactDirectory,
  fetchCustomFields,
  fetchSources,
  setContactSource,
  updateContact,
} from "@/lib/bff";

export function ContactsManager() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: contacts, isPending } = useQuery({
    queryKey: ["contact-directory", search],
    queryFn: () => fetchContactDirectory(search),
  });
  const { data: sources = [] } = useQuery({
    queryKey: ["sources"],
    queryFn: fetchSources,
  });
  const { data: fields = [] } = useQuery({
    queryKey: ["custom-fields"],
    queryFn: fetchCustomFields,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["contact-directory"] });

  // El panel lee del listado, así que al guardar se refresca solo.
  const openContact = (contacts ?? []).find((c) => c.id === openId) ?? null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          style={searchInput}
          value={search}
          placeholder="Buscar por nombre o teléfono…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <button onClick={() => setShowWebhook((v) => !v)} style={toolBtn}>
          <NavIcon name="globe" size={15} />
          Webhook
        </button>
        <button onClick={() => setShowFields((v) => !v)} style={toolBtn}>
          <NavIcon name="settings" size={15} />
          Campos
        </button>
        <button onClick={() => setImporting(true)} style={toolBtn} data-open-import>
          <NavIcon name="arrow-up" size={15} />
          Importar
        </button>
        <button onClick={() => setCreating((v) => !v)} style={primaryBtn}>
          Nuevo contacto
        </button>
      </div>
      {importing && <ImportContactsDialog onClose={() => setImporting(false)} />}

      {showWebhook && <WebhookInfo />}
      {showFields && (
        <div style={infoBox}>
          <CustomFieldsEditor />
        </div>
      )}

      {creating && (
        <NewContactForm
          sources={sources}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      {isPending && <p style={muted}>Cargando…</p>}

      <table style={table}>
        <thead>
          <tr>
            <Th>Contacto</Th>
            <Th>Llegó por</Th>
            <Th>Fuente</Th>
            <Th>Etiquetas</Th>
            <Th>Opt-in</Th>
            <Th>Último mensaje</Th>
          </tr>
        </thead>
        <tbody>
          {(contacts ?? []).map((c) => (
            <ContactRow key={c.id} contact={c} onOpen={() => setOpenId(c.id)} />
          ))}
        </tbody>
      </table>
      {contacts && contacts.length === 0 && !isPending && (
        <div style={emptyState}>
          <NavIcon name="user" size={28} />
          <p style={{ margin: "10px 0 0", fontWeight: 600 }}>
            {search.trim() ? "Sin resultados" : "Todavía no hay contactos"}
          </p>
          <p style={{ ...muted, margin: "4px 0 0", fontSize: 13 }}>
            {search.trim()
              ? `Ningún contacto coincide con «${search.trim()}».`
              : "Llegarán solos en cuanto alguien escriba a tu WhatsApp, o créalos a mano."}
          </p>
        </div>
      )}

      {openContact && (
        <ContactDrawer
          contact={openContact}
          sources={sources}
          fields={fields}
          onClose={() => setOpenId(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function WebhookInfo() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/api/v1/webhooks/lead`;
  const example = `curl -X POST ${url} \\
  -H "x-webhook-token: TU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"phone":"+51999...","name":"Ana","source":"Facebook Ads","tags":["nuevo"],"fields":{"ciudad":"Lima"}}'`;
  return (
    <div style={infoBox}>
      <strong>Webhook para recibir leads</strong>
      <p style={{ ...muted, margin: "6px 0" }}>
        Envía leads desde landing pages, anuncios, n8n o Zapier con un{" "}
        <code>POST</code> a esta URL y el header{" "}
        <code>x-webhook-token</code> = tu <code>LEAD_WEBHOOK_TOKEN</code>. Crea o
        actualiza el contacto por teléfono (fuente, etiquetas y campos incluidos).
      </p>
      <code style={urlBox}>{url}</code>
      <pre style={pre}>{example}</pre>
    </div>
  );
}

function ContactRow({
  contact: c,
  onOpen,
}: {
  contact: ContactListItem;
  onOpen: () => void;
}) {
  const last = c.lastMessageAt ? new Date(c.lastMessageAt) : null;

  return (
    <tr style={tr} onClick={onOpen} className="contact-row">
      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={avatar}>{initials(c.name ?? c.phone)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{c.name || "Sin nombre"}</div>
            <div style={{ ...muted, fontSize: 12.5 }}>{c.phone}</div>
          </div>
        </div>
      </td>

      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={badge(ORIGIN_COLORS[c.origin])}>
            {contactOriginLabels[c.origin]}
          </span>
          {/* Un contacto con campaña detrás merece verse desde la tabla. */}
          {hasAttribution(c) && (
            <span style={campaignChip} title="Tiene datos de campaña">
              <NavIcon name="megaphone" size={11} />
              campaña
            </span>
          )}
        </div>
        {c.originDetail && (
          <div style={{ ...muted, fontSize: 11.5, marginTop: 3 }}>
            {c.originDetail.length > 26
              ? `${c.originDetail.slice(0, 26)}…`
              : c.originDetail}
          </div>
        )}
      </td>

      <td style={td}>
        {c.source ? (
          <span style={badge(c.source.color ?? "var(--surface-3)")}>{c.source.name}</span>
        ) : (
          <span style={muted}>—</span>
        )}
      </td>

      <td style={td}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {c.tags.slice(0, 3).map((t) => (
            <span key={t.name} style={badge(t.color ?? "var(--surface-3)")}>
              {t.name}
            </span>
          ))}
          {c.tags.length > 3 && (
            <span style={{ ...muted, fontSize: 12 }}>+{c.tags.length - 3}</span>
          )}
          {c.tags.length === 0 && <span style={muted}>—</span>}
        </div>
      </td>

      <td style={td}>
        {c.optIn ? (
          <span style={{ ...okMark, color: "#7ee2a8" }}>
            <NavIcon name="check" size={14} /> Sí
          </span>
        ) : (
          <span style={{ ...okMark, color: "#e08a8a" }}>
            <NavIcon name="x" size={14} /> No
          </span>
        )}
      </td>

      <td style={{ ...td, ...muted, fontSize: 12.5, whiteSpace: "nowrap" }}>
        {last ? relativeDay(last) : "—"}
      </td>
    </tr>
  );
}

// "hace 3 h" / "ayer" / "12 sep": orientación sin saturar la columna.
function relativeDay(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `hace ${Math.max(1, mins)} min`;
  if (mins < 60 * 24) return `hace ${Math.round(mins / 60)} h`;
  if (mins < 60 * 48) return "ayer";
  return d.toLocaleDateString("es", { day: "numeric", month: "short" });
}

function NewContactForm({
  sources,
  onClose,
  onSaved,
}: {
  sources: SourceDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      createContact({ name: name.trim() || null, phone: phone.trim(), sourceId }),
    onSuccess: () => {
      toast.success("Contacto creado");
      onSaved();
    },
  });

  return (
    <div style={formBox}>
      <input style={input} value={name} placeholder="Nombre" onChange={(e) => setName(e.target.value)} />
      <input style={input} value={phone} placeholder="Teléfono (+51…)" onChange={(e) => setPhone(e.target.value)} />
      <select style={input} value={sourceId ?? ""} onChange={(e) => setSourceId(e.target.value || null)}>
        <option value="">— Sin fuente —</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {save.isError && (
        <span style={{ color: "#ff6b6b", fontSize: 13, alignSelf: "center" }}>
          {(save.error as Error).message}
        </span>
      )}
      <button onClick={onClose} style={ghostBtn}>Cancelar</button>
      <button
        onClick={() => save.mutate()}
        disabled={!phone.trim() || save.isPending}
        style={primaryBtn}
      >
        {save.isPending ? "Guardando…" : "Crear"}
      </button>
    </div>
  );
}

// Procedencia técnica: por qué vía entró el contacto. `detail` precisa cuál
// (el número de WhatsApp que lo recibió, la integración del webhook…).

const avatar: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  flexShrink: 0,
  borderRadius: "50%",
  background: "rgba(37,211,102,0.12)",
  color: "var(--positive, #7ee2a8)",
  fontSize: 12,
  fontWeight: 700,
};

const campaignChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 10.5,
  fontWeight: 600,
  padding: "2px 7px",
  borderRadius: 999,
  background: "rgba(122,95,176,0.18)",
  color: "#c9b6f0",
};

const okMark: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 13,
};

const toolBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 13.5,
};

function badge(bg: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "3px 9px",
    borderRadius: 999,
    background: bg,
    color: "#eaf2ff",
    whiteSpace: "nowrap",
  };
}

const emptyState: React.CSSProperties = {
  textAlign: "center",
  color: "var(--muted)",
  padding: "48px 24px",
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 12, color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>
      {children}
    </th>
  );
}

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 18,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "var(--shadow-card)",
};

const tr: React.CSSProperties = { borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "12px", fontSize: 14, verticalAlign: "middle" };
const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14 };

const searchInput: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

const formBox: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginTop: 12,
  padding: 14,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  flexWrap: "wrap",
};

const input: React.CSSProperties = {
  flex: 1,
  minWidth: 140,
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

const miniInput: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13,
};

const select: React.CSSProperties = {
  padding: "6px 9px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13,
};


const primaryBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "#f3f8ff",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghostBtn: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const miniBtn: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 6,
  border: "none",
  background: "var(--accent)",
  color: "#f3f8ff",
  cursor: "pointer",
  fontWeight: 700,
};

const linkBtn: React.CSSProperties = {
  fontSize: 13,
  color: "var(--accent)",
  textDecoration: "none",
};

const infoBox: React.CSSProperties = {
  marginTop: 12,
  padding: 16,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
};

const urlBox: React.CSSProperties = {
  display: "block",
  padding: "8px 10px",
  background: "var(--field)",
  borderRadius: 8,
  border: "1px solid var(--border)",
  fontSize: 13,
  color: "#7ee2a8",
  wordBreak: "break-all",
};

const pre: React.CSSProperties = {
  marginTop: 10,
  padding: 12,
  background: "var(--field)",
  borderRadius: 8,
  border: "1px solid var(--border)",
  fontSize: 12,
  color: "#aebfd6",
  overflowX: "auto",
  whiteSpace: "pre-wrap",
};

function chip(color: string | null): React.CSSProperties {
  const bg =
    color && /^#?[0-9a-fA-F]{3,8}$/.test(color)
      ? color.startsWith("#")
        ? color
        : `#${color}`
      : "#2c4b7a";
  return {
    fontSize: 11,
    padding: "2px 9px",
    borderRadius: 999,
    background: bg,
    color: "#eaf2ff",
  };
}
