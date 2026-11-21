"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentTestCase } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { createTestCase, draftTestCaseFromChat } from "@/lib/bff";
import { toast } from "@/lib/toast";

const TITLE_MAX = 80;
const BRIEF_MIN = 10;
const BRIEF_MAX = 600;

/** El formulario de un caso: cómo se llama y quién es el cliente. Lo usan «Nuevo caso», editar y el caso de un chat. */
export function CaseForm({
  initial,
  saving,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial?: { title: string; brief: string };
  saving: boolean;
  saveLabel: string;
  onSave: (value: { title: string; brief: string }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [brief, setBrief] = useState(initial?.brief ?? "");
  const briefOk = brief.trim().length >= BRIEF_MIN;
  const ok = title.trim().length > 0 && briefOk;
  return (
    <form
      className="improve-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !saving) onSave({ title: title.trim(), brief: brief.trim() });
      }}
      data-improve-case-form
    >
      <label className="label" htmlFor={`${id}-title`}>
        Nombre del caso
      </label>
      <input
        id={`${id}-title`}
        className="field"
        value={title}
        maxLength={TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Ej.: Pide qué incluye y los requisitos"
        autoFocus
      />
      <label className="label" htmlFor={`${id}-brief`}>
        Quién es el cliente y qué quiere
      </label>
      <textarea
        id={`${id}-brief`}
        className="field"
        rows={4}
        value={brief}
        maxLength={BRIEF_MAX}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="Ej.: Vio el anuncio de un curso, le parece caro y dice que lo va a pensar; si le ofrecen pagar en partes, pregunta cómo."
        aria-invalid={!briefOk && brief.length > 0}
        aria-describedby={`${id}-hint`}
      />
      <p className="improve-form__hint" id={`${id}-hint`}>
        Una IA hará de este cliente contra tu agente. Describe la situación, no un guion: no pongas nombres ni teléfonos de clientes reales.
      </p>
      <div className="improve-form__actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!ok || saving} data-improve-case-save>
          {saving ? "Guardando…" : saveLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Un caso de prueba sacado de un chat real: una IA redacta la situación del
 * cliente, el dueño la revisa y la guarda en la batería del agente que atendió
 * ese chat. Se abre desde «Revisión de chats» y desde «Mejorar».
 */
export function CaseFromChatDialog({
  botId,
  botName,
  conversationId,
  onClose,
  onSaved,
}: {
  botId: string;
  botName: string | null;
  conversationId: string;
  onClose: () => void;
  onSaved?: (c: AgentTestCase) => void;
}) {
  const qc = useQueryClient();
  // Redactarlo gasta tokens: una sola vez por chat mientras el diálogo está abierto.
  const draft = useQuery({
    queryKey: ["improve-case-draft", botId, conversationId],
    queryFn: () => draftTestCaseFromChat(botId, conversationId),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const save = useMutation({
    mutationFn: (v: { title: string; brief: string }) => createTestCase(botId, { ...v, conversationId }),
    onSuccess: (c) => {
      toast.success(`Caso añadido a las pruebas de ${botName ?? "el agente"}`);
      void qc.invalidateQueries({ queryKey: ["improve", botId] });
      onSaved?.(c);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    // En captura: se cierra este diálogo y no la ventana que tiene debajo.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="confirm-backdrop confirm-backdrop--top" onClick={onClose} data-case-from-chat>
      <div className="confirm-dialog improve-dialog" role="dialog" aria-modal="true" aria-label="Caso de prueba a partir de un chat" onClick={(e) => e.stopPropagation()}>
        <header className="improve-dialog__head">
          <div>
            <h3>Caso de prueba a partir de este chat</h3>
            <p>
              Se guarda la situación del cliente, no el chat: el simulador la repetirá contra {botName ? <strong>{botName}</strong> : "el agente"} cada vez que midas.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
            <NavIcon name="x" size={15} />
          </button>
        </header>
        {draft.isPending ? (
          <p className="improve-note is-loading" role="status">
            Leyendo el chat y redactando el caso…
          </p>
        ) : (
          <>
            {draft.isError && (
              <p className="improve-note is-error" role="alert">
                {(draft.error as Error).message}
              </p>
            )}
            <CaseForm
              key={draft.data ? "draft" : "empty"}
              initial={draft.data}
              saving={save.isPending}
              saveLabel="Guardar en los casos de prueba"
              onSave={(v) => save.mutate(v)}
              onCancel={onClose}
            />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
