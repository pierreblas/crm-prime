"use client";

import { provisionTwilio, updateIntegrationSettings as saveIntegrations } from "@/lib/bff";
import type { TwilioProvisionResult } from "@crm/shared";

import { NavIcon } from "@/components/NavIcons";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiKeyState,
  IntegrationSettingsDto,
  IntegrationTestResult,
} from "@crm/shared";
import {
  fetchIntegrationSettings,
  testIntegration,
  updateIntegrationSettings,
} from "@/lib/bff";
import { toast } from "@/lib/toast";
import { ghostBtn as ghostBase, primaryBtn, smBtn } from "@/components/ui";

const ghostBtn: React.CSSProperties = { ...ghostBase, ...smBtn };

/**
 * Ajustes › Integraciones. Credenciales que el CRM usa para llamar a
 * terceros. Se guardan cifradas; si se dejan vacías se usa el .env.
 *
 * El token de WhatsApp por número NO está aquí: vive en cada canal
 * (pestaña Canales). Aquí solo lo que es a nivel de app de Meta.
 */
export function IntegrationsSettings() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["integration-settings"],
    queryFn: fetchIntegrationSettings,
  });

  const [voyageModel, setVoyageModel] = useState("");
  const [appId, setAppId] = useState("");
  const [graphVersion, setGraphVersion] = useState("");
  // undefined = no se toca el secreto guardado; "" lo borra.
  const [voyageKey, setVoyageKey] = useState<string | undefined>();
  const [appSecret, setAppSecret] = useState<string | undefined>();
  const [verifyToken, setVerifyToken] = useState<string | undefined>();
  const [test, setTest] = useState<IntegrationTestResult | null>(null);

  useEffect(() => {
    if (!data) return;
    setVoyageModel(data.voyageModel);
    setAppId(data.whatsappAppId ?? "");
    setGraphVersion(data.whatsappGraphVersion);
    setVoyageKey(undefined);
    setAppSecret(undefined);
    setVerifyToken(undefined);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      updateIntegrationSettings({
        voyageModel: voyageModel.trim() || undefined,
        whatsappAppId: appId.trim() || null,
        whatsappGraphVersion: graphVersion.trim() || undefined,
        ...(voyageKey !== undefined ? { voyageKey } : {}),
        ...(appSecret !== undefined ? { whatsappAppSecret: appSecret } : {}),
        ...(verifyToken !== undefined
          ? { whatsappVerifyToken: verifyToken }
          : {}),
      }),
    onSuccess: (fresh: IntegrationSettingsDto) => {
      queryClient.setQueryData(["integration-settings"], fresh);
      setTest(null);
      toast.success("Integraciones guardadas");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const check = useMutation({
    mutationFn: testIntegration,
    onSuccess: setTest,
    onError: (e) => toast.error((e as Error).message),
  });

  if (isPending || !data) {
    return (
      <div>
        <h3 style={{ margin: "0 0 4px" }}>Integraciones</h3>
        <p style={muted}>Cargando…</p>
      </div>
    );
  }

  const dirty =
    voyageModel !== data.voyageModel ||
    appId !== (data.whatsappAppId ?? "") ||
    graphVersion !== data.whatsappGraphVersion ||
    voyageKey !== undefined ||
    appSecret !== undefined ||
    verifyToken !== undefined;

  // SaaS: lo de WhatsApp aquí es la app de Meta PROPIA de la empresa, un
  // camino opcional; la app de la plataforma no se configura desde aquí.
  const saas = data.whatsappWebhookUrl != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Integraciones</h3>
        <p style={muted}>
          Credenciales que el CRM usa para llamar a otros servicios. Se guardan
          cifradas; si las dejas vacías se usa lo que haya en el archivo .env.
        </p>
      </header>

      <TwilioCard data={data} onSaved={(fresh) => queryClient.setQueryData(["integration-settings"], fresh)} />

      {/* ── Embeddings ─────────────────────────────────────── */}
      <div style={card}>
        <div style={rowHead}>
          <strong style={{ fontSize: 14 }}>Embeddings (Voyage AI)</strong>
          <span
            style={badge(
              data.embeddingsProvider === "voyage" ? "#1f4d38" : "#5a4a2a",
            )}
          >
            {data.embeddingsProvider === "voyage" ? "Activo" : "Simulado"}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => check.mutate()}
            disabled={check.isPending || dirty}
            style={ghostBtn}
            title={dirty ? "Guarda los cambios antes de probar" : undefined}
          >
            {check.isPending ? "Probando…" : "Probar conexión"}
          </button>
        </div>
        <p style={hint}>
          Convierte tu base de conocimiento en vectores para que el bot
          encuentre la respuesta correcta. Sin key, la búsqueda es pobre.
        </p>

        <SecretField
          label="API key"
          state={data.voyageKey}
          envVar="VOYAGE_API_KEY"
          placeholder="pa-…"
          value={voyageKey}
          onChange={setVoyageKey}
        />

        <label style={{ ...label, marginTop: 12 }}>Modelo</label>
        <input
          style={input}
          value={voyageModel}
          onChange={(e) => setVoyageModel(e.target.value)}
        />

        {test && (
          <div style={{ ...testBox(test.ok), display: "flex", alignItems: "center", gap: 6 }}>
            <NavIcon name={test.ok ? "check" : "x"} size={14} />
            {test.message}
          </div>
        )}

        {data.embeddingsProvider === "voyage" && (
          <p style={{ ...hint, color: "#e0b766", display: "flex", alignItems: "flex-start", gap: 6 }}>
            <NavIcon name="alert" size={14} />
            Si cambias de embedder (o pones/quitas la key), los vectores
            antiguos dejan de ser comparables: hay que reindexar la base de
            conocimiento.
          </p>
        )}
      </div>

      {/* ── WhatsApp a nivel de app ────────────────────────── */}
      <div style={card}>
        <div style={rowHead}>
          <strong style={{ fontSize: 14 }}>
            {saas ? "Tu propia app de Meta (opcional)" : "WhatsApp (nivel de app)"}
          </strong>
          <span
            style={badge(
              data.webhookSignatureVerified ? "#1f4d38" : saas ? "#3a3a3a" : "#5a4a2a",
            )}
          >
            {saas
              ? data.webhookSignatureVerified
                ? "App propia activa"
                : "Usando la app de la plataforma"
              : data.webhookSignatureVerified
                ? "Firma verificada"
                : "Firma SIN verificar"}
          </span>
        </div>

        {saas ? (
          <>
            <p style={hint}>
              Lo normal es conectar tu número con el botón de la pestaña
              WhatsApp: usa la app de Meta de la plataforma y aquí no hay que
              tocar nada. Si prefieres usar <strong>tu propia app de Meta</strong>{" "}
              —o mientras la plataforma no tenga aprobado el acceso avanzado de
              Meta—, sigue estos pasos:
            </p>
            <ol style={{ ...hint, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>
                En <strong>developers.facebook.com</strong> crea una app de tipo
                Negocio y añádele el producto <strong>WhatsApp</strong>.
              </li>
              <li>
                Pega aquí su <strong>App ID</strong>, su <strong>App secret</strong>{" "}
                (Configuración › Básica) y un <strong>verify token</strong> que
                elijas tú. Guarda.
              </li>
              <li>
                En tu app → WhatsApp → Configuración → <strong>Webhooks</strong>:
                URL de devolución de llamada = la de abajo; verify token = el que
                guardaste. Suscribe <code>messages</code> (y{" "}
                <code>message_echoes</code> si también usarás el número desde el
                celular).
              </li>
              <li>
                En la pestaña WhatsApp → «Añadir un número a mano»: Phone number
                ID, WABA ID y un token <strong>permanente</strong> (usuario del
                sistema con los permisos de WhatsApp).
              </li>
            </ol>
            <p style={{ ...hint, color: "#e0b766", display: "flex", alignItems: "flex-start", gap: 6 }}>
              <NavIcon name="alert" size={14} />
              <span>
                Ten en cuenta: con tu propia app el número trabaja en{" "}
                <strong>modo API</strong> (se atiende solo desde el CRM). La{" "}
                <strong>Coexistencia</strong> con la app del celular no se puede
                activar por cuenta propia: Meta solo la habilita a través de un
                proveedor tecnológico aprobado (con acceso avanzado), y en Driony
                la da el botón «Conectar WhatsApp» de la pestaña WhatsApp cuando
                Meta apruebe la plataforma. Si al pulsarlo Meta muestra el error
                #2655111, es que esa aprobación aún no ha llegado: mientras tanto,
                este es el camino.
              </span>
            </p>
            <label style={{ ...label, marginTop: 10 }}>URL del webhook de tu app</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ ...chip, wordBreak: "break-all" }}>{data.whatsappWebhookUrl}</code>
              <button
                style={ghostBtn}
                onClick={() => {
                  void navigator.clipboard?.writeText(data.whatsappWebhookUrl ?? "");
                  toast.success("URL copiada");
                }}
              >
                Copiar
              </button>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "6px 0 0", lineHeight: 1.5 }}>
              Pégala en tu app de Meta → WhatsApp → Configuración → Webhooks. <strong>Guarda primero
              aquí el verify token</strong> y después pulsa «Verificar y guardar» en Meta: Meta lo
              comprueba en ese momento y, si no coincide, dice que no pudo validar la URL.
            </p>
          </>
        ) : (
          <>
            <p style={hint}>
              El token para <em>enviar</em> mensajes va en cada número, en la
              pestaña Canales. Esto es lo de la app de Meta, común a todos.
            </p>

            {!data.webhookSignatureVerified && (
              <div style={testBox(false)}>
                Sin app secret, cualquiera que conozca tu URL puede enviarte
                webhooks falsos. Configúralo antes de salir a producción.
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 12 }}>
          <SecretField
            label="App secret"
            state={data.whatsappAppSecret}
            envVar={saas ? "la app de la plataforma" : "WHATSAPP_APP_SECRET"}
            placeholder="32 caracteres hex"
            value={appSecret}
            onChange={setAppSecret}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <SecretField
            label="Verify token (el que pones en Meta al dar de alta el webhook)"
            state={data.whatsappVerifyToken}
            envVar={saas ? "la app de la plataforma" : "WHATSAPP_VERIFY_TOKEN"}
            placeholder="una cadena que elijas tú"
            value={verifyToken}
            onChange={setVerifyToken}
          />
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={label}>App ID</label>
            <input
              style={input}
              value={appId}
              placeholder="1234567890"
              onChange={(e) => setAppId(e.target.value)}
            />
          </div>
          <div style={{ flex: "0 1 140px" }}>
            <label style={label}>Versión de Graph</label>
            <input
              style={input}
              value={graphVersion}
              placeholder="v24.0"
              onChange={(e) => setGraphVersion(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          style={{ ...primaryBtn, opacity: dirty ? 1 : 0.5 }}
        >
          {save.isPending ? "Guardando…" : "Guardar cambios"}
        </button>
        {dirty && <span style={hint}>Hay cambios sin guardar.</span>}
      </div>
    </div>
  );
}

// Campo de secreto: enmascarado, se sustituye pero nunca se muestra.
/**
 * Llamadas telefónicas con Twilio. Tiene su propio Guardar: son credenciales
 * de otro proveedor y conviene activarlas (crear la app de voz en Twilio) en
 * cuanto están completas, sin mezclarlas con lo demás.
 */
function TwilioCard({
  data,
  onSaved,
}: {
  data: IntegrationSettingsDto;
  onSaved: (fresh: IntegrationSettingsDto) => void;
}) {
  const [accountSid, setAccountSid] = useState(data.twilioAccountSid ?? "");
  const [apiKeySid, setApiKeySid] = useState(data.twilioApiKeySid ?? "");
  const [number, setNumber] = useState(data.twilioNumber ?? "");
  const [record, setRecord] = useState(data.twilioRecord);
  const [authToken, setAuthToken] = useState<string | undefined>();
  const [apiKeySecret, setApiKeySecret] = useState<string | undefined>();
  const [result, setResult] = useState<TwilioProvisionResult | null>(null);

  useEffect(() => {
    setAccountSid(data.twilioAccountSid ?? "");
    setApiKeySid(data.twilioApiKeySid ?? "");
    setNumber(data.twilioNumber ?? "");
    setRecord(data.twilioRecord);
    setAuthToken(undefined);
    setApiKeySecret(undefined);
  }, [data]);

  const dirty =
    accountSid !== (data.twilioAccountSid ?? "") ||
    apiKeySid !== (data.twilioApiKeySid ?? "") ||
    number !== (data.twilioNumber ?? "") ||
    record !== data.twilioRecord ||
    authToken !== undefined ||
    apiKeySecret !== undefined;

  const save = useMutation({
    mutationFn: () =>
      saveIntegrations({
        twilioAccountSid: accountSid.trim() || null,
        twilioApiKeySid: apiKeySid.trim() || null,
        twilioNumber: number.trim() || null,
        twilioRecord: record,
        ...(authToken !== undefined ? { twilioAuthToken: authToken } : {}),
        ...(apiKeySecret !== undefined ? { twilioApiKeySecret: apiKeySecret } : {}),
      }),
    onSuccess: (fresh: IntegrationSettingsDto) => {
      onSaved(fresh);
      setResult(null);
      toast.success("Twilio guardado");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const activate = useMutation({
    mutationFn: provisionTwilio,
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) toast.success(r.message);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const active = data.twilioConfigured && !!data.twilioAppSid;

  return (
    <div style={card}>
      <div style={rowHead}>
        <strong style={{ fontSize: 14 }}>Llamadas telefónicas (Twilio)</strong>
        <span style={badge(active ? "#1f4d38" : data.twilioConfigured ? "#5a4a2a" : "#3a3a3a")}>
          {active ? "Activo" : data.twilioConfigured ? "Falta activar" : "Sin configurar"}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => activate.mutate()}
          disabled={activate.isPending || dirty || !data.twilioConfigured}
          style={ghostBtn}
          title={dirty ? "Guarda los cambios antes de activar" : !data.twilioConfigured ? "Completa las credenciales y el número" : "Crea la app de voz en Twilio y apunta el número a Driony"}
        >
          {activate.isPending ? "Activando…" : active ? "Reactivar webhooks" : "Activar llamadas"}
        </button>
      </div>
      <p style={hint}>
        Llama y recibe llamadas desde el navegador con un número de Twilio. Pega las credenciales de tu
        cuenta (Console › Account › API keys & tokens) y el número en formato internacional; al
        activar, Driony configura Twilio solo. Guía: <a href="/docs/llamadas" style={{ color: "var(--accent-text)" }}>Llamadas</a>.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <label style={label}>Account SID</label>
          <input style={{ ...input, fontFamily: "ui-monospace, monospace" }} value={accountSid} placeholder="AC…" onChange={(e) => setAccountSid(e.target.value)} />
        </div>
        <div>
          <label style={label}>Número de Twilio</label>
          <input style={input} value={number} placeholder="+51 1 7001234" onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div>
          <label style={label}>API Key SID</label>
          <input style={{ ...input, fontFamily: "ui-monospace, monospace" }} value={apiKeySid} placeholder="SK…" onChange={(e) => setApiKeySid(e.target.value)} />
        </div>
      </div>
      <SecretField label="Auth Token" state={data.twilioAuthToken} envVar="—" placeholder="Auth token de la cuenta" value={authToken} onChange={setAuthToken} />
      <SecretField label="API Key Secret" state={data.twilioApiKeySecret} envVar="—" placeholder="Secreto de la API key (solo se muestra una vez en Twilio)" value={apiKeySecret} onChange={setApiKeySecret} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
        Grabar las llamadas y transcribirlas con la IA
      </label>
      {data.twilioWebhookBase ? (
        <p style={hint}>
          Webhooks: <code style={chip}>{data.twilioWebhookBase}/…</code>
          {data.twilioAppSid ? <> · App de voz <code style={chip}>{data.twilioAppSid}</code></> : null}
        </p>
      ) : (
        <p style={{ ...hint, color: "#e0b766" }}>
          El servidor no sabe su dirección pública: define <code style={chip}>API_PUBLIC_URL</code> para que Twilio pueda llegar a Driony.
        </p>
      )}
      {result && (
        <div style={testBox(result.ok)}>
          {result.message}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} style={{ ...ghostBtn, opacity: dirty ? 1 : 0.6 }}>
          {save.isPending ? "Guardando…" : "Guardar Twilio"}
        </button>
      </div>
    </div>
  );
}

function SecretField({
  label: text,
  state,
  envVar,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  state: ApiKeyState;
  envVar: string;
  placeholder: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const editing = value !== undefined;

  return (
    <div>
      <label style={label}>{text}</label>
      {editing ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...input, fontFamily: "ui-monospace, monospace" }}
            type="password"
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          <button onClick={() => onChange(undefined)} style={ghostBtn}>
            Cancelar
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={badge(state.configured ? "#1f4d38" : "#3a3a3a")}>
            {state.source === "db"
              ? "Guardado"
              : state.source === "env"
                ? `Desde ${envVar}`
                : "Sin configurar"}
          </span>
          {state.masked && <code style={chip}>{state.masked}</code>}
          <button onClick={() => onChange("")} style={ghostBtn}>
            {state.source === "db" ? "Cambiar" : "Configurar"}
          </button>
          {state.source === "db" && (
            <span style={hint}>Guarda vacío para borrarlo y volver a {envVar}.</span>
          )}
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

const rowHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 8,
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
  lineHeight: 1.45,
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

function testBox(ok: boolean): React.CSSProperties {
  return {
    marginTop: 11,
    padding: "9px 11px",
    borderRadius: 8,
    fontSize: 13,
    background: ok ? "rgba(63,140,110,0.14)" : "rgba(200,80,80,0.14)",
    border: `1px solid ${ok ? "#2f6b52" : "#6b3232"}`,
    color: ok ? "#8fe6c0" : "#ffb3b3",
  };
}
