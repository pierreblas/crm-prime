"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { PLANS, TRIAL_DAYS } from "@crm/shared";
import { Arrow } from "./chrome";

/**
 * La cuenta que el visitante no se ha hecho: cuántos de sus leads escriben
 * cuando nadie responde y cuánto vale recuperar una parte. Todas las cifras
 * son suyas y el supuesto de recuperación lo elige él; la página no promete
 * resultados, le da la calculadora.
 */
const CURRENCIES = [
  { code: "PEN", label: "Soles (S/)", symbol: "S/", ticket: 150, step: 10 },
  { code: "USD", label: "Dólares (USD)", symbol: "USD", ticket: 40, step: 5 },
  { code: "MXN", label: "Pesos mexicanos (MXN)", symbol: "MXN", ticket: 800, step: 50 },
  { code: "COP", label: "Pesos colombianos (COP)", symbol: "COP", ticket: 150000, step: 5000 },
  { code: "CLP", label: "Pesos chilenos (CLP)", symbol: "CLP", ticket: 40000, step: 1000 },
  { code: "ARS", label: "Pesos argentinos (ARS)", symbol: "ARS", ticket: 40000, step: 1000 },
] as const;
type Currency = (typeof CURRENCIES)[number];

const RECOVER = [
  { every: 10, label: "1 de cada 10 (prudente)" },
  { every: 5, label: "1 de cada 5" },
  { every: 3, label: "1 de cada 3" },
] as const;

const n = (v: number) => Math.round(v).toLocaleString("es-PE");

export function LeadCalc() {
  const id = useId();
  const [leads, setLeads] = useState(200);
  const [offPct, setOffPct] = useState(40);
  const [currency, setCurrency] = useState<Currency>(CURRENCIES[0]);
  const [ticket, setTicket] = useState<number>(CURRENCIES[0].ticket);
  const [every, setEvery] = useState<number>(5);

  const waiting = Math.round((leads * offPct) / 100);
  const recovered = Math.round(waiting / every);
  const revenue = recovered * ticket;
  const pro = PLANS.pro;

  return (
    <div className="lp-calc" data-lead-calc>
      <form className="lp-calc__form" onSubmit={(e) => e.preventDefault()} aria-label="Tus cifras">
        <div className="lp-field">
          <div className="lp-field__head">
            <label htmlFor={`${id}-leads`}>Leads que te escriben al mes</label>
            <output htmlFor={`${id}-leads`}>{n(leads)}</output>
          </div>
          <input
            id={`${id}-leads`}
            className="lp-range"
            type="range"
            min={20}
            max={1000}
            step={10}
            value={leads}
            onChange={(e) => setLeads(Number(e.target.value))}
          />
        </div>

        <div className="lp-field">
          <div className="lp-field__head">
            <label htmlFor={`${id}-off`}>Los que llegan fuera de horario o esperan más de una hora</label>
            <output htmlFor={`${id}-off`}>{offPct} %</output>
          </div>
          <input
            id={`${id}-off`}
            className="lp-range"
            type="range"
            min={10}
            max={80}
            step={5}
            value={offPct}
            onChange={(e) => setOffPct(Number(e.target.value))}
          />
        </div>

        <div className="lp-field lp-field--row">
          <div>
            <label htmlFor={`${id}-ticket`}>Lo que vale una venta</label>
            <input
              id={`${id}-ticket`}
              className="lp-input"
              type="number"
              inputMode="numeric"
              min={1}
              step={currency.step}
              value={ticket}
              onChange={(e) => setTicket(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div>
            <label htmlFor={`${id}-cur`}>Moneda</label>
            <select
              id={`${id}-cur`}
              className="lp-input"
              value={currency.code}
              onChange={(e) => {
                const c = CURRENCIES.find((x) => x.code === e.target.value) ?? CURRENCIES[0];
                setCurrency(c);
                setTicket(c.ticket);
              }}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="lp-field">
          <label htmlFor={`${id}-rec`}>Cuántos de esos leads crees que cierran si les respondes al momento</label>
          <select id={`${id}-rec`} className="lp-input" value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            {RECOVER.map((r) => (
              <option key={r.every} value={r.every}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </form>

      <div className="lp-calc__out" aria-live="polite">
        <p className="lp-calc__label">Ventas que hoy se enfrían esperando respuesta</p>
        <p className="lp-calc__big" data-calc-revenue>
          {currency.symbol} {n(revenue)}
          <small>al mes</small>
        </p>
        <ul className="lp-calc__facts">
          <li>
            <b>{n(waiting)}</b> leads al mes te escriben cuando nadie responde
          </li>
          <li>
            <b>{n(recovered)}</b> ventas recuperadas, con tu supuesto de 1 de cada {every}
          </li>
          <li>
            El plan {pro.name} cuesta <b>USD {pro.priceUsd}</b> al mes para toda tu empresa, con la IA incluida
          </li>
        </ul>
        <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg">
          Probar {TRIAL_DAYS} días gratis <Arrow />
        </Link>
        <p className="lp-calc__note">Son tus cifras y un supuesto que eliges tú. No prometemos resultados: te damos la cuenta.</p>
      </div>
    </div>
  );
}
