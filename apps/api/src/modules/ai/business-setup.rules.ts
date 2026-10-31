import {
  BUSINESS_TYPES,
  hoursLabel,
  type AgentGoal,
  type AgentTone,
  type AgentToolInfo,
  type BusinessHours,
  type BusinessSetupInput,
  type BusinessType,
  type SetupHours,
  type Weekday,
} from "@crm/shared";

// Parte pura del asistente de bienvenida: sin Nest ni Prisma, para poder
// probarla sin base de datos. El servicio solo lee, llama al modelo y guarda.

/** Origen del documento de conocimiento que escribe el asistente (para reemplazarlo al repetir). */
export const SETUP_KNOWLEDGE_SOURCE = "Asistente de bienvenida";

/** Palabras que pasan el chat a una persona; las mismas que propone el asistente de agentes. */
export const SETUP_HANDOFF_KEYWORDS = ["asesor", "humano", "persona", "reclamo"];

/** Qué capacidades tienen sentido para cada misión. */
const TOOLS_BY_GOAL: Record<AgentGoal, string[]> = {
  vender: ["search_products", "send_product_image", "mark_lead", "move_deal_stage", "add_tag"],
  // Con servicios en la agenda, el agente consulta horas y reserva él mismo.
  agendar: ["check_availability", "book_appointment", "reschedule_appointment", "cancel_appointment", "mark_lead", "move_deal_stage", "assign_to_seller", "add_tag"],
  soporte: ["search_products", "add_tag"],
  datos: ["mark_lead", "move_deal_stage", "assign_to_seller", "add_tag"],
};
/** Las que todo agente necesita: saber, recordar y apartarse a tiempo. */
const BASE_TOOLS = ["search_knowledge", "search_contact", "update_contact", "handoff_to_human"];

/** Herramientas del agente: las de su misión que se pueden usar hoy en esta empresa. */
export function toolsForGoal(goal: AgentGoal, available: AgentToolInfo[]): string[] {
  const usable = new Set(available.filter((t) => !t.unavailableReason).map((t) => t.name));
  return [...new Set([...BASE_TOOLS, ...TOOLS_BY_GOAL[goal]])].filter((n) => usable.has(n));
}

const GOAL_TEXT: Record<AgentGoal, string> = {
  vender: "vender: informar, resolver objeciones y llevar al cliente a confirmar la compra",
  agendar: "calificar al cliente y conseguir que agende una cita o visita",
  soporte: "resolver dudas y problemas con la información del negocio",
  datos: "captar los datos del cliente (nombre, qué necesita, cómo contactarlo) para que un vendedor lo llame",
};

const TONE_TEXT: Record<AgentTone, string> = {
  cercano: "cercano y profesional, de tú, con algún emoji ocasional",
  formal: "formal y cortés, de usted, sin emojis",
  juvenil: "juvenil y directo, de tú, frases cortas",
  divertido: "divertido y cálido, con emojis, sin perder claridad",
};

/** Las respuestas del rubro que la empresa rellenó, con su pregunta. */
export function answeredFaq(p: BusinessSetupInput): { title: string; question: string; answer: string }[] {
  return BUSINESS_TYPES[p.businessType].faq
    .map((f) => ({ title: f.title, question: f.question, answer: (p.answers[f.key] ?? "").trim() }))
    .filter((f) => f.answer.length > 0);
}

/** Lo que se le cuenta al asistente de redacción para escribir las instrucciones. */
export function composeBrief(p: BusinessSetupInput, orgName: string): string {
  const def = BUSINESS_TYPES[p.businessType];
  const faq = answeredFaq(p);
  return [
    `Negocio: ${orgName} (${def.label}). ${p.description || def.hint}`,
    p.city ? `Ubicación: ${p.city}` : null,
    p.website ? `Sitio web: ${p.website}` : null,
    `Nombre del agente: ${p.agentName}`,
    `Objetivo del agente: ${GOAL_TEXT[p.goal]}`,
    `Tono: ${TONE_TEXT[p.tone]}`,
    p.hours
      ? `Horario de atención: ${hoursLabel(p.hours)}. Fuera de ese horario el agente no responde (lo cubre un aviso automático).`
      : "Responde a cualquier hora, también fines de semana.",
    faq.length
      ? `Información del negocio (úsala tal cual, no inventes otra):\n${faq.map((f) => `- ${f.title}: ${f.answer}`).join("\n")}`
      : null,
    p.extra ? `Más datos del negocio: ${p.extra}` : null,
    `Debe pasar el chat a una persona (handoff_to_human) si el cliente está molesto, pide hablar con alguien, o menciona: ${SETUP_HANDOFF_KEYWORDS.join(", ")}.`,
    "Redacta ya las instrucciones completas del agente, sin hacer preguntas: lo que falte, déjalo como marcador entre corchetes.",
  ]
    .filter(Boolean)
    .join("\n");
}

