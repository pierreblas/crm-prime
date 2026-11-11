"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { AI_TOKENS_PER_CONVERSATION, formatTokens, PLAN_KEYS, PLANS, TRIAL_DAYS, type PlanDef } from "@crm/shared";
import { Arrow } from "./chrome";

/**
 * «Cuál me toca»: el visitante pone su equipo y sus números y ve el plan y el
 * precio, leídos del catálogo compartido para que nunca difieran de /precios.
 * Enseña lo que la tabla no enseña: que sumar gente no cambia la cifra.
 */

const AI_OPTIONS = [
  { value: 100, label: "Pocas, para probar" },
  { value: 500, label: "Unas 500 al mes" },
  { value: 2000, label: "Unas 2.000 al mes" },
  { value: 6000, label: "Más de 5.000 al mes" },
  { value: 0, label: "Uso mi propia clave de IA" },
] as const;

function fits(plan: PlanDef, numbers: number, users: number, broadcasts: boolean, ai: number): boolean {
  if (plan.limits.numbers !== null && plan.limits.numbers < numbers) return false;
  if (plan.limits.users !== null && plan.limits.users < users) return false;
  if (broadcasts && !plan.features.broadcasts) return false;
  // El visitante piensa en conversaciones; el plan trae tokens (unos 20.000 por conversación atendida).
  if (ai > 0 && plan.aiTokens !== null && plan.aiTokens < ai * AI_TOKENS_PER_CONVERSATION) return false;
  return true;
}

function cheapest(numbers: number, users: number, broadcasts: boolean, ai: number): PlanDef {
  return PLAN_KEYS.map((k) => PLANS[k]).find((p) => fits(p, numbers, users, broadcasts, ai)) ?? PLANS.business;
}

export function PlanPicker() {
  const id = useId();
  const [numbers, setNumbers] = useState(1);
  const [users, setUsers] = useState(4);
  const [broadcasts, setBroadcasts] = useState(false);
  const [ai, setAi] = useState<number>(500);

  const plan = cheapest(numbers, users, broadcasts, ai);
  // Hasta dónde crece el equipo sin cambiar de plan: la prueba de «por empresa».
  const roomForPeople = plan.limits.users === null ? null : plan.limits.users - users;

  return (
    <div className="lp-picker" aria-live="polite">
      <form className="lp-picker__form" onSubmit={(e) => e.preventDefault()}>
        <p className="lp-tag">[ Cuál me toca ]</p>
        <label className="lp-picker__field">
          <span>Números de WhatsApp</span>
          <input type="range" min={1} max={6} value={numbers} onChange={(e) => setNumbers(Number(e.target.value))} aria-describedby={`${id}-n`} />
          <output id={`${id}-n`}>{numbers === 6 ? "6 o más" : numbers}</output>
        </label>
        <label className="lp-picker__field">
          <span>Personas que atienden</span>
          <input type="range" min={1} max={15} value={users} onChange={(e) => setUsers(Number(e.target.value))} aria-describedby={`${id}-u`} />
          <output id={`${id}-u`}>{users === 15 ? "15 o más" : users}</output>
        </label>
        <label className="lp-picker__field lp-picker__field--select">
          <span>Conversaciones que atiende la IA</span>
          <select value={ai} onChange={(e) => setAi(Number(e.target.value))}>
            {AI_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="lp-picker__check">
          <input type="checkbox" checked={broadcasts} onChange={(e) => setBroadcasts(e.target.checked)} />
          <span>Envío difusiones con plantillas</span>
        </label>
      </form>

      <div className="lp-picker__result" data-plan={plan.key}>
        <p className="lp-picker__kicker">Tu plan</p>
        <p className="lp-picker__name">{plan.name}</p>
        <p className="lp-picker__price">
          {plan.priceUsd === 0 ? "Sin costo" : `USD ${plan.priceUsd}`}
          {plan.priceUsd ? <small>/mes, toda tu empresa</small> : <small>, un número y dos personas</small>}
        </p>
        <ul className="lp-picker__facts">
          <li>
            {numbers === 6 ? "Seis o más números" : numbers === 1 ? "Un número" : `${numbers} números`} y {users === 15 ? "quince o más" : users} persona{users === 1 ? "" : "s"}, al mismo precio.
          </li>
          <li>
            {roomForPeople === null
              ? "Suma a quien quieras: no hay tope de personas."
              : roomForPeople > 0
                ? `Puedes sumar ${roomForPeople} persona${roomForPeople === 1 ? "" : "s"} más sin que cambie la cifra.`
                : "Con una persona más pasarías al siguiente plan."}
          </li>
          <li>
            {ai === 0
              ? "Con tu clave la IA no tiene cupo: pagas a tu proveedor, sin recargo."
              : `${formatTokens(plan.aiTokens ?? 0)} de tokens de IA al mes: unas ${Math.round((plan.aiTokens ?? 0) / AI_TOKENS_PER_CONVERSATION).toLocaleString("es")} conversaciones atendidas.`}
          </li>
          <li>Sin cobro por conversación, por mensaje ni por contacto.</li>
        </ul>
        <Link href="/register" className="lp-btn lp-btn--white">
          Probar {TRIAL_DAYS} días gratis <Arrow />
        </Link>
      </div>
    </div>
  );
}
