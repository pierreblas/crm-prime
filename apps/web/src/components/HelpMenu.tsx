"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./NavIcons";
import { useT } from "@/i18n/I18nProvider";
import { requestTour, tourForPath } from "@/features/onboarding/tours";
import { FeedbackDialog, type FeedbackTab } from "@/features/feedback/FeedbackDialog";

/**
 * El «?» de la cabecera: repetir el tour de la pantalla actual, volver a
 * Primeros pasos o abrir la documentación. Siempre a un clic, sin ocupar
 * sitio: la ayuda que se esconde no se usa.
 */
export function HelpMenu() {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackTab | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const tour = tourForPath(pathname);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="icon-btn"
        data-tour="help"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("nav.help")}
        aria-label={t("nav.help")}
        onClick={() => setOpen((o) => !o)}
      >
        <NavIcon name="question" size={17} />
      </button>
      {open && (
        <div role="menu" className="help-menu" aria-label={t("nav.help")}>
          <button
            type="button"
            role="menuitem"
            className="help-menu__item"
            disabled={!tour}
            onClick={() => {
              setOpen(false);
              if (tour) requestTour(tour.key);
            }}
          >
            <NavIcon name="play" size={14} />
            <span>
              {t("nav.helpTour")}
              {tour && <small>{tour.name}</small>}
            </span>
          </button>
          <Link role="menuitem" className="help-menu__item" href="/getting-started" onClick={() => setOpen(false)}>
            <NavIcon name="rocket" size={14} />
            <span>{t("nav.gettingStarted")}</span>
          </Link>
          <a role="menuitem" className="help-menu__item" href="/docs" target="_blank" rel="noopener noreferrer">
            <NavIcon name="book" size={14} />
            <span>{t("nav.helpDocs")}</span>
          </a>
          <div className="help-menu__sep" role="separator" />
          <button type="button" role="menuitem" className="help-menu__item" data-feedback-open="report" onClick={() => { setOpen(false); setFeedback("report"); }}>
            <NavIcon name="alert" size={14} />
            <span>
              {t("nav.feedbackReport")}
              <small>{t("nav.feedbackReportHint")}</small>
            </span>
          </button>
          <button type="button" role="menuitem" className="help-menu__item" data-feedback-open="opinion" onClick={() => { setOpen(false); setFeedback("opinion"); }}>
            <NavIcon name="message" size={14} />
            <span>
              {t("nav.feedbackOpinion")}
              <small>{t("nav.feedbackOpinionHint")}</small>
            </span>
          </button>
        </div>
      )}
      {feedback && <FeedbackDialog initial={feedback} onClose={() => setFeedback(null)} />}
    </div>
  );
}
