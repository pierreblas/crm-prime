import { aiPrice } from "@crm/shared";
import type { IconName } from "@/components/NavIcons";

/**
 * Textos del editor de agentes para personas, no para la IA.
 *
 * La API describe cada herramienta con instrucciones dirigidas al modelo
 * ("Úsala SIEMPRE que…"). Eso es necesario para que el modelo la use bien, y
 * confuso para quien configura el agente. Aquí va lo que ve el usuario.
 */
export const TOOL_COPY: Record<string, { title: string; desc: string; icon: IconName; recommended?: boolean }> = {
  search_products: {
    title: "Consultar tus productos y precios",
    desc: "Busca en tu catálogo y da precios reales, en la moneda del país del cliente. Nunca se los inventa.",
    icon: "tag",
    recommended: true,
  },
  search_knowledge: {
    title: "Responder con tu información",
    desc: "Antes de contestar, busca en tu base de conocimiento: envíos, garantías, horarios, preguntas frecuentes.",
    icon: "book",
    recommended: true,
  },
  search_contact: {
    title: "Conocer al cliente",
    desc: "Lee su ficha para no volver a preguntarle lo que ya te dijo.",
    icon: "user",
  },
  handoff_to_human: {
    title: "Pasarte el chat cuando haga falta",
    desc: "Si no sabe algo o el cliente pide una persona, deja de responder y la conversación queda para tu equipo.",
    icon: "reply",
    recommended: true,
  },
  send_product_image: {
    title: "Enviar fotos de productos",
    desc: "Manda la foto del producto por WhatsApp cuando el cliente quiere verlo.",
    icon: "image",
  },
  add_tag: {
    title: "Etiquetar clientes",
    desc: "Marca al cliente con tus etiquetas (Interesado, VIP…) según lo que conversa.",
    icon: "tag",
  },
  remove_tag: {
    title: "Quitar etiquetas",
    desc: "Quita una etiqueta que ya no aplica.",
    icon: "x",
  },
  move_deal_stage: {
    title: "Mover en el embudo",
    desc: "Avanza la oportunidad: a Negociación cuando pide precio, a Ganado cuando confirma la compra.",
    icon: "pipeline",
  },
  update_contact: {
    title: "Guardar datos del cliente",
    desc: "Apunta en su ficha lo que el cliente cuenta: su nombre, su ciudad, lo que busca.",
    icon: "note",
  },
  assign_to_seller: {
    title: "Asignar un vendedor",
    desc: "Pone a un vendedor como responsable, sin quitarle el chat al agente.",
    icon: "user",
  },
  schedule_followup: {
    title: "Programar un seguimiento",
    desc: "Deja un recordatorio para volver a escribir al cliente más adelante.",
    icon: "clock",
  },
  check_availability: {
    title: "Ver horas libres de la agenda",
    desc: "Consulta tu agenda y ofrece horas que de verdad están libres, según el horario de cada persona.",
    icon: "calendar",
  },
  book_appointment: {
    title: "Reservar citas",
    desc: "Cuando el cliente elige una hora, la reserva en tu agenda y lo confirma en el chat.",
    icon: "calendar",
  },
  reschedule_appointment: {
    title: "Cambiar la hora de una cita",
    desc: "Si el cliente no puede, mueve su cita a otra hora libre.",
    icon: "clock",
  },
  cancel_appointment: {
    title: "Cancelar citas",
    desc: "Anula la cita cuando el cliente lo pide (antes le ofrece otra hora).",
    icon: "x",
  },
};

/** Modelos con nombre para personas. El valor es el que usa la API. */
export const MODEL_OPTIONS: { value: string; title: string; desc: string; provider: "OpenAI" | "Anthropic"; recommended?: boolean }[] = [
  { value: "gpt-4o-mini", title: "Rápido y económico", desc: "Ideal para empezar. Responde al instante y cuesta muy poco.", provider: "OpenAI", recommended: true },
  { value: "gpt-4.1-mini", title: "Rápido y algo más listo", desc: "Un paso más de calidad sin subir mucho el precio.", provider: "OpenAI" },
  { value: "gpt-4o", title: "Más inteligente", desc: "Mejor con preguntas enredadas. Bastante más caro.", provider: "OpenAI" },
  { value: "gpt-4.1", title: "Más inteligente (reciente)", desc: "Buena calidad y sigue bien instrucciones largas.", provider: "OpenAI" },
  { value: "claude-haiku-4-5", title: "Claude rápido", desc: "La opción rápida y económica de Anthropic.", provider: "Anthropic" },
  { value: "claude-sonnet-4-6", title: "Claude equilibrado", desc: "Muy buena redacción a un precio medio.", provider: "Anthropic" },
  { value: "claude-opus-4-7", title: "Claude máximo", desc: "El más capaz. Para casos que lo necesiten de verdad.", provider: "Anthropic" },
  { value: "claude-opus-4-8", title: "Claude máximo (reciente)", desc: "La última versión del más capaz.", provider: "Anthropic" },
];

