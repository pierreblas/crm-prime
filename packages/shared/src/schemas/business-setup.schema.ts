import { z } from "zod";

/**
 * Asistente de bienvenida: tras crear la empresa, unas pocas pantallas (tipo
 * de negocio, qué vende, su agente, lo que debe saber, cómo atiende) y Driony
 * arma la IA de WhatsApp con eso: instrucciones del agente, base de
 * conocimiento, embudo con las etapas de su rubro y respuestas rápidas.
 *
 * El catálogo vive aquí porque lo usan los dos lados: la web para preguntar y
 * enseñar la vista previa, la API para construir.
 */

export const BUSINESS_TYPE_KEYS = [
  "tienda",
  "restaurante",
  "salud",
  "belleza",
  "inmobiliaria",
  "educacion",
  "servicios",
  "automotriz",
  "turismo",
  "otro",
] as const;
export type BusinessType = (typeof BUSINESS_TYPE_KEYS)[number];
export const businessTypeSchema = z.enum(BUSINESS_TYPE_KEYS);

export const AGENT_GOALS = ["vender", "agendar", "soporte", "datos"] as const;
export type AgentGoal = (typeof AGENT_GOALS)[number];

export const AGENT_TONES = ["cercano", "formal", "juvenil", "divertido"] as const;
export type AgentTone = (typeof AGENT_TONES)[number];

/** Una pregunta frecuente del rubro: su respuesta va al conocimiento y a una respuesta rápida. */
export interface BusinessFaq {
  key: string;
  /** Rótulo corto: título de la respuesta rápida. */
  title: string;
  question: string;
  placeholder: string;
  shortcut: string;
}

export interface BusinessTypeDef {
  label: string;
  hint: string;
  /** Misión que se propone para su agente. */
  goal: AgentGoal;
  agentName: string;
  /** Ejemplo para «qué vendes y a quién». */
  describe: string;
  /**
   * Etapas del embudo, en el mismo orden y con el mismo papel que las de
   * fábrica (entrada, contactado, calificado, propuesta, ganado, perdido).
   * null: se quedan las de fábrica.
   */
  stages: readonly [string, string, string, string, string, string] | null;
  faq: BusinessFaq[];
  /** Conversación de muestra para la vista previa. */
  sample: { question: string; answer: string };
}

const HORARIO = (placeholder: string): BusinessFaq => ({
  key: "horario",
  title: "Dirección y horario",
  question: "¿Dónde están y en qué horario atienden?",
  placeholder,
  shortcut: "/horario",
});

const PAGOS = (placeholder: string): BusinessFaq => ({
  key: "pagos",
  title: "Medios de pago",
  question: "¿Qué medios de pago aceptan?",
  placeholder,
  shortcut: "/pagos",
});

