import { REPLY_BUTTONS_TOOL, type AgentToolInfo } from "@crm/shared";
import type { LlmTool } from "./llm.types";

// Catálogo de herramientas de SOLO LECTURA: se ejecutan al instante.
export const TOOL_REGISTRY: Record<string, LlmTool> = {
  search_contact: {
    name: "search_contact",
    description:
      "Devuelve la información del contacto de esta conversación (nombre, teléfono, opt-in, último mensaje). Úsala si necesitas datos del cliente.",
    input_schema: { type: "object", properties: {} },
  },
  search_knowledge: {
    name: "search_knowledge",
    description:
      "Busca en la base de conocimiento del negocio (precios, políticas, FAQs). Úsala para responder con información verificada en vez de inventar.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Qué buscar" },
      },
      required: ["query"],
    },
  },
  search_products: {
    name: "search_products",
    description:
      "Consulta el catálogo de productos del negocio (nombre, precio, moneda, descripción, SKU y, en \"details\", sus características como talla, color o garantía). Busca por palabras sueltas, sin importar tildes ni mayúsculas, también en esas características; usa pocas palabras clave (ej. \"zapatilla running\"), no frases. Los precios ya vienen en la moneda del cliente cuando el producto la tiene; si un producto dice priceInClientCurrency=false, no hay precio en su moneda: da el precio tal cual viene (con su moneda) y no lo conviertas. Si la respuesta trae \"otherNames\", son productos que existen pero no vienen con detalle: si el que busca el cliente está ahí, vuelve a llamar con ese nombre. Úsala SIEMPRE que el cliente pregunte por precios, qué venden, o si tienen algo. Deja la consulta vacía para ver el catálogo. Nunca digas que algo no existe sin haberlo buscado por su nombre; nunca inventes precios ni productos.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Texto a buscar en nombre o descripción. Vacío = lista general.",
        },
      },
    },
  },
  handoff_to_human: {
    name: "handoff_to_human",
    description:
      "Escala la conversación a un agente humano. Úsala si no estás seguro, el cliente está molesto, o el tema excede tu alcance.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Motivo del escalado" },
      },
      required: ["reason"],
    },
  },
};

// Lectura con esquema dinámico: como las acciones, lleva los valores reales
// (los servicios que se pueden reservar) como enum.
export const DYNAMIC_READ_TOOL_NAMES = ["check_availability"] as const;
type DynamicReadToolName = (typeof DYNAMIC_READ_TOOL_NAMES)[number];
function isDynamicReadTool(name: string): name is DynamicReadToolName {
  return (DYNAMIC_READ_TOOL_NAMES as readonly string[]).includes(name);
}

const NO_BOOKING_SERVICES = "No hay servicios con alguien que los atienda en Ajustes › Agenda.";

function readTool(name: DynamicReadToolName, c: ToolContext): LlmTool | null {
  switch (name) {
    case "check_availability":
      if (!c.bookingServices.length) return null;
      return {
        name,
        description:
          "Consulta las horas libres para reservar una cita. Devuelve los próximos días con hueco y sus horas, en la zona horaria del negocio. Úsala SIEMPRE antes de ofrecer horarios o de reservar: nunca inventes ni supongas que una hora está libre. Si el cliente pide un día concreto, pásalo en «date».",
        input_schema: {
          type: "object",
          properties: {
            service: { type: "string", enum: c.bookingServices, description: "Servicio que quiere reservar" },
            date: { type: "string", description: "Día desde el que buscar, AAAA-MM-DD (opcional; por defecto, hoy)" },
            ...(c.bookingStaff.length > 1
              ? { staff: { type: "string", enum: c.bookingStaff, description: "Solo si el cliente pide a una persona concreta" } }
              : {}),
          },
          required: ["service"],
        },
      };
  }
}

// ── Acciones: herramientas que ESCRIBEN en el CRM ──────────────
// Su esquema no es fijo: se construye con los valores reales del workspace
// (etiquetas, etapas, vendedores…) como enum, para que el modelo no pueda
// inventarse una etiqueta o una etapa que no existe.
export const ACTION_TOOL_NAMES = [
  "add_tag",
  "remove_tag",
  "move_deal_stage",
  "update_contact",
  "assign_to_seller",
  "send_product_image",
  "send_product_file",
  "send_payment_methods",
  "mark_lead",
  "book_appointment",
  "reschedule_appointment",
  "cancel_appointment",
] as const;
export type ActionToolName = (typeof ACTION_TOOL_NAMES)[number];

