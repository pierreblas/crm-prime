/**
 * Errores de envío de WhatsApp (Cloud API), dichos para quien manda la
 * difusión. Meta responde en inglés y con un código; aquí se traduce lo que
 * pasó y qué hacer, y se deja el código y el detalle de Meta al final para
 * poder buscarlo.
 *
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export interface WhatsappErrorInfo {
  code?: number | null;
  /** `error.message` o `errors[].title` de Meta. */
  message?: string | null;
  /** `error.error_data.details` o `errors[].error_data.details`. */
  details?: string | null;
}

const EXPLAIN: Record<number, string> = {
  0: "Meta no pudo autenticar la cuenta. Vuelve a conectar el número",
  3: "La app no tiene permiso para enviar con este número",
  10: "La app no tiene permiso para enviar con este número",
  100: "Meta rechazó un dato del envío",
  190: "El acceso al número caducó. Vuelve a conectarlo en WhatsApp",
  200: "La app no tiene permiso para enviar con este número",
  368: "La cuenta está bloqueada temporalmente por infringir las políticas de WhatsApp",
  130429: "Se superó el límite de envíos por segundo del número. Reintenta en unos minutos",
  130472: "Meta no entregó el mensaje a este número por un experimento suyo de mensajes de marketing",
  131000: "Error interno de Meta. Reintenta más tarde",
  131005: "La app no tiene permiso para enviar con este número",
  131008: "Falta un dato obligatorio de la plantilla (una variable vacía o el archivo del encabezado)",
  131009: "Un valor de la plantilla no es válido",
  131016: "WhatsApp no está disponible en este momento. Reintenta más tarde",
  131021: "El destinatario es el mismo número que envía",
  131026: "No se pudo entregar: ese número no usa WhatsApp, no aceptó los últimos términos o tiene una versión antigua",
  131030: "Ese número no está en la lista de destinatarios permitidos del número de prueba",
  131031: "La cuenta de WhatsApp Business está bloqueada o restringida",
  131042: "Hay un problema con el método de pago de la cuenta de WhatsApp Business. Añade o revisa la tarjeta en Meta Business Suite › Configuración de pagos de WhatsApp",
  131045: "El número no está registrado en la API de WhatsApp. Vuelve a conectarlo",
  131047: "Pasaron más de 24 horas desde el último mensaje del cliente: solo se le puede escribir con una plantilla",
  131048: "Meta limitó los envíos de este número porque muchos mensajes fueron bloqueados o reportados",
  131049: "Meta no lo entregó para cuidar la experiencia del cliente (recibe demasiados mensajes de marketing). Prueba en unos días",
  131050: "El cliente dejó de aceptar mensajes de marketing de tu empresa",
  131051: "Tipo de mensaje no admitido",
  131052: "No se pudo descargar el archivo del mensaje",
  131053: "No se pudo subir el archivo del encabezado (formato o tamaño no admitidos)",
  131056: "Demasiados mensajes seguidos al mismo número. Espera un poco antes de reintentar",
  131057: "La cuenta está en mantenimiento. Reintenta más tarde",
  132000: "La cantidad de variables no coincide con la plantilla aprobada en Meta. Sincroniza las plantillas y vuelve a crear la difusión",
  132001: "La plantilla no existe en Meta con ese nombre e idioma, o aún no está aprobada. Sincroniza las plantillas",
  132005: "El texto de la plantilla con las variables rellenas es demasiado largo",
  132007: "El contenido de las variables infringe las políticas de WhatsApp",
  132012: "El formato de una variable no coincide con la plantilla (por ejemplo, el archivo del encabezado)",
  132015: "La plantilla está pausada en Meta por baja calidad",
  132016: "La plantilla está desactivada en Meta",
  132068: "El flujo de la plantilla está bloqueado",
  132069: "El flujo de la plantilla está limitado",
  133010: "El número no está registrado en la API de WhatsApp. Vuelve a conectarlo",
  135000: "Error genérico de Meta con un dato del envío",
};

/** «Hay un problema con el método de pago… (Meta #131042: …)». */
export function explainWhatsappError(e: WhatsappErrorInfo): string {
  const code = typeof e.code === "number" ? e.code : null;
  const base = (code !== null && EXPLAIN[code]) || e.message?.trim() || "Meta rechazó el envío";
  const extra = [e.details?.trim(), code !== null && EXPLAIN[code] ? e.message?.trim() : null]
    .filter((x): x is string => !!x)
    // Meta a veces repite el título en el detalle.
    .filter((x, i, all) => all.indexOf(x) === i && !base.includes(x))[0];
  const ref = code !== null ? `Meta #${code}${extra ? `: ${extra}` : ""}` : extra;
  return ref ? `${base} (${ref})` : base;
}

/** Lee el cuerpo de error de la Graph API ({ error: { code, message, error_data } }). */
export function parseGraphError(body: string): WhatsappErrorInfo | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: number; message?: string; error_user_msg?: string; error_data?: { details?: string } | string };
    };
    if (!parsed.error) return null;
    const data = parsed.error.error_data;
    return {
      code: parsed.error.code ?? null,
      message: parsed.error.message ?? null,
      details: (typeof data === "string" ? data : data?.details) ?? parsed.error.error_user_msg ?? null,
    };
  } catch {
    return null;
  }
}