export const BUSINESS_TYPES: Record<BusinessType, BusinessTypeDef> = {
  tienda: {
    label: "Tienda o e-commerce",
    hint: "Ropa, tecnología, productos con envío",
    goal: "vender",
    agentName: "Sofía",
    describe: "Vendemos ropa deportiva para mujer por Instagram y WhatsApp, con envíos a todo el país.",
    stages: ["Entrantes", "Consultando", "Interesado", "Pedido", "Vendido", "Perdido"],
    faq: [
      {
        key: "envios",
        title: "Envíos",
        question: "¿Hacen envíos? ¿A dónde, cuánto cuestan y cuánto tardan?",
        placeholder: "Enviamos a todo el país en 2 a 4 días hábiles. Gratis en compras desde 150; si no, 10.",
        shortcut: "/envios",
      },
      PAGOS("Transferencia, tarjeta y billeteras digitales. Contra entrega solo en la capital."),
      {
        key: "cambios",
        title: "Cambios y devoluciones",
        question: "¿Aceptan cambios o devoluciones?",
        placeholder: "Cambios dentro de los 7 días, con la etiqueta puesta. No devolvemos dinero.",
        shortcut: "/cambios",
      },
      HORARIO("Somos tienda online. Respondemos de lunes a sábado de 9 a 19."),
    ],
    sample: {
      question: "Hola, ¿hacen envíos a provincia?",
      answer: "Sí, enviamos a todo el país. ¿Qué producto te interesa? Te confirmo precio y plazo.",
    },
  },
  restaurante: {
    label: "Restaurante o comida",
    hint: "Delivery, cafetería, pastelería",
    goal: "vender",
    agentName: "Carla",
    describe: "Restaurante de comida criolla con delivery en la zona sur de la ciudad; también recibimos reservas.",
    stages: ["Entrantes", "Viendo la carta", "Armando pedido", "Por confirmar", "Entregado", "Perdido"],
    faq: [
      {
        key: "carta",
        title: "Carta y precios",
        question: "¿Qué platos tienen y a qué precio?",
        placeholder: "Menú del día 18. Pollo a la brasa entero 65. Postres desde 8. Bebidas desde 5.",
        shortcut: "/carta",
      },
      {
        key: "delivery",
        title: "Delivery",
        question: "¿Hacen delivery? ¿A qué zonas, cuánto cuesta y cuánto tarda?",
        placeholder: "Delivery en el centro y la zona sur por 7. Llega en 40 a 60 minutos.",
        shortcut: "/delivery",
      },
      HORARIO("Av. Principal 123. Abrimos de martes a domingo de 12 a 22."),
      {
        key: "reservas",
        title: "Reservas",
        question: "¿Aceptan reservas? ¿Cómo se hacen?",
        placeholder: "Sí, para grupos de hasta 12 personas, con un día de anticipación.",
        shortcut: "/reservas",
      },
    ],
    sample: {
      question: "Hola, ¿hacen delivery hoy?",
      answer: "¡Sí! Llegamos en unos 45 minutos. ¿Te paso la carta para que elijas?",
    },
  },
  salud: {
    label: "Salud o clínica",
    hint: "Consultorio, dental, psicología, laboratorio",
    goal: "agendar",
    agentName: "Lucía",
    describe: "Clínica dental familiar; atendemos ortodoncia, limpiezas y urgencias. Queremos llenar la agenda.",
    stages: ["Entrantes", "Contactado", "Interesado", "Cita agendada", "Atendido", "Perdido"],
    faq: [
      {
        key: "servicios",
        title: "Servicios y precios",
        question: "¿Qué servicios o especialidades ofrecen y cuánto cuesta la consulta?",
        placeholder: "Odontología general, ortodoncia y blanqueamiento. Evaluación: 50.",
        shortcut: "/servicios",
      },
      HORARIO("Av. Central 456, consultorio 302. Lunes a sábado de 9 a 20."),
      {
        key: "seguros",
        title: "Seguros y convenios",
        question: "¿Trabajan con seguros o convenios?",
        placeholder: "Atendemos con los principales seguros privados. Particulares: 10% de descuento en efectivo.",
        shortcut: "/seguros",
      },
      {
        key: "citas",
        title: "Cómo agendar",
        question: "¿Cómo se agenda una cita? ¿Hay que pagar algo antes?",
        placeholder: "Por este chat: nos dices día y hora y te confirmamos. No pedimos adelanto.",
        shortcut: "/citas",
      },
    ],
    sample: {
      question: "Hola, ¿tienen cita esta semana?",
      answer: "Claro que sí. ¿Qué día y a qué hora te queda mejor? Así te confirmo el espacio.",
    },
  },
  belleza: {
    label: "Belleza o estética",
    hint: "Salón, barbería, spa, uñas",
    goal: "agendar",
    agentName: "Valeria",
    describe: "Salón de belleza: cortes, color, uñas y pestañas. Atendemos con cita.",
    stages: ["Entrantes", "Contactado", "Interesado", "Cita agendada", "Atendida", "Perdido"],
    faq: [
      {
        key: "servicios",
        title: "Servicios y precios",
        question: "¿Qué servicios ofrecen y a qué precio?",
        placeholder: "Corte 35. Tinte desde 90. Manicure 25. Pestañas 80.",
        shortcut: "/precios",
      },
      HORARIO("Calle Las Flores 210. Lunes a sábado de 10 a 20; domingos con cita."),
      {
        key: "citas",
        title: "Reservas",
        question: "¿Cómo se reserva? ¿Piden adelanto?",
        placeholder: "Reservas por este chat con el 50% de adelanto por transferencia.",
        shortcut: "/reservas",
      },
      PAGOS("Efectivo, tarjeta y transferencia."),
    ],
    sample: {
      question: "Hola, ¿tienen espacio el sábado?",
      answer: "¡Sí! Todavía quedan horarios el sábado. ¿Qué servicio te gustaría?",
    },
  },
  inmobiliaria: {
    label: "Inmobiliaria",
    hint: "Venta o alquiler de propiedades, proyectos",
    goal: "agendar",
    agentName: "Andrea",
    describe: "Inmobiliaria con proyectos de departamentos de 2 y 3 dormitorios; buscamos agendar visitas.",
    stages: ["Entrantes", "Contactado", "Calificado", "Visita agendada", "Cerrado", "Perdido"],
    faq: [
      {
        key: "proyectos",
        title: "Proyectos",
        question: "¿Qué propiedades o proyectos tienen y en qué zonas?",
        placeholder: "Departamentos de 2 y 3 dormitorios en dos proyectos de la zona norte, desde 70 m².",
        shortcut: "/proyectos",
      },
      {
        key: "precios",
        title: "Precios y financiamiento",
        question: "¿Cuál es el rango de precios y cómo se puede pagar?",
        placeholder: "Desde 120 mil. Aceptamos crédito hipotecario y programas de vivienda.",
        shortcut: "/precios",
      },
      {
        key: "visitas",
        title: "Visitas",
        question: "¿Cómo se agenda una visita?",
        placeholder: "Visitas todos los días de 10 a 18, con cita previa por este chat.",
        shortcut: "/visitas",
      },
      HORARIO("Oficina de ventas en Av. Norte 900. Lunes a domingo de 10 a 18."),
    ],
    sample: {
      question: "Hola, ¿tienen departamentos de 3 dormitorios?",
      answer: "¡Hola! Sí, tenemos opciones. ¿En qué zona buscas y para cuándo te gustaría mudarte?",
    },
  },
  educacion: {
    label: "Educación o cursos",
    hint: "Academia, cursos online, idiomas, colegio",
    goal: "vender",
    agentName: "Diego",
    describe: "Academia de inglés online para adultos; clases en vivo en grupos pequeños.",
    stages: ["Entrantes", "Contactado", "Interesado", "Matrícula en proceso", "Inscrito", "Perdido"],
    faq: [
      {
        key: "cursos",
        title: "Cursos",
        question: "¿Qué cursos o programas ofrecen?",
        placeholder: "Inglés básico, intermedio y avanzado. Cada nivel dura 3 meses.",
        shortcut: "/cursos",
      },
      {
        key: "precios",
        title: "Precios y pagos",
        question: "¿Cuánto cuesta y cuáles son las formas de pago?",
        placeholder: "Mensualidad de 120 o pago completo del nivel con 15% de descuento.",
        shortcut: "/precios",
      },
      {
        key: "inicio",
        title: "Inicio y horarios",
        question: "¿Cuándo empiezan y en qué horarios hay clases?",
        placeholder: "Nuevos grupos cada primer lunes del mes. Turnos mañana, tarde y noche.",
        shortcut: "/inicio",
      },
      {
        key: "modalidad",
        title: "Modalidad y certificado",
        question: "¿Es presencial o virtual? ¿Entregan certificado?",
        placeholder: "100% en vivo por videollamada. Certificado digital al aprobar cada nivel.",
        shortcut: "/modalidad",
      },
    ],
    sample: {
      question: "Hola, ¿cuándo empieza el próximo grupo?",
      answer: "¡Hola! Te cuento las fechas. ¿Qué curso te interesa y en qué horario podrías?",
    },
  },
  servicios: {
    label: "Servicios profesionales",
    hint: "Agencia, estudio, consultoría, técnicos",
    goal: "datos",
    agentName: "Mateo",
    describe: "Agencia de marketing digital para pequeños negocios: redes sociales, anuncios y páginas web.",
    stages: ["Entrantes", "Contactado", "Calificado", "Cotización enviada", "Ganado", "Perdido"],
    faq: [
      {
        key: "servicios",
        title: "Servicios",
        question: "¿Qué servicios ofrecen?",
        placeholder: "Manejo de redes, campañas de anuncios, diseño de marca y páginas web.",
        shortcut: "/servicios",
      },
      {
        key: "precios",
        title: "Cotizaciones",
        question: "¿Cómo cotizan y desde cuánto cuesta?",
        placeholder: "Planes mensuales desde 300. Cotizamos gratis tras una llamada de 15 minutos.",
        shortcut: "/cotizar",
      },
      {
        key: "zona",
        title: "Zona de atención",
        question: "¿En qué ciudades o zonas trabajan?",
        placeholder: "Trabajamos con clientes de todo el país, de forma remota.",
        shortcut: "/zona",
      },
      {
        key: "plazos",
        title: "Plazos",
        question: "¿Cuánto tardan en empezar o en entregar?",
        placeholder: "Empezamos en 5 días hábiles desde la firma. Una web toma de 2 a 3 semanas.",
        shortcut: "/plazos",
      },
    ],
    sample: {
      question: "Hola, quisiera una cotización",
      answer: "¡Con gusto! Para cotizarte bien, ¿me cuentas qué necesitas y para cuándo lo quieres?",
    },
  },
  automotriz: {
    label: "Autos y talleres",
    hint: "Concesionario, repuestos, taller mecánico",
    goal: "vender",
    agentName: "Bruno",
    describe: "Venta de repuestos y taller mecánico para camionetas; también hacemos mantenimiento preventivo.",
    stages: ["Entrantes", "Contactado", "Interesado", "Cotización o prueba", "Vendido", "Perdido"],
    faq: [
      {
        key: "catalogo",
        title: "Qué ofrecemos",
        question: "¿Qué vehículos, repuestos o servicios tienen?",
        placeholder: "Repuestos originales y alternativos para camionetas. Mantenimiento y diagnóstico.",
        shortcut: "/catalogo",
      },
      {
        key: "precios",
        title: "Precios y financiamiento",
        question: "¿Cómo son los precios y hay financiamiento?",
        placeholder: "Mantenimiento desde 180. Hasta 6 cuotas sin intereses con tarjeta.",
        shortcut: "/financiamiento",
      },
      HORARIO("Taller en Av. Industrial 77. Lunes a sábado de 8 a 18."),
      {
        key: "garantia",
        title: "Garantía",
        question: "¿Qué garantía ofrecen?",
        placeholder: "3 meses de garantía en repuestos y mano de obra.",
        shortcut: "/garantia",
      },
    ],
    sample: {
      question: "Hola, ¿tienen pastillas de freno para mi camioneta?",
      answer: "¡Hola! Déjame revisarlo. ¿Me confirmas la marca, el modelo y el año?",
    },
  },
  turismo: {
    label: "Turismo y hoteles",
    hint: "Agencia de viajes, hotel, tours",
    goal: "vender",
    agentName: "Camila",
    describe: "Agencia de viajes con paquetes nacionales e internacionales y tours a medida.",
    stages: ["Entrantes", "Contactado", "Interesado", "Cotización enviada", "Reservado", "Perdido"],
    faq: [
      {
        key: "paquetes",
        title: "Paquetes y tours",
        question: "¿Qué paquetes, tours o habitaciones ofrecen?",
        placeholder: "Paquetes de 3 a 7 días a los principales destinos del país y a la playa.",
        shortcut: "/paquetes",
      },
      {
        key: "precios",
        title: "Precios",
        question: "¿Cuánto cuestan y qué incluyen?",
        placeholder: "Desde 450 por persona: transporte, hotel, desayunos y guía.",
        shortcut: "/precios",
      },
      {
        key: "reservas",
        title: "Reservas",
        question: "¿Cómo se reserva y qué adelanto piden?",
        placeholder: "Separamos tu cupo con el 30% de adelanto; el resto, 15 días antes del viaje.",
        shortcut: "/reservas",
      },
      {
        key: "cancelacion",
        title: "Cambios y cancelación",
        question: "¿Cuál es la política de cambios o cancelación?",
        placeholder: "Cambios de fecha gratis hasta 20 días antes. Cancelaciones con 20% de penalidad.",
        shortcut: "/cancelacion",
      },
    ],
    sample: {
      question: "Hola, ¿tienen tours para diciembre?",
      answer: "¡Hola! Sí, tenemos salidas en diciembre. ¿Para cuántas personas y qué fechas?",
    },
  },
  otro: {
    label: "Otro tipo de negocio",
    hint: "Nos cuentas qué haces en el paso siguiente",
    goal: "vender",
    agentName: "Ana",
    describe: "Qué vendes u ofreces, dónde y a qué tipo de cliente.",
    stages: null,
    faq: [
      {
        key: "precios",
        title: "Precios",
        question: "¿Cuáles son sus precios o cómo cotizan?",
        placeholder: "Nuestros precios van desde 50. Cotizamos gratis por este chat.",
        shortcut: "/precios",
      },
      PAGOS("Efectivo, tarjeta y transferencia."),
      HORARIO("Atendemos de lunes a viernes de 9 a 18."),
      {
        key: "envios",
        title: "Envíos o atención a domicilio",
        question: "¿Hacen envíos o atienden a domicilio?",
        placeholder: "Sí, en toda la ciudad, con un costo adicional según la zona.",
        shortcut: "/envios",
      },
    ],
    sample: {
      question: "Hola, quisiera más información",
      answer: "¡Hola! Con gusto te ayudo. ¿Qué te gustaría saber?",
    },
  },
};

