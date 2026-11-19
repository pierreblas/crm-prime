"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Arrow, Check } from "./chrome";

/**
 * La demo del hero, con la forma de la bandeja real: a la izquierda la lista
 * de conversaciones, en el centro el chat con el mando Autopilot / Copilot, y
 * a la derecha los detalles (embudo, ficha y registro de lo que hizo el
 * agente). El visitante elige una conversación y decide quién responde: en
 * Autopilot el agente responde solo; en Copilot propone la respuesta y él la
 * edita, la envía o la descarta. Es «Tú mandas» en un clic.
 *
 * En estrecho la lista se pliega a una fila de casos y los paneles se apilan.
 * La acción que toca va pegada al último mensaje, no al fondo del panel: así
 * el primer botón queda a la vista sin bajar.
 *
 * Cada conversación dice por qué canal llegó (WhatsApp, Instagram, Messenger o
 * TikTok) y la barra los enseña todos: que se vea de un vistazo dónde atiende.
 * Las horas son de noche, como el titular («Tus clientes escriben a medianoche»).
 *
 * Guionada, sin IA real (la etiqueta lo dice): nada se llama al servidor.
 * Al cargar se ve la venta ganada ya hecha (el resultado primero); «Ver cómo
 * lo hizo» la repite paso a paso y las demás conversaciones esperan su clic.
 * Nada corre solo: cada paso lo dispara un clic. El alto de cada panel es fijo
 * para que la página no salte, y con «reducir movimiento» los pasos llegan de
 * golpe. Datos inventados; nada de contactos reales.
 */

type Mode = "auto" | "copilot";
type Channel = "whatsapp" | "instagram" | "messenger" | "tiktok";

const CHANNELS: { key: Channel; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "messenger", label: "Messenger" },
  { key: "tiktok", label: "TikTok" },
];
const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<Channel, string>;

/** La marca de cada canal, en su color (lo pinta el CSS por data-channel) para reconocerla al vuelo. */
function ChannelIcon({ channel, size = 12 }: { channel: Channel; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  if (channel === "whatsapp") {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 1 1-4.2 15.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8z" />
        <path d="M8.9 7.4c-.2-.4-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.9 4.5 4 2.2.9 2.7.7 3.2.7.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-1.9-.9c-.3-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.6.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.1 0-.3 0-.4l-.9-2.3z" />
      </svg>
    );
  }
  if (channel === "instagram") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (channel === "messenger") {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.4 5.5 3.7 7.2V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.5 0 10-4.1 10-9.2S17.5 2 12 2zm1 12.4l-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8z" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="currentColor">
      <path d="M16.6 5.8A4.8 4.8 0 0 1 15.4 3h-3.3v13.1a2.8 2.8 0 1 1-2.8-2.8c.3 0 .6 0 .9.1V10a6.1 6.1 0 1 0 5.2 6V9.6a8 8 0 0 0 4.6 1.5V7.8a4.8 4.8 0 0 1-3.4-2z" />
    </svg>
  );
}
type Phase = "waiting" | "typing" | "suggest" | "acting" | "done" | "discarded";

const STAGES = ["Entrante", "Cotizado", "Reunión", "Ganado"] as const;

interface Scenario {
  key: string;
  /** Por dónde escribió. */
  channel: Channel;
  /** El caso en dos palabras, para la fila de casos en estrecho. */
  chip: string;
  contact: { name: string; role: string; initials: string };
  /** A qué hora escribió, en la lista (de noche: nadie del equipo está conectado). */
  when: string;
  /** Lo que ya había en el chat, en una línea. */
  context?: string;
  ask: string;
  attachment?: string;
  reply: string;
  /** Etapa del embudo antes y después (índices de STAGES). */
  from: number;
  to: number;
  /** Lo que el agente hace en el CRM, en orden. Líneas cortas: van en mono en una columna estrecha. */
  log: string[];
  /** En qué línea del registro cambia la etapa. */
  stageAt: number;
  /** Lo que queda escrito en la ficha, y con qué línea del registro aparece (1 = la primera). */
  facts: { label: string; value: string; at: number }[];
  /** Mientras piensa, qué está mirando. */
  reading: string;
  result: string;
}