const TOOL_RULES: Record<string, string> = {
  search_products: "Cuando pregunten por productos, precios o disponibilidad, consulta el catálogo con search_products. Nunca inventes precios ni productos.",
  search_knowledge: "Antes de responder sobre envíos, horarios, pagos, políticas o preguntas frecuentes, busca en search_knowledge y responde con esa información.",
  search_contact: "Revisa la ficha del cliente con search_contact para no volver a preguntar lo que ya sabes.",
  update_contact: "Guarda con update_contact los datos que el cliente te confirme (nombre, ciudad, lo que busca).",
  mark_lead: "Clasifica al cliente con mark_lead: «potential» en cuanto muestre interés real, «purchase» cuando confirme la compra, la cita o el pago, «lost» si dice que no le interesa.",
  move_deal_stage: "Mueve su oportunidad con move_deal_stage cuando avance en el embudo.",
  add_tag: "Etiqueta al cliente con add_tag según su interés, usando solo las etiquetas disponibles.",
  send_product_image: "Si quiere ver un producto, envía su foto con send_product_image.",
  assign_to_seller: "Cuando el cliente esté listo para que lo atienda alguien, asigna un vendedor con assign_to_seller.",
};

/**
 * Instrucciones sin modelo: cuando no hay IA para redactarlas, o la respuesta
 * no sirve. Correctas y completas, con los datos que dio la empresa.
 */
