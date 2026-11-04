"use client";

import type { QuotePublicView } from "@crm/shared";
import { Wordmark } from "@/components/BrandMark";
import { AI_MODE_LABEL, AI_MODE_NOTE, CATEGORY_LABEL, fmtMoney } from "./labels";

const longDate = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });

/**
 * Hoja de propuesta. Recibe únicamente la vista pública: lo que puede ver el
 * cliente. Sin aprobar lleva la marca «BORRADOR» para que no se entregue por
 * error. Imprimir → «Guardar como PDF» del navegador; no hace falta librería.
 */
export function ProposalPrint({ view, approved }: { view: QuotePublicView; approved: boolean }) {
  const paragraphs = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="proposal-page" data-proposal-print>
      <div className="proposal-toolbar no-print">
        <span>
          {approved ? "Propuesta aprobada: se puede entregar." : "Sin aprobar: sale con marca de borrador."}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.close()}>
            Cerrar
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()} data-print>
            Imprimir / guardar como PDF
          </button>
        </span>
      </div>

      <article className={`proposal${approved ? "" : " is-draft"}`}>
        {!approved && <div className="proposal-watermark" aria-hidden="true">BORRADOR</div>}
        <header className="proposal-head">
          <Wordmark size={22} />
          <div className="proposal-meta">
            <b>Propuesta de implementación</b>
            <span>
              {view.number} · versión {view.version}
            </span>
            {view.validUntil && <span>Válida hasta el {longDate(view.validUntil)}</span>}
          </div>
        </header>

        <h1>{view.title}</h1>
        <p className="proposal-for">
          Preparada para <b>{view.clientName}</b>
        </p>

        {view.objective && (
          <section>
            <h2>Objetivo</h2>
            {paragraphs(view.objective).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        )}

        <section>
          <h2>Qué incluye</h2>
          {paragraphs(view.deliverables).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {view.lines.length > 0 && (
            <ul>
              {view.lines.map((l, i) => (
                <li key={i}>
                  <span className="proposal-cat">{CATEGORY_LABEL[l.category]}</span> {l.description}
                </li>
              ))}
            </ul>
          )}
        </section>

        {view.exclusions && (
          <section>
            <h2>Qué no incluye</h2>
            {paragraphs(view.exclusions).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        )}
        {view.assumptions && (
          <section>
            <h2>Supuestos</h2>
            {paragraphs(view.assumptions).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        )}
        {view.clientRequirements && (
          <section>
            <h2>Lo que necesitamos de ustedes</h2>
            {paragraphs(view.clientRequirements).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        )}
        {view.timelineNote && (
          <section>
            <h2>Plazo orientativo</h2>
            <p>{view.timelineNote}</p>
          </section>
        )}

        <section>
          <h2>Inversión</h2>
          <table className="proposal-table">
            <tbody>
              <tr>
                <td>Implementación (pago único)</td>
                <td className="num">{fmtMoney(view.implementationPriceCents, view.currency)}</td>
              </tr>
              {view.diagnosisCreditCents !== null && (
                <tr>
                  <td>Descuento: diagnóstico ya pagado (se acredita una sola vez)</td>
                  <td className="num">− {fmtMoney(view.diagnosisCreditCents, view.currency)}</td>
                </tr>
              )}
              <tr className="total">
                <td>Total de la implementación</td>
                <td className="num" data-proposal-total>
                  {fmtMoney(view.totalDueCents, view.currency)}
                </td>
              </tr>
            </tbody>
          </table>
          <table className="proposal-table proposal-table--aside">
            <tbody>
              <tr>
                <td>Plan mensual de Driony (se factura aparte, mes a mes)</td>
                <td className="num">{view.plan ? `${view.plan.name} · USD ${(view.plan.monthlyCents / 100).toFixed(0)}/mes` : "Por definir"}</td>
              </tr>
              <tr>
                <td>Inteligencia artificial</td>
                <td className="num">{AI_MODE_LABEL[view.aiBillingMode]}</td>
              </tr>
            </tbody>
          </table>
          <p className="proposal-small">{AI_MODE_NOTE[view.aiBillingMode]}</p>
          {view.externalCostsNote && <p className="proposal-small">{view.externalCostsNote}</p>}
          {view.taxNote && <p className="proposal-small">{view.taxNote}</p>}
        </section>

        {view.supportNote && (
          <section>
            <h2>Soporte</h2>
            <p>{view.supportNote}</p>
          </section>
        )}

        <section>
          <h2>Condiciones</h2>
          <p>{view.paymentTerms || "—"}</p>
          <p className="proposal-small">
            El plazo es orientativo y depende de los accesos y la información que entregue el cliente. Cualquier cambio de alcance se cotiza como una versión nueva de esta propuesta.
            {view.validUntil ? ` Esta propuesta es válida hasta el ${longDate(view.validUntil)}.` : ""}
          </p>
        </section>

        <footer className="proposal-foot">Driony · {view.number} v{view.version}</footer>
      </article>
    </div>
  );
}
