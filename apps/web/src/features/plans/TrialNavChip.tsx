"use client";

import Link from "next/link";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";
import { useMyPlan } from "./usePlan";

/**
 * Los días que quedan de la prueba, en el menú lateral y debajo de Primeros
 * pasos. Solo mientras la prueba corre; lleva a Ajustes › Plan. Lo ven los
 * administradores, que son quienes deciden el plan.
 */
export function TrialNavChip({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const { data } = useMyPlan();
  const trial = data?.saas ? data.trial : null;
  if (!trial?.active) return null;

  const label =
    trial.daysLeft === 1
      ? t("trial.navLastDay", { plan: trial.planName })
      : t("trial.navDays", { plan: trial.planName, n: trial.daysLeft });

  return (
    <Link
      href="/settings?tab=plan"
      className={`trial-chip${trial.daysLeft <= 3 ? " is-ending" : ""}${collapsed ? " is-collapsed" : ""}`}
      title={collapsed ? label : undefined}
      aria-label={label}
      onClick={() => document.body.classList.remove("nav-open")}
    >
      <NavIcon name="sparkles" size={14} />
      {!collapsed && (
        <>
          <span>{label}</span>
          <small>{t("trial.navCta")}</small>
        </>
      )}
    </Link>
  );
}
