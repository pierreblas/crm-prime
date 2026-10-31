import type { PromptAssistantRequest, PromptAssistantTarget } from "@crm/shared";

// Parte pura del asistente de redacción: sin Nest ni Prisma, para poder
// probarla sin base de datos. El servicio solo carga el contexto y llama al
// modelo.

export interface PromptContext {
  orgName: string | null;
  products: {
    total: number;
    sample: { name: string; price: string }[];
    /** Campos propios que el agente ve de cada producto (con su unidad). */
    fields: string[];
    /** Campos propios apagados para la IA: no los puede citar. */
    hiddenFields: string[];
    /** Monedas en que hay precios (la base y las adicionales). */
    currencies: string[];
    /** Productos con foto (el agente la puede enviar con send_product_image). */
    withImage: number;
  };
  knowledge: { total: number; titles: string[] };
  stages: string[];
  tags: string[];
  sellers: number;
  tools: {
    name: string;
    description: string;
    enabled: boolean;
    unavailable: string | null;
  }[];
}

export const EMPTY_PROMPT_CONTEXT: PromptContext = {
  orgName: null,
  products: { total: 0, sample: [], fields: [], hiddenFields: [], currencies: [], withImage: 0 },
  knowledge: { total: 0, titles: [] },
  stages: [],
  tags: [],
  sellers: 0,
  tools: [],
};

/** Cómo se llama cada campo de cara al modelo y qué forma debe tener. */
export const TARGET_META: Record<PromptAssistantTarget, { label: string; rules: string }> = {
  systemPrompt: {
    label: "Instrucciones del agente (system prompt)",
    rules: `## Cómo es un buen system prompt para vender por WhatsApp
Estructura recomendada, con títulos cortos en mayúsculas (sin markdown pesado):
1. ROL E IDENTIDAD: nombre del agente, negocio, qué vende y a quién.
2. OBJETIVO DE LA CONVERSACIÓN: qué debe conseguir (vender, calificar y agendar, resolver dudas)
   y los pasos: saludar → entender la necesidad → recomendar → cerrar, agendar o derivar.
3. TONO Y FORMATO PARA WHATSAPP: mensajes cortos (1 a 3 frases, máximo 4 líneas), una sola
   pregunta por mensaje, sin listas largas ni markdown (WhatsApp no lo muestra), emojis con
   moderación, tuteo o usted según el negocio.
4. INFORMACIÓN DEL NEGOCIO: horarios, cobertura, medios de pago, envíos, políticas. Solo lo
   que se sepa: donde falte, deja un marcador entre corchetes como [HORARIO] para que lo
   rellene el dueño. Nunca inventes datos.
5. HERRAMIENTAS: cuándo usar cada herramienta habilitada, por su nombre exacto (por ejemplo
   "antes de dar un precio usa search_products"). No menciones herramientas no habilitadas.
6. LÍMITES: no inventar precios, stock ni promociones; no prometer plazos que no consten; no
   pedir datos sensibles; no hablar mal de la competencia; no salirse del tema del negocio.
7. CUÁNDO PASAR A UNA PERSONA: reclamos, cuando el cliente pide hablar con alguien, casos fuera
   de alcance. Si handoff_to_human está habilitada, indica que la use.
8. EJEMPLOS: dos o tres pares breves "Cliente: … / Agente: …" que enseñen el tono.

Reglas del texto:
- Usa esos títulos en mayúsculas, en ese orden, cada uno seguido de su contenido: así el
  dueño del negocio encuentra y edita cada parte sin releerlo todo.
- Va dirigido al agente en segunda persona ("Eres…", "Cuando el cliente…").
- Entre 250 y 700 palabras normalmente; más largo solo si el negocio lo pide.
- Usa la información real del negocio que tienes abajo. Lo que no esté, marcador o pregunta.
- Si ya hay un texto actual, mejóralo respetando lo que el usuario decidió, salvo que te pida
  cambiarlo.`,
  },
  welcomeMessage: {
    label: "Mensaje de bienvenida (se envía solo al primer mensaje del cliente)",
    rules: `## Cómo es un buen mensaje de bienvenida
- Un solo mensaje, de 1 a 3 frases y menos de 300 caracteres.
- Dice quién responde (negocio o agente), agradece y pide lo mínimo para ayudar (qué busca).
- Sin marcadores entre corchetes ni variables: se envía tal cual.
- Cálido pero directo; un emoji como mucho.`,
  },
  outOfHoursMessage: {
    label: "Mensaje fuera de horario",
    rules: `## Cómo es un buen mensaje fuera de horario
- Un solo mensaje, menos de 300 caracteres.
- Dice que ahora no atienden, cuándo responderán y qué puede dejar escrito el cliente
  mientras tanto (qué necesita, su nombre).
- Sin marcadores entre corchetes salvo que no sepas el horario: entonces usa [HORARIO].`,
  },
  quickReply: {
    label: "Respuesta rápida (la envía una persona del equipo con un clic)",
    rules: `## Cómo es una buena respuesta rápida
- Texto listo para enviar tal cual por WhatsApp, corto y con el tono del negocio.
- Sin markdown. Puede terminar con una pregunta que haga avanzar la venta.`,
  },
  free: {
    label: "Texto libre",
    rules: `## Redacción libre
- Escribe exactamente lo que te pidan: guion de ventas, mensaje de seguimiento, plantilla,
  descripción de producto, respuesta a una objeción, etc.
- Si es para WhatsApp: corto, sin markdown, una idea por mensaje.
- Si es un guion o una lista de mensajes, sepáralos con líneas en blanco.`,
  },
};

