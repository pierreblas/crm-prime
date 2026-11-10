import { z } from "zod";

/**
 * Claves de API que EMITE el CRM para que sistemas externos (n8n, Zapier,
 * una landing…) le escriban. Distintas de las credenciales que el CRM
 * consume para llamar a terceros (ver integration-settings.schema).
 *
 * Cada integración tiene su propia clave: así se puede revocar una sin tocar
 * las demás, se sabe cuál está llamando (el origen del contacto deja de ser
 * autodeclarado) y se limita qué puede hacer cada una con los ámbitos.
 */

// Permisos que puede tener una clave. Se nombran recurso:acción.
export const apiScopes = [
  "leads:write",
  "contacts:read",
  "contacts:write",
  "deals:write",
  "messages:send",
  "analytics:read",
  "products:read",
  "products:write",
] as const;
export type ApiScope = (typeof apiScopes)[number];

export const apiScopeLabels: Record<ApiScope, string> = {
  "leads:write": "Crear leads y contactos",
  "contacts:read": "Leer contactos",
  "contacts:write": "Editar contactos",
  "deals:write": "Crear y mover oportunidades",
  "messages:send": "Enviar mensajes",
  "analytics:read": "Leer métricas",
  "products:read": "Leer el catálogo",
  "products:write": "Crear y actualizar productos",
};

export const apiScopeHints: Record<ApiScope, string> = {
  "leads:write": "POST /webhooks/lead — es el que necesita una landing o un n8n.",
  "contacts:read": "Consultar el directorio de contactos.",
  "contacts:write": "Modificar nombre, etiquetas y campos de un contacto.",
  "deals:write": "Crear oportunidades y cambiarlas de etapa.",
  "messages:send": "Enviar mensajes de WhatsApp en nombre del negocio.",
  "analytics:read": "Consultar métricas agregadas para un dashboard externo.",
  "products:read": "Listar los productos del catálogo con sus precios y campos.",
  "products:write": "Crear, actualizar o cargar en bloque el catálogo desde un ERP o un n8n.",
};

// La clave NUNCA se devuelve entera salvo al crearla: solo su prefijo.
export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(), // "crm_a1b2c3d4" — identifica la clave sin revelarla
  scopes: z.array(z.enum(apiScopes)),
  lastUsedAt: z.string().nullable(),
  useCount: z.number(),
  revokedAt: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiKeyDto = z.infer<typeof apiKeySchema>;

export const createApiKeySchema = z.object({
  name: z.string().min(1, "Ponle un nombre").max(80),
  scopes: z.array(z.enum(apiScopes)).min(1, "Elige al menos un permiso"),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

// Respuesta de la creación: la única vez que se ve el secreto completo.
export const createdApiKeySchema = z.object({
  key: apiKeySchema,
  secret: z.string(), // "crm_a1b2c3d4_<32 chars>" — no se puede recuperar
});
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const updateApiKeySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  scopes: z.array(z.enum(apiScopes)).min(1).optional(),
});
export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;
