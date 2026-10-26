"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import type { FeedbackKind } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { sendFeedback } from "@/lib/bff";
import { useT } from "@/i18n/I18nProvider";

export type FeedbackTab = "report" | "opinion";

const RATE_LABEL = ["feedback.rate.1", "feedback.rate.2", "feedback.rate.3", "feedback.rate.4", "feedback.rate.5"] as const;

/**
 * Escribirnos desde el panel. Dos pestañas: «Reportar o sugerir» (un error,
 * una idea u otra cosa) y «Tu opinión» (estrellas y un comentario). La
 * pantalla desde la que se envía va con el mensaje, para reproducir errores.
 */
export function FeedbackDialog({ initial, onClose }: { initial: FeedbackTab; onClose: () => void }) {
  const t = useT();
  const pathname = usePathname();
  const [tab, setTab] = useState<FeedbackTab>(initial);
  const [kind, setKind] = useState<Exclude<FeedbackKind, "opinion">>("bug");
  const [report, setReport] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [opinion, setOpinion] = useState("");
  const [sent, setSent] = useState(false);
  const first = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (tab === "report") first.current?.focus();
  }, [tab]);

  const send = useMutation({
    mutationFn: () =>
      tab === "report"
        ? sendFeedback({ kind, message: report.trim(), rating: null, pagePath: pathname })
        : sendFeedback({ kind: "opinion", message: opinion.trim(), rating, pagePath: pathname }),
    onSuccess: () => setSent(true),
    onError: (e: Error) => toast.error(e.message),
  });

  const canSend = tab === "report" ? report.trim().length >= 5 : rating > 0;
  const kinds: { key: Exclude<FeedbackKind, "opinion">; icon: "alert" | "sparkles" | "message" }[] = [
    { key: "bug", icon: "alert" },
    { key: "suggestion", icon: "sparkles" },
    { key: "other", icon: "message" },
  ];
  const shown = hover || rating;

  return createPortal(
    <div className="confirm-backdrop confirm-backdrop--top" onClick={onClose}>
      <div className="confirm-dialog feedback-dialog" role="dialog" aria-label={t("feedback.title")} onClick={(e) => e.stopPropagation()} data-feedback-dialog>
        <header className="feedback-dialog__head">
          <h3>{t("feedback.title")}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            <NavIcon name="x" size={15} />
          </button>
        </header>

        {sent ? (
          <div className="feedback-done" role="status">
            <span className="feedback-done__icon"><NavIcon name="check" size={22} /></span>
            <strong>{t("feedback.thanksTitle")}</strong>
            <p>{tab === "report" ? t("feedback.thanksReport") : t("feedback.thanksOpinion")}</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        ) : (
          <>
            <div className="seg feedback-dialog__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "report"} onClick={() => setTab("report")}>
                {t("feedback.tabReport")}
              </button>
              <button type="button" role="tab" aria-selected={tab === "opinion"} onClick={() => setTab("opinion")}>
                {t("feedback.tabOpinion")}
              </button>
            </div>

            {tab === "report" ? (
              <div className="feedback-dialog__body">
                <span className="feedback-label">{t("feedback.whatIsIt")}</span>
                <div className="feedback-kinds" role="radiogroup" aria-label={t("feedback.whatIsIt")}>
                  {kinds.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      role="radio"
                      aria-checked={kind === k.key}
                      className={`feedback-kind${kind === k.key ? " is-on" : ""}`}
                      onClick={() => setKind(k.key)}
                    >
                      <NavIcon name={k.icon} size={15} />
                      <span>
                        <strong>{t(`feedback.kind.${k.key}`)}</strong>
                        <small>{t(`feedback.kindHint.${k.key}`)}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <label className="feedback-label" htmlFor="fb-report">
                  {kind === "bug" ? t("feedback.bugLabel") : kind === "suggestion" ? t("feedback.suggestionLabel") : t("feedback.otherLabel")}
                </label>
                <textarea
                  id="fb-report"
                  ref={first}
                  className="field"
                  rows={6}
                  maxLength={4000}
                  value={report}
                  onChange={(e) => setReport(e.target.value)}
                  placeholder={kind === "bug" ? t("feedback.bugPlaceholder") : kind === "suggestion" ? t("feedback.suggestionPlaceholder") : t("feedback.otherPlaceholder")}
                />
                <small className="feedback-hint">{t("feedback.pageNote", { page: pathname })}</small>
              </div>
            ) : (
              <div className="feedback-dialog__body">
                <span className="feedback-label">{t("feedback.rateQuestion")}</span>
                <div className="feedback-stars" role="radiogroup" aria-label={t("feedback.rateQuestion")} onMouseLeave={() => setHover(0)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rating === n}
                      aria-label={t("feedback.stars", { n })}
                      className={`feedback-star${n <= shown ? " is-on" : ""}`}
                      onMouseEnter={() => setHover(n)}
                      onClick={() => setRating(n)}
                    >
                      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17.1 6.4 20l1.1-6.2L2.9 9.4l6.3-.9z" />
                      </svg>
                    </button>
                  ))}
                  <span className="feedback-stars__label">{shown ? t(RATE_LABEL[shown - 1]!) : ""}</span>
                </div>
                <label className="feedback-label" htmlFor="fb-opinion">
                  {t("feedback.opinionLabel")}
                </label>
                <textarea
                  id="fb-opinion"
                  className="field"
                  rows={5}
                  maxLength={4000}
                  value={opinion}
                  onChange={(e) => setOpinion(e.target.value)}
                  placeholder={t("feedback.opinionPlaceholder")}
                />
              </div>
            )}

            <footer className="feedback-dialog__foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!canSend || send.isPending} onClick={() => send.mutate()}>
                <NavIcon name="send" size={13} /> {send.isPending ? t("feedback.sending") : t("feedback.send")}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
