// Contrato del proveedor de WhatsApp (patrón Adapter).
// La lógica de negocio depende SOLO de esta interfaz, nunca de Meta directamente.

import type { TemplateButton, TemplateHeader } from "@crm/shared";

export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");

/** Medio ya resuelto para enviar: subido a Meta (id) o URL pública. */
export interface MediaRef {
  id?: string;
  link?: string;
  filename?: string;
}

/** Plantilla lista para enviar: estructura + valores de cada hueco. */
export interface TemplateSendSpec {
  name: string;
  language: string;
  header: TemplateHeader | null;
  buttons: TemplateButton[];
  /** Valores de {{1}}, {{2}}… del cuerpo, en orden. */
  bodyParams: string[];
  /** Plantilla con variables con nombre: el nombre de cada valor de `bodyParams`. */
  bodyParamNames?: string[];
  /** Valor de la variable del encabezado de texto. */
  headerTextParam?: string;
  headerParamName?: string;
  /** Archivo del encabezado IMAGE/VIDEO/DOCUMENT. */
  headerMedia?: MediaRef;
  headerLocation?: {
    latitude: string;
    longitude: string;
    name?: string;
    address?: string;
  };
  /** Sufijo dinámico de los botones de URL, por posición del botón. */
  urlButtonParams?: { index: number; value: string }[];
}

/** Botón de un mensaje interactivo (sin plantilla, dentro de las 24h). */
export interface InteractiveButton {
  id: string;
  title: string;
}

export interface SendResult {
  waMessageId: string;
}

/** Tipos de adjunto que se pueden enviar sueltos. El audio no lleva pie. */
export type OutboundMediaKind = "IMAGE" | "DOCUMENT" | "VIDEO" | "AUDIO";

export interface DownloadedMedia {
  url: string; // ubicación donde quedó almacenado el medio
  mimeType: string;
}

export interface WhatsAppProvider {
  /** Nombre legible para logs/diagnóstico ("fake" | "meta"). */
  readonly name: string;

  /**
   * Envía texto. `fromPhoneNumberId` selecciona el canal/número emisor
   * (multi-número); si se omite, usa el canal activo por defecto.
   */
  sendText(
    to: string,
    text: string,
    fromPhoneNumberId?: string,
    /** waMessageId del mensaje citado (cita estilo WhatsApp). */
    replyToWaMessageId?: string,
  ): Promise<SendResult>;

  sendMedia(
    to: string,
    kind: OutboundMediaKind,
    mediaUrl: string,
    caption?: string,
    fromPhoneNumberId?: string,
  ): Promise<SendResult>;

  /**
   * Envía un mensaje de plantilla (obligatorio fuera de la ventana de 24h),
   * con todos sus componentes: encabezado (texto, archivo o ubicación),
   * cuerpo y botones dinámicos.
   */
  sendTemplate(
    to: string,
    spec: TemplateSendSpec,
    fromPhoneNumberId?: string,
  ): Promise<SendResult>;

  /**
   * Mensaje con botones de respuesta rápida, sin plantilla. Solo vale dentro
   * de la ventana de 24h, pero no necesita aprobación de Meta.
   */
  sendInteractiveButtons(
    to: string,
    body: string,
    buttons: InteractiveButton[],
    options?: { header?: string; footer?: string },
    fromPhoneNumberId?: string,
  ): Promise<SendResult>;

  /**
   * Cualquier mensaje interactivo ya armado (el objeto `interactive` de la
   * Cloud API): botones con encabezado multimedia, lista o carrusel. Solo
   * dentro de la ventana de 24 h.
   */
  sendInteractive(
    to: string,
    interactive: Record<string, unknown>,
    fromPhoneNumberId?: string,
  ): Promise<SendResult>;

  /**
   * Reacciona a un mensaje con un emoji (cadena vacía = quita la reacción).
   */
  sendReaction(
    to: string,
    targetWaMessageId: string,
    emoji: string,
    fromPhoneNumberId?: string,
  ): Promise<SendResult>;

  /**
   * Sube un binario a Meta y devuelve su media id. Enviar por id evita tener
   * que exponer públicamente el fichero (que es lo que exige `link`), así que
   * funciona igual en local que en producción. Meta lo conserva 30 días.
   */
  uploadMedia(
    buffer: Buffer,
    mimeType: string,
    filename: string,
    fromPhoneNumberId?: string,
  ): Promise<string>;

  /** Envía un medio ya subido a Meta, por su media id. */
  sendMediaById(
    to: string,
    kind: OutboundMediaKind,
    mediaId: string,
    caption?: string,
    fromPhoneNumberId?: string,
  ): Promise<SendResult>;

  /**
   * Marca el mensaje como leído y muestra "escribiendo…" en el chat del
   * cliente. Se descarta solo al responder o a los 25 segundos, lo que pase
   * antes, así que solo debe usarse si de verdad vas a contestar.
   */
  sendTypingIndicator(
    waMessageId: string,
    fromPhoneNumberId?: string,
  ): Promise<void>;

  /** Descarga un medio entrante (por su id de Meta) al almacenamiento. */
  downloadMedia(mediaId: string, fromPhoneNumberId?: string): Promise<DownloadedMedia>;
}