export function isActionTool(name: string): name is ActionToolName {
  return (ACTION_TOOL_NAMES as readonly string[]).includes(name);
}

// Datos reales del workspace que se inyectan en los esquemas.
export interface ToolContext {
  tags: string[];
  stages: string[];
  sellers: string[];
  customFields: { key: string; label: string; options: string[] }[];
  /** Productos que TIENEN foto cargada: los únicos que se pueden enviar. */
  productsWithImage: string[];
  /** Productos con algún archivo (campo «Archivo») y cuáles: «Power BI» → Brochure, Temario. */
  productFiles: { product: string; files: string[] }[];
  /** Clasificaciones con etapa configurada: potential (Potencial), purchase (Ganada), lost (Perdida). */
  leadStatuses: string[];
  /** Servicios de la agenda que se pueden reservar (activos y con alguien que los atienda). */
  bookingServices: string[];
  /** Quién atiende esos servicios. */
  bookingStaff: string[];
  /** Campos de producto que ve la IA («Temario», «Fechas»…): search_products dice cuál pide el cliente. */
  productFields: string[];
  /** Métodos de pago activos (Ajustes › Métodos de pago), por nombre. */
  paymentMethods: string[];
  /** Países con métodos propios, por nombre: para cuando el cliente paga desde otro país. */
  paymentCountries: string[];
}

export const EMPTY_TOOL_CONTEXT: ToolContext = {
  tags: [],
  stages: [],
  sellers: [],
  customFields: [],
  productsWithImage: [],
  productFiles: [],
  leadStatuses: [],
  bookingServices: [],
  bookingStaff: [],
  productFields: [],
  paymentMethods: [],
  paymentCountries: [],
};

const ACTION_META: Record<
  ActionToolName,
  { label: string; needs: (c: ToolContext) => string | null }
> = {
  add_tag: {
    label: "Poner una etiqueta",
    needs: (c) =>
      c.tags.length ? null : "No hay etiquetas creadas en Ajustes › Etiquetas.",
  },
  remove_tag: {
    label: "Quitar una etiqueta",
    needs: (c) =>
      c.tags.length ? null : "No hay etiquetas creadas en Ajustes › Etiquetas.",
  },
  move_deal_stage: {
    label: "Mover en el pipeline",
    needs: (c) =>
      c.stages.length
        ? null
        : "No hay etapas creadas en Ajustes › Etapas del pipeline.",
  },
  update_contact: {
    label: "Actualizar datos del contacto",
    needs: () => null, // el nombre siempre se puede actualizar
  },
  assign_to_seller: {
    label: "Asignar a un vendedor",
    needs: (c) => (c.sellers.length ? null : "No hay vendedores activos."),
  },
  mark_lead: {
    label: "Marcar como potencial, compra o perdido",
    needs: (c) =>
      c.leadStatuses.length
        ? null
        : "Marca en Ajustes › Embudos qué etapa es Potencial, Ganada y Perdida.",
  },
  book_appointment: {
    label: "Reservar una cita",
    needs: (c) => (c.bookingServices.length ? null : NO_BOOKING_SERVICES),
  },
  reschedule_appointment: {
    label: "Cambiar la hora de una cita",
    needs: (c) => (c.bookingServices.length ? null : NO_BOOKING_SERVICES),
  },
  cancel_appointment: {
    label: "Cancelar una cita",
    needs: (c) => (c.bookingServices.length ? null : NO_BOOKING_SERVICES),
  },
  send_payment_methods: {
    label: "Enviar los métodos de pago",
    needs: (c) => (c.paymentMethods.length ? null : "No hay métodos de pago activos (Ajustes › Métodos de pago)."),
  },
  send_product_image: {
    label: "Enviar la foto de un producto",
    needs: (c) =>
      c.productsWithImage.length
        ? null
        : "Ningún producto tiene URL de imagen cargada (Productos › editar).",
  },
  send_product_file: {
    label: "Enviar un archivo de un producto",
    needs: (c) =>
      c.productFiles.length
        ? null
        : "Ningún producto tiene un archivo: crea un campo de tipo «Archivo» en Productos › Campos y cárgalo en el producto.",
  },
};

