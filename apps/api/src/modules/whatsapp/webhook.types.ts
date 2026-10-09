import { MessageStatus, MessageType, normalizePhone } from "@crm/shared";

// ── Payloads de los jobs de la cola inbound ──────────────────
export interface InboundMessageJob {
  kind: "message";
  from: string;
  name?: string;
  waMessageId: string;
  type: MessageType;
  text?: string;
  mediaId?: string;
  /** Medio ya guardado en el almacén (simulador de desarrollo): no hay nada que descargar de Meta. */
  mediaUrl?: string;
  /** Identificador del botón que pulsó el contacto (plantilla o interactivo). */
  buttonPayload?: string;
  // Anuncio que originó la conversación (solo en el primer mensaje).
  referral?: MetaReferral;
  /** waMessageId citado por el cliente, si respondió a un mensaje. */
  replyToWaMessageId?: string;
  // phone_number_id del número que recibió el mensaje (multi-número).
  channelPhoneNumberId?: string;
}

export interface InboundStatusJob {
  kind: "status";
  waMessageId: string;
  status: MessageStatus;
  channelPhoneNumberId?: string;
}

// Coexistencia: mensaje que el negocio envió DESDE la app de WhatsApp del
// celular. Meta lo reporta como "echo" para que el CRM se mantenga en sync.
export interface InboundEchoJob {
  kind: "echo";
  to: string; // teléfono del cliente (destinatario)
  waMessageId: string;
  type: MessageType;
  text?: string;
  channelPhoneNumberId?: string;
}

// Reacción (emoji) de un contacto sobre un mensaje. Emoji vacío = se quitó.
export interface InboundReactionJob {
  kind: "reaction";
  targetWaMessageId: string;
  emoji: string;
  channelPhoneNumberId?: string;
}

// Coexistencia: un mensaje del historial importado al conectar el número.
export interface InboundHistoryJob {
  kind: "history";
  customerWaId: string; // hilo (teléfono del cliente)
  fromCustomer: boolean; // true = entrante; false = saliente (desde la app)
  waMessageId: string;
  type: MessageType;
  text?: string;
  timestampMs: number;
  channelPhoneNumberId?: string;
}

// Coexistencia: sincronización de contactos y etiquetas de la app.
export interface StateSyncItem {
  kind: "contact" | "label" | "association";
  action: "add" | "remove";
  phone?: string;
  name?: string;
  labelId?: string;
  labelName?: string;
  labelColor?: string;
}
export interface InboundStateSyncJob {
  kind: "state_sync";
  items: StateSyncItem[];
  channelPhoneNumberId?: string;
}

// Meta aprobó, rechazó o pausó una plantilla (field
// message_template_status_update).
export interface InboundTemplateStatusJob {
  kind: "template_status";
  // Sin esto el worker no sabe de qué empresa es lo que procesa. Este evento
  // llega a nivel de WABA y NO trae phone_number_id, así que la empresa se
  // resuelve por `wabaId`, que Meta pone en `entry.id`.
  channelPhoneNumberId?: string;
  wabaId?: string;
  waTemplateId?: string;
  name?: string;
  language?: string;
  status: string;
  reason?: string | null;
  category?: string;
}

/**
 * Por dónde entró el evento. Si llegó por la ruta de una empresa
 * (`acme.driony.com/api/v1/webhooks/whatsapp`, su propia app de Meta) lleva
 * su `orgId`, y el worker exige que el número sea de esa empresa: una app
 * ajena, aunque firme bien lo suyo, no puede meter mensajes en otra. Por el
 * webhook de la plataforma no hay `orgId`: la empresa sale del número.
 */
export interface InboundOrigin {
  orgId?: string;
}

export type InboundJob = (
  | InboundMessageJob
  | InboundStatusJob
  | InboundEchoJob
  | InboundReactionJob
  | InboundHistoryJob
  | InboundStateSyncJob
  | InboundTemplateStatusJob
) &
  InboundOrigin;

