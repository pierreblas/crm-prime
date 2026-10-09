"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import {
  CURRENCIES,
  countryFromPhone,
  contactOriginLabels,
  utmKeys,
  type ContactListItem,
  type ContactOrigin,
  type CustomFieldDto,
  type SourceDto,
} from "@crm/shared";
import { setContactSource, updateContact } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";

/**
 * Ficha completa del contacto en panel lateral.
 *
 * Antes la edición estaba repartida por la fila de la tabla —el nombre en
 * línea, la fuente en un select, los campos en una fila desplegada—, así que
 * ni se veía todo junto ni se sabía qué estaba guardado. Aquí el contacto se
 * lee y se edita en un sitio, y la atribución de marketing tiene su propio
 * bloque en vez de mezclarse con los campos del negocio.
 */
export function ContactDrawer({
  contact,
  sources,
  fields,
  onClose,
  onSaved,
}: {
  contact: ContactListItem;
  sources: SourceDto[];
  fields: CustomFieldDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(contact.name ?? "");
  const [optIn, setOptIn] = useState(contact.optIn);
  const [values, setValues] = useState<Record<string, string>>(contact.fields);
  const [sourceId, setSourceId] = useState(contact.source?.id ?? "");
  // "" = la moneda de su país (deducida del teléfono).
  const [currency, setCurrency] = useState(contact.currencyOverride ?? "");

  // Al cambiar de contacto sin cerrar el panel, recargar el formulario.
  useEffect(() => {
    setName(contact.name ?? "");
    setOptIn(contact.optIn);
    setValues(contact.fields);
    setSourceId(contact.source?.id ?? "");
    setCurrency(contact.currencyOverride ?? "");
  }, [contact]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const countryCurrency = countryFromPhone(contact.phone)?.currency ?? null;

  const dirty =
    name !== (contact.name ?? "") ||
    optIn !== contact.optIn ||
    sourceId !== (contact.source?.id ?? "") ||
    currency !== (contact.currencyOverride ?? "") ||
    fields.some((f) => (values[f.key] ?? "") !== (contact.fields[f.key] ?? ""));

  const save = useMutation({
    mutationFn: async () => {
      await updateContact(contact.id, {
        name: name.trim() || null,
        optIn,
        fields: values,
        currency: currency || null,
      });
      // La fuente tiene su propio endpoint (afecta al reparto por vendedor).
      if (sourceId !== (contact.source?.id ?? "")) {
        await setContactSource(contact.id, sourceId || null);
      }
    },
    onSuccess: () => {
      toast.success("Contacto guardado");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const utms = Object.entries(contact.attribution.utms);
  const ad = contact.attribution.ad;

  return (
    <>
      <div style={backdrop} onClick={onClose} />
      <aside style={drawer} role="dialog" aria-label="Ficha del contacto">
        <header style={head}>
          <span style={avatar}>{initials(contact.name ?? contact.phone)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {contact.name || "Sin nombre"}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {contact.phone}
            </div>
          </div>
          <button onClick={onClose} style={iconBtn} title="Cerrar (Esc)">
            <NavIcon name="x" size={16} />
          </button>
        </header>

        <div style={body}>
          {/* ── Datos ───────────────────────────────────── */}
          <Section title="Datos">
            <Field label="Nombre">
              <input
                style={input}
                value={name}
                placeholder="Sin nombre"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="Fuente">
              <select
                style={input}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">— Sin fuente —</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="País y moneda para cotizar">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  {contact.country ? contact.country.name : "País no reconocido"}
                </span>
                <select
                  style={{ ...input, flex: 1, minWidth: 180 }}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  aria-label="Moneda para cotizar"
                >
                  <option value="">
                    {countryCurrency
                      ? `La de su país (${countryCurrency})`
                      : "La base de cada producto"}
                  </option>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={hint}>
                El agente de IA le da los precios en esta moneda cuando el producto la tiene.
              </div>
            </Field>

            <label style={switchRow}>
              <input
                type="checkbox"
                checked={optIn}
                onChange={(e) => setOptIn(e.target.checked)}
              />
              <span>
                <strong style={{ fontSize: 13 }}>Acepta mensajes (opt-in)</strong>
                <div style={hint}>
                  Sin opt-in, ni el bot ni las difusiones le escriben.
                </div>
              </span>
            </label>
          </Section>

          {/* ── Atribución ──────────────────────────────── */}
          <Section title="De dónde vino">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={badge(ORIGIN_COLORS[contact.origin])}>
                {contactOriginLabels[contact.origin]}
              </span>
              {contact.originDetail && (
                <span style={badge("var(--surface-3)")}>{contact.originDetail}</span>
              )}
            </div>

            {ad && (
              <div style={adCard}>
                <div style={adTitle}>
                  <NavIcon name="megaphone" size={14} />
                  Anuncio Click-to-WhatsApp
                </div>
                {ad.headline && <div style={adLine}>{ad.headline}</div>}
                {ad.body && (
                  <div style={{ ...adLine, color: "var(--muted)" }}>{ad.body}</div>
                )}
                <dl style={adGrid}>
                  {ad.sourceId && (
                    <>
                      <dt style={dt}>ID del anuncio</dt>
                      <dd style={dd}>{ad.sourceId}</dd>
                    </>
                  )}
                  {ad.ctwaClid && (
                    <>
                      <dt style={dt}>ctwa_clid</dt>
                      <dd style={{ ...dd, wordBreak: "break-all" }}>
                        {ad.ctwaClid}
                      </dd>
                    </>
                  )}
                </dl>
                {ad.sourceUrl && (
                  <a
                    href={ad.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={adLink}
                  >
                    Ver el anuncio
                  </a>
                )}
              </div>
            )}

            {utms.length > 0 ? (
              <dl style={utmGrid}>
                {utms.map(([k, v]) => (
                  <div key={k} style={utmRow}>
                    <dt style={dt}>{k.replace("utm_", "")}</dt>
                    <dd style={dd}>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              !ad && (
                <p style={hint}>
                  Sin datos de campaña. Los <code>utm_*</code> se capturan de los
                  parámetros del anuncio, del texto de un enlace{" "}
                  <code>wa.me</code> o del webhook de leads.
                </p>
              )
            )}
          </Section>

          {/* ── Etiquetas ───────────────────────────────── */}
          <Section title="Etiquetas">
            {contact.tags.length > 0 ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {contact.tags.map((t) => (
                  <span key={t.name} style={badge(t.color ?? "var(--surface-3)")}>
                    {t.name}
                  </span>
                ))}
              </div>
            ) : (
              <p style={hint}>
                Sin etiquetas. Las pone el bot o tú desde la conversación.
              </p>
            )}
          </Section>

          {/* ── Campos personalizados ───────────────────── */}
          <Section title="Campos del negocio">
            {fields.length === 0 ? (
              <p style={hint}>
                No has definido campos personalizados. Se crean en Ajustes ›
                Campos personalizados.
              </p>
            ) : (
              fields.map((f) => (
                <Field key={f.id} label={f.label}>
                  {f.type === "select" ? (
                    <select
                      style={input}
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    >
                      <option value="">—</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      style={input}
                      type={
                        f.type === "number"
                          ? "number"
                          : f.type === "date"
                            ? "date"
                            : "text"
                      }
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    />
                  )}
                </Field>
              ))
            )}
          </Section>
        </div>

        <footer style={foot}>
          <Link href="/" style={ghostBtn}>
            Abrir chat
          </Link>
          <div style={{ flex: 1 }} />
          {dirty && <span style={hint}>Sin guardar</span>}
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            style={{ ...primaryBtn, opacity: dirty ? 1 : 0.5 }}
          >
            {save.isPending ? "Guardando…" : "Guardar"}
          </button>
        </footer>
      </aside>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h4 style={sectionTitle}>{title}</h4>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  const digits = value.replace(/\D/g, "");
  return (digits.slice(-2) || value.slice(0, 2)).toUpperCase();
}

export const ORIGIN_COLORS: Record<ContactOrigin, string> = {
  ad: "#7a5fb0",
  whatsapp: "#1f4d38",
  webhook: "#2c4b7a",
  manual: "#3a3a3a",
  import: "#5a4a2a",
  call: "#3f7a8c",
};

// Se exporta para que la tabla marque qué contactos traen campaña.
export function hasAttribution(c: ContactListItem): boolean {
  return (
    !!c.attribution.ad ||
    utmKeys.some((k) => !!c.attribution.utms[k])
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 40,
};

const drawer: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: "min(440px, 100vw)",
  display: "flex",
  flexDirection: "column",
  background: "var(--surface, var(--panel))",
  borderLeft: "1px solid var(--border)",
  boxShadow: "-8px 0 24px rgba(0,0,0,0.4)",
  zIndex: 41,
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "16px 18px",
  borderBottom: "1px solid var(--border)",
};

const body: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "18px",
};

const foot: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 18px",
  borderTop: "1px solid var(--border)",
};

const avatar: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 42,
  height: 42,
  flexShrink: 0,
  borderRadius: "50%",
  background: "rgba(37,211,102,0.14)",
  color: "var(--positive, #7ee2a8)",
  fontSize: 14,
  fontWeight: 700,
};

const sectionTitle: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--muted)",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: "var(--muted)",
  marginBottom: 5,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field, var(--field))",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

const switchRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
  cursor: "pointer",
  marginTop: 4,
};

const hint: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 12,
  margin: "4px 0 0",
  lineHeight: 1.45,
};

const adCard: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: "rgba(122,95,176,0.12)",
  border: "1px solid #4a3a6a",
  marginBottom: 12,
};

const adTitle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  color: "#c9b6f0",
  marginBottom: 7,
};

const adLine: React.CSSProperties = { fontSize: 13, marginBottom: 3 };

const adGrid: React.CSSProperties = {
  margin: "9px 0 0",
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "3px 10px",
};

const adLink: React.CSSProperties = {
  display: "inline-block",
  marginTop: 8,
  fontSize: 12,
  color: "var(--accent-text)",
};

const utmGrid: React.CSSProperties = { margin: 0, display: "grid", gap: 4 };

const utmRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "90px 1fr",
  gap: 10,
  padding: "5px 9px",
  borderRadius: 7,
  background: "var(--field, var(--field))",
};

const dt: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--muted)",
  margin: 0,
  textTransform: "capitalize",
};

const dd: React.CSSProperties = { fontSize: 12.5, margin: 0 };

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent, #25d366)",
  color: "var(--accent-ink, #04210f)",
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 13px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 13,
  textDecoration: "none",
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
