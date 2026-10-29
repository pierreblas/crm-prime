"use client";

import { NavIcon } from "@/components/NavIcons";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  llmProviderLabels,
  llmProviderNames,
  suggestedModels,
  type AiConnectionTest,
  type AiSettingsDto,
  type ApiKeyState,
  type LlmProviderName,
} from "@crm/shared";
import { fetchAiSettings, testAiConnection, updateAiSettings } from "@/lib/bff";
import { resetLabel } from "@/features/copilot/useAiStatus";
import { toast } from "@/lib/toast";
import { ghostBtn as ghostBase, primaryBtn, smBtn } from "@/components/ui";

const ghostBtn: React.CSSProperties = { ...ghostBase, ...smBtn };

/**
 * Ajustes › Inteligencia Artificial.
 * Elige el proveedor, guarda las API keys (cifradas en la BD) y comprueba
 * la conexión. Si una key está vacía aquí, se usa la del .env.
 */
export function AiSettings() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: fetchAiSettings,
  });

  const [provider, setProvider] = useState<LlmProviderName>("auto");
  const [openaiModel, setOpenaiModel] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");
  // undefined = no se toca la key guardada; string = se enviará (vacío la borra).
  const [openaiKey, setOpenaiKey] = useState<string | undefined>(undefined);
  const [anthropicKey, setAnthropicKey] = useState<string | undefined>(undefined);
  const [test, setTest] = useState<AiConnectionTest | null>(null);

  useEffect(() => {
    if (!data) return;
    setProvider(data.provider);
    setOpenaiModel(data.openaiModel);
    setAnthropicModel(data.anthropicModel);
    setOpenaiBaseUrl(data.openaiBaseUrl ?? "");
    setOpenaiKey(undefined);
    setAnthropicKey(undefined);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      updateAiSettings({
        provider,
        openaiModel: openaiModel.trim() || undefined,
        anthropicModel: anthropicModel.trim() || undefined,
        openaiBaseUrl: openaiBaseUrl.trim() || null,
        ...(openaiKey !== undefined ? { openaiKey } : {}),
        ...(anthropicKey !== undefined ? { anthropicKey } : {}),
      }),
    onSuccess: (fresh: AiSettingsDto) => {
      queryClient.setQueryData(["ai-settings"], fresh);
      setTest(null);
      toast.success("Ajustes de IA guardados");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const check = useMutation({
    mutationFn: testAiConnection,
    onSuccess: (r) => setTest(r),
    onError: (e) => toast.error((e as Error).message),
  });

  if (isPending || !data) {
    return <Panel title="Inteligencia Artificial" subtitle="Cargando…" />;
  }

  const dirty =
    provider !== data.provider ||
    openaiModel !== data.openaiModel ||
    anthropicModel !== data.anthropicModel ||
    openaiBaseUrl !== (data.openaiBaseUrl ?? "") ||
    openaiKey !== undefined ||
    anthropicKey !== undefined;

  // SaaS: las keys son de cada empresa; el "respaldo" es la key de la
  // plataforma solo si el operador la presta (`platformKeys`).
  const saas = data.saas;
  const sinRespaldo = saas && !data.platformKeys;
  const fallbackDe = (envVar: string) =>
    saas ? (data.platformKeys ? "la key de la plataforma" : null) : envVar;
  // IA de Driony: sin clave propia, el agente usa la de la plataforma con
  // cupo de conversaciones según el plan.
  const included = data.included;
  const conClavePropia = data.openaiKey.source === "db" || data.anthropicKey.source === "db";
  const usaIncluida = !!included && !conClavePropia && !included.exhausted && data.provider !== "fake";

  return (
    <Panel
      title="Inteligencia Artificial"
      subtitle={
        included
          ? "Tu plan trae IA incluida, con un cupo de conversaciones al mes: el agente, el copiloto y los asistentes la usan sin que configures nada. Aquí puedes conectar tu propia clave para elegir el modelo y no tener cupo."
          : saas
          ? "Las API keys con las que trabajan tus agentes, el copilot del inbox y el asistente de flujos. Son tuyas: se guardan cifradas, solo las usa tu empresa y el consumo se carga a tu cuenta del proveedor."
          : "La API key que usarán los agentes IA, el copilot del inbox y el asistente de flujos. Se guarda cifrada; si la dejas vacía se usa la del archivo .env."
      }
    >
      {included ? (
        <div className={`byok${(included.full || included.exhausted) && !conClavePropia ? " is-warn" : ""}`} data-ai-included>
          <NavIcon name={conClavePropia ? "key" : "sparkles"} size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>
              {conClavePropia
                ? "Usas tu propia clave: sin cupo y con el modelo que elijas."
                : included.exhausted
                  ? "La IA incluida en tu plan llegó a su límite de uso este mes."
                  : included.full
                    ? "Llegaste a las conversaciones con IA incluidas en tu plan este mes."
                    : "IA de Driony incluida en tu plan."}
            </strong>
            <span>
              {conClavePropia
                ? `Pagas a tu proveedor a precio de lista. Si quitas tu clave, el agente vuelve a usar la IA de Driony (${included.limit.toLocaleString("es")} conversaciones al mes en tu plan).`
                : included.exhausted
                  ? `Hasta ${resetLabel(included)}, el agente no responde y los chats en autopilot pasan a tu equipo. Conecta tu clave de OpenAI o Anthropic abajo para seguir ya, o cambia de plan en Ajustes › Plan.`
                  : included.full
                    ? `El agente termina las conversaciones que ya atendía; los chats nuevos pasan a tu equipo hasta ${resetLabel(included)}. Conecta tu clave abajo para que atienda también los nuevos, o cambia de plan en Ajustes › Plan.`
                    : `Tu agente responde sin que configures nada. Cuenta cada conversación que atiende en el mes, no cada mensaje; el cupo vuelve ${resetLabel(included)}. Si conectas tu clave de OpenAI o Anthropic, eliges el modelo, no hay cupo y pagas a tu proveedor a precio de lista, sin recargo.`}
            </span>
            {!conClavePropia && (
              <div className="byok__meter" aria-label="Conversaciones con IA de Driony este mes">
                <span className="byok__bar">
                  <i style={{ width: `${Math.min(100, (included.conversations / included.limit) * 100)}%` }} />
                </span>
                <span className="byok__count">
                  {included.conversations.toLocaleString("es")} de {included.limit.toLocaleString("es")} conversaciones
                  este mes
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* La IA no se paga a Driony: va con la clave de la empresa. */
        <div className="byok">
          <NavIcon name="key" size={16} />
          <div>
            <strong>Tu clave, tu consumo. Sin créditos ni recargos.</strong>
            <span>
              El agente, el copiloto del chat, la memoria de clientes, las preguntas sin respuesta y la búsqueda
              en el conocimiento usan esta clave. Pagas a OpenAI o Anthropic directamente, al precio de su lista;
              Driony no cobra nada por la IA.
            </span>
          </div>
        </div>
      )}

      {/* Estado actual */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            style={dot(
              data.activeProvider === "fake" ? "#b08a3f" : "#3f8c6e",
            )}
          />
          <strong style={{ fontSize: 14 }}>
            {data.activeProvider === "fake"
              ? included?.exhausted && !conClavePropia
                ? `IA incluida al límite — tus agentes no responderán hasta ${resetLabel(included)} o hasta que pongas tu clave`
                : sinRespaldo
                  ? "Sin API key — tus agentes no responderán hasta que introduzcas una"
                  : "Sin API key — respuestas simuladas"
              : usaIncluida
                ? "Activo: IA de Driony"
                : `Activo: ${llmProviderLabels[data.activeProvider]}`}
          </strong>
          {data.activeProvider !== "fake" && (
            <code style={chip}>{data.activeModel}</code>
          )}
          {usaIncluida && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              El proveedor y los modelos de abajo se usan solo con tu clave.
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => check.mutate()}
            disabled={check.isPending || dirty}
            style={ghostBtn}
            title={dirty ? "Guarda los cambios antes de probar" : "Hacer una llamada real de prueba"}
          >
            {check.isPending ? "Probando…" : "Probar conexión"}
          </button>
        </div>

        {test && (
          <div style={{ ...testBox(test.ok), display: "flex", alignItems: "center", gap: 6 }}>
            <NavIcon name={test.ok ? "check" : "x"} size={14} />
            {test.message}
            {test.ok && (
              <span style={{ color: "var(--muted)" }}>
                {" "}
                · {test.model} · {test.latencyMs} ms
              </span>
            )}
          </div>
        )}

        {sinRespaldo && !included && data.activeProvider === "fake" && (
          <div style={{ ...testBox(false), borderColor: "#7a6f4a", background: "rgba(224,183,102,0.08)", color: "#e0b766" }}>
            <strong>Para activar la IA necesitas una API key tuya.</strong> Crea una
            en <em>platform.openai.com</em> (OpenAI) o en <em>console.anthropic.com</em>{" "}
            (Claude), pégala abajo, guarda y pulsa «Probar conexión». Cada respuesta
            se cobra en tu cuenta de ese proveedor; en cada agente ves cuántos
            tokens gasta y puedes ponerle un tope mensual.
          </div>
        )}
      </div>

      {/* Proveedor */}
      <div style={card}>
        <label style={label}>Proveedor</label>
        <select
          style={input}
          value={provider}
          onChange={(e) => setProvider(e.target.value as LlmProviderName)}
        >
          {llmProviderNames.map((p) => (
            <option key={p} value={p}>
              {llmProviderLabels[p]}
            </option>
          ))}
        </select>
        <p style={hint}>
          «Automático» usa OpenAI si hay key y, si no, Anthropic. Fuerza uno
          concreto si tienes las dos configuradas.
        </p>
      </div>

      {/* OpenAI */}
      <ProviderCard
        title="OpenAI"
        state={data.openaiKey}
        fallback={fallbackDe("OPENAI_API_KEY")}
        placeholder="sk-proj-…"
        value={openaiKey}
        onChange={setOpenaiKey}
        model={openaiModel}
        onModelChange={setOpenaiModel}
        models={suggestedModels.openai}
      >
        <label style={label}>URL base (opcional)</label>
        <input
          style={input}
          value={openaiBaseUrl}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => setOpenaiBaseUrl(e.target.value)}
        />
        <p style={hint}>
          Solo si usas un servicio compatible con la API de OpenAI (Groq,
          DeepSeek, OpenRouter, Ollama…): la key y el modelo son entonces los de
          ese servicio.
        </p>
      </ProviderCard>

      {/* Anthropic */}
      <ProviderCard
        title="Anthropic (Claude)"
        state={data.anthropicKey}
        fallback={fallbackDe("ANTHROPIC_API_KEY")}
        placeholder="sk-ant-…"
        value={anthropicKey}
        onChange={setAnthropicKey}
        model={anthropicModel}
        onModelChange={setAnthropicModel}
        models={suggestedModels.anthropic}
      />

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
    </Panel>
  );
}

function ProviderCard({
  title,
  state,
  fallback,
  placeholder,
  value,
  onChange,
  model,
  onModelChange,
  models,
  children,
}: {
  title: string;
  state: ApiKeyState;
  /** De dónde sale la key si no hay una guardada; null = no hay respaldo. */
  fallback: string | null;
  placeholder: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  model: string;
  onModelChange: (v: string) => void;
  models: string[];
  children?: React.ReactNode;
}) {
  const editing = value !== undefined;

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <span style={badge(state.configured ? "#1f4d38" : "#3a3a3a")}>
          {state.source === "db"
            ? "Key guardada"
            : state.source === "env"
              ? fallback === "la key de la plataforma"
                ? "Incluida por la plataforma"
                : `Desde ${fallback}`
              : "Sin key"}
        </span>
        {state.masked && (
          <code style={{ ...chip, color: "var(--muted)" }}>{state.masked}</code>
        )}
      </div>

      <label style={label}>API key</label>
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
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onChange("")} style={ghostBtn}>
            {state.source === "db" ? "Cambiar key" : "Introducir key"}
          </button>
          {state.source === "db" && (
            <span style={hint}>
              {fallback
                ? `Deja el campo vacío al guardar para borrarla y volver a ${fallback}.`
                : "Deja el campo vacío al guardar para borrarla."}
            </span>
          )}
        </div>
      )}

      <label style={{ ...label, marginTop: 12 }}>Modelo por defecto</label>
      <input
        style={input}
        list={`${title}-models`}
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
      />
      <datalist id={`${title}-models`}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <p style={hint}>
        Se usa cuando el bot no fija uno propio, y para el asistente de flujos.
      </p>

      {children}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>{title}</h3>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0 }}>{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 14,
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

function dot(color: string): React.CSSProperties {
  return {
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
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
