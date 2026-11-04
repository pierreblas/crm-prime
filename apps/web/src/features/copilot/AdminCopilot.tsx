"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMutation } from "@tanstack/react-query";
import type { AdminCopilotReply } from "@crm/shared";
import { askAdminCopilot } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";

type Turn = {
  role: "user" | "assistant";
  content: string;
  /** Lo que consultó para responder (documentos, datos de la cuenta). */
  consulted?: string[];
  simulated?: boolean;
  /** Un error al preguntar: se enseña, pero no viaja como historial. */
  failed?: boolean;
};

// AppShell se monta de nuevo con cada pantalla: el hilo y si estaba abierto
// se guardan en la pestaña para que navegar desde un enlace no lo borre.
const STORE = "driony.adminCopilot";
const MAX_TURNS = 40;
const EXAMPLES = ["ex1", "ex2", "ex3", "ex4"] as const;

function load(): { open: boolean; turns: Turn[] } | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    if (!raw) return null;
    const s = JSON.parse(raw) as { open?: unknown; turns?: unknown };
    return {
      open: s.open === true,
      turns: Array.isArray(s.turns) ? (s.turns as Turn[]).slice(-MAX_TURNS) : [],
    };
  } catch {
    return null;
  }
}

function save(state: { open: boolean; turns: Turn[] }) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* sin almacenamiento (modo privado): el hilo dura lo que la pantalla */
  }
}

/**
 * Copiloto del administrador: el botón de la cabecera y su panel lateral.
 * Responde con la documentación y los datos de la cuenta; solo lee.
 *
 * El panel va en un portal: la cabecera lleva backdrop-filter, que haría de
 * contenedor de un `position: fixed` y lo recortaría a su altura.
 */
