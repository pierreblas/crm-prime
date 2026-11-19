"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Arrow, Check, MetaMark } from "./chrome";

/**
 * La demo del hero, con la forma de la bandeja de Driony a medianoche: a la
 * izquierda las conversaciones (filtrables por canal), en el centro el chat
 * entero con su historia (se desliza hacia arriba) y lo que hizo el agente, y a
 * la derecha el expediente del lead (embudo, valor, tiempo de respuesta y lo que
 * pasó esta noche). El visitante elige una conversación y decide quién
 * responde: en Autopilot el agente responde solo; en Copilot propone la
 * respuesta y él la edita, la envía o la descarta.
 *
 * Al cargar se ve la venta ganada ya hecha (el resultado primero); «Ver cómo lo
 * hizo» la repite paso a paso y las demás conversaciones esperan su clic.
 *
 * Todo lo que enseña lo hace Driony de verdad: leer un comprobante, botones
 * para pulsar (botones en WhatsApp, respuestas rápidas en Instagram y
 * Messenger, opciones numeradas en TikTok), recordar al cliente, mover el
 * embudo, avisar al equipo e informar la venta a Meta. Guionada, sin IA real
 * (la etiqueta lo dice): nada se llama al servidor. Datos inventados.
 * Con «reducir movimiento» los pasos llegan de golpe.
 */

type Mode = "auto" | "copilot";
type Channel = "whatsapp" | "instagram" | "messenger" | "tiktok";
type Phase = "waiting" | "typing" | "suggest" | "acting" | "done" | "discarded";

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

const STAGES = ["Entrante", "Cotizado", "Reunión", "Ganado"] as const;
/** La hora de la demo: medianoche, como el titular. */
const NOW = "23:52";

interface Msg {
  who: "in" | "out";
  text: string;
  at: string;
  /** El cliente pulsó un botón: su mensaje es el texto del botón. */
  tap?: boolean;
  /** Botones que llevaba el mensaje del negocio. */
  buttons?: string[];
  file?: { name: string; meta: string };
}

interface Scenario {
  key: string;
  channel: Channel;
  /** Debajo del nombre: canal y tipo de cliente. */
  segment: string;
  /** El caso en dos palabras, para la fila de casos en estrecho. */
  chip: string;
  contact: { name: string; initials: string; handle: string };
  when: string;
  /** De qué va, en la tarjeta de la lista. */
  topic: string;
  /** Lo que ya se habló antes (arriba del separador): se ve deslizando hacia arriba. */
  history: Msg[];
  /** El separador de hoy. */
  divider: string;
  ask: Msg;
  reply: string;
  replyButtons?: string[];
  reading: string;
  /** Lo que hizo el agente, en tres datos, y con qué línea del registro llega cada uno (1 = la primera). */
  trace: { label: string; value: string; at: number }[];
  from: number;
  to: number;
  /** Cuándo llegó a cada etapa (por índice). */
  stageTimes: Partial<Record<number, string>>;
  /** Lo que el agente hace en el CRM, en orden. Líneas cortas: van en mono en una columna estrecha. */
  log: string[];
  /** En qué línea del registro cambia la etapa (índice). */
  stageAt: number;
  value: string;
  /** Lo que entendió del mensaje (la clasificación). */
  intent: string;
  result: string;
}

