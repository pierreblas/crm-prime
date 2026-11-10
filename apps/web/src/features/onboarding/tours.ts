import type { IconName } from "@/components/NavIcons";
import type { TourKey } from "@crm/shared";

/**
 * Tours guiados: un recorrido corto por cada pantalla, señalando elementos
 * reales (`data-tour="…"`) en vez de capturas. Se abren solos la primera vez
 * que la persona entra en la pantalla y se pueden repetir desde Ayuda.
 *
 * Un paso cuyo elemento no está en pantalla (p. ej. el chat cuando no hay
 * conversación abierta) se salta sin ruido: el tour se adapta a lo que hay.
 */
export interface TourStep {
  /** Selector CSS del elemento a señalar. */
  target: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
}

export interface TourDef {
  key: TourKey;
  icon: IconName;
  /** Nombre de la pantalla, para el listado y el menú de ayuda. */
  name: string;
  /** Ruta en la que vive el tour (la que se abre para verlo). */
  href: string;
  matches: (pathname: string) => boolean;
  steps: TourStep[];
}

export const TOURS: TourDef[] = [
  {
    key: "welcome",
    icon: "rocket",
    name: "Primeros pasos",
    href: "/getting-started",
    matches: (p) => p === "/getting-started",
    steps: [
      {
        target: "[data-tour=gs-progress]",
        title: "Tu progreso, siempre a la vista",
        body: "Cada paso se marca solo cuando lo completas de verdad: conectar el número, cargar un producto, recibir un chat. Nada de casillas que marcar a mano.",
        placement: "bottom",
      },
      {
        target: "[data-tour=gs-current]",
        title: "Empieza por aquí",
        body: "El primer paso pendiente está desplegado, con lo que hay que hacer y el botón que te lleva a la pantalla exacta. Lo que no aplique a tu negocio se puede omitir.",
        placement: "right",
      },
      {
        target: "[data-tour=nav-inbox]",
        title: "La Bandeja",
        body: "Aquí llegan las conversaciones de todos tus números, en tiempo real. Tu equipo y el agente de IA trabajan desde aquí.",
        placement: "right",
      },
      {
        target: "[data-tour=nav-bots]",
        title: "Agentes IA",
        body: "Configura cómo responde la IA: qué vende, cómo habla, qué puede hacer y cuándo pasa el chat a una persona.",
        placement: "right",
      },
      {
        target: "[data-tour=help]",
        title: "Ayuda a un clic",
        body: "Desde aquí vuelves a esta lista, repites el tour de cualquier pantalla o abres la documentación.",
        placement: "bottom",
      },
    ],
  },
  {
    key: "inbox",
    icon: "inbox",
    name: "Bandeja",
    href: "/",
    matches: (p) => p === "/",
    steps: [
      {
        target: "[data-tour=inbox-list]",
        title: "Todas tus conversaciones",
        body: "Cada chat de todos tus números. Filtra por Mías, Sin asignar o Esperando, ordena por tiempo de espera y busca por nombre o teléfono.",
        placement: "right",
      },
      {
        target: "[data-tour=inbox-chat]",
        title: "La conversación",
        body: "Mensajes en tiempo real. Los del agente de IA llevan su propia marca, para distinguirlos de los de tu equipo.",
        placement: "left",
      },
      {
        target: "[data-tour=inbox-ai-mode]",
        title: "Copilot o Autopilot",
        body: "En Copilot la IA propone respuestas y tú decides. En Autopilot responde sola y te avisa si necesita ayuda. Se cambia por conversación.",
        placement: "bottom",
      },
      {
        target: "[data-tour=inbox-composer]",
        title: "Responde",
        body: "Escribe, adjunta archivos o usa una respuesta rápida. Dentro de la ventana de 24 h de WhatsApp escribes libre; fuera de ella, con una plantilla aprobada.",
        placement: "top",
      },
    ],
  },
  {
    key: "pipeline",
    icon: "pipeline",
    name: "Embudo",
    href: "/pipeline",
    matches: (p) => p === "/pipeline",
    steps: [
      {
        target: "[data-tour=pipeline-header]",
        title: "Tu embudo",
        body: "Cada columna es una etapa. Las conversaciones nuevas de WhatsApp entran solas en la primera, sin configurar nada.",
        placement: "bottom",
      },
      {
        target: "[data-tour=pipeline-columns]",
        title: "Arrastra para avanzar",
        body: "Mueve una tarjeta a otra columna para cambiar de etapa. Ábrela para ver el valor, el vendedor y las etiquetas, o pulsa el icono de mensaje para ir a su chat.",
        placement: "top",
      },
      {
        target: "[data-tour=pipeline-new]",
        title: "Oportunidades a mano",
        body: "También puedes crear una oportunidad para un contacto que no vino por WhatsApp. Nace en la moneda de su país.",
        placement: "bottom",
      },
      {
        target: "[data-tour=pipeline-stages]",
        title: "Etapas y varios embudos",
        body: "Renombra etapas, cámbialas de orden o crea otro embudo (soporte, posventa) desde aquí.",
        placement: "bottom",
      },
    ],
  },
  {
    key: "agents",
    icon: "bot",
    name: "Agentes IA",
    href: "/agentes",
    matches: (p) => p === "/agentes",
    steps: [
      {
        target: "[data-tour=agents-list]",
        title: "Tus agentes",
        body: "Uno para todos los números o uno por número. El agente por defecto atiende los números que no tienen uno propio.",
        placement: "right",
      },
      {
        target: "[data-tour=agents-wizard]",
        title: "Con ayuda",
        body: "¿Primera vez? Cinco preguntas y el agente queda armado: qué vendes, su misión, qué puede hacer y cuándo te avisa.",
        placement: "bottom",
      },
      {
        target: "[data-tour=agents-editor]",
        title: "Instrucciones",
        body: "Aquí vive su personalidad: qué vende, cómo habla, qué no debe hacer y cuándo pasa la conversación a una persona.",
        placement: "left",
      },
      {
        target: "[data-tour=agents-assist]",
        title: "Asistente de redacción",
        body: "¿No sabes por dónde empezar? Pídele que escriba las instrucciones a partir de tu negocio y ajústalas a tu gusto.",
        placement: "bottom",
      },
      {
        target: "[data-tour=agents-try]",
        title: "Pruébalo antes",
        body: "Habla con tu agente como si fueras un cliente. Verás qué herramientas usa y cuándo escala, sin enviar nada real.",
        placement: "bottom",
      },
    ],
  },
  {
    key: "products",
    icon: "tag",
    name: "Productos",
    href: "/products",
    matches: (p) => p === "/products",
    steps: [
      {
        target: "[data-tour=products-new]",
        title: "Tu catálogo",
        body: "Añade productos con precio, moneda, foto y descripción. El agente los consulta para cotizar y puede enviar la foto al cliente.",
        placement: "bottom",
      },
      {
        target: "[data-tour=products-import]",
        title: "Importa en bloque",
        body: "¿Tienes el catálogo en Excel? Guárdalo como CSV e impórtalo aquí. Admite columnas de precio por moneda, como precio_MXN.",
        placement: "bottom",
      },
      {
        target: "[data-tour=products-connect]",
        title: "Conecta tu tienda",
        body: "¿Vendes en WooCommerce o Shopify, o llevas el catálogo en una hoja de Google? Conéctalo y Driony lo lee solo cada hora: precios, fotos, stock y variantes.",
        placement: "bottom",
      },
      {
        target: "[data-tour=products-grid]",
        title: "Todo en tarjetas",
        body: "Pulsa una tarjeta para editarla. Los productos inactivos siguen aquí, pero el agente no los ofrece.",
        placement: "top",
      },
    ],
  },
  {
    key: "whatsapp",
    icon: "whatsapp",
    name: "WhatsApp",
    href: "/whatsapp",
    matches: (p) => p === "/whatsapp",
    steps: [
      {
        target: "[data-tour=wa-connect]",
        title: "Conectar un número",
        body: "Meta abre su ventana: eliges la cuenta de empresa y el número. Puedes conectar varios; cada uno con su agente y su embudo.",
        placement: "bottom",
      },
      {
        target: "[data-tour=wa-manual]",
        title: "¿Tienes tu propia app de Meta?",
        body: "Añade el número a mano con el Phone number ID y el token. Trabaja en modo API: las respuestas salen solo desde Driony.",
        placement: "top",
      },
    ],
  },
];

export const tourForPath = (pathname: string): TourDef | undefined =>
  TOURS.find((t) => t.matches(pathname));

export const TOUR_BY_KEY: Record<TourKey, TourDef> = Object.fromEntries(
  TOURS.map((t) => [t.key, t]),
) as Record<TourKey, TourDef>;

/** Nombre del evento con el que cualquier pantalla pide abrir un tour. */
export const TOUR_EVENT = "driony:tour";
/** Al navegar a otra pantalla para ver su tour, se deja la clave aquí. */
export const TOUR_FORCE_KEY = "driony:tour:force";

export function requestTour(key: TourKey): void {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { key } }));
}
