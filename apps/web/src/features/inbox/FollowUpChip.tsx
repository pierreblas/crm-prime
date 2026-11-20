"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { NavIcon } from "@/components/NavIcons";
import { draftFollowUp, fetchFollowUpPreview } from "@/lib/bff";
import { useLocale, useT } from "@/i18n/I18nProvider";
import { toast } from "@/lib/toast";

const POP_WIDTH = 340;
const GUTTER = 16;

/**
 * El seguimiento automático programado en un chat. La etiqueta dice cuál es y
 * cuánto falta; al pulsarla se ve qué va a enviar antes de que salga: el texto
 * exacto si es fijo o una plantilla, o el objetivo y un borrador a pedido si
 * lo redacta la IA. Desde aquí también se cancela.
 */
export function FollowUpChip({
  conversationId,
  step,
  dueAt,
  label,
  onCancel,
  cancelling,
}: {
  conversationId: string;
  /** El toque programado (desde 0), para refrescar el detalle cuando cambie. */
  step: number;
  dueAt: string;
  /** «Seguimiento 2 en 3 h». */
  label: string;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // Dónde cabe el detalle: bajo la etiqueta y alineado a su derecha, pero sin
  // salirse de la pantalla (en el móvil la etiqueta queda a la izquierda).
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(POP_WIDTH, window.innerWidth - 2 * GUTTER);
      const left = Math.max(GUTTER, Math.min(r.right - width, window.innerWidth - GUTTER - width));
      setPos({ top: r.bottom + 8, left, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const preview = useQuery({
    queryKey: ["follow-up-preview", conversationId, step, dueAt],
    queryFn: () => fetchFollowUpPreview(conversationId),
    enabled: open,
    staleTime: 30_000,
  });
  const draft = useMutation({
    mutationFn: () => draftFollowUp(conversationId),
    onError: (e) => toast.error((e as Error).message),
  });
  // Otro chat u otro toque: el borrador anterior ya no vale.
  useEffect(() => draft.reset(), [conversationId, step, dueAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const p = preview.data;
  const when = new Date(dueAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <span ref={ref} className="fup" data-follow-up>
      <span className="fup__chip">
        <button type="button" className="fup__open" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" title={t("inbox.followUpOpen")} data-follow-up-open>
          <NavIcon name="clock" size={12} />
          {label}
        </button>
        <button type="button" className="fup__x" onClick={onCancel} disabled={cancelling} title={t("inbox.followUpCancel")} aria-label={t("inbox.followUpCancel")}>
          <NavIcon name="x" size={11} />
        </button>
      </span>

      {open && pos && (
        <div className="fup__pop" role="dialog" aria-label={t("inbox.followUpOpen")} style={pos} data-follow-up-pop>
          {preview.isPending && <p className="fup__muted">{t("inbox.followUpLoading")}</p>}
          {preview.isError && <p className="fup__warn">{(preview.error as Error).message}</p>}
          {preview.isSuccess && !p && <p className="fup__muted">{t("inbox.followUpGone")}</p>}
          {p && (
            <>
              <div className="fup__head">
                <strong>{t("inbox.followUpHead", { n: p.step, total: p.total })}</strong>
                <span>{t("inbox.followUpWhen", { when })}</span>
              </div>

              {p.kind === "ai" ? (
                <>
                  <p className="fup__lead">{t("inbox.followUpAi")}</p>
                  {p.goal && <p className="fup__muted">{t("inbox.followUpGoal", { goal: p.goal })}</p>}
                  {draft.data ? (
                    <>
                      <p className="fup__bubble" data-follow-up-draft>
                        {draft.data.text}
                      </p>
                      <p className="fup__muted">{t("inbox.followUpDraftNote")}</p>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm" onClick={() => draft.mutate()} disabled={draft.isPending || !!p.blocked} data-follow-up-draft-btn>
                      <NavIcon name="sparkles" size={13} /> {draft.isPending ? t("inbox.followUpDrafting") : t("inbox.followUpDraft")}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="fup__lead">{p.kind === "template" && p.templateName ? t("inbox.followUpTemplate", { name: p.templateName }) : t("inbox.followUpText")}</p>
                  {p.message && (
                    <p className="fup__bubble" data-follow-up-message>
                      {p.message}
                    </p>
                  )}
                </>
              )}

              {p.blocked && (
                <p className="fup__warn" data-follow-up-blocked>
                  <NavIcon name="alert" size={13} /> {p.blocked}
                </p>
              )}

              <div className="fup__foot">
                <span>{t("inbox.followUpAuto")}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setOpen(false);
                    onCancel();
                  }}
                  disabled={cancelling}
                  data-follow-up-cancel
                >
                  {t("inbox.followUpCancelBtn")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