// ── Forma (parcial) del webhook de Meta ──────────────────────
interface MetaContact {
  profile?: { name?: string };
  wa_id: string;
}
// Anuncio Click-to-WhatsApp que originó el mensaje. Meta lo adjunta al
// PRIMER mensaje de una conversación abierta desde el anuncio.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text
export interface MetaReferral {
  source_url?: string; // enlace corto del anuncio
  source_id?: string; // id del anuncio
  source_type?: string; // ad | post
  headline?: string;
  body?: string;
  media_type?: string; // image | video
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string; // click id: necesario para devolver conversiones a Meta
  welcome_message?: { text?: string };
}

interface MetaMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  document?: { id: string; caption?: string; filename?: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
  video?: { id: string; caption?: string; mime_type?: string };
  sticker?: { id: string; mime_type?: string; animated?: boolean };
  reaction?: { message_id: string; emoji?: string };
  // Respuesta a un botón de plantilla.
  button?: { text?: string; payload?: string };
  // Respuesta a un mensaje interactivo (botones o lista).
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  referral?: MetaReferral;
  // El cliente respondió citando un mensaje nuestro.
  context?: { id?: string; from?: string };
}
interface MetaStatus {
  id: string;
  status: string;
}
// Echo de coexistencia: el negocio envió desde la app del celular.
interface MetaMessageEcho {
  to?: string;
  from?: string;
  id: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  document?: { id: string; caption?: string };
}
// Historial importado (coexistencia).
interface MetaHistoryMessage {
  id: string;
  from: string;
  to?: string;
  type: string;
  timestamp?: string;
  text?: { body: string };
  image?: { caption?: string };
  document?: { caption?: string };
}
interface MetaHistory {
  threads?: { id: string; messages?: MetaHistoryMessage[] }[];
}
// Sincronización de estado de la app (coexistencia).
interface MetaStateSync {
  type: string; // contact | label | contact_label_association
  action?: string; // add | remove
  contact?: { full_name?: string; phone_number?: string };
  label?: { id?: string; name?: string; color?: string };
  contact_label_association?: { phone_number?: string; label_id?: string };
}
// Cambio de estado de una plantilla (aprobada, rechazada, pausada…).
interface MetaTemplateStatusValue {
  event?: string;
  message_template_id?: string | number;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string | null;
  new_category?: string;
}
interface MetaValue extends MetaTemplateStatusValue {
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
  message_echoes?: MetaMessageEcho[];
  history?: MetaHistory[];
  state_sync?: MetaStateSync[];
}
export interface MetaWebhookBody {
  entry?: { id?: string; changes?: { field?: string; value?: MetaValue }[] }[];
}

const TYPE_MAP: Record<string, MessageType> = {
  text: MessageType.TEXT,
  image: MessageType.IMAGE,
  document: MessageType.DOCUMENT,
  audio: MessageType.AUDIO,
  video: MessageType.VIDEO,
  sticker: MessageType.STICKER,
  location: MessageType.LOCATION,
};

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

/**
 * Convierte un webhook de Meta en una lista plana de jobs para la cola.
 * Los teléfonos se normalizan aquí (Meta manda el `wa_id` sin "+"), para que
 * aguas abajo todo el mundo vea el mismo formato E.164 y no se dupliquen
 * contactos con y sin "+".
 */
