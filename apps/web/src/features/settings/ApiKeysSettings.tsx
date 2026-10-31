"use client";

import { NavIcon } from "@/components/NavIcons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiScopeHints,
  apiScopeLabels,
  apiScopes,
  type ApiKeyDto,
  type ApiScope,
  type CreatedApiKey,
} from "@crm/shared";
import {
  createApiKey,
  deleteApiKey,
  fetchApiKeys,
  revokeApiKey,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { PlanGate } from "@/features/plans/usePlan";
import { toast } from "@/lib/toast";

/**
 * Ajustes › Claves de API. Una clave por integración entrante (n8n, Zapier,
 * una landing…). El secreto completo solo se ve al crearla.
 */
export function ApiKeysSettings() {
  const queryClient = useQueryClient();
  const { data: keys = [], isPending } = useQuery({
    queryKey: ["api-keys"],
    queryFn: fetchApiKeys,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["api-keys"] });

  const [creating, setCreating] = useState(false);
  // Secreto recién creado: se enseña hasta que el usuario lo descarta.
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <PlanGate feature="api" />
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Claves de API</h3>
        <p style={muted}>
          Para que sistemas externos escriban en tu CRM. Dale una clave propia a
          cada integración: así puedes revocar una sin tocar las demás y sabes
          cuál creó cada contacto.
        </p>
      </header>

      {justCreated && (
        <NewKeyBanner
          created={justCreated}
          onClose={() => setJustCreated(null)}
        />
      )}

      {creating ? (
        <NewKeyForm
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
            + Nueva clave
          </button>
        </div>
      )}

      {isPending && <p style={muted}>Cargando…</p>}
      {!isPending && keys.length === 0 && !creating && (
        <div style={{ ...card, color: "var(--muted)" }}>
          Todavía no hay claves. Mientras tanto, el webhook sigue aceptando el
          token heredado de <code>LEAD_WEBHOOK_TOKEN</code>.
        </div>
      )}

      {keys.map((k) => (
        <KeyRow key={k.id} apiKey={k} onChanged={refresh} />
      ))}
    </div>
  );
}

// El secreto no se puede recuperar: hay que dejarlo muy claro.
function NewKeyBanner({
  created,
  onClose,
}: {
  created: CreatedApiKey;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar; selecciónala a mano");
    }
  }

  return (
    <div style={banner}>
      <strong>Copia la clave ahora: no se puede volver a ver.</strong>
      <p style={{ ...muted, fontSize: 13, margin: "6px 0 10px" }}>
        Guardamos solo un hash. Si la pierdes, tendrás que crear otra.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code style={secretBox}>{created.secret}</code>
        <button onClick={copy} style={primaryBtn}>
          {copied ? "Copiada" : "Copiar"}
        </button>
        <button onClick={onClose} style={ghostBtn}>
          Ya la guardé
        </button>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13 }}>
          Cómo usarla
        </summary>
        <pre style={code}>
{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/bff/... \\
  -H "Authorization: Bearer ${created.secret}" \\
  -H "Content-Type: application/json" \\
  -d '{"phone":"+51999888777","name":"Ana","source":"Facebook Ads"}'`}
        </pre>
        <p style={{ ...muted, fontSize: 12 }}>
          El endpoint de leads es <code>POST /api/v1/webhooks/lead</code> en tu
          API. También se acepta la cabecera <code>x-api-key</code>.
        </p>
      </details>
    </div>
  );
}

function NewKeyForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (c: CreatedApiKey) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["leads:write"]);

  const create = useMutation({
    mutationFn: () => createApiKey({ name: name.trim(), scopes }),
    onSuccess: onCreated,
    onError: (e) => toast.error((e as Error).message),
  });

  function toggle(scope: ApiScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  return (
    <div style={card}>
      <label style={label}>Nombre de la integración</label>
      <input
        autoFocus
        style={input}
        value={name}
        placeholder="n8n-formulario-web"
        onChange={(e) => setName(e.target.value)}
      />
      <p style={hint}>
        Este nombre queda como procedencia de los contactos que cree esta clave.
      </p>

      <label style={{ ...label, marginTop: 14 }}>Permisos</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {apiScopes.map((s) => (
          <label key={s} style={scopeRow}>
            <input
              type="checkbox"
              checked={scopes.includes(s)}
              onChange={() => toggle(s)}
            />
            <span>
              <strong style={{ fontSize: 13 }}>{apiScopeLabels[s]}</strong>{" "}
              <code style={{ color: "var(--accent)", fontSize: 11 }}>{s}</code>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {apiScopeHints[s]}
              </div>
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          onClick={() => create.mutate()}
          disabled={!name.trim() || scopes.length === 0 || create.isPending}
          style={primaryBtn}
        >
          {create.isPending ? "Creando…" : "Crear clave"}
        </button>
        <button onClick={onCancel} style={ghostBtn}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function KeyRow({
  apiKey: k,
  onChanged,
}: {
  apiKey: ApiKeyDto;
  onChanged: () => void;
}) {
  const revoked = !!k.revokedAt;

  const revoke = useMutation({
    mutationFn: () => revokeApiKey(k.id),
    onSuccess: () => {
      toast.success("Clave revocada");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => deleteApiKey(k.id),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div style={{ ...card, opacity: revoked ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>{k.name}</strong>
        <code style={chip}>{k.prefix}…</code>
        {revoked && <span style={badge("#5a2a2a")}>Revocada</span>}
        <div style={{ flex: 1 }} />
        {!revoked && (
          <button
            onClick={() => {
              void confirmDialog({
                message: `¿Revocar la clave "${k.name}"? La integración dejará de funcionar de inmediato.`,
                danger: true,
              }).then((ok) => ok && revoke.mutate());
            }}
            style={ghostBtn}
          >
            Revocar
          </button>
        )}
        <button
          onClick={() => {
            void confirmDialog({
              message: `¿Eliminar "${k.name}"? Se pierde también su historial de uso.`,
              danger: true,
            }).then((ok) => ok && remove.mutate());
          }}
          style={dangerBtn}
          title="Eliminar"
        >
          <NavIcon name="x" size={14} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
        {k.scopes.map((s) => (
          <span key={s} style={badge("#2c4b7a")}>
            {apiScopeLabels[s]}
          </span>
        ))}
      </div>

      <div style={{ ...muted, fontSize: 12, marginTop: 9 }}>
        {k.lastUsedAt
          ? `Último uso: ${new Date(k.lastUsedAt).toLocaleString("es")} · ${k.useCount} llamada${k.useCount === 1 ? "" : "s"}`
          : "Todavía no se ha usado"}
        {k.createdByName ? ` · creada por ${k.createdByName}` : ""}
      </div>
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
  background: "rgba(63,140,110,0.12)",
  border: "1px solid #2f6b52",
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

const code: React.CSSProperties = {
  background: "var(--field)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 11,
  fontSize: 11.5,
  overflowX: "auto",
  whiteSpace: "pre",
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
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

const hint: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 12,
  margin: "6px 0 0",
};

const scopeRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
  cursor: "pointer",
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

const chip: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 6,
  background: "var(--field)",
  border: "1px solid var(--border)",
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
