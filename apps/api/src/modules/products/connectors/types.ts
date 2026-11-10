import type { ProductSourceKind, TestProductSourceResult } from "@crm/shared";

/**
 * Conectores de catálogo: cada uno sabe leer una tienda o una hoja y
 * devolver los productos en el molde de Driony. El servicio de sincronización
 * no sabe nada de WooCommerce ni de Shopify: solo de `ExternalProduct`.
 */

/** Un producto tal como lo trae la tienda, ya en el molde de Driony. */
export interface ExternalProduct {
  /** Id estable en la tienda (producto, o producto:variante). */
  externalId: string;
  name: string;
  sku: string | null;
  description: string | null;
  price: number;
  currency: string;
  imageUrl: string | null;
  isActive: boolean;
  /** Valores de campos (key → texto): opciones de la variante, stock, enlace… */
  attributes: Record<string, string>;
  /** Precios en otras monedas (solo las hojas los traen). */
  prices?: { currency: string; amount: number }[];
}

/** Campo de producto que la conexión necesita para guardar sus datos; se crea si no existe. */
export interface ConnectorField {
  key: string;
  label: string;
  type: "text" | "number" | "url";
  showOnCard: boolean;
  help?: string;
}

export interface PullResult {
  items: ExternalProduct[];
  storeName: string | null;
  currency: string | null;
  fields: ConnectorField[];
  warnings: string[];
  /** Credenciales derivadas que conviene guardar (p. ej. el token temporal de Shopify). */
  credentialsPatch?: Record<string, string>;
}

export type TestResult = TestProductSourceResult & { credentialsPatch?: Record<string, string> };

/** Campo de producto existente, para que las hojas emparejen sus columnas. */
export interface KnownField {
  key: string;
  label: string;
  type: string;
  options: string[];
  unit?: string | null;
  required?: boolean;
}

export interface SourceConfig {
  /** La dirección ya normalizada por `normalizeTarget`. */
  target: string;
  defaultCurrency: string | null;
  credentials: Record<string, string>;
  fields: KnownField[];
  /** Guardar credenciales derivadas en el acto (un token renovado que ya no admite vuelta atrás). Solo en conexiones guardadas. */
  saveCredentials?: (patch: Record<string, string>) => Promise<void>;
}

export interface CatalogConnector {
  readonly kind: ProductSourceKind;
  /** Deja la dirección como se guarda (https, sin barra final, dominio .myshopify.com…). Lanza si no sirve. */
  normalizeTarget(raw: string): string;
  /** Comprueba el acceso: nombre, moneda, cuántos hay y una muestra. Lanza ConnectorError si no. */
  test(cfg: SourceConfig): Promise<TestResult>;
  /** Trae el catálogo entero. */
  pull(cfg: SourceConfig): Promise<PullResult>;
}

/** Error que se le puede enseñar al usuario tal cual (credenciales, dirección, formato). */
export class ConnectorError extends Error {}

/** Claves reservadas de los campos que crean las tiendas. */
export const STOCK_KEY = "stock";
export const LINK_KEY = "enlace";
export const CATEGORY_KEY = "categoria";

export const STOCK_FIELD: ConnectorField = { key: STOCK_KEY, label: "Stock", type: "number", showOnCard: true, help: "Unidades disponibles según la tienda." };
export const LINK_FIELD: ConnectorField = { key: LINK_KEY, label: "Enlace", type: "url", showOnCard: false, help: "Página del producto en la tienda. El agente puede enviarla al cliente." };
export const CATEGORY_FIELD: ConnectorField = { key: CATEGORY_KEY, label: "Categoría", type: "text", showOnCard: false, help: "Categoría o tipo según la tienda." };