// Construye el esquema de una acción con los valores reales disponibles.
function actionTool(name: ActionToolName, c: ToolContext): LlmTool | null {
  switch (name) {
    case "add_tag":
      if (!c.tags.length) return null;
      return {
        name,
        description:
          "Pone una etiqueta al contacto para clasificarlo (interesado, VIP, no molestar…). Usa SOLO una de las etiquetas listadas.",
        input_schema: {
          type: "object",
          properties: {
            tag: { type: "string", enum: c.tags, description: "Etiqueta a poner" },
          },
          required: ["tag"],
        },
      };

    case "remove_tag":
      if (!c.tags.length) return null;
      return {
        name,
        description:
          "Quita una etiqueta que el contacto ya no debería tener. Usa SOLO una de las etiquetas listadas.",
        input_schema: {
          type: "object",
          properties: {
            tag: { type: "string", enum: c.tags, description: "Etiqueta a quitar" },
          },
          required: ["tag"],
        },
      };

    case "move_deal_stage":
      if (!c.stages.length) return null;
      return {
        name,
        description:
          "Mueve la oportunidad de este contacto a otra etapa del pipeline (p. ej. a «Negociación» cuando pide precio, o a «Ganado» cuando confirma la compra). Si el contacto aún no tiene oportunidad, se crea en esa etapa.",
        input_schema: {
          type: "object",
          properties: {
            stage: {
              type: "string",
              enum: c.stages,
              description: "Etapa destino",
            },
            reason: {
              type: "string",
              description: "Por qué lo mueves (queda en el historial)",
            },
          },
          required: ["stage"],
        },
      };

    case "update_contact": {
      const properties: Record<string, unknown> = {
        name: {
          type: "string",
          description: "Nombre del contacto, si te lo dice en el chat",
        },
      };
      for (const f of c.customFields) {
        properties[f.key] = f.options.length
          ? { type: "string", enum: f.options, description: f.label }
          : { type: "string", description: f.label };
      }
      return {
        name,
        description:
          "Guarda en la ficha del contacto los datos que te vaya diciendo (su nombre y los campos personalizados del negocio). Envía solo los campos que el cliente haya confirmado; nunca inventes valores.",
        input_schema: { type: "object", properties },
      };
    }

    case "send_product_image":
      if (!c.productsWithImage.length) return null;
      return {
        name,
        description:
          "Envía al cliente la foto de un producto del catálogo por WhatsApp. Úsala cuando pregunte cómo es algo, pida ver el producto, o cuando una imagen explique mejor que el texto. Solo puedes enviar los productos listados: son los que tienen foto cargada.",
        input_schema: {
          type: "object",
          properties: {
            product: {
              type: "string",
              enum: c.productsWithImage,
              description: "Producto cuya foto enviar",
            },
            caption: {
              type: "string",
              description: "Pie de foto breve (opcional)",
            },
          },
          required: ["product"],
        },
      };

    case "send_product_file": {
      if (!c.productFiles.length) return null;
      const names = c.productFiles.map((p) => p.product);
      const files = [...new Set(c.productFiles.flatMap((p) => p.files))];
      return {
        name,
        description:
          "Envía al cliente un archivo de un producto (por ejemplo su brochure o su temario) como documento. Úsala cuando lo pida, o cuando tus instrucciones lo indiquen. search_products dice en «files» qué archivos tiene cada producto: si no aparece ahí, no lo prometas. No escribas tú enlaces ni digas que lo enviaste sin llamar a esta acción.",
        input_schema: {
          type: "object",
          properties: {
            product: {
              type: "string",
              description: "Nombre exacto del producto, tal como lo devuelve search_products",
              // En un catálogo grande la lista no cabe: el nombre sale de search_products.
              ...(names.length <= 60 ? { enum: names } : {}),
            },
            ...(files.length > 1 ? { file: { type: "string", enum: files, description: "Qué archivo enviar" } } : {}),
            caption: { type: "string", description: "Texto breve que acompaña al archivo (opcional)" },
          },
          required: files.length > 1 ? ["product", "file"] : ["product"],
        },
      };
    }

    case "send_payment_methods": {
      if (!c.paymentMethods.length) return null;
      const properties: Record<string, unknown> = {
        methods: {
          type: "array",
          items: { type: "string", enum: c.paymentMethods },
          description: "Solo si pidió uno en concreto («¿puedo pagar con Yape?»). Si no, no lo pongas: se envían todos los de su país.",
        },
      };
      if (c.paymentCountries.length) {
        properties.country = {
          type: "string",
          enum: c.paymentCountries,
          description:
            "Solo si el cliente dijo que paga desde un país distinto al de su número, o si la herramienta te dijo que no sabe su país. Si no, no lo pongas: se usa el de su teléfono.",
        };
      }
      return {
        name,
        description:
          "Envía al cliente los datos para pagar (cuentas, Yape, enlaces de pago, QR) exactamente como los cargó la empresa, solo los de su país. Úsala cuando quiera pagar o pregunte cómo, a dónde o a qué cuenta pagar, depositar o transferir. Nunca escribas tú un dato de pago: esta herramienta envía los exactos. No la uses si solo pregunta algo sobre el pago (si hay cuotas, si es mensual, cuánto cuesta): eso se responde con texto.",
        input_schema: { type: "object", properties },
      };
    }

    case "mark_lead":
      if (!c.leadStatuses.length) return null;
      return {
        name,
        description:
          "Clasifica al contacto en el embudo según lo que dice: «potential» = muestra interés real (pregunta precios, pide cotización, piensa comprar); «purchase» = confirma la compra, paga o cierra; «lost» = no le interesa o compró en otro sitio. Mueve (o crea) su oportunidad a la etapa que la empresa reservó para cada caso. Úsala en cuanto el cliente lo deje claro, no por suposición, y una sola vez por cambio.",
        input_schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: c.leadStatuses, description: "potential | purchase | lost" },
            reason: { type: "string", description: "Qué dijo el cliente que lo justifica" },
          },
          required: ["status"],
        },
      };

    case "book_appointment":
      if (!c.bookingServices.length) return null;
      return {
        name,
        description:
          "Reserva una cita para este contacto. Solo cuando el cliente haya elegido una hora concreta de las que devolvió check_availability: pásala tal cual en «start» (AAAA-MM-DDTHH:mm, hora del negocio). No digas que está reservada hasta que esta herramienta lo confirme. Si ya tiene una cita de ese servicio y quiere cambiarla, usa reschedule_appointment.",
        input_schema: {
          type: "object",
          properties: {
            service: { type: "string", enum: c.bookingServices, description: "Servicio a reservar" },
            start: { type: "string", description: "Fecha y hora de inicio, AAAA-MM-DDTHH:mm (p. ej. 2026-11-03T10:30)" },
            ...(c.bookingStaff.length > 1
              ? { staff: { type: "string", enum: c.bookingStaff, description: "Persona que atiende (solo si el cliente la pidió)" } }
              : {}),
            note: { type: "string", description: "Algo que deba saber quien atiende (opcional)" },
          },
          required: ["service", "start"],
        },
      };

    case "reschedule_appointment":
      if (!c.bookingServices.length) return null;
      return {
        name,
        description:
          "Mueve la próxima cita del contacto a otra hora libre (consúltala antes con check_availability). Si tiene varias, indica el servicio.",
        input_schema: {
          type: "object",
          properties: {
            start: { type: "string", description: "Nueva fecha y hora, AAAA-MM-DDTHH:mm" },
            service: { type: "string", enum: c.bookingServices, description: "Servicio de la cita a mover (si tiene varias)" },
          },
          required: ["start"],
        },
      };

    case "cancel_appointment":
      if (!c.bookingServices.length) return null;
      return {
        name,
        description:
          "Cancela la próxima cita del contacto cuando él lo pida claramente. Si tiene varias, indica el servicio. Antes de cancelar, ofrece moverla a otra hora.",
        input_schema: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Motivo que dio el cliente" },
            service: { type: "string", enum: c.bookingServices, description: "Servicio de la cita a cancelar (si tiene varias)" },
          },
          required: ["reason"],
        },
      };

    case "assign_to_seller":
      if (!c.sellers.length) return null;
      return {
        name,
        description:
          "Asigna un vendedor humano responsable de la oportunidad. NO escala la conversación ni la saca del bot: solo fija el responsable. Para pasar el chat a una persona usa handoff_to_human.",
        input_schema: {
          type: "object",
          properties: {
            seller: {
              type: "string",
              enum: c.sellers,
              description: "Vendedor responsable",
            },
          },
          required: ["seller"],
        },
      };
  }
}