// ── System prompt del asistente ─────────────────────────────
export function buildSystem(ctx: PromptContext, target: PromptAssistantTarget): string {
  const meta = TARGET_META[target];
  const negocio = ctx.orgName ? ` Trabajas para el negocio "${ctx.orgName}".` : "";

  return `Eres un experto en redactar instrucciones y mensajes para agentes de IA que atienden
clientes por WhatsApp en nombre de un negocio.${negocio} Escribes en español (salvo que te
pidan otro idioma), de forma directa y concreta, sin relleno ni frases genéricas.

Campo que estás redactando: ${meta.label}.

${meta.rules}

## Cómo trabajar con el usuario
- Si falta lo esencial (por ejemplo, qué vende el negocio), pregunta lo mínimo (máximo 3
  preguntas cortas) y deja "proposal" en null. Si ya tienes lo mínimo, propón un borrador
  completo y en "message" di en una o dos frases qué te faltó y qué asumiste.
- Cuando el usuario pida un ajuste ("más corto", "más formal", "quita X"), devuelve SIEMPRE
  el texto completo resultante, no solo el trozo cambiado.
- Si el usuario solo pregunta algo (por ejemplo, qué es un system prompt), responde en
  "message" y deja "proposal" en null.

${buildContextBlock(ctx)}

## Formato de salida
Responde ÚNICAMENTE con un objeto JSON, sin texto alrededor ni vallas de código:
{
  "message": "explicación breve en español, o tus preguntas si falta información",
  "proposal": "texto completo propuesto para el campo, o null"
}
Dentro de "proposal" usa saltos de línea reales (\\n) y nunca vallas de código.`;
}

function buildContextBlock(ctx: PromptContext): string {
  const lines: string[] = ["## Datos reales del negocio (úsalos; no inventes otros)"];

  if (ctx.products.total > 0) {
    const p = ctx.products;
    const sample = p.sample.map((x) => `${x.name} (${x.price})`).join(", ");
    lines.push(`Catálogo: ${p.total} producto(s) activo(s). Ejemplos: ${sample}.`);
    lines.push(
      `Datos de cada producto que el agente obtiene con search_products: nombre, precio, descripción y SKU` +
        (p.fields.length ? `, y además: ${p.fields.join(", ")}` : "") +
        ". En las instrucciones pide consultarlos y citarlos (p. ej. «dale la fecha de inicio y el horario que trae el producto»);" +
        " NUNCA copies esos valores ni dejes marcadores como [Precio] o [Horario] para esos datos: cambian y el agente los lee al momento.",
    );
    if (p.currencies.length > 1) {
      lines.push(`Hay precios en varias monedas (${p.currencies.join(", ")}): search_products da el de la moneda del cliente si existe.`);
    }
    if (p.withImage > 0) {
      lines.push(`${p.withImage} producto(s) tienen foto: el agente puede enviarla con send_product_image (solo si está habilitada).`);
    }
    if (p.hiddenFields.length) {
      lines.push(`Campos del catálogo que el agente NO ve (apagados para la IA): ${p.hiddenFields.join(", ")}. No le pidas usarlos.`);
    }
  } else {
    lines.push("Catálogo: sin productos cargados todavía.");
  }

  if (ctx.knowledge.total > 0) {
    lines.push(
      `Base de conocimiento: ${ctx.knowledge.total} documento(s): ${ctx.knowledge.titles
        .map((t) => `"${t}"`)
        .join(", ")}.`,
    );
  } else {
    lines.push("Base de conocimiento: vacía.");
  }

  lines.push(
    ctx.stages.length
      ? `Etapas del embudo de ventas: ${ctx.stages.join(" → ")}.`
      : "Embudo de ventas: sin etapas.",
  );
  lines.push(
    ctx.tags.length ? `Etiquetas existentes: ${ctx.tags.join(", ")}.` : "Etiquetas: ninguna.",
  );
  lines.push(`Vendedores humanos activos: ${ctx.sellers}.`);

  const enabled = ctx.tools.filter((t) => t.enabled);
  const disabled = ctx.tools.filter((t) => !t.enabled);
  if (enabled.length) {
    lines.push("Herramientas HABILITADAS en este agente (puedes citarlas por su nombre):");
    for (const t of enabled) {
      lines.push(
        `  - ${t.name}: ${t.description}${t.unavailable ? ` (aviso: ${t.unavailable})` : ""}`,
      );
    }
  } else {
    lines.push("Herramientas habilitadas en este agente: ninguna.");
  }
  if (disabled.length) {
    lines.push(
      `Herramientas que existen pero NO están habilitadas (no las menciones en el texto): ${disabled
        .map((t) => t.name)
        .join(", ")}.`,
    );
  }
  return lines.join("\n");
}

