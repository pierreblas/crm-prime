import type { IconName } from "@/components/NavIcons";
import type { OnboardingStepKey } from "@crm/shared";

/**
 * Textos y destinos de cada paso de Primeros pasos. El ESTADO lo da la API
 * (se deduce de los datos); aquí solo va lo que se le cuenta a la persona.
 *
 * Cada paso responde a tres cosas: qué hacer, por qué importa y cuánto
 * tarda. El detalle se despliega solo en el paso en curso, para no abrumar.
 */
export interface StepMeta {
  key: OnboardingStepKey;
  icon: IconName;
  title: string;
  /** Por qué importa, en una línea. */
  why: string;
  minutes: number;
  href: string;
  cta: string;
  /** Qué hacer exactamente, cuando el paso está desplegado. */
  details: string[];
  doc?: { slug: string; label: string };
  /** Cómo leer la cifra que devuelve la API para este paso. */
  count?: (n: number) => string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const STEPS: StepMeta[] = [
  {
    key: "whatsapp",
    icon: "whatsapp",
    title: "Conecta tu número de WhatsApp",
    why: "Sin número no hay conversaciones. Es el único paso imprescindible.",
    minutes: 5,
    href: "/whatsapp",
    cta: "Conectar WhatsApp",
    details: [
      "Pulsa «Conectar WhatsApp»: Meta abre su ventana, eliges la cuenta y el número.",
      "Si tienes tu propia app de Meta, añade el número a mano con el token.",
      "Puedes conectar varios números; cada uno puede tener su propio agente y embudo.",
    ],
    doc: { slug: "whatsapp", label: "Guía: conectar WhatsApp" },
    count: (n) => plural(n, "número conectado", "números conectados"),
  },
  {
    key: "ai",
    icon: "sparkles",
    title: "Activa la inteligencia artificial",
    why: "Sin IA, los agentes no responden. Si tu plan la incluye, este paso ya aparece hecho.",
    minutes: 2,
    href: "/settings?tab=ai",
    cta: "Ir a Ajustes › IA",
    details: [
      "Si tu plan trae IA incluida, no tienes que hacer nada: el agente ya responde.",
      "Si quieres elegir el modelo o no tener cupo, pega tu clave de OpenAI o Anthropic.",
      "«Probar conexión» hace una llamada real para confirmar que funciona.",
    ],
    doc: { slug: "agentes", label: "Guía: modelos y claves" },
  },
  {
    key: "agent",
    icon: "bot",
    title: "Dale personalidad a tu agente",
    why: "Nace con instrucciones genéricas. Cuéntale qué vendes y cómo hablar.",
    minutes: 5,
    href: "/agentes?asistente=1",
    cta: "Armar mi agente con ayuda",
    details: [
      "El asistente te hace cinco preguntas (qué vendes, su misión, qué puede hacer, cuándo te avisa) y redacta las instrucciones por ti.",
      "Activa el saludo automático y, si lo necesitas, el horario de atención.",
      "Elige qué puede hacer: consultar el catálogo, buscar en el conocimiento, mover el embudo, escalar a un humano.",
    ],
    doc: { slug: "agentes", label: "Guía: agentes de IA" },
  },
  {
    key: "products",
    icon: "tag",
    title: "Carga tu catálogo",
    why: "Así el agente da precios reales, en la moneda de cada cliente, nunca inventados.",
    minutes: 5,
    href: "/products",
    cta: "Añadir productos",
    details: [
      "Crea productos uno a uno o importa un CSV con nombre, precio y moneda.",
      "Pon precios en varias monedas: cada cliente ve la de su país.",
      "Los productos inactivos no se le muestran al agente.",
    ],
    count: (n) => plural(n, "producto", "productos"),
  },
  {
    key: "knowledge",
    icon: "book",
    title: "Sube lo que tu agente debe saber",
    why: "Preguntas frecuentes, envíos, devoluciones, horarios: lo que hoy respondes a mano.",
    minutes: 3,
    href: "/knowledge",
    cta: "Subir conocimiento",
    details: [
      "Pega texto o sube documentos: cómo comprar, envíos, garantías, políticas.",
      "El agente busca en ellos antes de responder.",
      "Empieza por las diez preguntas que más te hacen.",
    ],
    count: (n) => plural(n, "documento", "documentos"),
  },
  {
    key: "try_agent",
    icon: "flask",
    title: "Prueba tu agente en el simulador",
    why: "Conversa con él como si fueras un cliente antes de que hable con uno real.",
    minutes: 2,
    href: "/agentes",
    cta: "Abrir el simulador",
    details: [
      "En Agentes IA, pulsa «Probar» sobre tu agente.",
      "Pregúntale precios, pide una foto, ponlo en aprietos: verás qué herramientas usa y cuándo escala.",
      "Ajusta las instrucciones y vuelve a probar hasta que responda como lo harías tú.",
    ],
  },
  {
    key: "first_chat",
    icon: "inbox",
    title: "Recibe tu primera conversación",
    why: "Escríbete desde otro celular y mira cómo entra en la Bandeja y en el Embudo.",
    minutes: 1,
    href: "/",
    cta: "Ir a la Bandeja",
    details: [
      "Envía un mensaje a tu número desde otro teléfono.",
      "Aparece en la Bandeja al instante y como oportunidad en la primera etapa del embudo.",
      "En Copilot la IA sugiere y tú apruebas; en Autopilot responde sola.",
    ],
    doc: { slug: "bandeja", label: "Guía: la Bandeja" },
    count: (n) => plural(n, "conversación", "conversaciones"),
  },
  {
    key: "team",
    icon: "user",
    title: "Invita a tu equipo",
    why: "Cada vendedor con su usuario: bandeja propia y reparto automático por fuentes.",
    minutes: 2,
    href: "/sellers",
    cta: "Añadir vendedores",
    details: [
      "Crea un usuario por vendedor con su correo y una contraseña inicial.",
      "Asigna fuentes a cada uno para repartir conversaciones y oportunidades.",
      "¿Trabajas solo? Omite este paso; puedes retomarlo cuando quieras.",
    ],
    doc: { slug: "empezar", label: "Guía: equipo y roles" },
    count: (n) => plural(n, "usuario", "usuarios"),
  },
];

export const STEP_BY_KEY: Record<OnboardingStepKey, StepMeta> = Object.fromEntries(
  STEPS.map((s) => [s.key, s]),
) as Record<OnboardingStepKey, StepMeta>;
