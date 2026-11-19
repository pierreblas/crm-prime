"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatMoney, type AdSalesCounts, type AdSalesRow, type DashboardPeriod } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { fetchAdSales } from "@/lib/bff";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", tiktok: "TikTok" };
const rate = (part: number, of: number) => (of > 0 ? `${Math.round((part / of) * 100)} %` : "—");

/**
 * Ventas por anuncio: qué anuncio de Meta trae clientes que compran, no solo
 * mensajes. Cada cliente cuenta para el último anuncio por el que escribió, y
 * los que llegaron sin anuncio van aparte para comparar.
 */
export function AdSales({ period }: { period: DashboardPeriod }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["dashboard-ads", period],
    queryFn: () => fetchAdSales(period),
    placeholderData: keepPreviousData,
    refetchInterval: 300_000,
  });
  const money = (n: number) => (data ? formatMoney(n, data.currency) : String(n));

  return (
    <section className="dash__card dash__wide ad-sales" data-ad-sales>
      <div className="dash__cardhead">
        <div className="ad-sales__title">
          <h3>
            <NavIcon name="megaphone" size={15} /> Ventas por anuncio
          </h3>
          <p>
            Los clientes que escribieron desde un anuncio de Meta en este periodo (WhatsApp, Instagram o Messenger) y lo que pasó después con
            ellos. Cada uno cuenta para el último anuncio por el que escribió.
          </p>
        </div>
      </div>

      {isPending && <p className="dash__empty">Cargando…</p>}
      {isError && <p className="dash__empty">No se pudo cargar.</p>}
      {data && data.totals.chats === 0 && (
        <p className="dash__empty" data-ad-sales-empty>
          Nadie escribió desde un anuncio en este periodo. Cuando alguien toque un anuncio de Click to WhatsApp, Instagram o Messenger y te
          escriba, verás aquí cuántos llegan a potencial y cuántos compran.
        </p>
      )}

      {data && data.totals.chats > 0 && (
        <>
          <div className="ad-sales__totals">
            <Total label="Chats de anuncios" value={String(data.totals.chats)} />
            <Total label="Potenciales" value={String(data.totals.qualified)} sub={rate(data.totals.qualified, data.totals.chats)} />
            <Total label="Ventas" value={String(data.totals.won)} sub={rate(data.totals.won, data.totals.chats)} />
            <Total label="Vendido" value={money(data.totals.wonValue)} sub={data.otherCurrencies ? `solo ${data.currency}` : undefined} />
          </div>

          <MetaLine sent={data.totals.sentToMeta} won={data.totals.won} reportable={data.totals.reportable} />

          <div className="ad-sales__table" role="table" aria-label="Ventas por anuncio">
            <div className="ad-sales__row ad-sales__row--head" role="row">
              <span role="columnheader">Anuncio</span>
              <span role="columnheader">Chats</span>
              <span role="columnheader">Potenciales</span>
              <span role="columnheader">Ventas</span>
              <span role="columnheader">Vendido</span>
              <span role="columnheader" title="Ventas de cada 100 chats">Compran</span>
            </div>
            {data.ads.map((a) => (
              <AdRow key={a.key} ad={a} money={money} best={a.won > 0 && a.chats >= MIN_CHATS && a.won / a.chats === bestRate(data.ads)} />
            ))}
            <Counts
              label="Sin anuncio"
              hint="Empezaron a escribir en el periodo sin venir de un anuncio"
              counts={data.organic}
              money={money}
            />
          </div>
        </>
      )}
    </section>
  );
}

/** Con menos chats, un porcentaje no dice nada (1 de 1 no es «el mejor»). */
const MIN_CHATS = 3;

/** La mejor proporción de clientes que compran, entre los anuncios con chats suficientes. */
function bestRate(ads: AdSalesRow[]): number {
  return Math.max(0, ...ads.filter((a) => a.chats >= MIN_CHATS).map((a) => a.won / a.chats));
}

function Total({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ad-sales__total">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Lo que se avisó a Meta: es lo que le enseña a la campaña qué cliente buscar. */
function MetaLine({ sent, won, reportable }: { sent: number; won: number; reportable: number }) {
  if (reportable === 0) return null;
  if (sent > 0)
    return (
      <p className="ad-sales__meta" data-ad-sales-meta="on">
        <NavIcon name="check" size={13} /> {sent === 1 ? "1 cliente se avisó" : `${sent} clientes se avisaron`} a Meta como lead o venta: tus
        campañas aprenden a buscar más como ellos.
      </p>
    );
  return (
    <p className="ad-sales__meta is-off" data-ad-sales-meta="off">
      <NavIcon name="alert" size={13} />
      <span>
        {won > 0 ? `Tienes ${won === 1 ? "1 venta" : `${won} ventas`} de anuncios que Meta no conoce.` : "Meta no sabe quién de estos chats compra."}{" "}
        Activa las conversiones para que tus campañas busquen clientes como los que compran.{" "}
        <Link href="/settings?tab=integrations">Activar conversiones</Link>
      </span>
    </p>
  );
}

function AdRow({ ad, money, best }: { ad: AdSalesRow; money: (n: number) => string; best: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`ad-sales__row${best ? " is-best" : ""}`} role="row" data-ad-sales-row={ad.key}>
      <span className="ad-sales__ad" role="cell">
        {ad.imageUrl && !broken ? (
          // Las miniaturas de Meta caducan: si ya no carga, el icono.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <span className="ad-sales__thumb" aria-hidden="true">
            <NavIcon name="megaphone" size={16} />
          </span>
        )}
        <span className="ad-sales__name">
          <strong title={ad.label}>{ad.label}</strong>
          <small>
            {ad.channels.map((c) => CHANNEL[c] ?? c).join(" · ")}
            {ad.sourceType === "post" ? " · publicación" : ""}
            {best && <b className="ad-sales__best"> · el que mejor convierte</b>}
            {ad.sourceUrl && (
              <>
                {" · "}
                <a href={ad.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Ver anuncio
                </a>
              </>
            )}
          </small>
        </span>
      </span>
      <Cells counts={ad} money={money} />
    </div>
  );
}

function Counts({ label, hint, counts, money }: { label: string; hint: string; counts: AdSalesCounts; money: (n: number) => string }) {
  return (
    <div className="ad-sales__row ad-sales__row--organic" role="row" data-ad-sales-organic>
      <span className="ad-sales__ad" role="cell">
        <span className="ad-sales__thumb" aria-hidden="true">
          <NavIcon name="message" size={16} />
        </span>
        <span className="ad-sales__name">
          <strong>{label}</strong>
          <small>{hint}</small>
        </span>
      </span>
      <Cells counts={counts} money={money} />
    </div>
  );
}

function Cells({ counts, money }: { counts: AdSalesCounts; money: (n: number) => string }) {
  return (
    <>
      <span role="cell" data-label="Chats">
        {counts.chats}
      </span>
      <span role="cell" data-label="Potenciales">
        {counts.qualified}
      </span>
      <span role="cell" data-label="Ventas">
        {counts.won}
      </span>
      <span role="cell" data-label="Vendido">
        {counts.wonValue > 0 ? money(counts.wonValue) : "—"}
      </span>
      <span role="cell" data-label="Compran" className="ad-sales__rate">
        {rate(counts.won, counts.chats)}
      </span>
    </>
  );
}
