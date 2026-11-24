"use client";

import { BILLING_PERIODS, formatUsd, periodPrice, type BillingPeriodKey, type PlanDef } from "@crm/shared";

/** Elegir cada cuánto se paga, con lo que se ahorra a la vista. Los descuentos salen del catálogo compartido. */
export function PeriodToggle({ value, onChange }: { value: BillingPeriodKey; onChange: (p: BillingPeriodKey) => void }) {
  return (
    <div className="lp-period" role="group" aria-label="Cada cuánto pagar">
      {BILLING_PERIODS.map((p) => (
        <button key={p.key} type="button" aria-pressed={value === p.key} onClick={() => onChange(p.key)} data-period={p.key}>
          {p.label}
          {p.discountPct > 0 && <span className="lp-period__off">−{p.discountPct} %</span>}
        </button>
      ))}
    </div>
  );
}

/** El precio de un plan en ese periodo: lo que se cobra, y debajo lo que sale al mes y lo que se ahorra. */
export function PeriodPrice({ plan, period }: { plan: PlanDef; period: BillingPeriodKey }) {
  const price = periodPrice(plan, period);
  const months = BILLING_PERIODS.find((p) => p.key === period)!.months;
  if (!price || months === 1) {
    return (
      <p className="lp-price" data-price={plan.key}>
        {formatUsd(plan.priceUsd ?? 0)}
        <small>/mes</small>
      </p>
    );
  }
  return (
    <>
      <p className="lp-price" data-price={plan.key}>
        {formatUsd(price.total)}
        <small>/{months === 12 ? "año" : `${months} meses`}</small>
      </p>
      <p className="lp-price__offer">
        <s aria-label={`Precio sin descuento: ${formatUsd(price.full)}`}>{formatUsd(price.full)}</s> Ahorras {formatUsd(price.saved)}
        <span>Unos {formatUsd(price.perMonth)} al mes</span>
      </p>
    </>
  );
}