// Lista para los checkboxes del panel: lectura + acciones, con el motivo por
// el que una acción no se puede usar todavía (para poder avisar en la UI).
export function availableTools(c: ToolContext = EMPTY_TOOL_CONTEXT): AgentToolInfo[] {
  const read: AgentToolInfo[] = Object.values(TOOL_REGISTRY).map((t) => ({
    name: t.name,
    label: READ_LABELS[t.name] ?? t.name,
    description: t.description,
    isAction: false,
    unavailableReason: null,
  }));
  const dynamicRead: AgentToolInfo[] = DYNAMIC_READ_TOOL_NAMES.map((name) => {
    const built = readTool(name, c);
    return {
      name,
      label: READ_LABELS[name] ?? name,
      description: built?.description ?? READ_LABELS[name] ?? name,
      isAction: false,
      unavailableReason: built ? null : NO_BOOKING_SERVICES,
    };
  });

  const actions: AgentToolInfo[] = ACTION_TOOL_NAMES.map((name) => {
    const meta = ACTION_META[name];
    const built = actionTool(name, c);
    return {
      name,
      label: meta.label,
      // La descripción real solo existe si la acción es construible.
      description: built?.description ?? meta.label,
      isAction: true,
      unavailableReason: meta.needs(c),
    };
  });

  // No es una herramienta que llame el modelo: activa el paso que pone botones
  // a la respuesta (ver reply-options.ts). Se elige junto a las demás.
  const replyButtons: AgentToolInfo = {
    name: REPLY_BUTTONS_TOOL,
    label: "Ofrecer botones y listas",
    description:
      "Si la respuesta termina en una pregunta para elegir (sí o no, o entre pocas opciones), sale con botones para pulsar: botones en WhatsApp, respuestas rápidas en Instagram y Messenger.",
    isAction: false,
    unavailableReason: null,
  };

  return [...read, ...dynamicRead, replyButtons, ...actions];
}