const SCENARIOS: Scenario[] = [
  // La venta cerrada va primero: es lo que se ve al cargar la página.
  {
    key: "pago",
    channel: "whatsapp",
    chip: "Mandan comprobante",
    contact: { name: "Lucía Paredes", role: "Administración", initials: "LP" },
    when: "23:52",
    context: "Ayer · Cotización: 12 impresoras láser · USD 4.380",
    ask: "Listo, ya hicimos la transferencia. Adjunto el comprobante.",
    attachment: "comprobante.jpg",
    reply:
      "Recibido, Lucía: transferencia por USD 4.380, operación 004812. Tu pedido queda confirmado y el equipo ya tiene el comprobante para facturar.",
    from: 1,
    to: 3,
    log: [
      "lee el comprobante: USD 4.380",
      "registra el pago en la oportunidad",
      "mueve el embudo: Cotizado → Ganado",
      "avisa a tu equipo para facturar",
      "informa la venta a tu anuncio de Meta",
    ],
    stageAt: 2,
    facts: [
      { label: "Pago", value: "USD 4.380 · op. 004812", at: 2 },
      { label: "Factura", value: "Tu equipo ya fue avisado", at: 4 },
      { label: "Anuncio de Meta", value: "Venta informada", at: 5 },
    ],
    reading: "El agente lee el mensaje y la foto del comprobante…",
    result: "Pago leído y venta cerrada. Tu equipo solo factura.",
  },
  {
    key: "cotizacion",
    channel: "whatsapp",
    chip: "Piden cotización",
    contact: { name: "Carla Ríos", role: "Jefa de compras", initials: "CR" },
    when: "23:49",
    ask: "Hola, necesito cotización de 40 laptops para la oficina. ¿Tienen stock y facturan a empresa?",
    reply:
      "Hola, Carla. Sí hay stock: 40 Laptop Pro 14 a USD 689 cada una, USD 27.560 más IGV, con factura a tu RUC. Entrega en 3 días hábiles en Lima. ¿Te paso con tu ejecutivo para cerrar las condiciones?",
    from: 0,
    to: 1,
    log: [
      "lee el catálogo: Laptop Pro 14 en stock",
      "responde con precio, stock y plazo",
      "crea la oportunidad · USD 27.560",
      "mueve el embudo: Entrante → Cotizado",
      "avisa a Diego, ejecutivo de cuentas",
    ],
    stageAt: 3,
    facts: [
      { label: "Oportunidad", value: "40 Laptop Pro 14", at: 3 },
      { label: "Valor", value: "USD 27.560", at: 3 },
      { label: "Responsable", value: "Diego · ejecutivo", at: 5 },
    ],
    reading: "El agente lee el mensaje y tu catálogo…",
    result: "Cotizado en segundos. La oportunidad ya está en tu embudo.",
  },
  {
    key: "reunion",
    channel: "instagram",
    chip: "Quieren reunión",
    contact: { name: "Martín Salas", role: "Gerente de operaciones", initials: "MS" },
    when: "23:44",
    ask: "Buenas, somos 12 en operaciones y queremos una demo. ¿Pueden el jueves a las 10?",
    reply:
      "Hola, Martín. El jueves a las 10:00 está libre: les reservo 30 minutos por videollamada con Diego, de nuestro equipo. El recordatorio te llega un día antes por aquí.",
    from: 0,
    to: 2,
    log: [
      "revisa la agenda: jueves 10:00 libre",
      "reserva 30 min con Diego",
      "anota en la ficha: 12 personas",
      "mueve el embudo: Entrante → Reunión",
      "programa el recordatorio de la cita",
    ],
    stageAt: 3,
    facts: [
      { label: "Cita", value: "Jueves 10:00 · 30 min", at: 2 },
      { label: "Ficha", value: "Operaciones · 12 personas", at: 3 },
      { label: "Recordatorio", value: "Miércoles, por Instagram", at: 5 },
    ],
    reading: "El agente lee el mensaje y la agenda del equipo…",
    result: "Reunión agendada sin que nadie abriera el calendario.",
  },
  {
    key: "envio",
    channel: "tiktok",
    chip: "Preguntan envío",
    contact: { name: "Sofía Vega", role: "Vio tu video", initials: "SV" },
    when: "23:40",
    ask: "Vi su video de la Laptop Pro 14 😍 ¿Hacen envíos a Arequipa? ¿Cuánto sale?",
    reply:
      "¡Hola, Sofía! Sí enviamos a Arequipa: la Laptop Pro 14 está USD 689 y el envío, USD 12. Llega en 2 a 3 días hábiles. ¿Te la separo?",
    from: 0,
    to: 1,
    log: [
      "lee el catálogo: Laptop Pro 14 · USD 689",
      "busca tus envíos: Arequipa · USD 12",
      "responde con precio, envío y plazo",
      "etiqueta «Vino de TikTok»",
      "mueve el embudo: Entrante → Cotizado",
    ],
    stageAt: 4,
    facts: [
      { label: "Oportunidad", value: "Laptop Pro 14 · Arequipa", at: 3 },
      { label: "Valor", value: "USD 701", at: 3 },
      { label: "Etiqueta", value: "Vino de TikTok", at: 4 },
    ],
    reading: "El agente lee el mensaje, tu catálogo y tus envíos…",
    result: "Cotizado con envío incluido, a medianoche y sin nadie conectado.",
  },
];

