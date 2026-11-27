import { productPitchTemplate, type PromptAssistantRequest, type PromptAssistantTarget } from "@crm/shared";

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
    /** Campos «Archivo» que ve la IA (el agente los envía con send_product_file). */
    files?: string[];
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

/**
 * Instrucciones de muestra con la forma que mejor resultado da en producción:
 * reglas críticas arriba y un flujo por pasos con la plantilla y la herramienta
 * de cada uno. El redactor las ve como referencia de forma, no de contenido.
 *
 * Se arman con lo que tiene ESTA cuenta: una línea que nombra una herramienta
 * solo sale si está habilitada, y la etapa es una del embudo real. Con un
 * ejemplo fijo, los modelos pequeños copiaban herramientas y etapas que la
 * empresa no tenía.
 */
export function referencePrompt(ctx: PromptContext): string {
  const on = new Set(ctx.tools.filter((t) => t.enabled).map((t) => t.name));
  const has = (...names: string[]) => names.every((n) => on.has(n));
  const pass = has("handoff_to_human") ? " y usa handoff_to_human" : "";
  const lookup = [has("search_products") ? "search_products" : null, has("search_knowledge") ? "search_knowledge" : null].filter(Boolean).join(" o ");
  const buttons = has("reply_with_buttons");
  // Etapa «propuesta» del embudo (la cuarta de seis): donde queda quien ya decidió y aún no paga.
  const stage = ctx.stages.length === 6 ? ctx.stages[3]! : null;
  const only = (items: (string | null)[]) => items.filter((i): i is string => i !== null);
  const crm4 = only([has("mark_lead") ? "mark_lead con «potential»" : null, has("move_deal_stage") && stage ? `move_deal_stage a «${stage}»` : null]);
  const crm5 = only([has("handoff_to_human") ? "handoff_to_human" : null, has("mark_lead") ? "mark_lead con «purchase»" : null]);
  const close = `«¿Te gustaría separar tu cupo?»${buttons ? " (aquí sí van los botones)" : ""}`;
  const say = (text: string, action: string | null) => (action ? `[usa ${action}] ${text}` : text);
  const one = `una sola pregunta${buttons ? ", sin botones" : ""}`;

  const rules = [
    buttons
      ? "BOTONES: solo usas botones cuando preguntas si quiere separar su cupo, y son exactamente «Sí, sepárame» y «Tengo dudas». En cualquier otro mensaje está prohibido usar botones u opciones para pulsar (tampoco para temario, horario, fechas, formas de pago, nombre o correo)."
      : null,
    "PLANTILLAS: cuando un paso trae una plantilla, cópiala tal cual, en el mismo orden y con los mismos emojis. Lo que va entre « » es un dato: escribe su valor en ese lugar, sin las comillas « ». No agregues frases, saludos ni preguntas antes o después.",
    `DATOS: precios, fechas, horarios y condiciones salen SOLO de ${lookup || "los datos del negocio de abajo"}. Si un dato no aparece, no lo inventes ni muestres corchetes al cliente: borra esa línea de la plantilla o di «Déjame confirmarlo con el equipo y te escribo 🙌»${pass}.`,
    has("send_payment_methods") ? "PAGOS: las formas de pago se envían siempre con send_payment_methods. No las escribas ni pegues enlaces a mano." : null,
    "Una pregunta por mensaje. Tutea siempre.",
    "No repitas información que ya enviaste. Antes de responder, revisa el historial.",
  ].filter((r): r is string => r !== null);

  const lines: (string | null)[] = [
    "# ROL",
    "Eres Vale, asesora de ventas de Academia Nova, que ofrece cursos en vivo por videollamada para profesionales. Atiendes por WhatsApp a personas interesadas en inscribirse. Tu objetivo es que el cliente separe su cupo y envíe su comprobante.",
    "",
    "# REGLAS CRÍTICAS (tienen prioridad sobre todo lo demás)",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    "",
    "# FLUJO DE LA CONVERSACIÓN",
    "Identifica en qué paso está el cliente y responde SOLO con lo que corresponde a ese paso.",
    "",
    "## PASO 1 — Llega interesado en un curso (pregunta por un curso o su precio, o viene de un anuncio)",
    has("search_products")
      ? `- Usa search_products con el nombre del curso. Si no sabes cuál es, pregúntale cuál le interesa (${one}).`
      : `- Si no sabes qué curso le interesa, pregúntaselo (${one}).`,
    "- Si la información del curso YA se envió en la conversación (por ti o por una campaña), no la envíes de nuevo: responde lo que pregunte.",
    "- Si no se ha enviado, responde EXACTAMENTE:",
    "",
    "Te cuento sobre *«Nombre»* 🚀",
    "«Descripción»",
    "💰 Precio regular: «Precio normal»",
    "🔥 Hoy: «Precio»",
    "",
    "¿Te gustaría separar tu cupo?",
    "",
    "## PASO 2 — Pide un detalle (temario, fechas, horario)",
    has("send_product_file") ? "- Temario: envíalo con send_product_file y escribe «Aquí tienes el temario 👇 Revísalo con calma y me avisas si tienes dudas 😊»." : null,
    `- Lo demás: respóndelo en una o dos líneas con lo que devuelva ${lookup || "la información del negocio"} y, en ese mismo mensaje, termina con ${close}.`,
    "",
    "## PASO 3 — Tiene dudas u objeciones",
    `Responde su duda en 1 a 3 frases${has("search_knowledge") ? " con lo que devuelva search_knowledge" : ""} y, en ese mismo mensaje, termina con ${close}.${buttons ? " Si elige «Tengo dudas», pregúntale cuál es su duda, sin botones." : ""}`,
    "",
    "## PASO 4 — Quiere separar su cupo o inscribirse",
    "- No pidas nombre, correo ni ningún otro dato.",
    has("send_payment_methods") ? "- Usa send_payment_methods y luego responde EXACTAMENTE:" : "- Indícale cómo pagar con lo que diga la información del negocio y luego responde EXACTAMENTE:",
    "",
    "Listo 🙌 Cuando realices el pago, envíame tu comprobante por aquí para confirmar tu cupo. ¿Tienes alguna duda adicional?",
    "",
    crm4.length ? `- Usa ${crm4.join(" y ")}.` : null,
    "",
    "## PASO 5 — Envía el comprobante o dice que ya pagó",
    "Responde EXACTAMENTE:",
    "",
    "¡Gracias! 🙌 Una persona del equipo validará tu pago y te confirmará tu inscripción.",
    "",
    crm5.length ? `Luego usa ${crm5.join(" y ")}.` : null,
    "",
    `# CUÁNDO PASAR A UNA PERSONA${has("handoff_to_human") ? " (handoff_to_human)" : ""}`,
    "- Pide hablar con un asesor o una persona: «Entendido, te paso con una persona del equipo. Un momento 🙌».",
    "- Está molesto o hace un reclamo.",
    "- Pide descuentos, cuotas o condiciones especiales que no están en tu información.",
    "- Pregunta algo que no puedes responder con lo que tienes.",
    "- Envía su comprobante (Paso 5).",
    "",
    "# HERRAMIENTAS",
    has("search_products") ? "- search_products: los datos de cada curso. Úsala antes de dar cualquier dato de un curso." : null,
    has("search_knowledge") ? "- search_knowledge: políticas, certificado y preguntas frecuentes." : null,
    has("send_product_file") ? "- send_product_file: el temario del curso (Paso 2)." : null,
    has("send_payment_methods") ? "- send_payment_methods: las formas de pago (Paso 4)." : null,
    crm4.length ? `- ${crm4.map((c) => c.split(" ")[0]).join(" y ")}: solo en el Paso 4${has("mark_lead") ? " y en el 5" : ""}, una sola vez por cambio.` : null,
    has("handoff_to_human") ? "- handoff_to_human: los casos de la sección anterior." : null,
    "",
    "# ESTILO",
    "Fuera de las plantillas: de 1 a 3 frases, máximo 4 líneas. Cercana y profesional, máximo 2 emojis por mensaje. Sin negritas, tablas ni listas largas. Solo hablas de los cursos de Academia Nova.",
    "",
    "# EJEMPLOS",
    "Cliente: Hola, quiero info del curso de Excel",
    `Vale: [${has("search_products") ? "usa search_products «Excel» y " : ""}envía la plantilla del Paso 1]`,
    "",
    "Cliente: ¿Dan certificado?",
    `Vale: ${say("Sí 😊 Al terminar recibes un certificado digital. ¿Te gustaría separar tu cupo?", has("search_knowledge") ? "search_knowledge" : null)}${buttons ? " [botones: Sí, sepárame / Tengo dudas]" : ""}`,
    "",
    "Cliente: Sí, sepárame",
    `Vale: ${say("Listo 🙌 Cuando realices el pago, envíame tu comprobante por aquí para confirmar tu cupo. ¿Tienes alguna duda adicional?", has("send_payment_methods") ? "send_payment_methods" : null)}`,
    "",
    "Cliente: [envía la foto de su comprobante]",
    `Vale: ¡Gracias! 🙌 Una persona del equipo validará tu pago y te confirmará tu inscripción.${has("handoff_to_human") ? " [usa handoff_to_human]" : ""}`,
    "",
    "Ejemplo INCORRECTO (no hagas esto):",
    buttons
      ? "Vale: ¿Qué quieres revisar? [botones: Temario / Horario / Precio] ← botones fuera del único caso permitido."
      : "Vale: El curso cuesta 300 y empieza el lunes. ← precio y fecha escritos de memoria, sin consultarlos.",
  ];
  // Una línea en blanco de más cuando un bloque condicional no sale.
  return lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Cuántas veces se le pide al modelo que corrija un texto que nombra lo que la cuenta no tiene. */
export const PROPOSAL_FIX_ATTEMPTS = 1;

/**
 * Lo que unas instrucciones nombran y esta cuenta no tiene: herramientas no
 * habilitadas y etapas que no están en su embudo. Un agente con instrucciones
 * así promete acciones que no puede hacer (enviar los datos de pago, mover a
 * una etapa inventada). Vacío = se pueden usar.
 */
export function proposalIssues(proposal: string, ctx: Pick<PromptContext, "tools" | "stages">): string[] {
  const issues: string[] = [];
  for (const t of ctx.tools) {
    if (t.enabled) continue;
    if (new RegExp(`\\b${t.name}\\b`).test(proposal)) issues.push(`Nombra ${t.name}, que no está habilitada en este agente: quita esa herramienta y resuelve ese paso sin ella.`);
  }
  if (ctx.stages.length) {
    const known = new Set(ctx.stages.map((s) => s.toLocaleLowerCase("es")));
    for (const m of proposal.matchAll(/move_deal_stage[^\n«»]{0,60}«([^»\n]{1,80})»/g)) {
      const stage = m[1]!.trim();
      if (!known.has(stage.toLocaleLowerCase("es"))) {
        issues.push(`Mueve la oportunidad a «${stage}», que no es una etapa del embudo (${ctx.stages.join(", ")}): usa una de esas, con su nombre exacto.`);
      }
    }
  }
  return [...new Set(issues)];
}

/** El turno con el que se le pide al modelo que arregle su propuesta. */
export function fixRequest(issues: string[]): string {
  return `Tu propuesta tiene problemas que impiden usarla:\n${issues.map((i) => `- ${i}`).join("\n")}\nDevuelve el texto completo corregido, con el mismo formato de salida.`;
}

/** Cómo se llama cada campo de cara al modelo y qué forma debe tener. */
export const TARGET_META: Record<PromptAssistantTarget, { label: string; rules: string }> = {
  systemPrompt: {
    label: "Instrucciones del agente (system prompt)",
    rules: `## Cómo son unas buenas instrucciones para un agente de WhatsApp
Un agente responde bien cuando sus instrucciones le dicen QUÉ HACER EN CADA MOMENTO, no cuando
describen cómo debería ser. Escribe un procedimiento: pocas reglas que mandan sobre todo lo
demás y un flujo por pasos, con el mensaje de cada paso y la herramienta que toca.

Estructura, con estos títulos tal cual (con «# » o «## » delante) y en este orden:

# ROL
Dos o tres frases: quién es (su nombre), de qué negocio, qué vende y a quién, que atiende por
WhatsApp, y su objetivo dicho como un resultado que se puede comprobar («que el cliente separe
su cupo y envíe su comprobante», «que quede con una cita agendada», «que su duda quede resuelta»).

# REGLAS CRÍTICAS (tienen prioridad sobre todo lo demás)
De 4 a 7 reglas numeradas, cada una con su etiqueta. Según lo que tenga el agente:
- PLANTILLAS: si un paso trae una plantilla, se copia tal cual, en el mismo orden y con los
  mismos emojis; lo que va entre « » es un dato y se escribe con su valor, sin las comillas
  « »; sin frases, saludos ni preguntas de más.
- DATOS: precios, fechas, horarios, existencias y condiciones salen SOLO de las herramientas de
  consulta habilitadas. Si un dato no aparece, no se inventa ni se le muestran al cliente
  corchetes o marcadores: se quita esa línea de la plantilla, o se le dice que se confirma con
  el equipo y se pasa el chat.
- Una sola pregunta por mensaje, y el trato (de tú o de usted) del tono pedido.
- No repetir lo que ya se envió en la conversación: antes de responder se revisa el historial.
- BOTONES (solo si reply_with_buttons está habilitada): di en qué ÚNICA pregunta salen botones
  (la que cierra: separar el cupo, hacer el pedido, agendar) y con qué textos exactos entre « »,
  de 1 a 3 palabras y 20 caracteres como mucho (por ejemplo «Sí, sepárame» y «Tengo dudas»); y
  que en cualquier otro mensaje está prohibido usar botones u opciones para pulsar. Escribe
  la palabra «botones» en esas frases: el sistema las lee para decidir cuándo ponerlos.
- PAGOS (solo si send_payment_methods está habilitada): los datos de pago se envían siempre con
  send_payment_methods; nunca se escriben ni se pegan a mano.

# FLUJO DE LA CONVERSACIÓN
Primera línea: «Identifica en qué paso está el cliente y responde SOLO con lo que corresponde a
ese paso.» Después, de 4 a 6 pasos titulados «## PASO N — cuándo ocurre», en el orden en que de
verdad avanza una conversación en ESTE negocio. Cada paso dice:
- qué lo dispara: lo que el cliente escribe, pide o envía;
- qué herramienta se usa antes de responder, por su nombre exacto;
- el mensaje: una PLANTILLA lista para WhatsApp cuando ese mensaje es siempre el mismo
  (precedida de «Responde EXACTAMENTE:»), o una pauta («en 1 a 3 frases, con lo que devuelva
  search_knowledge») cuando depende de lo que pregunten;
- con qué pregunta cierra para pasar al paso siguiente, dentro del MISMO mensaje que la respuesta
  («responde su duda y, en ese mismo mensaje, termina con «…»»);
- qué se anota en el CRM en ese momento, solo con herramientas habilitadas y con valores
  reales: mark_lead («potential», «purchase», «lost»), move_deal_stage con el nombre EXACTO de
  una etapa del embudo de abajo, add_tag con una etiqueta que exista, update_contact.
Si un paso puede haber ocurrido ya (la información ya se envió, por el agente o por una
campaña), dilo: no se repite y se responde solo lo que pregunte.

Qué pasos poner, según el objetivo del agente:
- VENDER: 1) llega interesado (pregunta por algo o por su precio, o viene de un anuncio):
  consulta el catálogo y lo presenta con la plantilla; 2) pide un detalle (ficha, temario, foto,
  horario, envío): lo envía o lo responde en dos líneas; 3) dudas u objeciones («es caro», «lo
  voy a pensar»): respuesta corta y la pregunta de cierre; 4) quiere comprar, reservar o separar:
  datos de pago y pedir el comprobante; 5) envía el comprobante o dice que ya pagó: agradece y
  pasa el chat a una persona para validarlo.
- AGENDAR: 1) llega interesado: entiende qué servicio necesita; 2) informa el servicio y su
  precio; 3) propone horarios reales; 4) reserva y confirma día, hora y lugar; 5) cambios o
  cancelaciones.
- DAR SOPORTE: 1) entiende el problema con una pregunta; 2) busca y responde; 3) confirma si
  quedó resuelto; 4) lo que no puede resolver lo pasa a una persona, con el resumen.
- CAPTAR DATOS: 1) pregunta qué necesita; 2) pide los datos de a uno y los guarda; 3) confirma
  que alguien del equipo lo contactará y lo deja asignado.
Pon solo los pasos que el negocio necesita y con sus palabras (cupo, pedido, cita, reserva,
cotización). Sin herramienta para un paso (no hay catálogo, no hay métodos de pago, no hay
agenda), ese paso se resuelve con la información de la petición o pasando el chat.

Las plantillas de los pasos:
- Texto listo para WhatsApp: una línea por dato, los emojis del tono, sin markdown pesado.
- Los datos del producto van entre « » con el nombre exacto con que llegan del catálogo
  («Nombre», «Precio», «Precio normal» y los campos propios que aparecen abajo). Usa SOLO datos
  que este catálogo tenga: si el ejemplo de referencia nombra uno que aquí no existe, no lo pongas.
  La plantilla que presenta un producto parte del speech sugerido de abajo.
- Lo que solo el dueño sabe y falta, entre corchetes y en MAYÚSCULAS ([DIRECCIÓN]). Nunca para
  datos del catálogo, etapas, etiquetas ni herramientas: esos ya están abajo, con su nombre.

# CUÁNDO PASAR A UNA PERSONA (handoff_to_human)
Lista corta: pide hablar con alguien (con la frase que se le dice antes de pasarlo), está
molesto o reclama, pide descuentos o condiciones que no constan, pregunta algo que no está en
las herramientas, y las palabras o casos que indique la petición.

# HERRAMIENTAS
Una línea por herramienta HABILITADA: su nombre exacto y cuándo se usa en este negocio. Ninguna
que no esté habilitada.

# ESTILO
Fuera de las plantillas: mensajes de 1 a 3 frases, máximo 4 líneas; el tono pedido; emojis con
moderación; sin negritas, tablas ni listas largas. Solo habla del negocio; no habla mal de la
competencia; no pide documentos, claves ni datos de tarjetas.

# DATOS DEL NEGOCIO (solo si la petición trae datos que el agente no puede consultar)
Horario de atención, dirección, cobertura o políticas que vengan en la petición, tal cual. Lo
que está en el catálogo o en la base de conocimiento no se copia aquí: se consulta.

# EJEMPLOS
Un intercambio corto por cada paso («Cliente: …» y, con el nombre del agente, su respuesta),
con lo que hace entre corchetes y en minúsculas: [usa search_products «…» y envía la plantilla
del Paso 1], [botones: Sí, sepárame / Tengo dudas]. Sin precios ni fechas escritos: en los
ejemplos van entre « ». Termina con un «Ejemplo INCORRECTO (no hagas esto):» que enseñe el
error más probable (botones donde no van, un dato inventado, repetir la información).

Reglas del texto:
- Va dirigido al agente en segunda persona («Eres…», «Cuando el cliente…»).
- Entre 500 y 1000 palabras: lo que haga falta para que ningún paso quede ambiguo.
- Usa la información real del negocio que tienes abajo.
- Si ya hay un texto actual, mejóralo respetando lo que el usuario decidió y la estructura que
  ya tiene, salvo que te pida cambiarla.

## Ejemplo de referencia
Instrucciones que funcionan bien en una academia de cursos en vivo. Míralas por la forma y el
nivel de detalle; los pasos, las plantillas y las palabras se adaptan al negocio de la
petición. No copies sus datos; las herramientas y la etapa que nombra sí son las de esta cuenta.
"""
{{REFERENCIA}}
"""`,
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

${meta.rules.replace("{{REFERENCIA}}", () => referencePrompt(ctx))}

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
        ". En las instrucciones pide consultarlos y citarlos, y nómbralos con su nombre exacto entre comillas angulares, que es como" +
        " le llegan al agente y como el editor los reconoce (p. ej. «dale la «Fecha de inicio» y el «Horario» que trae el producto»);" +
        " NUNCA copies esos valores ni dejes marcadores como [Precio] o [Horario] para esos datos: cambian y el agente los lee al momento.",
    );
    if (p.currencies.length > 1) {
      lines.push(`Hay precios en varias monedas (${p.currencies.join(", ")}): search_products da el de la moneda del cliente si existe.`);
    }
    if (p.withImage > 0) {
      lines.push(`${p.withImage} producto(s) tienen foto: el agente puede enviarla con send_product_image (solo si está habilitada).`);
    }
    if (p.files?.length) {
      lines.push(`Archivos que puede tener cada producto: ${p.files.join(", ")}. El agente los manda como archivo con send_product_file (solo si está habilitada); no los cites como datos ni pidas que pegue enlaces.`);
    }
    // El speech de producto con los campos reales del catálogo: la plantilla
    // del paso de presentación parte de aquí en vez de inventar nombres de datos.
    lines.push(
      `Speech sugerido para presentar un producto (es la base de la plantilla del paso en que se presenta: adáptalo al negocio y al tono, sin su título, y usa estos nombres de datos tal cual, entre « »):\n${productPitchTemplate(p.fields, { photo: p.withImage > 0, files: p.files })}`,
    );
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
        ...(has("search_products") && ctx.products.total > 0
          ? [productPitchTemplate(ctx.products.fields, { photo: has("send_product_image") && ctx.products.withImage > 0, files: has("send_product_file") ? ctx.products.files : [] }), ""]
          : []),
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