export function normalizeWebhook(body: MetaWebhookBody): InboundJob[] {
  const jobs: InboundJob[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Estado de una plantilla: no es un mensaje, llega en su propio field.
      if (change.field === "message_template_status_update" && value.event) {
        jobs.push({
          kind: "template_status",
          wabaId: entry.id,
          waTemplateId: value.message_template_id
            ? String(value.message_template_id)
            : undefined,
          name: value.message_template_name,
          language: value.message_template_language,
          status: value.event,
          reason: value.reason ?? null,
          category: value.new_category,
        });
        continue;
      }

      const channelPhoneNumberId = value.metadata?.phone_number_id;

      const nameByWaId = new Map<string, string | undefined>();
      for (const c of value.contacts ?? []) {
        nameByWaId.set(c.wa_id, c.profile?.name);
      }

      for (const m of value.messages ?? []) {
        // Reacción: no es un mensaje nuevo, sino un emoji sobre otro mensaje.
        if (m.type === "reaction" && m.reaction) {
          jobs.push({
            kind: "reaction",
          channelPhoneNumberId,
            targetWaMessageId: m.reaction.message_id,
            emoji: m.reaction.emoji ?? "",
          });
          continue;
        }
        // El contacto pulsó un botón: de plantilla (button) o de un mensaje
        // interactivo (interactive). Se guarda como texto + identificador.
        const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
        const buttonText = m.button?.text ?? reply?.title;
        const buttonPayload = m.button?.payload ?? reply?.id;

        const type = TYPE_MAP[m.type] ?? MessageType.TEXT;
        jobs.push({
          kind: "message",
          from: normalizePhone(m.from),
          name: nameByWaId.get(m.from),
          waMessageId: m.id,
          type,
          text: m.text?.body ?? buttonText ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption,
          mediaId: m.image?.id ?? m.document?.id ?? m.audio?.id ?? m.video?.id ?? m.sticker?.id,
          ...(buttonPayload ? { buttonPayload } : {}),
          channelPhoneNumberId,
          ...(m.referral ? { referral: m.referral } : {}),
          ...(m.context?.id ? { replyToWaMessageId: m.context.id } : {}),
        });
      }

      for (const s of value.statuses ?? []) {
        const status = STATUS_MAP[s.status];
        if (status)
          jobs.push({
            kind: "status",
            waMessageId: s.id,
            status,
            channelPhoneNumberId,
          });
      }

      // Coexistencia: mensajes enviados desde la app del celular.
      for (const e of value.message_echoes ?? []) {
        if (!e.to) continue;
        jobs.push({
          kind: "echo",
          to: normalizePhone(e.to),
          waMessageId: e.id,
          type: TYPE_MAP[e.type] ?? MessageType.TEXT,
          text: e.text?.body ?? e.image?.caption ?? e.document?.caption,
          channelPhoneNumberId,
        });
      }

      // Coexistencia: historial de chats importado al conectar.
      for (const h of value.history ?? []) {
        for (const thread of h.threads ?? []) {
          for (const m of thread.messages ?? []) {
            jobs.push({
              kind: "history",
              customerWaId: normalizePhone(thread.id),
              fromCustomer: m.from === thread.id,
              waMessageId: m.id,
              type: TYPE_MAP[m.type] ?? MessageType.TEXT,
              text: m.text?.body ?? m.image?.caption ?? m.document?.caption,
              timestampMs: m.timestamp ? Number(m.timestamp) * 1000 : Date.now(),
              channelPhoneNumberId,
            });
          }
        }
      }

      // Coexistencia: sincronización de contactos y etiquetas.
      const syncItems = (value.state_sync ?? [])
        .map((s): StateSyncItem | null => {
          const action = s.action === "remove" ? "remove" : "add";
          if (s.type === "contact" && s.contact?.phone_number) {
            return {
              kind: "contact",
              action,
              phone: normalizePhone(s.contact.phone_number),
              name: s.contact.full_name,
            };
          }
          if (s.type === "label" && s.label?.id) {
            return {
              kind: "label",
              action,
              labelId: s.label.id,
              labelName: s.label.name,
              labelColor: s.label.color,
            };
          }
          if (
            s.type === "contact_label_association" &&
            s.contact_label_association?.phone_number &&
            s.contact_label_association?.label_id
          ) {
            return {
              kind: "association",
              action,
              phone: s.contact_label_association.phone_number,
              labelId: s.contact_label_association.label_id,
            };
          }
          return null;
        })
        .filter((x): x is StateSyncItem => x !== null);
      if (syncItems.length)
        jobs.push({
          kind: "state_sync",
          items: syncItems,
          channelPhoneNumberId,
        });
    }
  }
  return jobs;
}