const READ_LABELS: Record<string, string> = {
  search_contact: "Consultar la ficha del contacto",
  search_knowledge: "Buscar en la base de conocimiento",
  search_products: "Consultar el catálogo de productos",
  handoff_to_human: "Pasar la conversación a un humano",
  check_availability: "Consultar horas libres de la agenda",
};

// Herramientas que se le pasan al modelo en una llamada concreta.
// Una acción habilitada pero sin datos (p. ej. sin etiquetas) se omite: es
// mejor que el modelo no la vea a que la llame y falle.
export function resolveTools(
  enabled: string[],
  context: ToolContext = EMPTY_TOOL_CONTEXT,
): LlmTool[] {
  const out: LlmTool[] = [];
  for (const name of enabled) {
    if (isActionTool(name)) {
      const built = actionTool(name, context);
      if (built) out.push(built);
      continue;
    }
    if (isDynamicReadTool(name)) {
      const built = readTool(name, context);
      if (built) out.push(built);
      continue;
    }
    if (name === "search_products") {
      out.push(searchProductsTool(context.productFields));
      continue;
    }
    const tool = TOOL_REGISTRY[name];
    if (tool) out.push(tool);
  }
  return out;
}

/**
 * search_products con «asks»: qué dato del producto pide el cliente, elegido de
 * los campos reales del catálogo. Va en la misma llamada (sin otra vuelta al
 * modelo) y, si el producto no lo tiene, queda contado en «Lo que preguntan y
 * falta» de Productos. Sin campos de producto, la herramienta de siempre.
 */
export function searchProductsTool(fields: string[] = []): LlmTool {
  const base = TOOL_REGISTRY.search_products;
  const labels = [...new Set(fields.map((f) => f.trim()).filter(Boolean))];
  if (!labels.length) return base;
  const schema = base.input_schema as { properties: Record<string, unknown> };
  return {
    ...base,
    input_schema: {
      ...base.input_schema,
      properties: {
        ...schema.properties,
        asks: {
          type: "array",
          items: { type: "string", enum: labels },
          // «Con sus palabras»: el modelo ponía aquí los datos de su propia
          // presentación («Qué incluye», «Requisitos») y, si el producto no los
          // traía, le decía al cliente que faltaban sin que nadie los pidiera.
          description:
            "Qué datos de esta lista pregunta el cliente con sus palabras en su último mensaje (si pregunta cuándo empieza, el de fechas; si pide el temario, el temario). Los datos que lleva tu presentación o tus instrucciones no cuentan: el cliente no los ha pedido. Vacío si solo pide información del producto, pregunta qué hay o el precio.",
        },
      },
    },
  };
}
