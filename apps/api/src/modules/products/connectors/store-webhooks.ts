import { createHmac, timingSafeEqual } from "node:crypto";
import { ConnectorError, type SourceConfig } from "./types";
import { wooRequest } from "./woocommerce.connector";
import { shopifyGraphql, shopifyToken } from "./shopify.connector";

/**
 * Webhooks de entrada de las tiendas: en vez de esperar a la siguiente
 * lectura, la tienda avisa cuando cambia un producto y Driony relee.
 *
 * El aviso es solo un «toque»: no se confía en su cuerpo, se vuelve a leer el
 * catálogo con las credenciales guardadas. Por eso basta con que la URL lleve
 * el token de la conexión; además, cuando la tienda firma (WooCommerce con el
 * secreto, Shopify con el secreto de cliente de la app) se comprueba la firma.
 */

export const WOO_TOPICS = ["product.created", "product.updated", "product.deleted", "product.restored"] as const;
export const SHOPIFY_TOPICS = ["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE"] as const;
const WEBHOOK_NAME = "Driony · catálogo";

/** `X-WC-Webhook-Signature`: HMAC-SHA256 del cuerpo con el secreto del webhook, en base64. */
export function verifyWooSignature(secret: string, header: string, rawBody: Buffer): boolean {
  return hmacBase64Equals(secret, header, rawBody);
}

/** `X-Shopify-Hmac-Sha256`: HMAC-SHA256 del cuerpo con el secreto de cliente de la app, en base64. */
export function verifyShopifyHmac(clientSecret: string, header: string, rawBody: Buffer): boolean {
  return hmacBase64Equals(clientSecret, header, rawBody);
}

function hmacBase64Equals(secret: string, header: string, rawBody: Buffer): boolean {
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("base64"));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ── WooCommerce ──────────────────────────────────────────────

interface WooWebhook {
  id: number;
  topic: string;
  delivery_url: string;
  status: string;
}

/** Crea los webhooks de producto que falten, apuntando a nuestra URL y firmados con el token. */
export async function registerWooWebhooks(cfg: SourceConfig, url: string, secret: string): Promise<void> {
  const existing = await listWooWebhooks(cfg, url);
  const present = new Set(existing.map((w) => w.topic));
  for (const topic of WOO_TOPICS) {
    if (present.has(topic)) continue;
    try {
      await wooRequest<WooWebhook>(cfg, "webhooks", {
        method: "POST",
        body: { name: WEBHOOK_NAME, topic, delivery_url: url, secret, status: "active" },
      });
    } catch (e) {
      if (e instanceof ConnectorError && /rechazó las claves|401|403/.test(e.message)) {
        throw new ConnectorError(
          "La clave de WooCommerce solo tiene permiso de lectura, así que los webhooks hay que crearlos a mano (o dale permiso de lectura/escritura y pulsa «Registrar de nuevo»).",
        );
      }
      throw e;
    }
  }
}

/** Quita nuestros webhooks de la tienda. Si no se puede, no pasa nada: la URL ya no existirá. */
export async function unregisterWooWebhooks(cfg: SourceConfig, url: string): Promise<void> {
  const ours = await listWooWebhooks(cfg, url);
  for (const w of ours) {
    await wooRequest(cfg, `webhooks/${w.id}`, { method: "DELETE", params: { force: "true" } });
  }
}

async function listWooWebhooks(cfg: SourceConfig, url: string): Promise<WooWebhook[]> {
  const { data } = await wooRequest<WooWebhook[]>(cfg, "webhooks", { params: { per_page: "100" } });
  return (Array.isArray(data) ? data : []).filter((w) => w.delivery_url === url);
}

// ── Shopify ──────────────────────────────────────────────────

interface ShopifySubscriptionsPage {
  webhookSubscriptions: { nodes: { id: string; topic: string; uri: string | null }[] };
}

export async function registerShopifyWebhooks(cfg: SourceConfig, url: string): Promise<Record<string, string> | undefined> {
  const { token, patch } = await shopifyToken(cfg);
  const existing = await shopifyGraphql<ShopifySubscriptionsPage>(
    cfg,
    token,
    `query DrionyHooks($topics: [WebhookSubscriptionTopic!]) { webhookSubscriptions(first: 100, topics: $topics) { nodes { id topic uri } } }`,
    { topics: SHOPIFY_TOPICS },
  );
  const present = new Set(existing.webhookSubscriptions.nodes.filter((n) => n.uri === url).map((n) => n.topic));
  for (const topic of SHOPIFY_TOPICS) {
    if (present.has(topic)) continue;
    const result = await shopifyGraphql<{ webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: { field: string[] | null; message: string }[] } }>(
      cfg,
      token,
      `mutation DrionyHook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { field message } }
      }`,
      { topic, sub: { uri: url } },
    );
    const err = result.webhookSubscriptionCreate.userErrors[0];
    if (err) throw new ConnectorError(`Shopify no aceptó el webhook ${topic}: ${err.message}`);
  }
  return patch;
}

export async function unregisterShopifyWebhooks(cfg: SourceConfig, url: string): Promise<void> {
  const { token } = await shopifyToken(cfg);
  const existing = await shopifyGraphql<ShopifySubscriptionsPage>(
    cfg,
    token,
    `query DrionyHooks($topics: [WebhookSubscriptionTopic!]) { webhookSubscriptions(first: 100, topics: $topics) { nodes { id topic uri } } }`,
    { topics: SHOPIFY_TOPICS },
  );
  for (const n of existing.webhookSubscriptions.nodes) {
    if (n.uri !== url) continue;
    await shopifyGraphql(cfg, token, `mutation DrionyUnhook($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } } }`, { id: n.id });
  }
}
