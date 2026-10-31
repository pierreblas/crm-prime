"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import type { PlaygroundReply, PlaygroundTurn } from "@crm/shared";
import { testAgent } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";

type ChatMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; meta?: PlaygroundReply; escalated?: boolean };

export function AgentPlayground({
  botId,
  botName,
  onClose,
}: {
  botId?: string;
  botName?: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const send = useMutation({
    mutationFn: (message: string) => {
      const history: PlaygroundTurn[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      return testAgent({ message, botId, history });
    },
    onSuccess: (reply) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            reply.reply ??
            (reply.escalate
              ? "(El agente recomendó pasar a un humano y no generó respuesta)"
              : "(Sin respuesta)"),
          meta: reply,
          escalated: reply.escalate,
        },
      ]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, send.isPending]);

  // Cerrar con Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: t }]);
    setText("");
    send.mutate(t);
  };

  // Se monta en <body> con un portal: dentro de la página quedaría bajo la
  // cabecera de la app, que forma su propio contexto de apilamiento.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <>
      <div style={backdrop} onClick={onClose} />
      <aside style={drawer} role="dialog" aria-label="Probar agente IA">
        <header style={header}>
          <div>
            <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <NavIcon name="flask" size={16} />
              Probar agente
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {botName ? botName : "Agente por defecto"} · no se envía nada real
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} style={ghostBtn} title="Reiniciar">
                Reiniciar
              </button>
            )}
            <button onClick={onClose} style={iconBtn} title="Cerrar">
              <NavIcon name="x" size={16} />
            </button>
          </div>
        </header>

        <div style={body}>
          {messages.length === 0 && !send.isPending && (
            <div style={empty}>
              <div style={{ color: "var(--muted)", opacity: 0.6 }}>
                <NavIcon name="message" size={40} />
              </div>
              <p style={{ color: "var(--muted)", fontSize: 14 }}>
                Escribe como si fueras un cliente y mira cómo responde el agente
                con su prompt, herramientas y base de conocimiento.
              </p>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} style={{ alignSelf: "flex-end", ...bubble("var(--bubble-out)") }}>
                {m.content}
              </div>
            ) : (
              <div key={i} style={{ alignSelf: "flex-start", maxWidth: "85%" }}>
                {m.escalated && (
                  <div style={escalateTag}>
                    <NavIcon name="alert" size={13} />
                    Recomienda escalar a un humano
                  </div>
                )}
                <div style={bubble("var(--surface-2)")}>{m.content}</div>
                {!!m.meta?.simulatedActions.length && (
                  <div style={simActions}>
                    <strong style={{ fontSize: 11.5 }}>
                      Acciones (no aplicadas, es una prueba):
                    </strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                      {m.meta.simulatedActions.map((a, k) => (
                        <li key={k} style={{ fontSize: 12 }}>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.meta && (
                  <div style={metaLine}>
                    {m.meta.provider}/{m.meta.model}
                    {m.meta.toolsUsed.length ? ` · herramientas: ${m.meta.toolsUsed.join(", ")}` : ""}
                    {" · "}
                    {m.meta.inputTokens + m.meta.outputTokens} tok
                    {m.meta.costUsd > 0 ? ` · $${m.meta.costUsd.toFixed(4)}` : ""}
                  </div>
                )}
              </div>
            ),
          )}

          {send.isPending && (
            <div style={{ alignSelf: "flex-start", ...bubble("var(--surface-2)"), color: "var(--muted)" }}>
              Pensando…
            </div>
          )}
          {send.isError && (
            <div style={{ alignSelf: "flex-start", color: "var(--danger)", fontSize: 13 }}>
              {(send.error as Error).message}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={composer}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe un mensaje de prueba…"
            autoFocus
            style={input}
          />
          <button type="submit" disabled={!text.trim() || send.isPending} style={sendBtn}>
            {send.isPending ? "…" : "Enviar"}
          </button>
        </form>
      </aside>
    </>,
    document.body,
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 1000,
  animation: "fadeIn 0.15s ease",
};

const drawer: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  height: "100vh",
  width: "min(440px, 100vw)",
  background: "var(--panel-2)",
  borderLeft: "1px solid var(--border)",
  boxShadow: "var(--shadow-drawer)",
  zIndex: 1001,
  display: "flex",
  flexDirection: "column",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 16px",
  borderBottom: "1px solid var(--border)",
};

const body: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const empty: React.CSSProperties = {
  margin: "auto",
  textAlign: "center",
  maxWidth: 280,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  alignItems: "center",
};

function bubble(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "var(--text)",
    padding: "9px 12px",
    borderRadius: 10,
    fontSize: 14,
    maxWidth: "85%",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
}

const simActions: React.CSSProperties = {
  marginTop: 7,
  padding: "7px 9px",
  borderRadius: 7,
  background: "rgba(224,183,102,0.10)",
  border: "1px solid #5a4a2a",
  color: "#e0b766",
};

const metaLine: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  marginTop: 4,
  paddingLeft: 2,
};

const escalateTag: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 12,
  color: "var(--warning)",
  marginBottom: 4,
};

const composer: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: 12,
  borderTop: "1px solid var(--border)",
};

const input: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
};

const sendBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};

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