export function localAgentPrompt(p: BusinessSetupInput, orgName: string, tools: string[]): string {
  const def = BUSINESS_TYPES[p.businessType];
  const faq = answeredFaq(p);
  const where = p.city ? `, en ${p.city}` : "";
  return [
    "ROL E IDENTIDAD",
    `Eres ${p.agentName}, asistente por WhatsApp de ${orgName} (${def.label.toLowerCase()}${where}). ${sentence(p.description || def.hint)}`,
    "",
    "OBJETIVO DE LA CONVERSACIÓN",
    `Tu objetivo: ${GOAL_TEXT[p.goal]}. Saluda, entiende qué necesita con una pregunta a la vez, recomienda y propón el siguiente paso concreto.`,
    "",
    "TONO Y FORMATO PARA WHATSAPP",
    `Tono ${TONE_TEXT[p.tone]}. Responde siempre en español, en mensajes cortos (máximo 4 líneas), con una sola pregunta por mensaje y sin formato markdown.`,
    "",
    "INFORMACIÓN DEL NEGOCIO",
    ...faq.map((f) => `- ${f.title}: ${f.answer}`),
    p.hours ? `- Horario de atención: ${hoursLabel(p.hours)}.` : null,
    p.website ? `- Sitio web: ${p.website}` : null,
    p.extra ? `- ${p.extra}` : null,
    faq.length || p.extra ? null : "- Aún no hay datos cargados: si no sabes algo, dilo y ofrece consultarlo con el equipo.",
    "",
    "HERRAMIENTAS",
    ...tools.map((t) => TOOL_RULES[t]).filter(Boolean).map((r) => `- ${r}`),
    "",
    "LÍMITES",
    "- No inventes precios, stock, plazos ni promociones que no estén en tu información.",
    "- No pidas datos sensibles (contraseñas, números de tarjeta).",
    "- Si te preguntan algo ajeno al negocio, redirige con amabilidad.",
    "",
    "CUÁNDO PASAR A UNA PERSONA (usa handoff_to_human)",
    `- Si pide hablar con alguien o menciona: ${SETUP_HANDOFF_KEYWORDS.join(", ")}.`,
    "- Si está molesto o insatisfecho.",
    "- Si el tema excede lo que sabes. Antes de pasarlo, despídete con una frase corta.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/** Cierra con punto lo que no termina en signo de puntuación. */
function sentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** Documento de conocimiento con lo que contó la empresa, o null si no contó nada. */
export function knowledgeDoc(
  p: BusinessSetupInput,
  orgName: string,
): { title: string; content: string; facts: number } | null {
  const def = BUSINESS_TYPES[p.businessType];
  const faq = answeredFaq(p);
  const lines: string[] = [];
  let facts = 0;
  const add = (line: string | null) => {
    if (!line) return;
    lines.push(line);
    facts++;
  };
  add(p.description ? `Qué hacemos: ${p.description}` : null);
  add(p.city ? `Ubicación: ${p.city}` : null);
  add(p.website ? `Sitio web: ${p.website}` : null);
  add(p.hours ? `Horario de atención por WhatsApp: ${hoursLabel(p.hours)}.` : null);
  if (!facts && !faq.length && !p.extra) return null;

  const content = [
    `Información de ${orgName}`,
    `Rubro: ${def.label}.`,
    ...lines,
    ...(faq.length ? ["", "Preguntas frecuentes", ...faq.flatMap((f) => ["", f.question, f.answer])] : []),
    ...(p.extra ? ["", "Otros datos", p.extra] : []),
  ].join("\n");
  return {
    title: `Información de ${orgName}`.slice(0, 200),
    content,
    facts: facts + faq.length + (p.extra ? 1 : 0),
  };
}

/** Respuestas rápidas para el equipo: un saludo y una por cada respuesta del rubro. */
export function quickRepliesFor(
  p: BusinessSetupInput,
  orgName: string,
): { shortcut: string; title: string; body: string }[] {
  const greeting =
    p.tone === "formal"
      ? `Hola, {{nombre}}. Gracias por comunicarse con ${orgName}. ¿En qué puedo ayudarle?`
      : `¡Hola, {{nombre}}! Gracias por escribir a ${orgName}. ¿En qué te puedo ayudar?`;
  const faq = BUSINESS_TYPES[p.businessType].faq
    .map((f) => ({ shortcut: f.shortcut, title: f.title, body: (p.answers[f.key] ?? "").trim() }))
    .filter((q) => q.body.length > 0);
  return [{ shortcut: "/hola", title: "Saludo", body: greeting }, ...faq];
}

/**
 * Etapas para el embudo principal según el rubro. Solo se tocan si siguen
 * como vinieron (las de fábrica o las de otro rubro de este asistente): si la
 * empresa ya las cambió, no se pisan. null = dejarlas como están.
 */
export function stagePlan(current: string[], type: BusinessType, factory: readonly string[]): string[] | null {
  if (current.length !== factory.length) return null;
  const known = [factory, ...Object.values(BUSINESS_TYPES).flatMap((d) => (d.stages ? [d.stages] : []))];
  const untouched = known.some((k) => k.every((name, i) => name === current[i]));
  if (!untouched) return null;
  return [...(BUSINESS_TYPES[type].stages ?? factory)];
}

/** Horario del agente con su aviso de fuera de horario. */
export function businessHoursFor(h: SetupHours, timezone: string, orgName: string): BusinessHours {
  const open = { from: h.from, to: h.to };
  const days: Record<Weekday, { from: string; to: string } | null> = {
    mon: open,
    tue: open,
    wed: open,
    thu: open,
    fri: open,
    sat: h.days === "lv" ? null : open,
    sun: h.days === "all" ? open : null,
  };
  return {
    timezone,
    days,
    outOfHoursMessage: `¡Gracias por escribir a ${orgName}! Ahora estamos fuera de horario: atendemos ${hoursLabel(h)}. Déjanos tu mensaje y te respondemos apenas abramos.`,
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** «tutienda.com» → «https://tutienda.com». */
export function normalizeWebsite(v: string): string {
  const t = v.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}