export const EFFORT_LABEL: Record<string, { title: string; desc: string }> = {
  low: { title: "Rápido", desc: "Responde enseguida. Suficiente para preguntas sencillas." },
  medium: { title: "Equilibrado", desc: "Recomendado. Piensa lo justo antes de responder." },
  high: { title: "Cuidadoso", desc: "Piensa más cada respuesta. Más lento y algo más caro." },
  xhigh: { title: "Muy cuidadoso", desc: "Para casos complejos. Notablemente más lento." },
  max: { title: "Máximo", desc: "Solo si de verdad lo necesitas: lento y caro." },
};

/**
 * Tokens de una respuesta típica con su contexto (conversación, catálogo,
 * instrucciones) y cuánto de eso es salida. Sirve para dar magnitudes, no
 * para presupuestar al céntimo.
 */
export const REPLY_TOKENS = { input: 1350, output: 150 };

/** Coste en USD de una respuesta típica con este modelo, o null si no hay precio. */
export function costPerReply(model: string): number | null {
  const p = aiPrice(model);
  if (!p) return null;
  return (REPLY_TOKENS.input * p.input + REPLY_TOKENS.output * p.output) / 1e6;
}

/** Tokens que caben en un presupuesto en USD con este modelo (mezcla típica de entrada y salida). */
export function tokensForUsd(model: string, usd: number): number | null {
  const perReply = costPerReply(model);
  if (!perReply) return null;
  const tokens = (usd / perReply) * (REPLY_TOKENS.input + REPLY_TOKENS.output);
  return Math.max(10_000, Math.round(tokens / 10_000) * 10_000);
}

/** USD aproximados de una cantidad de tokens con este modelo. */
export function usdForTokens(model: string, tokens: number): number | null {
  const perReply = costPerReply(model);
  if (!perReply) return null;
  return (tokens / (REPLY_TOKENS.input + REPLY_TOKENS.output)) * perReply;
}

export function usd(n: number): string {
  // Con poco uso los importes son de milésimas: se enseñan con más decimales.
  const digits = n === 0 ? 0 : n < 0.01 ? 4 : n < 10 ? 2 : 0;
  return `USD ${n.toLocaleString("es", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Lima", label: "Perú, Colombia, Ecuador (GMT-5)" },
  { value: "America/Mexico_City", label: "México centro (GMT-6)" },
  { value: "America/Bogota", label: "Bogotá (GMT-5)" },
  { value: "America/Santiago", label: "Chile" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina (GMT-3)" },
  { value: "America/Sao_Paulo", label: "Brasil, São Paulo (GMT-3)" },
  { value: "America/Caracas", label: "Venezuela (GMT-4)" },
  { value: "America/La_Paz", label: "Bolivia (GMT-4)" },
  { value: "America/Asuncion", label: "Paraguay" },
  { value: "America/Montevideo", label: "Uruguay (GMT-3)" },
  { value: "America/Guatemala", label: "Centroamérica (GMT-6)" },
  { value: "America/Panama", label: "Panamá (GMT-5)" },
  { value: "America/Santo_Domingo", label: "República Dominicana (GMT-4)" },
  { value: "America/New_York", label: "EE. UU. este" },
  { value: "America/Los_Angeles", label: "EE. UU. oeste" },
  { value: "Europe/Madrid", label: "España" },
];

/** Instrucciones de fábrica: si el agente sigue con ellas, se le anima a personalizarlas. */
export function isGenericPrompt(prompt: string): boolean {
  const p = prompt.trim();
  return (
    p.startsWith("Eres un asistente de atención al cliente por WhatsApp. Responde en español, con tono cercano y profesional. Usa las herramientas") ||
    p.startsWith("Eres un asistente de ventas por WhatsApp. Responde en español, con tono cercano y profesional. Cuando el cliente pregunte")
  );
}