export const AGENT_GOAL_INFO: Record<AgentGoal, { title: string; desc: string }> = {
  vender: { title: "Vender", desc: "Da precios, resuelve dudas y cierra la compra." },
  agendar: { title: "Agendar citas", desc: "Califica al cliente y consigue una cita o visita." },
  soporte: { title: "Dar soporte", desc: "Responde preguntas frecuentes y resuelve problemas." },
  datos: { title: "Captar datos", desc: "Recoge lo que necesita un vendedor para llamar." },
};

export const AGENT_TONE_INFO: Record<AgentTone, { title: string; sample: string }> = {
  cercano: { title: "Cercano", sample: "¡Hola! Claro, te cuento 😊" },
  formal: { title: "Formal, de usted", sample: "Hola. Con gusto le informo." },
  juvenil: { title: "Juvenil y directo", sample: "Hey! Va, te explico rápido." },
  divertido: { title: "Divertido", sample: "¡Holaaa! 🎉 Esto te va a encantar." },
};

/** Saludo automático del agente: el mismo que enseña la vista previa. */
export function welcomeMessageFor(tone: AgentTone, agentName: string, orgName: string): string {
  const agent = agentName.trim() || "tu asistente";
  const org = orgName.trim() || "nuestro negocio";
  switch (tone) {
    case "formal":
      return `Hola, gracias por comunicarse con ${org}. Le saluda ${agent}. ¿En qué puedo ayudarle?`;
    case "juvenil":
      return `Hey! 👋 Soy ${agent} de ${org}. Cuéntame, ¿qué buscas?`;
    case "divertido":
      return `¡Holaaa! 🎉 Soy ${agent} de ${org}. ¿En qué te ayudo hoy?`;
    case "cercano":
    default:
      return `¡Hola! 👋 Gracias por escribir a ${org}. Soy ${agent}, ¿en qué te puedo ayudar?`;
  }
}