// ── Turno del usuario ───────────────────────────────────────
export function buildUserTurn(input: PromptAssistantRequest): string {
  const meta = TARGET_META[input.target];
  const parts: string[] = [];
  parts.push(`Campo: ${meta.label}${input.botName ? ` · Agente: "${input.botName}"` : ""}.`);
  const current = input.current.trim();
  if (current) {
    parts.push(
      `Texto actual del campo (mejóralo o cámbialo según la petición):\n"""\n${current}\n"""`,
    );
  } else {
    parts.push("El campo está vacío.");
  }
  parts.push(`Petición: ${input.prompt.trim()}`);
  return parts.join("\n\n");
}

// ── Parseo de la respuesta ──────────────────────────────────
export interface ParsedReply {
  message: string;
  proposal: string | null;
}

/**
 * Los modelos a veces envuelven el JSON en ```json o le añaden prosa. Si no
 * hay JSON, un texto largo se toma como propuesta (el modelo escribió el
 * prompt directamente) y uno corto como respuesta conversacional.
 */
export function parseReply(raw: string): ParsedReply {
  const text = raw.trim();
  const json = parseLooseJson(text);
  if (json) {
    const message =
      typeof json.message === "string" && json.message.trim() ? json.message.trim() : "Listo.";
    const proposal =
      typeof json.proposal === "string" && json.proposal.trim()
        ? stripFences(json.proposal)
        : null;
    return { message, proposal };
  }
  if (!text) {
    return {
      message:
        "El modelo no devolvió una respuesta utilizable. Intenta describir mejor lo que necesitas.",
      proposal: null,
    };
  }
  if (text.length > 400) {
    return {
      message:
        "Aquí tienes el texto propuesto (el modelo no respetó el formato, así que lo muestro tal cual).",
      proposal: stripFences(text),
    };
  }
  return { message: text, proposal: null };
}

export function parseLooseJson(raw: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1]);
  candidates.push(raw);
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const c of candidates) {
    // Segundo intento con los saltos de línea crudos escapados: los modelos
    // a veces escriben el texto propuesto con saltos reales dentro del JSON.
    for (const attempt of [c.trim(), escapeRawNewlines(c.trim())]) {
      try {
        const parsed = JSON.parse(attempt) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // siguiente intento
      }
    }
  }
  return null;
}

/** Escapa saltos de línea y tabuladores crudos dentro de cadenas JSON. */
function escapeRawNewlines(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      out += ch + (s[i + 1] ?? "");
      i++;
    } else if (ch === '"') {
      inString = false;
      out += ch;
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      // se descarta: el \n que le sigue ya se escapa
    } else if (ch === "\t") {
      out += "\\t";
    } else {
      out += ch;
    }
  }
  return out;
}

function stripFences(s: string): string {
  const m = s.trim().match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  return (m ? m[1]! : s).trim();
}

// ── Plantilla sin modelo ────────────────────────────────────
/**
 * Cuando no hay API key, el proveedor simulado no sabe redactar. En vez de
 * devolver un texto de mentira se entrega una plantilla honesta que el
 * usuario puede rellenar, y se le dice cómo activar el asistente de verdad.
 */