const MODE_HINT: Record<Mode, string> = {
  auto: "Autopilot: el agente responde solo y tú supervisas.",
  copilot: "Copilot: el agente sugiere y tú apruebas.",
};

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** La venta ganada, que se ve ya hecha al cargar: lo primero es el resultado. */
const FIRST = SCENARIOS[0]!;

export function HeroDemo() {
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<Mode>("auto");
  const [phase, setPhase] = useState<Phase>("done");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<string | null>(FIRST.reply);
  const [approved, setApproved] = useState(false);
  const [logCount, setLogCount] = useState(FIRST.log.length);
  const [waited, setWaited] = useState(0);
  // Las conversaciones que ya se atendieron: en la lista quedan como «Atendido» al pasar a otra.
  const [attended, setAttended] = useState<Record<string, boolean>>({ [FIRST.key]: true });
  const timers = useRef<number[]>([]);
  const reduced = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sc = SCENARIOS[idx]!;

  const clearAll = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  /** Un paso más tarde; con «reducir movimiento», casi al instante pero en el mismo orden. */
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, reduced.current ? Math.min(ms, 40) : ms));
  };

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return clearAll;
  }, []);

  // El cliente espera: el reloj corre hasta que alguien le responde.
  const pending = phase === "waiting" || phase === "typing" || phase === "suggest";
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setWaited((w) => w + 1), 1000);
    return () => window.clearInterval(t);
  }, [pending, idx, mode]);

  // El chat baja solo a lo último (solo su caja: nunca mueve la página).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [phase, sent, idx]);

  /** Abre una conversación desde cero (también la que ya estaba atendida: se vuelve a jugar). */
  const reset = (nextIdx: number, nextMode: Mode) => {
    clearAll();
    setAttended((a) => ({ ...a, [SCENARIOS[nextIdx]!.key]: false }));
    setIdx(nextIdx);
    setMode(nextMode);
    setPhase("waiting");
    setDraft("");
    setSent(null);
    setApproved(false);
    setLogCount(0);
    setWaited(0);
  };

  const send = (text: string, byHuman: boolean) => {
    clearAll();
    setSent(text);
    setApproved(byHuman);
    setAttended((a) => ({ ...a, [sc.key]: true }));
    setPhase("acting");
    setLogCount(0);
    sc.log.forEach((_, i) => later(450 + i * 680, () => setLogCount(i + 1)));
    later(450 + sc.log.length * 680, () => setPhase("done"));
  };

  const start = () => {
    clearAll();
    setPhase("typing");
    later(1300, () => {
      if (mode === "auto") send(sc.reply, false);
      else {
        setDraft(sc.reply);
        setPhase("suggest");
      }
    });
  };

  /** La misma conversación otra vez, paso a paso: lo que se vio hecho, ahora en marcha. */
  const replay = () => {
    reset(idx, mode);
    start();
  };

  const discard = () => {
    clearAll();
    setPhase("discarded");
  };

  const acted = phase === "acting" || phase === "done";
  const stage = acted && logCount > sc.stageAt ? sc.to : sc.from;
  const other: Mode = mode === "auto" ? "copilot" : "auto";

  // Cómo va cada conversación en la lista: la abierta sigue a la demo; las demás, a lo ya atendido.
  const rows = SCENARIOS.map((s, i) => {
    const active = i === idx;
    const state: "waiting" | "done" | "off" = active ? (pending ? "waiting" : acted ? "done" : "off") : attended[s.key] ? "done" : "waiting";
    return { s, i, active, state, stage: active ? stage : attended[s.key] ? s.to : s.from };
  });
  const unanswered = rows.filter((r) => r.state === "waiting").length;

  return (
    <div className="lp-demo" data-hero-demo data-phase={phase} data-mode={mode}>
      <div className="lp-demo__bar">
        <span aria-hidden="true">
          <b>Bandeja</b> Demo interactiva
        </span>
        <span className="lp-demo__channels" role="img" aria-label="Llegan por WhatsApp, Instagram, Messenger y TikTok">
          <span className="lp-demo__channels-label">Llegan por</span>
          {CHANNELS.map((c) => (
            <span key={c.key} className="lp-demo__channel" data-channel={c.key}>
              <ChannelIcon channel={c.key} />
              {c.label}
            </span>
          ))}
        </span>
        <span className="lp-demo__tag">Datos de ejemplo</span>
      </div>

      <div className="lp-demo__body">
        {/* La lista de conversaciones: elegir una es elegir el caso. */}
        <div className="lp-demo__list" role="radiogroup" aria-label="Conversaciones de ejemplo">
          <div className="lp-demo__list-head">
            <span>Conversaciones</span>
            <span data-demo-unanswered>{unanswered === 0 ? "Todo atendido" : `${unanswered} sin responder`}</span>
          </div>
          {rows.map(({ s, i, active, state, stage: st }) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${s.contact.name}, por ${CHANNEL_LABEL[s.channel]}: ${s.chip}`}
              className="lp-demo__conv"
              onClick={() => !active && reset(i, mode)}
              data-demo-case={s.key}
              data-state={state}
            >
              <span className="lp-demo__avatar" aria-hidden="true">
                {s.contact.initials}
                <span className="lp-demo__badge" data-channel={s.channel}>
                  <ChannelIcon channel={s.channel} size={10} />
                </span>
              </span>
              <span className="lp-demo__conv-main">
                <span className="lp-demo__conv-top">
                  <strong>{s.contact.name}</strong>
                  <span>{s.when}</span>
                </span>
                <span className="lp-demo__conv-preview">{s.ask}</span>
                <span className="lp-demo__conv-tags">
                  <span className={`lp-demo__dot is-${state}`}>{state === "waiting" ? "Sin responder" : state === "done" ? "Atendido" : "Contigo"}</span>
                  <span className="lp-demo__stage">{STAGES[st]}</span>
                </span>
              </span>
              <span className="lp-demo__conv-chip">
                <span className="lp-demo__chip-icon" data-channel={s.channel}>
                  <ChannelIcon channel={s.channel} />
                </span>
                {s.chip}
              </span>
            </button>
          ))}
          <p className="lp-demo__list-hint">Abre una conversación y decide quién responde.</p>
        </div>

        {/* El chat, con el mando arriba y la acción que toca pegada al último mensaje. */}
        <div className="lp-demo__chatpane">
          <div className="lp-demo__head">
            <span className="lp-demo__avatar" aria-hidden="true">
              {sc.contact.initials}
            </span>
            <span className="lp-demo__who">
              <strong>{sc.contact.name}</strong>
              {/* El canal primero: en estrecho la línea se recorta y es lo que más importa. */}
              <small>
                <span className="lp-demo__via" data-channel={sc.channel}>
                  <ChannelIcon channel={sc.channel} size={11} />
                  {CHANNEL_LABEL[sc.channel]}
                </span>{" "}
                · {sc.contact.role}
              </small>
            </span>
            <span className={`lp-demo__wait ${pending ? "is-waiting" : acted ? "is-done" : "is-off"}`} data-demo-wait>
              {pending ? `Esperando ${clock(waited)}` : acted ? "Atendido" : "Lo atiendes tú"}
            </span>
            <div className="lp-demo__seg" role="radiogroup" aria-label="Modo del agente">
              {(["auto", "copilot"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => mode !== m && reset(idx, m)} data-demo-mode={m}>
                  {m === "auto" ? "Autopilot" : "Copilot"}
                </button>
              ))}
            </div>
          </div>
          <div className="lp-demo__scroll" ref={scrollRef}>
            <div className="lp-demo__chat" role="log" aria-live="polite" aria-label={`Chat con ${sc.contact.name}`}>
              {sc.context && <p className="lp-demo__note">{sc.context}</p>}
              <div className="lp-demo__msg lp-demo__msg--in" key={`ask-${sc.key}`}>
                {sc.ask}
                {sc.attachment && (
                  <span className="lp-demo__file">
                    <i aria-hidden="true" />
                    {sc.attachment}
                  </span>
                )}
              </div>
              {phase === "typing" && (
                <div className="lp-demo__typing" aria-label="El agente está escribiendo">
                  <i />
                  <i />
                  <i />
                </div>
              )}
              {phase === "suggest" && (
                <label className="lp-demo__draft">
                  <span>Sugerencia del agente · puedes editarla</span>
                  <textarea value={draft} rows={4} maxLength={600} onChange={(e) => setDraft(e.target.value)} data-demo-draft />
                </label>
              )}
              {sent !== null && (
                <div className="lp-demo__msg lp-demo__msg--out" data-demo-reply>
                  {sent}
                  <span className="lp-demo__meta">
                    {approved && <span>aprobada por ti</span>}
                    <span className="lp-demo__ia">IA</span>
                  </span>
                </div>
              )}
              {phase === "discarded" && <p className="lp-demo__note">Sugerencia descartada. El agente no envió nada.</p>}
            </div>

            <div className="lp-demo__act">
              {phase === "waiting" && (
                <>
                  <button type="button" className="lp-demo__go" onClick={start} data-demo-go>
                    {mode === "auto" ? "Que responda el agente" : "Pedir sugerencia al agente"} <Arrow />
                  </button>
                  <p className="lp-demo__status lp-demo__status--end">{MODE_HINT[mode]}</p>
                </>
              )}
              {phase === "typing" && <p className="lp-demo__status">{sc.reading}</p>}
              {phase === "suggest" && (
                <div className="lp-demo__row lp-demo__row--end">
                  <span className="lp-demo__status">Nada sale sin tu visto bueno.</span>
                  <button type="button" className="lp-demo__btn" onClick={discard} data-demo-discard>
                    Descartar
                  </button>
                  <button type="button" className="lp-demo__btn lp-demo__btn--primary" disabled={!draft.trim()} onClick={() => send(draft.trim(), true)} data-demo-send>
                    Enviar
                  </button>
                </div>
              )}
              {phase === "acting" && <p className="lp-demo__status">Respuesta enviada. Actualizando tu CRM…</p>}
              {(phase === "done" || phase === "discarded") && (
                <div className="lp-demo__after">
                  <p className="lp-demo__result" data-demo-result>
                    {phase === "done" ? sc.result : "Este chat lo atiendes tú. En Copilot siempre decides tú."}
                  </p>
                  <div className="lp-demo__row">
                    {phase === "done" && (
                      <button type="button" className="lp-demo__btn" onClick={replay} data-demo-replay>
                        Ver cómo lo hizo
                      </button>
                    )}
                    <button type="button" className="lp-demo__btn" onClick={() => reset(idx, other)} data-demo-switch>
                      Verlo en {other === "auto" ? "Autopilot" : "Copilot"}
                    </button>
                    <Link href="/register" className="lp-demo__link">
                      Probar gratis <Arrow />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Los detalles: embudo, ficha y registro de lo que hizo el agente. */}
        <div className="lp-demo__crm" aria-live="polite">
          <div className="lp-demo__crm-head">
            <span>Detalles · lo que hizo el agente</span>
            <span>{acted ? `${logCount}/${sc.log.length}` : "—"}</span>
          </div>
          <div className="lp-demo__crm-body">
            <ol className="lp-demo__pipe" aria-label={`Embudo: la oportunidad está en ${STAGES[stage]}`}>
              {STAGES.map((s, i) => (
                <li key={s} className={i === stage ? "is-on" : i < stage ? "is-past" : ""}>
                  {s}
                </li>
              ))}
            </ol>
            <dl className="lp-demo__facts" data-demo-facts>
              {sc.facts.map((f) => {
                const on = acted && logCount >= f.at;
                return (
                  <div key={f.label} className={on ? "is-on" : ""}>
                    <dt>{f.label}</dt>
                    <dd>{on ? f.value : "—"}</dd>
                  </div>
                );
              })}
            </dl>
            <ul className="lp-demo__log" data-demo-log>
              {acted ? (
                sc.log.slice(0, logCount).map((line) => (
                  <li key={line}>
                    <Check />
                    <span>{line}</span>
                  </li>
                ))
              ) : (
                <li className="is-idle">
                  <span>
                    {phase === "suggest"
                      ? "sugerencia lista: espera tu visto bueno"
                      : phase === "discarded"
                        ? "sin acciones: lo atiendes tú"
                        : phase === "typing"
                          ? "leyendo…"
                          : "esperando a que alguien responda"}
                  </span>
                  <b aria-hidden="true">▌</b>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
