"use client";

import { readableInk } from "@/lib/readable-ink";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  webhookEventLabels,
  webhookEvents,
  type CreatedWebhook,
  type WebhookEvent,
  type WebhookSubscriptionDto,
} from "@crm/shared";
import {
  createWebhookOut,
  deleteWebhookOut,
  fetchWebhooksOut,
  testWebhookOut,
  updateWebhookOut,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";

/**
 * Ajustes › Webhooks salientes. El CRM avisa a sistemas externos cuando pasa
 * algo, que es lo contrario de la API pública (donde ellos preguntan).
 */
export function WebhooksOutSettings() {
  const queryClient = useQueryClient();
  const { data: hooks = [], isPending } = useQuery({
    queryKey: ["webhooks-out"],
    queryFn: fetchWebhooksOut,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["webhooks-out"] });

  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedWebhook | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Webhooks salientes</h3>
        <p style={muted}>
          Avisa a otros sistemas en cuanto pasa algo en el CRM: un mensaje que
          entra, una oportunidad que avanza, la IA que escala. Cada envío va
          firmado para que el receptor pueda verificar que viene de aquí.
        </p>
      </header>

      {justCreated && (
        <SecretBanner
          created={justCreated}
          onClose={() => setJustCreated(null)}
        />
      )}

      {creating ? (
        <NewWebhookForm
          onCancel={() => setCreating(false)}
          onCreated={(c) => {
            setJustCreated(c);
            setCreating(false);
            refresh();
          }}
        />
      ) : (
        <div>
          <button onClick={() => setCreating(true)} style={primaryBtn}>
            Nuevo webhook
          </button>
        </div>
      )}

      {isPending && <p style={muted}>Cargando…</p>}
      {!isPending && hooks.length === 0 && !creating && (
        <div style={{ ...card, color: "var(--muted)" }}>
          Todavía no hay ninguno. Los pasos para conectar n8n o Zapier están en{" "}
          <code>INTEGRATIONS.md</code>.
        </div>
      )}

      {hooks.map((h) => (
        <WebhookRow key={h.id} hook={h} onChanged={refresh} />
      ))}
    </div>
  );
}

function SecretBanner({
  created,
  onClose,
}: {
  created: CreatedWebhook;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={banner}>
      <strong>Copia el secreto de firma: no se vuelve a mostrar.</strong>
      <p style={{ ...muted, fontSize: 13, margin: "6px 0 10px" }}>
        Tu sistema lo necesita para verificar la cabecera{" "}
        <code>X-CRM-Signature</code> y descartar avisos que no vengan del CRM.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code style={secretBox}>{created.secret}</code>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(created.secret);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("No se pudo copiar; selecciónalo a mano");
            }
          }}
          style={primaryBtn}
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
        <button onClick={onClose} style={ghostBtn}>
          Ya lo guardé
        </button>
      </div>
    </div>
  );
}

function NewWebhookForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (c: CreatedWebhook) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["message.received"]);

  const create = useMutation({
    mutationFn: () => createWebhookOut({ name: name.trim(), url: url.trim(), events }),
    onSuccess: onCreated,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div style={card}>
      <label style={label}>Nombre</label>
      <input
        autoFocus
        style={input}
        value={name}
        placeholder="n8n · pedidos"
        onChange={(e) => setName(e.target.value)}
      />

      <label style={{ ...label, marginTop: 12 }}>URL de destino</label>
      <input
        style={input}
        value={url}
        placeholder="https://n8n.midominio.com/webhook/crm"
        onChange={(e) => setUrl(e.target.value)}
      />
      <p style={hint}>Tiene que ser alcanzable desde donde corre el CRM.</p>

      <label style={{ ...label, marginTop: 14 }}>Eventos</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {webhookEvents.map((ev) => (
          <label key={ev} style={eventRow}>
            <input
              type="checkbox"
              checked={events.includes(ev)}
              onChange={() =>
                setEvents((p) =>
                  p.includes(ev) ? p.filter((x) => x !== ev) : [...p, ev],
                )
              }
            />
            <span>
              <strong style={{ fontSize: 13 }}>{webhookEventLabels[ev]}</strong>{" "}
              <code style={{ color: "var(--accent-text)", fontSize: 11 }}>{ev}</code>
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          onClick={() => create.mutate()}
          disabled={!name.trim() || !url.trim() || !events.length || create.isPending}
          style={primaryBtn}
        >
          {create.isPending ? "Creando…" : "Crear webhook"}
        </button>
        <button onClick={onCancel} style={ghostBtn}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function WebhookRow({
  hook: h,
  onChanged,
}: {
  hook: WebhookSubscriptionDto;
  onChanged: () => void;
}) {
  const test = useMutation({
    mutationFn: () => testWebhookOut(h.id),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const toggle = useMutation({
    mutationFn: () => updateWebhookOut(h.id, { isActive: !h.isActive }),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => deleteWebhookOut(h.id),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });

  // Un fallo persistente merece verse sin abrir nada.
  const broken = h.lastStatus !== null && (h.lastStatus < 200 || h.lastStatus >= 300);

  return (
    <div style={{ ...card, opacity: h.isActive ? 1 : 0.6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>{h.name}</strong>
        {!h.isActive && <span style={badge("#3f5b6b")}>Pausado</span>}
        {broken && <span style={badge("#b3261e")}>Error {h.lastStatus}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => test.mutate()} disabled={test.isPending} style={ghostBtn}>
          {test.isPending ? "…" : "Probar"}
        </button>
        <button onClick={() => toggle.mutate()} disabled={toggle.isPending} style={ghostBtn}>
          {h.isActive ? "Pausar" : "Reanudar"}
        </button>
        <button
          onClick={() => {
            void confirmDialog({
              message: `¿Eliminar "${h.name}"? El sistema dejará de recibir avisos.`,
              danger: true,
            }).then((ok) => ok && remove.mutate());
          }}
          style={dangerBtn}
          title="Eliminar"
        >
          <NavIcon name="x" size={14} />
        </button>
      </div>

      <code style={{ ...urlBox, marginTop: 8 }}>{h.url}</code>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 9 }}>
        {h.events.map((e) => (
          <span key={e} style={badge("#0a58b4")}>
            {webhookEventLabels[e] ?? e}
          </span>
        ))}
      </div>

      {test.data && (
        <div style={{ ...resultBox(test.data.ok), display: "flex", alignItems: "center", gap: 6 }}>
          <NavIcon name={test.data.ok ? "check" : "x"} size={14} />
          {test.data.message} · {test.data.latencyMs} ms
        </div>
      )}

      <div style={{ ...muted, fontSize: 12, marginTop: 9 }}>
        {h.deliveredCount} entregado{h.deliveredCount === 1 ? "" : "s"} ·{" "}
        {h.failedCount} fallido{h.failedCount === 1 ? "" : "s"}
        {h.lastDeliveryAt
          ? ` · último intento ${new Date(h.lastDeliveryAt).toLocaleString("es")}`
          : " · sin intentos aún"}
      </div>
      {broken && h.lastError && (
        <div style={{ ...muted, fontSize: 12, color: "var(--danger)", marginTop: 3 }}>
          {h.lastError}
        </div>
      )}
    </div>
  );
}

const muted: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 14,
  marginTop: 0,
};

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 14,
};

const banner: React.CSSProperties = {
  ...card,
  background: "rgba(126, 226, 168, 0.12)",
  border: "1px solid var(--positive-border)",
};

const secretBox: React.CSSProperties = {
  flex: 1,
  padding: "9px 11px",
  borderRadius: 8,
  background: "var(--field)",
  border: "1px solid var(--border)",
  fontSize: 12.5,
  wordBreak: "break-all",
  fontFamily: "ui-monospace, monospace",
};

const urlBox: React.CSSProperties = {
  display: "block",
  padding: "6px 9px",
  borderRadius: 7,
  background: "var(--field, var(--field))",
  border: "1px solid var(--border)",
  fontSize: 12,
  wordBreak: "break-all",
};

const label: React.CSSProperties = {
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

const hint: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 12,
  margin: "6px 0 0",
};

const eventRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
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
  whiteSpace: "nowrap",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 13px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const dangerBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "1px solid var(--danger-border)",
  background: "transparent",
  color: "var(--danger)",
  cursor: "pointer",
  flexShrink: 0,
};

function badge(bg: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: readableInk(bg),
    whiteSpace: "nowrap",
  };
}

function resultBox(ok: boolean): React.CSSProperties {
  return {
    marginTop: 10,
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 12.5,
    background: ok ? "rgba(126, 226, 168, 0.14)" : "rgba(240, 138, 138, 0.14)",
    border: `1px solid ${ok ? "var(--positive-border)" : "var(--danger-border)"}`,
    color: ok ? "var(--positive)" : "var(--danger)",
  };
}