export function fallbackTemplate(
  target: PromptAssistantTarget,
  ctx: PromptContext,
  input: PromptAssistantRequest,
): ParsedReply {
  const message =
    "No hay una API key configurada, así que no puedo redactar con IA. Configúrala en Ajustes › Inteligencia Artificial y vuelve a intentarlo. Mientras tanto, aquí tienes una plantilla para rellenar.";
  const negocio = ctx.orgName ?? "[NOMBRE DEL NEGOCIO]";
  const agente = input.botName?.trim() || "[NOMBRE DEL AGENTE]";
  const tools = ctx.tools.filter((t) => t.enabled).map((t) => t.name);
  const has = (n: string) => tools.includes(n);

  switch (target) {
    case "welcomeMessage":
      return {
        message,
        proposal: `¡Hola! 👋 Gracias por escribir a ${negocio}. Soy ${agente}. Cuéntame qué estás buscando y te ayudo enseguida.`,
      };
    case "outOfHoursMessage":
      return {
        message,
        proposal: `¡Gracias por escribir a ${negocio}! Ahora mismo estamos fuera de horario. Atendemos [HORARIO]. Déjanos tu nombre y qué necesitas y te respondemos en cuanto abramos.`,
      };
    case "quickReply":
      return {
        message,
        proposal: `¡Hola! Gracias por tu interés en ${negocio}. Te confirmo: [DETALLE]. ¿Te gustaría que avancemos con [SIGUIENTE PASO]?`,
      };
    case "free":
      return { message, proposal: null };
    case "systemPrompt":
    default: {
      const lines: (string | null)[] = [
        "ROL E IDENTIDAD",
        `Eres ${agente}, el asistente de ventas de ${negocio} por WhatsApp. Vendes [QUÉ VENDES] a [A QUIÉN]. Tu prioridad es ayudar de verdad y llevar la conversación hacia [OBJETIVO: la compra / agendar una visita / dejar sus datos].`,
        "",
        "OBJETIVO DE LA CONVERSACIÓN",
        "1. Saluda y pregunta qué necesita.",
        "2. Entiende su caso con una pregunta a la vez (qué busca, para cuándo, presupuesto).",
        "3. Recomienda la opción que mejor encaja y explica por qué en una o dos frases.",
        "4. Cierra: propón el siguiente paso concreto ([pagar / agendar / dejar datos]).",
        "",
        "TONO Y FORMATO",
        "Habla en español, de tú, cercano y profesional. Mensajes cortos: una a tres frases, máximo cuatro líneas. Una sola pregunta por mensaje. Sin listas largas ni formato markdown (WhatsApp no lo muestra). Un emoji como mucho por mensaje.",
        "",
        "INFORMACIÓN DEL NEGOCIO",
        "Horario: [HORARIO]. Cobertura o envíos: [ZONAS Y PLAZOS]. Medios de pago: [MEDIOS DE PAGO]. Políticas: [CAMBIOS, GARANTÍA, DEVOLUCIONES].",
        "",
        "HERRAMIENTAS",
        has("search_products")
          ? "Antes de dar un precio, disponibilidad o características usa search_products. Nunca inventes precios."
          : "Nunca inventes precios ni disponibilidad: si no lo sabes, dilo y ofrece consultarlo.",
        has("search_knowledge")
          ? "Para condiciones, políticas o preguntas frecuentes consulta search_knowledge."
          : null,
        has("search_contact")
          ? "Al empezar, revisa la ficha del contacto con search_contact para no volver a pedir datos que ya tenemos."
          : null,
        "",
        "LÍMITES",
        "No prometas plazos, descuentos ni stock que no consten. No pidas datos sensibles (contraseñas, tarjetas). No hables de la competencia. Si te preguntan algo ajeno al negocio, redirige con amabilidad.",
        "",
        "CUÁNDO PASAR A UNA PERSONA",
        has("handoff_to_human")
          ? "Si el cliente pide hablar con alguien, presenta un reclamo o el caso se sale de lo anterior, usa handoff_to_human y avísale de que una persona seguirá la conversación."
          : "Si el cliente pide hablar con alguien, presenta un reclamo o el caso se sale de lo anterior, díselo con claridad y deja que una persona siga la conversación.",
        "",
        "EJEMPLOS",
        "Cliente: Hola, ¿tienen [PRODUCTO]?",
        "Agente: ¡Hola! Sí, tenemos [PRODUCTO]. ¿Lo buscas para [USO A] o para [USO B]? Así te recomiendo el que mejor te va.",
        "Cliente: ¿Cuánto cuesta?",
        "Agente: [PRECIO REAL DEL CATÁLOGO]. Incluye [QUÉ INCLUYE]. ¿Te lo reservo?",
      ];
      return {
        message,
        proposal: lines.filter((l): l is string => l !== null).join("\n"),
      };
    }
  }
}
