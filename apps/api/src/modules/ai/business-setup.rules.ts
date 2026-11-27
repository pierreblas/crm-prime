import {
  BUSINESS_TYPES,
  hoursLabel,
  welcomeMessageFor,
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
  vender: ["search_products", "send_product_image", "send_product_file", "send_payment_methods", "mark_lead", "move_deal_stage", "add_tag", "reply_with_buttons"],
  // Con servicios en la agenda, el agente consulta horas y reserva él mismo.
  agendar: ["check_availability", "book_appointment", "reschedule_appointment", "cancel_appointment", "mark_lead", "move_deal_stage", "assign_to_seller", "add_tag", "reply_with_buttons"],
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

/**
 * Cómo avanza de verdad una conversación en cada rubro, la pregunta con la que
 * se cierra, el botón del «sí» y el resultado que se busca cuando el agente
 * vende o agenda. De aquí salen los pasos de las instrucciones:
 * un agente con un flujo propio de su negocio responde mucho mejor que uno con
 * consejos generales.
 */
export interface BusinessFlow {
  steps: string;
  /** La pregunta de cierre y el botón del «sí», de tú y de usted. */
  close: string;
  yes: string;
  closeFormal: string;
  yesFormal: string;
  /** El resultado que se busca cuando el agente vende o agenda. */
  result: string;
}
export const FLOW_BY_TYPE: Record<BusinessType, BusinessFlow> = {
  tienda: {
    steps: "pregunta por un producto → se le presenta con su precio → consulta talla, envío o cambios → hace el pedido → paga y envía el comprobante",
    close: "¿Te lo separo?",
    yes: "Sí, lo quiero",
    closeFormal: "¿Se lo separo?",
    yesFormal: "Sí, lo quiero",
    result: "que el cliente haga su pedido y envíe su comprobante",
  },
  restaurante: {
    steps: "pide la carta o un plato → arma su pedido → se confirma si es delivery o recojo y el total → paga o confirma → se entrega",
    close: "¿Confirmo tu pedido?",
    yes: "Sí, confirmar",
    closeFormal: "¿Confirmo su pedido?",
    yesFormal: "Sí, confirmar",
    result: "que el cliente deje su pedido confirmado",
  },
  salud: {
    steps: "pregunta por un servicio o cuenta su molestia → se le informa el servicio y su precio → se le proponen horarios → queda la cita agendada → cambios o cancelación",
    close: "¿Te agendo una cita?",
    yes: "Sí, agéndame",
    closeFormal: "¿Le agendo una cita?",
    yesFormal: "Sí, agéndeme",
    result: "que el cliente quede con una cita agendada",
  },
  belleza: {
    steps: "pregunta por un servicio → precio y duración → horarios disponibles → reserva (con adelanto si el negocio lo pide) → cambios o cancelación",
    close: "¿Te reservo un horario?",
    yes: "Sí, resérvame",
    closeFormal: "¿Le reservo un horario?",
    yesFormal: "Sí, resérveme",
    result: "que el cliente quede con su horario reservado",
  },
  inmobiliaria: {
    steps: "pregunta por una propiedad o un proyecto → se le califica (zona, presupuesto, para cuándo) → se le presenta la opción que encaja → queda una visita agendada → lo sigue un asesor",
    close: "¿Te agendo una visita?",
    yes: "Sí, agéndame",
    closeFormal: "¿Le agendo una visita?",
    yesFormal: "Sí, agéndeme",
    result: "que el cliente quede con una visita agendada",
  },
  educacion: {
    steps: "pide información de un curso → revisa el temario o el horario → resuelve dudas (certificado, modalidad, pagos) → separa su cupo → paga y envía el comprobante",
    close: "¿Te gustaría separar tu cupo?",
    yes: "Sí, sepárame",
    closeFormal: "¿Le gustaría separar su cupo?",
    yesFormal: "Sí, sepáreme",
    result: "que el cliente separe su cupo y envíe su comprobante",
  },
  servicios: {
    steps: "cuenta qué necesita → se le pide lo mínimo para cotizar → recibe la propuesta o el precio → confirma → se coordina el inicio o el pago",
    close: "¿Avanzamos con el servicio?",
    yes: "Sí, avancemos",
    closeFormal: "¿Avanzamos con el servicio?",
    yesFormal: "Sí, avancemos",
    result: "que el cliente confirme el servicio",
  },
  automotriz: {
    steps: "pregunta por un vehículo, un repuesto o un servicio → se le da precio y disponibilidad → consulta financiamiento o garantía → agenda una visita o una prueba, o separa → un asesor cierra",
    close: "¿Te agendo una visita?",
    yes: "Sí, agéndame",
    closeFormal: "¿Le agendo una visita?",
    yesFormal: "Sí, agéndeme",
    result: "que el cliente quede con una visita agendada o deje separado lo que busca",
  },
  turismo: {
    steps: "pregunta por un destino o un paquete → se le presenta con fechas y precio → consulta qué incluye y las condiciones → reserva con un adelanto → paga y envía el comprobante",
    close: "¿Te reservo tu lugar?",
    yes: "Sí, resérvame",
    closeFormal: "¿Le reservo su lugar?",
    yesFormal: "Sí, resérveme",
    result: "que el cliente reserve su lugar y envíe su comprobante",
  },
  otro: {
    steps: "cuenta qué busca → se le presenta la opción que encaja, con su precio → resuelve dudas → confirma → paga o coordina el siguiente paso",
    close: "¿Avanzamos?",
    yes: "Sí, avancemos",
    closeFormal: "¿Avanzamos?",
    yesFormal: "Sí, avancemos",
    result: "que el cliente confirme y quede claro el siguiente paso",
  },
};

/** El «no todavía» de la pregunta de cierre, igual en todos los rubros. */
export const CLOSE_NO = "Tengo dudas";

/** La pregunta de cierre y su botón, en el trato del tono elegido. */
export function closing(type: BusinessType, tone: AgentTone): { question: string; yes: string } {
  const f = FLOW_BY_TYPE[type];
  return tone === "formal" ? { question: f.closeFormal, yes: f.yesFormal } : { question: f.close, yes: f.yes };
}

/** ¿La misión termina en una pregunta de cierre (comprar, agendar)? */
const closes = (goal: AgentGoal) => goal === "vender" || goal === "agendar";

/**
 * Lo que la cuenta tiene hoy y las instrucciones pueden nombrar: las etapas de
 * su embudo y lo que trae su catálogo. Sin esto el borrador se queda en
 * general («mueve su oportunidad cuando avance»).
 */
export interface SetupFacts {
  /** Etapas del embudo principal, en orden. */
  stages: string[];
  /** Productos activos. */
  products: number;
  /** Campos propios del catálogo que ve la IA («Horario», «Fecha de inicio»…). */
  productFields: string[];
  /** Campos «Archivo» que ve la IA («Temario», «Brochure»…). */
  productFiles: string[];
}
export const NO_FACTS: SetupFacts = { stages: [], products: 0, productFields: [], productFiles: [] };

/** La etapa de quien ya decidió y aún no cierra (la cuarta de las seis de fábrica), o null si el embudo es otro. */
const decidedStage = (f: SetupFacts): string | null => (f.stages.length === 6 ? f.stages[3]! : null);

/** Las respuestas del rubro que la empresa rellenó, con su pregunta. */
export function answeredFaq(p: BusinessSetupInput): { title: string; question: string; answer: string }[] {
  return BUSINESS_TYPES[p.businessType].faq
    .map((f) => ({ title: f.title, question: f.question, answer: (p.answers[f.key] ?? "").trim() }))
    .filter((f) => f.answer.length > 0);
}

/** Lo que se le cuenta al asistente de redacción para escribir las instrucciones. */
export function composeBrief(p: BusinessSetupInput, orgName: string, opts: { draft?: boolean } = {}): string {
  const def = BUSINESS_TYPES[p.businessType];
  const flow = FLOW_BY_TYPE[p.businessType];
  const end = closing(p.businessType, p.tone);
  const faq = answeredFaq(p);
  return [
    `Negocio: ${orgName} (${def.label}). ${p.description || def.hint}`,
    p.city ? `Ubicación: ${p.city}` : null,
    p.website ? `Sitio web: ${p.website}` : null,
    `Nombre del agente: ${p.agentName}`,
    `Objetivo del agente: ${GOAL_TEXT[p.goal]}. Resultado que busca: ${closes(p.goal) ? flow.result : GOAL_RESULT[p.goal]}.`,
    `Tono: ${TONE_TEXT[p.tone]}`,
    `Cómo avanza una conversación en este rubro (de aquí salen los pasos del flujo, con las palabras del negocio): ${flow.steps}.`,
    closes(p.goal)
      ? `Pregunta de cierre: «${end.question}». Si el agente responde con botones, solo en esa pregunta y con estos textos: «${end.yes}» y «${CLOSE_NO}».`
      : null,
    p.welcome
      ? `El sistema ya envía solo un saludo al primer mensaje del cliente («${welcomeMessageFor(p.tone, p.agentName, orgName)}»). El agente NO lo envía ni lo repite, y ese saludo no se escribe en las instrucciones: sus plantillas van directo a lo que el cliente pidió, sin saludar ni presentarse.`
      : null,
    p.hours
      ? `Horario de atención: ${hoursLabel(p.hours)}. Fuera de ese horario el agente no responde (lo cubre un aviso automático).`
      : "Responde a cualquier hora, también fines de semana.",
    faq.length
      ? `Información del negocio (úsala tal cual, no inventes otra):\n${faq.map((f) => `- ${f.title}: ${f.answer}`).join("\n")}`
      : null,
    p.extra ? `Más datos del negocio: ${p.extra}` : null,
    `Debe pasar el chat a una persona (handoff_to_human) si el cliente está molesto, pide hablar con alguien, o menciona: ${SETUP_HANDOFF_KEYWORDS.join(", ")}.`,
    opts.draft
      ? "El texto actual es un borrador con los pasos, las reglas, las herramientas y las etapas correctas para esta empresa. Mejóralo sin hacer preguntas: conserva tal cual sus reglas críticas, sus pasos con sus herramientas y sus etapas, los textos de sus botones, los mensajes que van tras «responde EXACTAMENTE» y la lista de cuándo pasar a una persona; escribe el rol, los títulos de los pasos, las pautas, las objeciones y los ejemplos con las palabras de este negocio, y concreta lo que el borrador deja en general. No añadas herramientas, etapas ni datos de producto que el borrador no nombre. Lo que falte y solo sepa el dueño, entre corchetes y en mayúsculas."
      : "Redacta ya las instrucciones completas del agente, sin hacer preguntas: lo que falte, déjalo como marcador entre corchetes.",
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
  send_product_file: "Si pide el brochure, el temario o más información de un producto, envía su archivo con send_product_file.",
  send_payment_methods: "Cuando quiera pagar, envíale los datos con send_payment_methods (nunca los escribas tú) y pídele el comprobante.",
  assign_to_seller: "Cuando el cliente esté listo para que lo atienda alguien, asigna un vendedor con assign_to_seller.",
  reply_with_buttons: "Pone los botones de la pregunta de cierre. Solo ahí, como dice la regla de BOTONES.",
  handoff_to_human: "Pasa el chat a una persona en los casos de la sección anterior.",
  check_availability: "Consulta los horarios libres antes de ofrecer uno.",
  book_appointment: "Reserva la cita cuando el cliente elija día y hora.",
  reschedule_appointment: "Cambia una cita ya reservada.",
  cancel_appointment: "Cancela una cita cuando el cliente lo pida.",
};

/** Las herramientas que anotan en el CRM, dichas para un flujo por pasos: cuándo, lo dicen los pasos. */
const STEP_TOOL_RULES: Record<string, string> = {
  mark_lead: "Solo en los pasos que lo indican y una sola vez por cambio. Aparte de eso, usa «lost» si dice claramente que no le interesa.",
  move_deal_stage: "Solo en los pasos que lo indican, con el nombre de la etapa tal cual.",
};

/**
 * Instrucciones sin modelo: cuando no hay IA para redactarlas, o la respuesta
 * no sirve. Con la misma forma que las redactadas (reglas críticas y un flujo
 * por pasos), los datos que dio la empresa y solo las herramientas que tiene.
 */
export function localAgentPrompt(p: BusinessSetupInput, orgName: string, tools: string[], facts: SetupFacts = NO_FACTS): string {
  const def = BUSINESS_TYPES[p.businessType];
  const flow = FLOW_BY_TYPE[p.businessType];
  const faq = answeredFaq(p);
  const has = (t: string) => tools.includes(t);
  const where = p.city ? `, en ${p.city}` : "";
  const formal = p.tone === "formal";
  /** La misma frase de tú o de usted, y sin emoji si el tono es formal. */
  const say = (tu: string, usted: string) => (formal ? usted : tu);
  const end = closing(p.businessType, p.tone);
  const buttons = closes(p.goal) && has("reply_with_buttons");
  const close = `«${end.question}»${buttons ? " (aquí sí van los botones)" : ""}`;
  const lookup = [has("search_products") ? "search_products" : null, has("search_knowledge") ? "search_knowledge" : null]
    .filter(Boolean)
    .join(" o ");
  const source = lookup ? `lo que devuelva ${lookup}` : "los datos del negocio de abajo";
  const pass = has("handoff_to_human") ? " y usa handoff_to_human" : "";

  const helpers: StepHelpers = { has, say, close, source, pass, facts, question: end.question };

  const rules = [
    "PLANTILLAS: cuando un paso dice «responde EXACTAMENTE», copia ese mensaje tal cual. Lo que va entre « » es un dato: escribe su valor en ese lugar, sin las comillas « ». Sin frases, saludos ni preguntas de más.",
    `DATOS: precios, fechas, horarios y condiciones salen SOLO de ${lookup ? `${lookup} y de ` : ""}los datos del negocio de abajo. Si un dato no aparece, no lo inventes: di que lo confirmas con el equipo${pass}.`,
    `Una sola pregunta por mensaje. ${say("Tutea siempre.", "Trata siempre de usted.")}`,
    "No repitas información que ya enviaste en la conversación: antes de responder, revisa el historial.",
    buttons
      ? `BOTONES: solo usas botones cuando preguntas «${end.question}», y son exactamente «${end.yes}» y «${CLOSE_NO}». En cualquier otro mensaje está prohibido usar botones u opciones para pulsar.`
      : null,
    has("send_payment_methods") ? "PAGOS: los datos de pago se envían siempre con send_payment_methods. No los escribas ni pegues enlaces a mano." : null,
  ].filter((r): r is string => r !== null);

  return [
    "# ROL",
    `Eres ${p.agentName}, asistente por WhatsApp de ${orgName} (${def.label.toLowerCase()}${where}). ${sentence(p.description || def.hint)} Tu objetivo: ${closes(p.goal) ? flow.result : GOAL_RESULT[p.goal]}.`,
    "",
    "# REGLAS CRÍTICAS (tienen prioridad sobre todo lo demás)",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    "",
    "# FLUJO DE LA CONVERSACIÓN",
    "Identifica en qué paso está el cliente y responde SOLO con lo que corresponde a ese paso.",
    "",
    ...localSteps(p.goal, helpers),
    "",
    "# CUÁNDO PASAR A UNA PERSONA" + (has("handoff_to_human") ? " (handoff_to_human)" : ""),
    `- Pide hablar con alguien o menciona: ${SETUP_HANDOFF_KEYWORDS.join(", ")}. Antes de pasarlo, despídete con una frase corta.`,
    "- Está molesto o hace un reclamo.",
    "- Pide descuentos o condiciones que no están en tu información.",
    "- Pregunta algo que no puedes responder con lo que tienes.",
    "",
    "# HERRAMIENTAS",
    ...tools.map((t) => (STEP_TOOL_RULES[t] ?? TOOL_RULES[t] ? `- ${t}: ${STEP_TOOL_RULES[t] ?? TOOL_RULES[t]}` : null)),
    "",
    "# ESTILO",
    `Tono ${TONE_TEXT[p.tone]}. Responde siempre en español, en mensajes de 1 a 3 frases (máximo 4 líneas) y sin negritas, tablas ni listas largas. Solo hablas de ${orgName}; no hablas mal de la competencia ni pides documentos, claves o datos de tarjetas.`,
    "",
    "# DATOS DEL NEGOCIO",
    ...faq.map((f) => `- ${f.title}: ${f.answer}`),
    p.hours ? `- Horario de atención: ${hoursLabel(p.hours)}.` : null,
    p.website ? `- Sitio web: ${p.website}` : null,
    p.extra ? `- ${p.extra}` : null,
    faq.length || p.extra ? null : "- Aún no hay datos cargados: si no sabes algo, dilo y ofrece consultarlo con el equipo.",
    "",
    "# EJEMPLOS",
    ...localExamples(p.goal, p.agentName, { ...helpers, yes: end.yes, buttons: buttons ? `${end.yes} / ${CLOSE_NO}` : null }),
  ]
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** El objetivo dicho como un resultado que se puede comprobar. */
const GOAL_RESULT: Record<AgentGoal, string> = {
  vender: "que el cliente confirme su compra y envíe su comprobante",
  agendar: "que el cliente quede con una cita agendada",
  soporte: "que la duda o el problema del cliente quede resuelto",
  datos: "dejar anotado quién es el cliente y qué necesita, para que alguien del equipo lo contacte",
};

interface StepHelpers {
  has: (tool: string) => boolean;
  say: Say;
  /** La pregunta de cierre, ya entre « » y con la nota de los botones si los hay. */
  close: string;
  /** De dónde salen los datos: las herramientas de consulta o los datos del negocio. */
  source: string;
  /** « y usa handoff_to_human», o nada si no la tiene. */
  pass: string;
  facts: SetupFacts;
  /** La pregunta de cierre sola, para el final de una plantilla. */
  question: string;
}

type Say = (tu: string, usted: string) => string;
/** Lo que se le dice al cliente cuando quiere pagar, tras darle los datos de pago. */
const payMessage = (say: Say) =>
  say(
    "Listo 🙌 Cuando realices el pago, envíame tu comprobante por aquí para confirmarlo. ¿Tienes alguna duda adicional?",
    "Listo. Cuando realice el pago, envíeme su comprobante por aquí para confirmarlo. ¿Tiene alguna duda adicional?",
  );
/** Lo que se le dice al recibir su comprobante. */
const thanksMessage = (say: Say) =>
  say("¡Gracias! 🙌 Una persona del equipo validará tu pago y te confirmará.", "Gracias. Una persona del equipo validará su pago y le confirmará.");

/**
 * Un intercambio corto por paso, con lo que el agente hace entre corchetes. Sin
 * datos del negocio escritos: los ejemplos enseñan el procedimiento, no un precio.
 */
function localExamples(goal: AgentGoal, agent: string, h: StepHelpers & { yes: string; buttons: string | null }): string[] {
  const { has, say, question, yes, buttons } = h;
  const act = (tool: string, rest: string) => (has(tool) ? `[usa ${tool}${rest ? ` ${rest}` : ""}]` : `[${rest.replace(/^y /, "")}]`);
  const tail = buttons ? ` [botones: ${buttons}]` : "";
  const lookup = has("search_knowledge") ? "search_knowledge" : has("search_products") ? "search_products" : null;
  const answer = lookup ? `[usa ${lookup} y responde en una o dos frases]` : "[responde en una o dos frases con los datos del negocio]";
  const wrong = (text: string, why: string) => ["Ejemplo INCORRECTO (no hagas esto):", `${agent}: ${text} ← ${why}`];
  switch (goal) {
    case "vender":
      return [
        "Cliente: Hola, quiero información",
        `${agent}: ${act("search_products", "y responde como dice el Paso 1")}`,
        "",
        "Cliente: ¿Y cómo se paga?",
        `${agent}: ${answer} ${question}${tail}`,
        "",
        `Cliente: ${yes}`,
        `${agent}: ${has("send_payment_methods") ? "[usa send_payment_methods] " : ""}${payMessage(say)}`,
        "",
        "Cliente: [envía la foto de su comprobante]",
        `${agent}: ${thanksMessage(say)}${has("handoff_to_human") ? " [usa handoff_to_human]" : ""}`,
        "",
        ...(buttons
          ? wrong("¿Qué quieres revisar? [botones: Precio / Detalles / Pago]", "botones fuera del único caso permitido.")
          : wrong("Cuesta 300 y llega mañana.", "precio y plazo dichos de memoria, sin consultarlos.")),
      ];
    case "agendar":
      return [
        "Cliente: Hola, quiero una cita",
        `${agent}: [pregunta qué servicio necesita, en una sola pregunta]`,
        "",
        "Cliente: ¿Cuánto cuesta?",
        `${agent}: ${answer} ${question}${tail}`,
        "",
        "Cliente: Sí, el jueves en la tarde",
        `${agent}: ${has("check_availability") ? "[usa check_availability y ofrece dos o tres horarios reales de ese día]" : "[pregunta a qué hora le queda mejor]"}`,
        "",
        ...wrong(say("Tengo libre mañana a las 10, te espero.", "Tengo libre mañana a las 10, le espero."), "un horario ofrecido sin consultarlo ni reservarlo."),
      ];
    case "soporte":
      return [
        "Cliente: No me funciona",
        `${agent}: [pregunta qué es exactamente lo que no funciona, en una sola pregunta]`,
        "",
        "Cliente: (lo explica)",
        `${agent}: ${answer} ¿Con eso quedó resuelto?`,
        "",
        ...wrong("Seguro es un error del sistema, se arregla solo.", "una respuesta inventada, sin buscarla."),
      ];
    case "datos":
      return [
        "Cliente: Hola, quiero que me llamen",
        `${agent}: [pregunta qué necesita, en una sola pregunta]`,
        "",
        "Cliente: (lo cuenta)",
        `${agent}: [pide el dato que falta, uno por mensaje${has("update_contact") ? ", y lo guarda con update_contact" : ""}]`,
        "",
        ...wrong(say("Pásame tu nombre, tu correo, tu dirección y tu presupuesto.", "Indíqueme su nombre, su correo, su dirección y su presupuesto."), "varios datos pedidos en un solo mensaje."),
      ];
  }
}

/** «antes + qué + después», o null si no hay qué. */
const line = (before: string, what: string | null, after: string): string | null => (what ? `${before}${what}${after}` : null);

/** Los pasos de cada misión, con las herramientas que el agente tiene. */
function localSteps(goal: AgentGoal, h: StepHelpers): string[] {
  const { has, say, close, source, pass, facts, question } = h;
  /** De la lista, las herramientas que el agente tiene, unidas con «y»; null si no tiene ninguna. */
  const uses = (items: (string | null)[]): string | null => {
    const mine = items.filter((i): i is string => i !== null && has(i.split(" ")[0]!));
    return mine.length ? mine.join(" y ") : null;
  };
  const stage = has("move_deal_stage") ? decidedStage(facts) : null;
  // Con catálogo, la presentación es una plantilla con sus datos reales; sin él, una pauta.
  const pitch =
    has("search_products") && facts.products > 0
      ? [
          "- Si no se ha enviado, responde EXACTAMENTE:",
          "",
          "*«Nombre»*",
          "«Descripción»",
          "💰 «Precio»",
          ...facts.productFields.slice(0, 5).map((f) => `• ${f}: «${f}»`),
          "",
          question,
        ]
      : [`- Preséntalo en pocas líneas (qué es, lo esencial y su precio) con ${source} y, en ese mismo mensaje, termina con ${close}.`];
  const files = facts.productFiles.length ? facts.productFiles.join(", ").toLowerCase() : "ficha, brochure o temario";
  switch (goal) {
    case "vender":
      return [
        "## PASO 1 — Llega interesado (pregunta por algo o por su precio, o viene de un anuncio)",
        has("search_products")
          ? "- Usa search_products con lo que busca. Si no sabes qué le interesa, pregúntaselo (una sola pregunta)."
          : "- Si no sabes qué le interesa, pregúntaselo (una sola pregunta).",
        "- Si ya le enviaste esa información en la conversación, no la repitas: responde lo que pregunte.",
        ...pitch,
        "",
        "## PASO 2 — Pide un detalle (foto, ficha, envío, horario)",
        has("send_product_image") ? "- Foto: envíala con send_product_image." : null,
        has("send_product_file") ? `- ${files[0]!.toUpperCase()}${files.slice(1)}: envíalo con send_product_file.` : null,
        has("send_product_image") || has("send_product_file") ? `- Lo demás, en una o dos líneas con ${source}.` : `Respóndelo en una o dos líneas con ${source}.`,
        "",
        "## PASO 3 — Tiene dudas u objeciones",
        `Responde su duda en 1 a 3 frases con ${source} y, en ese mismo mensaje, termina con ${close}. Si dice que es caro o que lo va a pensar, recuérdale en una frase lo que incluye, sin inventar descuentos.`,
        "",
        "## PASO 4 — Quiere comprar, reservar o separar",
        has("send_payment_methods")
          ? "- Usa send_payment_methods y luego responde EXACTAMENTE:"
          : "- Indícale cómo pagar con los datos del negocio de abajo y luego responde EXACTAMENTE:",
        "",
        payMessage(say),
        "",
        line("- Usa ", uses(["mark_lead con «potential»", stage ? `move_deal_stage a «${stage}»` : null]), "."),
        "",
        "## PASO 5 — Envía el comprobante o dice que ya pagó",
        "Responde EXACTAMENTE:",
        "",
        thanksMessage(say),
        "",
        line("Luego usa ", uses(["handoff_to_human", "mark_lead con «purchase»"]), ".") ?? "Luego deja el chat para que lo siga una persona del equipo.",
      ].filter((l): l is string => l !== null);
    case "agendar":
      return [
        "## PASO 1 — Llega interesado",
        "Entiende qué servicio necesita con una sola pregunta. Si ya lo dijo, pasa al Paso 2.",
        "",
        "## PASO 2 — Informa el servicio",
        `Responde en 1 a 3 frases con ${source} (qué incluye y su precio) y, en ese mismo mensaje, termina con ${close}.`,
        "",
        "## PASO 3 — Quiere una cita",
        has("check_availability")
          ? "Usa check_availability y ofrécele dos o tres horarios reales, en una sola pregunta."
          : "Pregúntale qué día y a qué hora le queda mejor.",
        "",
        "## PASO 4 — Elige día y hora",
        has("book_appointment")
          ? "Resérvala con book_appointment y confirma en un solo mensaje el servicio, el día, la hora y la dirección."
          : `Dile que una persona del equipo le confirmará la cita${pass}.`,
        line("Usa ", uses(["mark_lead con «purchase»", stage ? `move_deal_stage a «${stage}»` : null]), " cuando la cita quede confirmada."),
        "",
        "## PASO 5 — Quiere cambiar o cancelar",
        has("reschedule_appointment") || has("cancel_appointment")
          ? "Usa reschedule_appointment o cancel_appointment y confírmale el cambio en una frase."
          : `Dile que una persona del equipo lo verá${pass}.`,
      ].filter((l): l is string => l !== null);
    case "soporte":
      return [
        "## PASO 1 — Cuenta su duda o su problema",
        "Si no queda claro qué necesita, hazle una sola pregunta para entenderlo.",
        "",
        "## PASO 2 — Responde",
        `Responde en 1 a 3 frases con ${source}, con los pasos a seguir si los hay.`,
        "",
        "## PASO 3 — Confirma",
        "Pregúntale si con eso quedó resuelto. Si no, inténtalo una vez más con otra búsqueda.",
        "",
        "## PASO 4 — No se puede resolver por aquí",
        `Dile que lo verá una persona del equipo${pass}.`,
      ];
    case "datos":
      return [
        "## PASO 1 — Llega",
        has("search_contact") ? "Revisa con search_contact lo que ya sabemos de él y pregúntale qué necesita." : "Pregúntale qué necesita.",
        "",
        "## PASO 2 — Pide sus datos",
        `De a uno por mensaje y solo los que falten: su nombre, qué necesita exactamente y para cuándo.${has("update_contact") ? " Guarda cada uno con update_contact." : ""}`,
        "",
        "## PASO 3 — Ya tienes lo necesario",
        "Responde EXACTAMENTE:",
        "",
        say("¡Gracias! 🙌 Una persona del equipo te escribirá para continuar.", "Gracias. Una persona del equipo le escribirá para continuar."),
        "",
        line("Luego usa ", uses(["mark_lead con «potential»", "assign_to_seller"]), "."),
      ].filter((l): l is string => l !== null);
  }
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