export function AdminCopilot() {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const saved = load();
    if (saved) {
      setOpen(saved.open);
      setTurns(saved.turns);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) save({ open, turns });
  }, [mounted, open, turns]);

  const ask = useMutation({
    mutationFn: (history: Turn[]) =>
      askAdminCopilot({
        messages: history
          .filter((h) => !h.failed)
          .slice(-MAX_TURNS)
          .map(({ role, content }) => ({ role, content: content.slice(0, 8000) })),
        path: `${window.location.pathname}${window.location.search}`,
      }),
    onSuccess: (r: AdminCopilotReply) =>
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: r.reply, consulted: r.consulted, simulated: r.provider === "fake" },
      ]),
    onError: (e) => setTurns((prev) => [...prev, { role: "assistant", content: (e as Error).message, failed: true }]),
  });

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, ask.isPending, open]);

  useEffect(() => {
    if (open && mounted) input.current?.focus();
  }, [open, mounted]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function send(text: string) {
    const q = text.trim();
    if (!q || ask.isPending) return;
    const next: Turn[] = [...turns.filter((h) => !h.failed), { role: "user", content: q }];
    setTurns(next);
    setDraft("");
    if (input.current) input.current.style.height = "";
    ask.mutate(next);
  }

  // Reintentar: la última pregunta sin respuesta (falló, o se navegó antes de que llegara).
  function retry() {
    const next = turns.filter((h) => !h.failed);
    setTurns(next);
    ask.mutate(next);
  }

  // En el móvil el panel tapa la pantalla: al seguir un enlace se cierra para verla.
  function onNavigate() {
    if (window.matchMedia("(max-width: 640px)").matches) setOpen(false);
  }

  const last = turns[turns.length - 1];
  const unanswered = !ask.isPending && last?.role === "user";

  const panel = (
    <aside
      id="admin-copilot"
      className="admin-copilot"
      role="dialog"
      aria-modal="false"
      aria-label={t("adminCopilot.title")}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <header className="admin-copilot__head">
        <span className="admin-copilot__title">
          <NavIcon name="sparkles" size={16} />
          {t("adminCopilot.title")}
        </span>
        <span className="admin-copilot__actions">
          {turns.length > 0 && (
            <button
              type="button"
              className="icon-btn"
              title={t("adminCopilot.newChat")}
              aria-label={t("adminCopilot.newChat")}
              disabled={ask.isPending}
              onClick={() => {
                setTurns([]);
                input.current?.focus();
              }}
            >
              <NavIcon name="pencil" size={15} />
            </button>
          )}
          <button type="button" className="icon-btn" title={t("adminCopilot.close")} aria-label={t("adminCopilot.close")} onClick={close}>
            <NavIcon name="x" size={15} />
          </button>
        </span>
      </header>

      <div ref={thread} className="admin-copilot__thread" aria-live="polite">
        {turns.length === 0 ? (
          <div className="admin-copilot__empty">
            <p>{t("adminCopilot.intro")}</p>
            <span className="admin-copilot__try">{t("adminCopilot.tryWith")}</span>
            <div className="admin-copilot__examples">
              {EXAMPLES.map((k) => (
                <button key={k} type="button" className="admin-copilot__example" onClick={() => send(t(`adminCopilot.${k}`))}>
                  {t(`adminCopilot.${k}`)}
                </button>
              ))}
            </div>
            <p className="admin-copilot__note">
              <NavIcon name="lock" size={12} />
              {t("adminCopilot.readOnly")}
            </p>
          </div>
        ) : (
          turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="admin-copilot__q">
                {turn.content}
              </div>
            ) : turn.failed ? (
              <div key={i} className="admin-copilot__error" role="alert">
                <span>{turn.content}</span>
                {i === turns.length - 1 && (
                  <button type="button" className="admin-copilot__retry" onClick={retry} disabled={ask.isPending}>
                    {t("adminCopilot.retry")}
                  </button>
                )}
              </div>
            ) : (
              <div key={i} className="admin-copilot__a">
                <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <CopilotLink href={href} onNavigate={onNavigate}>{children}</CopilotLink> }}>
                  {turn.content}
                </Markdown>
                {!!turn.consulted?.length && (
                  <div className="admin-copilot__consulted">
                    <span>{t("adminCopilot.consulted")}</span>
                    {turn.consulted.map((c) => (
                      <span key={c} className="admin-copilot__chip">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                {turn.simulated && <p className="admin-copilot__simulated">{t("adminCopilot.simulated")}</p>}
              </div>
            ),
          )
        )}
        {ask.isPending && (
          <div className="admin-copilot__thinking">
            <span className="admin-copilot__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {t("adminCopilot.thinking")}
          </div>
        )}
        {unanswered && (
          <button type="button" className="admin-copilot__retry" onClick={retry}>
            {t("adminCopilot.retry")}
          </button>
        )}
      </div>

      <form
        className="admin-copilot__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={draft}
          maxLength={4000}
          placeholder={t("adminCopilot.placeholder")}
          aria-label={t("adminCopilot.placeholder")}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <button
          type="submit"
          className="admin-copilot__send"
          style={{ background: "var(--accent)" }}
          disabled={!draft.trim() || ask.isPending}
          title={t("adminCopilot.send")}
          aria-label={t("adminCopilot.send")}
        >
          <NavIcon name="send" size={15} />
        </button>
      </form>
      <p className="admin-copilot__hint">{t("adminCopilot.hint")}</p>
    </aside>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn-soft admin-copilot-trigger"
        aria-expanded={open}
        aria-controls="admin-copilot"
        title={t("adminCopilot.open")}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <NavIcon name="sparkles" size={16} />
        <span className="admin-copilot-trigger__label">{t("adminCopilot.open")}</span>
      </button>
      {mounted && open && createPortal(panel, document.body)}
    </>
  );
}

/**
 * Un enlace a Driony con dominio (el modelo a veces lo añade) se queda en la
 * ruta: cada empresa tiene su subdominio y el dominio inventado sacaría de él.
 */
function appPath(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol === "https:" && (u.host === window.location.host || /(^|\.)driony\.com$/.test(u.hostname))) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
  } catch {
    /* ya es una ruta */
  }
  return href;
}

/**
 * Enlaces de las respuestas: las pantallas de la app navegan sin recargar,
 * la documentación y lo externo se abren aparte, y lo demás queda en texto.
 */
function CopilotLink({ href: raw, children, onNavigate }: { href?: string; children: ReactNode; onNavigate: () => void }) {
  const href = raw && appPath(raw);
  if (!href) return <>{children}</>;
  if (href.startsWith("/docs")) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link href={href} onClick={onNavigate}>
        {children}
      </Link>
    );
  }
  if (/^https:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return <>{children}</>;
}
