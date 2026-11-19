import {
  adReferralLabel,
  type AdReferral,
  type AdSalesCounts,
  type AdSalesReport,
  type AdSalesRow,
  type DashboardPeriod,
} from "@crm/shared";

/**
 * Ventas por anuncio, el cálculo (sin base de datos: lo prueba
 * test/ad-sales.test.ts). El servicio trae los clics, las oportunidades y sus
 * pasos por etapas «potencial»; aquí se atribuye y se cuenta.
 *
 * Reglas:
 *  - Cada cliente cuenta una vez, para el último anuncio por el que escribió
 *    en el periodo (último clic, como Meta).
 *  - Una oportunidad cuenta si es de después de su primer clic del periodo: se
 *    creó, cambió de etapa o se cerró después. Una venta de hace meses de un
 *    cliente que vuelve por un anuncio no es mérito del anuncio.
 *  - Potencial: la oportunidad está (o pasó) por una etapa «potencial», o ya
 *    está ganada. Venta: está en una etapa ganada.
 */

export interface AdClick {
  contactId: string;
  at: Date;
  referral: AdReferral;
  /** whatsapp | instagram | messenger… (Conversation.channelKind). */
  channel: string;
}

export interface SalesDeal {
  id: string;
  contactId: string;
  value: number | null;
  currency: string;
  createdAt: Date;
  stageEnteredAt: Date;
  closedAt: Date | null;
  isWon: boolean;
  isQualified: boolean;
}

/** Una vez que la oportunidad entró en una etapa «potencial». */
export interface QualifiedStep {
  dealId: string;
  at: Date;
}

export interface AdSalesInput {
  period: DashboardPeriod;
  clicks: AdClick[];
  /** Clientes que empezaron a escribir en el periodo (primera conversación nueva), con o sin anuncio. */
  started: Map<string, Date>;
  deals: SalesDeal[];
  qualifiedSteps: QualifiedStep[];
  /** Oportunidades con algún evento enviado a Meta. */
  sentDealIds: Set<string>;
  /** La moneda si no hay ventas: la más usada en las oportunidades. */
  fallbackCurrency: string;
  maxAds?: number;
}

/** Margen para la oportunidad que el sistema crea en el mismo instante del primer mensaje. */
const SLACK_MS = 60 * 60_000;

/** Identifica un anuncio: su id; si Meta no lo manda, su titular o su enlace. */
export function adKey(r: AdReferral): string {
  if (r.sourceId?.trim()) return `id:${r.sourceId.trim()}`;
  if (r.headline?.trim()) return `t:${r.headline.trim().toLowerCase()}`;
  return `u:${r.sourceUrl?.trim() ?? "?"}`;
}

/** Solo enlaces http(s): lo demás (javascript:, data:…) no se enseña como enlace. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** La oportunidad es de después del clic: se creó, cambió de etapa o se cerró después. */
export function dealAfter(deal: Pick<SalesDeal, "createdAt" | "stageEnteredAt" | "closedAt">, since: Date): boolean {
  const t = since.getTime();
  return (
    deal.createdAt.getTime() >= t - SLACK_MS ||
    deal.stageEnteredAt.getTime() >= t ||
    (!!deal.closedAt && deal.closedAt.getTime() >= t)
  );
}

interface Outcome {
  qualified: boolean;
  won: boolean;
  /** Valor ganado por moneda. */
  value: Map<string, number>;
  wonDeals: number;
  sent: boolean;
}

function outcome(deals: SalesDeal[], since: Date, steps: Map<string, Date[]>, sent: Set<string>): Outcome {
  const counted = deals.filter((d) => dealAfter(d, since));
  const value = new Map<string, number>();
  let wonDeals = 0;
  for (const d of counted) {
    if (!d.isWon) continue;
    wonDeals++;
    value.set(d.currency, (value.get(d.currency) ?? 0) + (d.value ?? 0));
  }
  return {
    qualified: counted.some(
      (d) => d.isWon || d.isQualified || (steps.get(d.id) ?? []).some((at) => at.getTime() >= since.getTime() - SLACK_MS),
    ),
    won: wonDeals > 0,
    value,
    wonDeals,
    sent: counted.some((d) => sent.has(d.id)),
  };
}

const empty = (): AdSalesCounts => ({ chats: 0, qualified: 0, won: 0, wonValue: 0 });

