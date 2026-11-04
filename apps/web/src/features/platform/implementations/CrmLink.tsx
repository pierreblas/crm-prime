"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { CrmLinkInput, ImplementationAssessment } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { linkImplementationCrm, searchCrm, unlinkImplementationCrm } from "@/lib/bff";
import { fmtMoney } from "./labels";

/**
 * Ficha › CRM propio: qué oportunidad de la empresa de Driony refleja este
 * diagnóstico, y el cajón para enlazarla (una existente, o una nueva para un
 * contacto existente o nuevo). El enlace es un espejo de la cotización: toma
 * el precio al aprobar o aceptar, pasa a ganada al aceptar y a perdida al
 * rechazar. Desvincular no toca la oportunidad.
 */
export function CrmLinkBar({
  a,
  crmReady,
  onChanged,
}: {
  a: ImplementationAssessment;
  /** Hay empresa propia elegida en Ajustes. */
  crmReady: boolean;
  onChanged: (next: ImplementationAssessment) => void;
}) {
  const [open, setOpen] = useState(false);
  const unlink = useMutation({
    mutationFn: () => unlinkImplementationCrm(a.id),
    onSuccess: (next) => {
      onChanged(next);
      toast.success("Desvinculado. La oportunidad sigue en el CRM.");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const askUnlink = () =>
    void confirmDialog({
      message: "¿Desvincular este diagnóstico de su oportunidad? La oportunidad no se borra ni se mueve; solo deja de reflejar la cotización.",
      confirmLabel: "Desvincular",
    }).then((ok) => ok && unlink.mutate());

  const crm = a.crm;
  const tone = crm ? (crm.isWon ? "on" : crm.isLost ? "off" : crm.discarded ? "muted" : "review") : "muted";
  return (
    <div className="pc-actions" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }} data-crm-link={crm ? crm.dealId : a.dealId ? "missing" : "none"}>
      <span className="pc-muted" style={{ fontSize: 12.5 }}>
        CRM propio:
      </span>
      {crm ? (
        <>
          <span className={`pc-badge is-${tone}`} title={`${crm.pipelineName} › ${crm.stageName}`} data-crm-stage>
            {crm.discarded ? "descartada" : crm.stageName}
          </span>
          <span style={{ fontSize: 13 }}>
            {crm.title} · {crm.contactName ?? crm.contactPhone} · {fmtMoney(crm.valueCents, crm.currency)}
          </span>
          <a className="btn btn-ghost btn-sm" href={crm.url} target="_blank" rel="noopener noreferrer" data-crm-open>
            Abrir en el CRM
          </a>
          <button type="button" className="btn btn-ghost btn-sm" disabled={unlink.isPending} onClick={askUnlink} data-crm-unlink>
            Desvincular
          </button>
        </>
      ) : a.dealId ? (
        <>
          <span className="pc-warn">La oportunidad enlazada ya no se encuentra en la empresa propia.</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={unlink.isPending} onClick={askUnlink} data-crm-unlink>
            Desvincular
          </button>
        </>
      ) : (
        <>
          <span className="pc-muted" style={{ fontSize: 13 }}>
            sin oportunidad enlazada
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!crmReady}
            title={crmReady ? undefined : "Elige primero la empresa propia en Ajustes del cotizador"}
            onClick={() => setOpen(true)}
            data-crm-link-open
          >
            Enlazar con el CRM
          </button>
        </>
      )}
      {open && (
        <CrmLinkDrawer
          a={a}
          onClose={() => setOpen(false)}
          onLinked={(next) => {
            onChanged(next);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Un teléfono con código de país dentro del texto libre del contacto, si lo hay. */
function phoneFrom(text: string): string {
  const m = text.match(/\+\d[\d\s().-]{6,}\d/);
  return m ? m[0].replace(/[\s().-]/g, "") : "";
}

function CrmLinkDrawer({ a, onClose, onLinked }: { a: ImplementationAssessment; onClose: () => void; onLinked: (next: ImplementationAssessment) => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [name, setName] = useState(a.clientName);
  const [phone, setPhone] = useState(() => phoneFrom(a.clientContact));
  const latest = a.quotes[0] ?? null;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const search = useQuery({ queryKey: ["platform", "impl", "crm-search", debounced], queryFn: () => searchCrm(debounced), placeholderData: keepPreviousData });
  const link = useMutation({
    mutationFn: (input: CrmLinkInput) => linkImplementationCrm(a.id, input),
    onSuccess: (next, input) => {
      toast.success(input.mode === "deal" ? "Oportunidad enlazada" : "Oportunidad creada en el CRM propio");
      onLinked(next);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const r = search.data;
  const phoneOk = phone.replace(/\D/g, "").length >= 6;
  return (
    <>
      <div className="pc-drawer__backdrop" onClick={onClose} />
      <aside className="pc-drawer" role="dialog" aria-modal="true" aria-label="Enlazar con el CRM propio" data-crm-drawer>
        <header className="pc-drawer__head">
          <div className="pc-drawer__title">
            <h2>Enlazar con el CRM propio</h2>
            <span className="pc-org__meta">
              {a.quoteNumber ?? a.title} · {a.clientName}
              {latest?.proposedPriceCents ? ` · propuesto ${fmtMoney(latest.proposedPriceCents, latest.currency)}` : " · todavía sin precio propuesto"}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar">
            <NavIcon name="x" size={16} />
          </button>
        </header>

        <div className="pc-drawer__body">
          <section className="pc-section">
            <h3>Una oportunidad o un contacto que ya existe</h3>
            <label className="pc-search" style={{ maxWidth: 440 }}>
              <NavIcon name="search" size={15} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título de la oportunidad, nombre o teléfono" aria-label="Buscar en el CRM propio" />
            </label>
            {search.isError && <p style={{ color: "var(--danger)" }}>{(search.error as Error).message}</p>}
            {search.isPending && <div className="skeleton" style={{ height: 60, marginTop: 10 }} />}
            {r && (
              <>
                <p className="pc-muted" style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 6px" }}>
                  {debounced ? "Oportunidades abiertas que coinciden" : "Oportunidades abiertas más recientes"}
                </p>
                {r.deals.length === 0 ? (
                  <p className="pc-empty">Ninguna.</p>
                ) : (
                  <table className="pc-table is-compact" data-crm-deals>
                    <thead>
                      <tr>
                        <th>Oportunidad</th>
                        <th>Etapa</th>
                        <th>Contacto</th>
                        <th className="num">Valor</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {r.deals.map((d) => (
                        <tr key={d.id} data-crm-deal={d.id}>
                          <td>
                            <b>{d.title}</b>
                          </td>
                          <td>
                            {d.pipelineName} › {d.stageName}
                          </td>
                          <td>{d.contactName ?? d.contactPhone}</td>
                          <td className="num">{fmtMoney(d.valueCents, d.currency)}</td>
                          <td>
                            {d.linkedTo ? (
                              <span className="pc-muted" style={{ fontSize: 12 }}>
                                ya enlazada a {d.linkedTo}
                              </span>
                            ) : (
                              <button type="button" className="btn btn-primary btn-sm" disabled={link.isPending} onClick={() => link.mutate({ mode: "deal", dealId: d.id })}>
                                Enlazar
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {debounced && (
                  <>
                    <p className="pc-muted" style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 6px" }}>
                      Contactos
                    </p>
                    {r.contacts.length === 0 ? (
                      <p className="pc-empty">Ninguno con ese nombre o teléfono. Créalo más abajo.</p>
                    ) : (
                      <table className="pc-table is-compact" data-crm-contacts>
                        <thead>
                          <tr>
                            <th>Contacto</th>
                            <th>Teléfono</th>
                            <th className="num">Abiertas</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {r.contacts.map((c) => (
                            <tr key={c.id} data-crm-contact={c.id}>
                              <td>
                                <b>{c.name ?? "Sin nombre"}</b>
                              </td>
                              <td>{c.phone}</td>
                              <td className="num">{c.openDeals}</td>
                              <td>
                                <button type="button" className="btn btn-ghost btn-sm" disabled={link.isPending} onClick={() => link.mutate({ mode: "contact", contactId: c.id })}>
                                  Nueva oportunidad
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </>
            )}
          </section>

          <section className="pc-section" data-crm-new>
            <h3>Un contacto nuevo y su oportunidad</h3>
            <p className="pc-muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Se crea el contacto en la empresa propia y una oportunidad en la etapa de entrada de los ajustes
              {latest?.proposedPriceCents ? `, con ${fmtMoney(latest.proposedPriceCents, latest.currency)} de valor` : ""}. Si el número ya existe, se usa ese contacto.
            </p>
            <div className="pc-form">
              <label>
                Nombre
                <input className="pc-input" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} aria-label="Nombre del contacto nuevo" />
              </label>
              <label>
                Teléfono, con código de país
                <input className="pc-input" value={phone} inputMode="tel" placeholder="+51 999 999 999" maxLength={40} onChange={(e) => setPhone(e.target.value)} aria-label="Teléfono del contacto nuevo" />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 10 }}
              disabled={link.isPending || !name.trim() || !phoneOk}
              onClick={() => link.mutate({ mode: "new", name: name.trim(), phone: phone.trim() })}
              data-crm-create
            >
              {link.isPending ? "Creando…" : "Crear contacto y oportunidad"}
            </button>
          </section>
        </div>
      </aside>
    </>
  );
}