const SCENARIOS: Scenario[] = [
  // La venta cerrada va primero: es lo que se ve al cargar la página.
  {
    key: "pago",
    channel: "whatsapp",
    segment: "WhatsApp · Empresa",
    chip: "Mandan comprobante",
    contact: { name: "Lucía Paredes", initials: "LP", handle: "+51 9•• ••• 482" },
    when: "23:52",
    topic: "Cotización: 12 impresoras",
    history: [
      { who: "in", at: "Ayer 18:10", text: "Hola, ¿me cotizan 12 impresoras láser para la oficina? Necesitamos factura." },
      {
        who: "out",
        at: "Ayer 18:10",
        text: "Hola, Lucía. Te cotizo 12 Láser Pro M404 a USD 365 cada una: USD 4.380, con factura a tu RUC. Entrega en 48 h en Lima. ¿Te las separo?",
        buttons: ["Sí, sepáralas", "Tengo dudas"],
      },
      { who: "in", at: "Ayer 18:12", text: "Sí, sepáralas", tap: true },
      { who: "out", at: "Ayer 18:12", text: "¡Listo! Quedan separadas hasta mañana. Cuando hagas la transferencia, envíame el comprobante por aquí." },
    ],
    divider: "Hoy · 23:52 · fuera de horario",
    ask: { who: "in", at: "23:52", text: "Listo, ya hicimos la transferencia. Adjunto el comprobante.", file: { name: "comprobante.jpg", meta: "Imagen · 182 KB" } },
    reply: "Recibido, Lucía: transferencia por USD 4.380, operación 004812. Tu pedido queda confirmado y el equipo ya tiene el comprobante para facturar.",
    reading: "El agente lee la foto del comprobante y la cotización de ayer…",
    trace: [
      { label: "Comprobante", value: "USD 4.380 · op. 004812", at: 1 },
      { label: "Cotización", value: "Coincide: 12 impresoras", at: 2 },
      { label: "Embudo", value: "Cotizado → Ganado", at: 3 },
    ],
    from: 1,
    to: 3,
    stageTimes: { 0: "Ayer 18:10", 1: "Ayer 18:10", 3: "23:52" },
    log: [
      "lee el comprobante: USD 4.380",
      "lo cruza con la cotización de ayer",
      "mueve el embudo: Cotizado → Ganado",
      "avisa a tu equipo para facturar",
      "informa la venta a tu anuncio de Meta",
    ],
    stageAt: 2,
    value: "USD 4.380",
    intent: "Pago · urgencia alta",
    result: "Pago leído y venta cerrada. Tu equipo solo factura.",
  },
  {
    key: "cotizacion",
    channel: "whatsapp",
    segment: "WhatsApp · Empresa",
    chip: "Piden cotización",
    contact: { name: "Carla Ríos", initials: "CR", handle: "+51 9•• ••• 127" },
    when: "23:49",
    topic: "40 laptops para oficina",
    history: [],
    divider: "Hoy · 23:49 · fuera de horario",
    ask: { who: "in", at: "23:49", text: "Hola, necesito cotización de 40 laptops para la oficina. ¿Tienen stock y facturan a empresa?" },
    reply: "Hola, Carla. Sí hay stock: 40 Laptop Pro 14 a USD 689 cada una, USD 27.560 más IGV, con factura a tu RUC. Entrega en 3 días hábiles en Lima. ¿Te las separo?",
    replyButtons: ["Sí, sepáralas", "Hablar con ventas"],
    reading: "El agente lee el mensaje y tu catálogo…",
    trace: [
      { label: "Catálogo", value: "Laptop Pro 14 · 40 en stock", at: 1 },
      { label: "Cotización", value: "USD 27.560 + IGV", at: 3 },
      { label: "Embudo", value: "Entrante → Cotizado", at: 4 },
    ],
    from: 0,
    to: 1,
    stageTimes: { 0: "23:49", 1: "23:49" },
    log: [
      "lee el catálogo: Laptop Pro 14 en stock",
      "responde con precio, stock y plazo",
      "crea la oportunidad · USD 27.560",
      "mueve el embudo: Entrante → Cotizado",
      "avisa a Diego, ejecutivo de cuentas",
    ],
    stageAt: 3,
    value: "USD 27.560",
    intent: "Cotización · empresa",
    result: "Cotizado en segundos. La oportunidad ya está en tu embudo.",
  },
  {
    key: "reunion",
    channel: "instagram",
    segment: "Instagram · Mensaje directo",
    chip: "Quieren reunión",
    contact: { name: "Martín Salas", initials: "MS", handle: "@martin.salas" },
    when: "23:44",
    topic: "Demo para 12 personas",
    history: [],
    divider: "Hoy · 23:44 · fuera de horario",
    ask: { who: "in", at: "23:44", text: "Buenas, somos 12 en operaciones y queremos una demo. ¿Pueden el jueves a las 10?" },
    reply: "Hola, Martín. El jueves a las 10:00 está libre: les reservo 30 minutos por videollamada con Diego, de nuestro equipo. El recordatorio te llega un día antes por aquí.",
    reading: "El agente lee el mensaje y la agenda del equipo…",
    trace: [
      { label: "Agenda", value: "Jueves 10:00 libre", at: 1 },
      { label: "Cita", value: "30 min con Diego", at: 2 },
      { label: "Embudo", value: "Entrante → Reunión", at: 4 },
    ],
    from: 0,
    to: 2,
    stageTimes: { 0: "23:44", 2: "23:44" },
    log: [
      "revisa la agenda: jueves 10:00 libre",
      "reserva 30 min con Diego",
      "anota en la ficha: 12 personas",
      "mueve el embudo: Entrante → Reunión",
      "programa el recordatorio de la cita",
    ],
    stageAt: 3,
    value: "Demo · 12 personas",
    intent: "Reunión · empresa",
    result: "Reunión agendada sin que nadie abriera el calendario.",
  },
  {
    key: "envio",
    channel: "tiktok",
    segment: "TikTok · Vio tu video",
    chip: "Preguntan envío",
    contact: { name: "Sofía Vega", initials: "SV", handle: "@sofivega" },
    when: "23:40",
    topic: "Envío a Arequipa",
    history: [],
    divider: "Hoy · 23:40 · fuera de horario",
    ask: { who: "in", at: "23:40", text: "Vi su video de la Laptop Pro 14 😍 ¿Hacen envíos a Arequipa? ¿Cuánto sale?" },
    reply: "¡Hola, Sofía! Sí enviamos a Arequipa: la Laptop Pro 14 está USD 689 y el envío, USD 12. Llega en 2 a 3 días hábiles. ¿Te la separo?",
    replyButtons: ["Sí, sepárala", "Tengo dudas"],
    reading: "El agente lee el mensaje, tu catálogo y tus envíos…",
    trace: [
      { label: "Catálogo", value: "Laptop Pro 14 · USD 689", at: 1 },
      { label: "Envío", value: "Arequipa · USD 12", at: 2 },
      { label: "Etiqueta", value: "Vino de TikTok", at: 4 },
    ],
    from: 0,
    to: 1,
    stageTimes: { 0: "23:40", 1: "23:40" },
    log: [
      "lee el catálogo: Laptop Pro 14 · USD 689",
      "busca tus envíos: Arequipa · USD 12",
      "responde con precio, envío y plazo",
      "etiqueta «Vino de TikTok»",
      "mueve el embudo: Entrante → Cotizado",
    ],
    stageAt: 4,
    value: "USD 701",
    intent: "Compra · envío",
    result: "Cotizado con envío incluido, a medianoche y sin nadie conectado.",
  },
  {
    key: "recompra",
    channel: "messenger",
    segment: "Messenger · Página de Facebook",
    chip: "Vuelve a comprar",
    contact: { name: "Jorge Medina", initials: "JM", handle: "Página de Facebook" },
    when: "23:31",
    topic: "Recompra de tóner",
    history: [{ who: "out", at: "Agosto", text: "Gracias por tu compra, Jorge. Tus 6 Láser Pro M404 salen hoy en la tarde." }],
    divider: "Hoy · 23:31 · fuera de horario",
    ask: { who: "in", at: "23:31", text: "Hola, ¿tienen tóner para las M404? Necesito 6." },
    reply: "Hola, Jorge 👋 Sí: tóner TN-404 para tus M404, a USD 58 cada uno, USD 348 los 6. Llegan mañana. ¿Te los separo?",
    replyButtons: ["Sí, sepáralos", "Ver otros"],
    reading: "El agente recuerda lo que compró y lee tu catálogo…",
    trace: [
      { label: "Recuerda", value: "Compró 6 M404 en agosto", at: 1 },
      { label: "Catálogo", value: "Tóner TN-404 · USD 58", at: 2 },
      { label: "Embudo", value: "Entrante → Cotizado", at: 5 },
    ],
    from: 0,
    to: 1,
    stageTimes: { 0: "23:31", 1: "23:31" },
    log: [
      "recuerda su compra de agosto: 6 M404",
      "lee el catálogo: tóner TN-404",
      "responde con precio y plazo",
      "etiqueta «Recompra»",
      "mueve el embudo: Entrante → Cotizado",
    ],
    stageAt: 4,
    value: "USD 348",
    intent: "Recompra",
    result: "Lo recordó, le cotizó y lo dejó listo para cerrar.",
  },
];