export function aggregateAdSales(input: AdSalesInput): AdSalesReport {
  const steps = new Map<string, Date[]>();
  for (const s of input.qualifiedSteps) steps.set(s.dealId, [...(steps.get(s.dealId) ?? []), s.at]);
  const dealsOf = new Map<string, SalesDeal[]>();
  for (const d of input.deals) dealsOf.set(d.contactId, [...(dealsOf.get(d.contactId) ?? []), d]);

  // Primer y último clic de cada cliente.
  const byContact = new Map<string, { first: Date; last: AdClick; channels: Set<string> }>();
  for (const c of [...input.clicks].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const cur = byContact.get(c.contactId);
    if (!cur) byContact.set(c.contactId, { first: c.at, last: c, channels: new Set([c.channel]) });
    else {
      cur.last = c;
      cur.channels.add(c.channel);
    }
  }

  // Valor por moneda, para elegir la principal al final (la de más ventas).
  const wonByCurrency = new Map<string, number>();
  const addWon = (o: Outcome) => {
    for (const d of o.value.keys()) wonByCurrency.set(d, (wonByCurrency.get(d) ?? 0) + 1);
  };

  type Acc = { row: Omit<AdSalesRow, "wonValue">; value: Map<string, number>; lastAt: number };
  const rows = new Map<string, Acc>();
  let reportable = 0;
  let sentToMeta = 0;
  for (const [contactId, { first, last }] of byContact) {
    const o = outcome(dealsOf.get(contactId) ?? [], first, steps, input.sentDealIds);
    addWon(o);
    const key = adKey(last.referral);
    let acc = rows.get(key);
    if (!acc) {
      acc = {
        row: {
          key,
          label: adReferralLabel(last.referral),
          sourceUrl: safeUrl(last.referral.sourceUrl),
          imageUrl: safeUrl(last.referral.thumbnailUrl ?? last.referral.imageUrl),
          sourceType: last.referral.sourceType,
          channels: [],
          chats: 0,
          qualified: 0,
          won: 0,
          sentToMeta: 0,
          lastAt: last.at.toISOString(),
        },
        value: new Map(),
        lastAt: 0,
      };
      rows.set(key, acc);
    }
    // Los datos del anuncio, del clic más reciente (Meta a veces manda el titular después).
    if (last.at.getTime() >= acc.lastAt) {
      acc.lastAt = last.at.getTime();
      acc.row.lastAt = last.at.toISOString();
      acc.row.label = adReferralLabel(last.referral);
      acc.row.sourceUrl = safeUrl(last.referral.sourceUrl) ?? acc.row.sourceUrl;
      acc.row.imageUrl = safeUrl(last.referral.thumbnailUrl ?? last.referral.imageUrl) ?? acc.row.imageUrl;
      acc.row.sourceType = last.referral.sourceType ?? acc.row.sourceType;
    }
    if (!acc.row.channels.includes(last.channel)) acc.row.channels.push(last.channel);
    acc.row.chats++;
    if (o.qualified) acc.row.qualified++;
    if (o.won) acc.row.won++;
    if (o.sent) {
      acc.row.sentToMeta++;
      sentToMeta++;
    }
    for (const [cur, v] of o.value) acc.value.set(cur, (acc.value.get(cur) ?? 0) + v);
    if (last.referral.ctwaClid) reportable++;
  }

  // Sin anuncio: empezaron a escribir en el periodo y nunca por un anuncio del periodo.
  const organicValue = new Map<string, number>();
  const organic = empty();
  for (const [contactId, since] of input.started) {
    if (byContact.has(contactId)) continue;
    const o = outcome(dealsOf.get(contactId) ?? [], since, steps, input.sentDealIds);
    addWon(o);
    organic.chats++;
    if (o.qualified) organic.qualified++;
    if (o.won) organic.won++;
    for (const [cur, v] of o.value) organicValue.set(cur, (organicValue.get(cur) ?? 0) + v);
  }

  // Empate: la más usada en la empresa.
  const fav = (c: string) => (c === input.fallbackCurrency ? 0 : 1);
  const currency = [...wonByCurrency.entries()].sort((a, b) => b[1] - a[1] || fav(a[0]) - fav(b[0]))[0]?.[0] ?? input.fallbackCurrency;
  let otherCurrencies = [...organicValue.keys()].some((c) => c !== currency);
  organic.wonValue = organicValue.get(currency) ?? 0;

  const ads: AdSalesRow[] = [...rows.values()].map(({ row, value }) => {
    if ([...value.keys()].some((c) => c !== currency)) otherCurrencies = true;
    return { ...row, wonValue: value.get(currency) ?? 0 };
  });
  ads.sort((a, b) => b.won - a.won || b.wonValue - a.wonValue || b.chats - a.chats || b.lastAt.localeCompare(a.lastAt));

  const totals = ads.reduce(
    (t, r) => ({ chats: t.chats + r.chats, qualified: t.qualified + r.qualified, won: t.won + r.won, wonValue: t.wonValue + r.wonValue }),
    empty(),
  );
  return {
    period: input.period,
    currency,
    otherCurrencies,
    totals: { ...totals, reportable, sentToMeta },
    ads: ads.slice(0, input.maxAds ?? 30),
    organic,
  };
}
