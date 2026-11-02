"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CURRENCIES, type DealDto, type StageDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";

/**
 * ¿Hay que preguntar cuánto fue la venta antes de mover aquí? Sí al ganarla
 * (o a una etapa que avisa a Meta de una compra) si aún no tiene valor: sin
 * él, el panel no suma la venta y Meta no sabe cuánto vendieron sus anuncios.
 */
export function asksValue(deal: Pick<DealDto, "value">, stage: Pick<StageDto, "isWon" | "conversionEvents">): boolean {
  const counts = stage.isWon || stage.conversionEvents.some((e) => e.eventName === "Purchase");
  return counts && !(deal.value != null && deal.value > 0);
}

/** «¿Cuánto fue la venta?» al marcar ganada una oportunidad sin valor. */
export function WonValueDialog({
  currency: initialCurrency,
  onSave,
  onSkip,
  onCancel,
}: {
  currency: string;
  onSave: (value: number, currency: string) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(initialCurrency);
  const n = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(n) && n > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="confirm-backdrop confirm-backdrop--top" onClick={onCancel}>
      <div className="confirm-dialog lr-dialog" role="dialog" aria-label="Valor de la venta" onClick={(e) => e.stopPropagation()} data-won-dialog>
        <header className="lr-dialog__head">
          <span className="lr-dialog__icon is-won"><NavIcon name="trophy" size={16} /></span>
          <div>
            <h3>¿Cuánto fue la venta?</h3>
            <p>Con el valor, el panel suma lo que vendes y, si el cliente vino de un anuncio, Meta sabe cuánto vendieron tus anuncios.</p>
          </div>
        </header>
        <form
          className="lr-other"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSave(n, currency);
          }}
        >
          <input
            className="field"
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0.00"
            aria-label="Valor"
          />
          <select className="field" style={{ width: 96, flex: "0 0 auto" }} value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Moneda">
            {!CURRENCIES.some((c) => c.code === currency) && <option value={currency}>{currency}</option>}
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!valid} data-won-save>
            Guardar
          </button>
        </form>
        <footer className="lr-dialog__foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip} data-won-skip>
            Ganada sin valor
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
