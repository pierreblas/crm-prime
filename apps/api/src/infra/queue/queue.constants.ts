// Nombres de las colas BullMQ.
export const QUEUE_INBOUND = "wa-inbound";
export const QUEUE_OUTBOUND = "wa-outbound";
export const QUEUE_CAMPAIGN = "wa-campaign";
export const QUEUE_AI_REPLY = "ai-reply"; // turno del autopilot tras esperar a que el cliente termine de escribir
export const QUEUE_FLOW = "wa-flow"; // reanudación de flujos tras un "Esperar"
export const QUEUE_WEBHOOK = "outgoing-webhook"; // avisos a sistemas externos
export const QUEUE_META_LEADS = "meta-leads"; // leads de formularios de Meta
export const QUEUE_META_MESSAGING = "meta-messaging"; // mensajes de Messenger e Instagram (páginas de Facebook)
export const QUEUE_TIKTOK = "tiktok-messaging"; // mensajes directos de TikTok
export const QUEUE_PRODUCT_SYNC = "product-sync"; // lectura de catálogos conectados (WooCommerce, Shopify, hojas)
export const QUEUE_EMAIL = "email-send"; // correos automáticos (bloque «Enviar correo» de los flujos)