// ── Lo que se pregunta ────────────────────────────────────────

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida");

export const SETUP_DAY_PRESETS = ["lv", "ls", "all"] as const;
export type SetupDayPreset = (typeof SETUP_DAY_PRESETS)[number];
export const SETUP_DAY_LABEL: Record<SetupDayPreset, string> = {
  lv: "de lunes a viernes",
  ls: "de lunes a sábado",
  all: "todos los días",
};

export const setupHoursSchema = z
  .object({ days: z.enum(SETUP_DAY_PRESETS), from: hhmm, to: hhmm })
  .refine((h) => h.from < h.to, { message: "La hora de cierre debe ser después de la de apertura", path: ["to"] });
export type SetupHours = z.infer<typeof setupHoursSchema>;

export function hoursLabel(h: SetupHours): string {
  return `${SETUP_DAY_LABEL[h.days]} de ${h.from} a ${h.to}`;
}

export const businessSetupSchema = z.object({
  businessType: businessTypeSchema,
  description: z.string().trim().max(1200).default(""),
  city: z.string().trim().max(120).default(""),
  website: z
    .string()
    .trim()
    .max(300)
    .default("")
    .refine((v) => !v || /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i.test(v), "Escribe una dirección válida, por ejemplo tutienda.com"),
  agentName: z.string().trim().min(1, "Ponle un nombre a tu agente").max(60),
  goal: z.enum(AGENT_GOALS),
  tone: z.enum(AGENT_TONES),
  /** Respuestas a las preguntas frecuentes del rubro, por clave. */
  answers: z.record(z.string().max(40), z.string().trim().max(1500)).default({}),
  /** Lo que no encaja en ninguna pregunta. */
  extra: z.string().trim().max(2000).default(""),
  autopilot: z.boolean().default(true),
  welcome: z.boolean().default(true),
  /** null: responde a toda hora. */
  hours: setupHoursSchema.nullable().default(null),
  timezone: z.string().trim().min(1).max(60).default("America/Lima"),
});
export type BusinessSetupInput = z.infer<typeof businessSetupSchema>;

// ── Lo que devuelve cada fase de la construcción ──────────────

export interface BusinessSetupState {
  profile: BusinessSetupInput | null;
  completedAt: string | null;
  orgName: string;
  /** ¿Hay IA para redactar las instrucciones? Sin ella se usa una plantilla. */
  aiReady: boolean;
}

export interface SetupProfileResult {
  /** Etapas con las que quedó el embudo, o null si se dejó como estaba. */
  stages: string[] | null;
  quickReplies: number;
}

export interface SetupKnowledgeResult {
  /** Datos del negocio que se guardaron (descripción, horario, respuestas…). */
  facts: number;
  website: { ok: boolean; pages: number; error: string | null } | null;
}

export interface SetupAgentResult {
  botId: string;
  botName: string;
  writtenBy: "ai" | "template";
  autopilot: boolean;
  welcome: boolean;
  hours: boolean;
  tools: number;
}