const MODE_HINT: Record<Mode, string> = {
  auto: "Autopilot: el agente responde solo y tú supervisas.",
  copilot: "Copilot: el agente sugiere y tú apruebas.",
};

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Lo que llega al cliente para pulsar, como lo pinta cada canal. */
function OfferedButtons({ channel, options }: { channel: Channel; options: string[] }) {
  if (!options.length) return null;
  if (channel === "tiktok") {
    return (
      <span className="lp-demo__numbered" aria-label="Opciones numeradas (TikTok no tiene botones)">
        {options.map((o, i) => (
          <span key={o}>
            {i + 1}) {o}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={`lp-demo__offer lp-demo__offer--${channel === "whatsapp" ? "buttons" : "quick"}`} aria-label="Botones para pulsar">
      {options.map((o) => (
        <span key={o}>{o}</span>
      ))}
    </span>
  );
}

function Bubble({ msg, channel, children, showAt = true }: { msg: Msg; channel: Channel; children?: ReactNode; showAt?: boolean }) {
  return (
    <div className={`lp-demo__msg lp-demo__msg--${msg.who}${msg.tap ? " is-tap" : ""}`}>
      <div className="lp-demo__bubble">
        {msg.tap && <span className="lp-demo__tap">Pulsó</span>}
        {msg.text}
        {msg.file && (
          <span className="lp-demo__file">
            <i aria-hidden="true" />
            <span>
              <b>{msg.file.name}</b>
              <small>{msg.file.meta}</small>
            </span>
          </span>
        )}
        {msg.buttons && channel === "tiktok" && <OfferedButtons channel={channel} options={msg.buttons} />}
        {children}
      </div>
      {msg.buttons && channel !== "tiktok" && <OfferedButtons channel={channel} options={msg.buttons} />}
      {showAt && <span className="lp-demo__at">{msg.at}</span>}
    </div>
  );
}

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
  const [respondedIn, setRespondedIn] = useState<number | null>(4);
  const [filter, setFilter] = useState<Channel | "all">("all");
  // Las conversaciones que ya se atendieron: en la lista quedan como atendidas al pasar a otra.
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

  // El chat baja solo a lo último (solo su caja: nunca mueve la página). Lo de antes, deslizando hacia arriba.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [phase, sent, idx, logCount]);

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
    setRespondedIn(null);
  };

  /** Como al cargar: la venta ganada hecha y las demás esperando. */
  const restart = () => {
    clearAll();
    setIdx(0);
    setMode("auto");
    setPhase("done");
    setDraft("");
    setSent(FIRST.reply);
    setApproved(false);
    setLogCount(FIRST.log.length);
    setWaited(0);
    setRespondedIn(4);
    setFilter("all");
    setAttended({ [FIRST.key]: true });
  };

  const send = (text: string, byHuman: boolean) => {
    clearAll();
    setSent(text);
    setApproved(byHuman);
    setRespondedIn((r) => r ?? Math.max(2, waited));
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
  const shown = rows.filter((r) => filter === "all" || r.s.channel === filter);
  const progress = ((stage + 1) / STAGES.length) * 100;
  /** La hora de cada etapa alcanzada (la de destino, solo cuando ya llegó). */
  const stageTime = (i: number) => (i > stage ? undefined : i === sc.to && stage !== sc.to ? undefined : sc.stageTimes[i]);

  return (
    <div className="lp-demo" data-hero-demo data-phase={phase} data-mode={mode}>
      {/* Barra: qué es, los canales (filtran la lista), la hora y volver a empezar. */}
      <div className="lp-demo__bar">
        <span className="lp-demo__title">
          <i className="lp-demo__live" aria-hidden="true" />
          <b>Bandeja</b>
          <span>Demo interactiva</span>
        </span>
        <div className="lp-demo__tabs" role="tablist" aria-label="Filtrar por canal">
          <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")} data-demo-filter="all">
            Todos
          </button>
          {CHANNELS.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={filter === c.key} onClick={() => setFilter(c.key)} data-channel={c.key} data-demo-filter={c.key}>
              <ChannelIcon channel={c.key} />
              {c.label}
            </button>
          ))}
        </div>
        <span className="lp-demo__bar-end">
          <span className="lp-demo__clock" title="La hora de la demo: nadie del equipo está conectado">
            {NOW} · fuera de horario
          </span>
          <span className="lp-demo__tag">Datos de ejemplo</span>
          <button type="button" className="lp-demo__reset" onClick={restart} data-demo-restart>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
            </svg>
            Reiniciar
          </button>
        </span>
      </div>

      <div className="lp-demo__body">
        {/* Las conversaciones: elegir una es elegir el caso. */}
        <aside className="lp-demo__list" aria-label="Conversaciones de ejemplo">
          <div className="lp-demo__list-head">
            <span>Conversaciones</span>
            <span className={unanswered ? "lp-demo__badge is-warn" : "lp-demo__badge"} data-demo-unanswered>
              {unanswered === 0 ? "Todo atendido" : `${unanswered} sin responder`}
            </span>
          </div>
          <div className="lp-demo__convs" role="radiogroup" aria-label="Conversación abierta">
            {shown.map(({ s, i, active, state, stage: st }) => (
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
                  <span className="lp-demo__badge-ch" data-channel={s.channel}>
                    <ChannelIcon channel={s.channel} size={10} />
                  </span>
                </span>
                <span className="lp-demo__conv-main">
                  <span className="lp-demo__conv-top">
                    <strong>{s.contact.name}</strong>
                    <span>{s.when}</span>
                  </span>
                  <span className="lp-demo__conv-seg">{s.segment}</span>
                  <span className="lp-demo__conv-preview">“{s.ask.text}”</span>
                  <span className="lp-demo__conv-tags">
                    <span className="lp-demo__topic">{s.topic}</span>
                    <span className={`lp-demo__dot is-${state}`}>{state === "waiting" ? "Sin responder" : state === "done" ? STAGES[st] : "Contigo"}</span>
                  </span>
                </span>
                <span className="lp-demo__conv-chip">
                  <span data-channel={s.channel}>
                    <ChannelIcon channel={s.channel} />
                  </span>
                  {s.chip}
                </span>
              </button>
            ))}
            {shown.length === 0 && <p className="lp-demo__empty">Sin conversaciones de este canal ahora.</p>}
          </div>
          <div className="lp-demo__pilot">
            <span className="lp-demo__pilot-head">
              <b>Autopilot 24/7</b>
              <span className={mode === "auto" ? "lp-demo__on" : "lp-demo__off"}>{mode === "auto" ? "On" : "Copilot"}</span>
            </span>
            <span>De noche el agente responde solo. Cambia a Copilot cuando quieras y apruebas tú cada respuesta.</span>
          </div>
        </aside>

        {/* El chat entero: lo de antes deslizando hacia arriba, lo de esta noche abajo. */}
        <section className="lp-demo__chatpane" aria-label={`Chat con ${sc.contact.name}`}>
          <div className="lp-demo__head">
            <span className="lp-demo__avatar" aria-hidden="true">
              {sc.contact.initials}
            </span>
            <span className="lp-demo__who">
              <strong>
                {sc.contact.name}
                <span className="lp-demo__stage-badge">{STAGES[stage]}</span>
              </strong>
              <small>
                <span className="lp-demo__via" data-channel={sc.channel}>
                  <ChannelIcon channel={sc.channel} size={11} />
                  {CHANNEL_LABEL[sc.channel]}
                </span>{" "}
                · {sc.contact.handle}
              </small>
            </span>
            <span className={`lp-demo__wait ${pending ? "is-waiting" : acted ? "is-done" : "is-off"}`} data-demo-wait>
              {pending ? `Esperando ${clock(waited)}` : acted ? `Respondió en ${respondedIn ?? 4} s` : "Lo atiendes tú"}
            </span>
            <div className="lp-demo__seg" role="radiogroup" aria-label="Modo del agente">
              {(["auto", "copilot"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => mode !== m && reset(idx, m)} data-demo-mode={m}>
                  {m === "auto" ? "Autopilot" : "Copilot"}
                </button>
              ))}
            </div>
          </div>

          <div className="lp-demo__scroll" ref={scrollRef} data-demo-scroll>
            <div className="lp-demo__chat" role="log" aria-live="polite">
              {sc.history.length > 0 && <p className="lp-demo__older">Conversación anterior</p>}
              {sc.history.map((m, k) => (
                <Bubble key={`h-${sc.key}-${k}`} msg={m} channel={sc.channel} />
              ))}
              <p className="lp-demo__divider">
                <span>{sc.divider}</span>
              </p>
              {/* Su hora va en la línea de «visto», debajo. */}
              <Bubble key={`ask-${sc.key}`} msg={sc.ask} channel={sc.channel} showAt={false} />
              <p className="lp-demo__seen">{phase === "waiting" ? `${sc.ask.at} · sin leer` : `${sc.ask.at} · visto por el agente de Driony`}</p>

              {phase === "typing" && (
                <div className="lp-demo__typing" aria-label="El agente está escribiendo">
                  <i />
                  <i />
                  <i />
                </div>
              )}
              {phase === "suggest" && (
                <label className="lp-demo__draft">
                  <span>Sugerencia de Driony · puedes editarla</span>
                  <textarea value={draft} rows={4} maxLength={600} onChange={(e) => setDraft(e.target.value)} data-demo-draft />
                  {sc.replyButtons && (
                    <span className="lp-demo__draft-btns">
                      Con botones: <OfferedButtons channel={sc.channel} options={sc.replyButtons} />
                    </span>
                  )}
                </label>
              )}
              {sent !== null && (
                <div className="lp-demo__msg lp-demo__msg--out" data-demo-reply>
                  <div className="lp-demo__bubble">
                    {sent}
                    {sc.replyButtons && sc.channel === "tiktok" && <OfferedButtons channel={sc.channel} options={sc.replyButtons} />}
                  </div>
                  {sc.replyButtons && sc.channel !== "tiktok" && <OfferedButtons channel={sc.channel} options={sc.replyButtons} />}
                  <span className="lp-demo__at">
                    {sc.ask.at} · {approved ? "aprobada por ti" : "IA"}
                  </span>
                </div>
              )}
              {phase === "discarded" && <p className="lp-demo__note">Sugerencia descartada. El agente no envió nada.</p>}

              {/* Lo que hizo el agente para responder, dato a dato. */}
              {(phase === "typing" || acted) && (
                <div className={`lp-demo__trace${phase === "done" ? " is-done" : ""}`} data-demo-trace>
                  <div className="lp-demo__trace-head">
                    <span>
                      <i aria-hidden="true" /> Lo que hizo el agente
                    </span>
                    <span>{phase === "done" ? "hecho" : "en vivo"}</span>
                  </div>
                  <div className="lp-demo__trace-cells">
                    {sc.trace.map((c, k) => {
                      const on = acted && logCount >= c.at;
                      return (
                        <div key={c.label} className={on ? "is-on" : ""}>
                          <span>
                            {k + 1}. {c.label}
                          </span>
                          <b>{on ? c.value : phase === "typing" ? "leyendo…" : "—"}</b>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* La acción que toca, siempre a la vista debajo del chat. */}
          <div className="lp-demo__act">
            {phase === "waiting" && (
              <>
                <button type="button" className="lp-demo__go" onClick={start} data-demo-go>
                  {mode === "auto" ? "Que responda el agente" : "Pedir sugerencia al agente"} <Arrow />
                </button>
                <p className="lp-demo__status">{MODE_HINT[mode]}</p>
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
                  <i aria-hidden="true" />
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
        </section>

        {/* El expediente del lead: embudo, valor, lo que entendió y lo que pasó esta noche. */}
        <aside className="lp-demo__crm" aria-live="polite" aria-label="Expediente del lead">
          <div className="lp-demo__crm-head">
            <span>Expediente del lead</span>
            <span className={phase === "acting" || phase === "typing" ? "lp-demo__live-tag is-live" : "lp-demo__live-tag"}>
              {phase === "acting" || phase === "typing" ? "En vivo" : `${logCount}/${sc.log.length}`}
            </span>
          </div>
          <div className="lp-demo__crm-body">
            <div className="lp-demo__pipe" aria-label={`Embudo: la oportunidad está en ${STAGES[stage]}`}>
              <div className="lp-demo__pipe-top">
                <span>Embudo</span>
                <b data-demo-stage>{stage !== sc.from ? `${STAGES[sc.from]} → ${STAGES[stage]}` : STAGES[stage]}</b>
              </div>
              <div className="lp-demo__pipe-bar">
                <span style={{ width: `${progress}%` }} />
              </div>
              <ol>
                {STAGES.map((s, i) => (
                  <li key={s} className={i === stage ? "is-on" : i < stage ? "is-past" : ""}>
                    <span>{s}</span>
                    <small>{stageTime(i) ?? ""}</small>
                  </li>
                ))}
              </ol>
            </div>
            <div className="lp-demo__tiles">
              <div>
                <span>Valor</span>
                <b className={acted && logCount > sc.stageAt ? "is-on" : ""}>{acted && logCount > sc.stageAt ? sc.value : "—"}</b>
              </div>
              <div>
                <span>Respuesta</span>
                <b className={acted ? "is-on" : pending ? "is-warn" : ""}>{acted ? `${respondedIn ?? 4} s` : pending ? clock(waited) : "—"}</b>
              </div>
            </div>
            <p className="lp-demo__intent">
              <span>Entendió</span>
              {phase === "waiting" ? "—" : sc.intent}
            </p>
            <div className="lp-demo__night">
              <span className="lp-demo__night-head">Esta noche</span>
              <ul data-demo-log>
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
            <p className="lp-demo__secure">
              <MetaMark />
              <span>API oficial de WhatsApp Business · Meta Business Partner</span>
            </p>
            <a href="#capacidades" className="lp-demo__more">
              Ver todo lo que hace <Arrow />
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
