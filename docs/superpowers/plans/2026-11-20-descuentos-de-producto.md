# Descuentos de producto: plan de construcción

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un producto pueda tener precio normal, precio con descuento y fecha de fin, que las tiendas conectadas lo llenen solas y que el agente lo diga tal cual, sin calcular.

**Architecture:** `price` sigue siendo lo que se paga hoy; al lado se guarda el precio normal (`regularPrice`) y la fecha de fin (`saleEndsAt`), y lo mismo por moneda (`regularAmount`). Una función compartida calcula qué rige ahora (y trata un descuento vencido como precio normal); un barrido cada 5 minutos deja las filas vencidas como deben.

**Tech Stack:** Turborepo · `packages/shared` (Zod, sin dependencias nuevas) · `apps/api` (NestJS, Prisma 6, pruebas con `tsx --test`) · `apps/web` (Next.js 15, React 19, TanStack Query).

**Spec:** `docs/superpowers/specs/2026-11-20-descuentos-de-producto-design.md`

## Global Constraints

- `price` = lo que paga el cliente hoy. Nunca guardar el precio normal en `price` mientras haya descuento.
- Hay descuento solo si `regularPrice > price`. Si no, `regularPrice` y `saleEndsAt` quedan en null.
- Porcentaje = `Math.max(1, Math.round((1 − price / regularPrice) × 100))`, entero; se calcula al leer, no se guarda.
- Vencido = `saleEndsAt <= ahora`. Un descuento vencido se lee como precio normal sin esperar al barrido.
- El agente no calcula: recibe `price`, `regularPrice`, `discount` y `discountUntil` ya hechos.
- La API solo gana campos opcionales; quien no los manda no nota nada.
- Textos de interfaz y de error en español. Sin dependencias nuevas.
- Tras tocar `packages/shared`: `npm run build -w @crm/shared`. Tras tocar `schema.prisma`: `npm run db:generate` (con los servidores parados) y `npm run db:deploy`.
- Antes de cada `npm run test:rls`: `node ../../scripts/setup-rls-test-db.mjs` desde `apps/api` (la base de pruebas no es idempotente).
- No se sube ni se envía nada a clientes reales al probar: la prueba del agente (`/bots/playground`) no envía.

## Review Focus

Lo que el diseño implica y es más fácil que falle en uso real; cada línea tiene su prueba en la tarea indicada:

1. Descuento en la moneda base y el cliente es de un país sin precio en su moneda → se usa el precio base, marcado como no convertido, **con** su descuento (Tarea 1).
2. La tienda manda el precio de antes igual, menor, vacío o `"0"` → sin descuento, no un «−0 %» (Tareas 1 y 4).
3. El usuario borra el precio con descuento al editar → vuelve al normal y se borra la fecha (Tarea 2).
4. Vence un descuento de un producto con otras monedas, unas con descuento y otras no → solo se restauran las que lo tenían (Tarea 3).
5. La oferta acaba «el 30» a las 23:59 de Lima (ya es día 1 en UTC) → el agente dice «30 de noviembre», no «1 de diciembre» (Tarea 5).

---

### Task 1: Cálculo compartido y tipos

**Files:**
- Modify: `packages/shared/src/money.ts`
- Modify: `packages/shared/src/schemas/product.schema.ts`
- Test: `apps/api/test/money.test.ts` (ampliar; `npm run test:money -w @crm/api`)

**Interfaces — Produces:**
```ts
// money.ts
export interface PriceEntry { currency: string; amount: number; regularAmount?: number | null }
export interface PricedProduct { price: number; currency: string; regularPrice?: number | null; saleEndsAt?: Date | string | null; prices?: PriceEntry[] }
export interface ProductPricing { amount: number; currency: string; fallback: boolean; regular: number | null; percent: number | null; endsAt: string | null }
export function discountPercent(amount: number, regular: number | null | undefined): number | null; // null si no hay descuento
export function productPricing(product: PricedProduct, currency: string | null, now?: Date): ProductPricing;
export function priceFor(product, currency, now?): { amount; currency; fallback }; // igual que hoy, ahora sobre productPricing
/** Para lo que entra de una tienda o un archivo: sin descuento válido, todo null. */
export function lenientDiscount(price: number, regular: number | null | undefined, endsAt: Date | null | undefined): { regularPrice: number | null; saleEndsAt: Date | null };
/** Para lo que guarda una persona o la API: el mensaje de error en español, o null si está bien. */
export function checkDiscount(price: number, regularPrice: number | null | undefined, saleEndsAt: string | Date | null | undefined, now?: Date): string | null;
/** «30 de noviembre», en esa zona horaria. */
export function discountUntilText(endsAt: string | Date, timeZone: string): string;
```
```ts
// product.schema.ts
productDtoSchema: + regularPrice: number|null (default null), saleEndsAt: string|null (default null), discountPercent: number|null (default null);
                  prices[]: + regularAmount: number|null (default null)
createProductSchema / updateProductSchema: + regularPrice (nullable), saleEndsAt (ISO datetime, nullable); prices[]: + regularAmount (nullable, opcional)
PRODUCT_IMPORT_FIELDS: + { key: "salePrice", label: "Precio con descuento", required: false,
  aliases: ["precio con descuento","precio descuento","precio oferta","precio de oferta","oferta","precio rebajado","precio promocional","sale price","sale_price"] }
productImportRowSchema / ProductImportRow: + regularPrice: number|null (default null)
```
Mensajes de `checkDiscount`, exactos: «El precio con descuento debe ser menor que el precio normal» (`regularPrice <= price`), «Pon el precio normal para usar una fecha de fin» (fecha sin `regularPrice`), «La fecha de fin del descuento ya pasó».

- [ ] **Step 1: pruebas que fallan** en `money.test.ts`:
  - `productPricing({price:40,currency:"USD",regularPrice:50,saleEndsAt:futuro}, "USD")` → `{amount:40,currency:"USD",fallback:false,regular:50,percent:20,endsAt:<ISO>}`.
  - Vencido (`saleEndsAt` hace 1 s) → `{amount:50, regular:null, percent:null, endsAt:null}`; `priceFor` devuelve 50.
  - Sin fecha → `endsAt:null`, descuento vigente.
  - Otra moneda con `regularAmount`: `prices:[{currency:"PEN",amount:150,regularAmount:190}]`, `"PEN"` → `{amount:150,regular:190,percent:21}`; otra moneda sin `regularAmount` → `regular:null` aunque la base tenga descuento.
  - **Review Focus 1:** cliente `"MXN"` sin precio en MXN → `{amount:40,currency:"USD",fallback:true,regular:50,percent:20}`.
  - **Review Focus 2:** `discountPercent(50,50)`, `(50,40)`, `(50,null)`, `(50,0)` → `null`; `discountPercent(49.9,50)` → `1` (nunca 0); `lenientDiscount(40,50,f)` → `{regularPrice:50,saleEndsAt:f}`; `lenientDiscount(50,50,f)` y `(50,0,f)` → los dos null.
  - `checkDiscount`: los tres mensajes y `null` en el caso válido y en «sin descuento» (`regularPrice` null, sin fecha).
  - `discountUntilText("2026-12-01T04:59:00.000Z","America/Lima")` → `"30 de noviembre"`.
  - Importación: `guessColumnMapping(["Nombre","Precio normal","Precio oferta"])` → `price:"Precio normal"`, `salePrice:"Precio oferta"`; `toProductImportRow` con oferta 40 y precio 50 → `price:40, regularPrice:50`; oferta vacía, igual o mayor → `price:50, regularPrice:null`; oferta `"abc"` → error «Precio con descuento no válido: "abc"»; sin la columna → como hoy.
- [ ] **Step 2:** `npm run test:money -w @crm/api` → FALLA (funciones no exportadas).
- [ ] **Step 3: implementar** las firmas de arriba. `productPricing`: elegir la entrada (base, la moneda pedida, o base con `fallback`), aplicar vencimiento y la regla `regular > amount`.
- [ ] **Step 4:** `npm run build -w @crm/shared && npm run test:money -w @crm/api` → PASA.
- [ ] **Step 5:** commit «Product pricing with discounts in the shared package».

### Task 2: Base de datos y API de productos

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Product`: `regularPrice Decimal? @db.Decimal(12, 2)`, `saleEndsAt DateTime?`, `@@index([saleEndsAt])`; `ProductPrice`: `regularAmount Decimal? @db.Decimal(12, 2)`)
- Create: `apps/api/prisma/migrations/20261120090000_product_discounts/migration.sql` (idempotente: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- Modify: `apps/api/src/modules/products/product-catalog.service.ts` (`toProductDto`; filtro `discount`)
- Modify: `apps/api/src/modules/products/products.controller.ts` (crear, editar, importar, `setPrices`, `upsertPrices`)
- Modify: `packages/shared/src/schemas/product-list.schema.ts` (`ProductQuery.discount: boolean`, parámetro `discount=1`, cuenta como filtro activo)
- Modify: `packages/shared/src/schemas/public-products.schema.ts`, `apps/api/src/modules/public-api/public-products.service.ts`
- Test: `apps/api/test/product-discounts.test.ts` (nuevo; script `"test:discounts": "tsx --test test/product-discounts.test.ts"`), `apps/api/test/rls.test.ts`

**Interfaces — Consumes:** todo lo de la Tarea 1.
**Produces:** `ProductDto` y `PublicProduct` con `regularPrice`, `saleEndsAt`, `discountPercent` y `prices[].regularAmount`, ya pasados por `productPricing` (un vencido sale como precio normal). Filtro SQL «con descuento»: `p."regularPrice" > p.price AND (p."saleEndsAt" IS NULL OR p."saleEndsAt" > now())`.

- [ ] **Step 1: pruebas que fallan** (`product-discounts.test.ts`, con dobles): `toProductDto` de una fila con `price 40`, `regularPrice 50`, fecha futura → `price:40, regularPrice:50, discountPercent:20, saleEndsAt:<ISO>`; la misma fila vencida → `price:50, regularPrice:null, discountPercent:null, saleEndsAt:null`; `prices[]` con y sin `regularAmount`.
- [ ] **Step 2:** en `rls.test.ts`, una prueba con base real: crear un producto con descuento por el controlador → se lee con descuento; filtro `discount` lo devuelve y no devuelve otro sin descuento; `PATCH` con `regularPrice` ≤ `price` → rechazo con el mensaje de `checkDiscount`; **Review Focus 3:** `PATCH { price: 50, regularPrice: null }` → `regularPrice` y `saleEndsAt` null; la otra empresa no ve nada.
- [ ] **Step 3:** correr las dos → FALLAN.
- [ ] **Step 4: implementar.** En crear y editar, validar con `checkDiscount` sobre los valores finales (lo que viene, o lo guardado si no viene) y lanzar `BadRequestException` con su mensaje; `regularPrice: null` borra también `saleEndsAt`. En la importación, escribir `regularPrice` de la fila (y null cuando no trae). `setPrices`/`upsertPrices` llevan `regularAmount` (misma regla por moneda con `checkDiscount`). API pública: mismos campos y misma validación.
- [ ] **Step 5:** `npm run db:generate && npm run db:deploy`, `npm run test:discounts`, RLS con base recién creada → PASAN. `npx tsc --noEmit` en `apps/api`.
- [ ] **Step 6:** commit «Store and serve product discounts».

### Task 3: Barrido de descuentos vencidos

**Files:**
- Create: `apps/api/src/modules/products/product-discounts.service.ts`
- Modify: el módulo de productos (registrar el servicio), `ARCHITECTURE-MULTITENANT.md` (añadirlo a la lista de barridos)
- Test: `apps/api/test/product-discounts.test.ts`, `apps/api/test/rls.test.ts`

**Interfaces — Produces:**
```ts
@Injectable() export class ProductDiscountsService implements OnModuleInit, OnModuleDestroy {
  /** Restaura lo vencido en todas las empresas. Devuelve cuántos productos tocó. */
  async sweep(now?: Date): Promise<number>;
}
```
Cada 5 minutos; se apaga con `PRODUCT_DISCOUNT_SWEEP=off`. `runUnscoped("descuentos vencidos", …)` para encontrar productos con `saleEndsAt <= now` (lotes de 500), `runInOrg(orgId, …)` para escribir: `price := regularPrice` si es mayor, `regularPrice := null`, `saleEndsAt := null`; en `product_prices` de ese producto, `amount := "regularAmount"`, `"regularAmount" := NULL` donde no sea null y sea mayor.

- [ ] **Step 1: prueba que falla** (RLS, base real): dos empresas con un producto vencido cada una y uno vigente; el de la empresa A tiene PEN con `regularAmount` y EUR sin él. Tras `sweep()`: los dos vencidos quedan `price = normal`, sin `regularPrice` ni fecha; **Review Focus 4:** PEN vuelve a su normal y EUR no cambia; el vigente no se toca; segunda pasada → 0.
- [ ] **Step 2:** correr → FALLA. **Step 3:** implementar. **Step 4:** RLS con base nueva → PASA.
- [ ] **Step 5:** commit «Restore the regular price when a discount ends».

### Task 4: Tiendas conectadas, hojas y archivos

**Files:**
- Modify: `apps/api/src/modules/products/connectors/types.ts` (`ExternalProduct`: `regularPrice?: number | null`, `saleEndsAt?: Date | null`; `prices[]`: `regularAmount?: number | null`)
- Modify: `connectors/shopify.connector.ts` (`compareAtPrice`), `connectors/woocommerce.connector.ts` (`regular_price`, `date_on_sale_to_gmt`, también en variaciones), `connectors/mercadolibre.connector.ts` (`original_price`), `connectors/sheet.connector.ts` (lo que devuelve `toProductImportRow`)
- Modify: `apps/api/src/modules/products/product-sync.service.ts` (`PRODUCT_SELECT`, `data`, `same()`, `upsertPrices`)
- Test: `apps/api/test/product-discounts.test.ts`

**Interfaces — Consumes:** `lenientDiscount` (Tarea 1). **Produces:** cada conector exporta una función pura que saca el descuento de un artículo de su tienda, para poder probarla:
```ts
export function shopifyDiscount(v: { price: string; compareAtPrice: string | null }): { regularPrice: number | null; saleEndsAt: Date | null };
export function wooDiscount(p: { price?: string; regular_price?: string; date_on_sale_to_gmt?: string | null }): { regularPrice: number | null; saleEndsAt: Date | null };
export function mercadoLibreDiscount(item: { price: number | null; original_price?: number | null }): { regularPrice: number | null; saleEndsAt: Date | null };
```

- [ ] **Step 1: pruebas que fallan:** Shopify `{price:"40.00",compareAtPrice:"50.00"}` → 50; **Review Focus 2:** `compareAtPrice` `null`, `"40.00"`, `"30.00"`, `"0"` → null. Woo `{price:"40",regular_price:"50",date_on_sale_to_gmt:"2026-11-30T23:59:59"}` → `{50, 2026-11-30T23:59:59Z}`; sin oferta (`price` = `regular_price`) → null y sin fecha; `regular_price:""` → null. Mercado Libre `{price:40,original_price:50}` → 50; `original_price:null` → null. Sincronización (`same()`): mismo producto con otro `regularPrice` o otra fecha → no es «igual» (se reescribe).
- [ ] **Step 2:** correr → FALLA. **Step 3:** implementar y usar esas funciones en el mapeo de cada conector; en la sincronización escribir `regularPrice`/`saleEndsAt` (null cuando la tienda no manda oferta). **Step 4:** `npm run test:discounts` → PASA; `npx tsc --noEmit`.
- [ ] **Step 5:** commit «Read sale prices from connected stores, sheets and files».

### Task 5: Lo que lee y dice el agente

**Files:**
- Create: `apps/api/src/modules/ai/product-agent-price.ts`
- Modify: `apps/api/src/modules/ai/agent.service.ts` (`search_products`, `buildSystemParts`, `draftFollowUp`)
- Test: `apps/api/test/product-discounts.test.ts`

**Interfaces — Produces:**
```ts
/** El precio de un producto como lo recibe el agente. Sin descuento vigente, solo price y currency. */
export function agentPrice(product: PricedProduct, clientCurrency: string | null, timeZone: string, now?: Date):
  { price: number; currency: string; priceInClientCurrency?: boolean; regularPrice?: number; discount?: string; discountUntil?: string };
```
`discount` = `"20 %"`. `discountUntil` = `discountUntilText(endsAt, timeZone)`. La zona horaria: `bookingSettings.timezone` de la empresa, o `"America/Lima"` si no tiene fila.

Regla fija (texto exacto), añadida cuando el agente tiene `search_products`:
> Descuentos: si un producto trae «regularPrice», está rebajado: hoy cuesta «price», antes costaba «regularPrice» y, si trae «discountUntil», el descuento vale hasta esa fecha. Dilo así, con esas cifras. No calcules otro precio ni otro porcentaje, no ofrezcas descuentos que no vengan en el producto y no alargues la fecha.

Frase añadida a la instrucción de `draftFollowUp` (texto exacto):
> No menciones precios, descuentos ni fechas de oferta: pueden haber cambiado desde que se hablaron.

- [ ] **Step 1: pruebas que fallan:** `agentPrice` con descuento vigente → `{price:40,currency:"USD",regularPrice:50,discount:"20 %",discountUntil:"30 de noviembre"}`; **Review Focus 5:** fin `2026-12-01T04:59:00Z` con `"America/Lima"` → `"30 de noviembre"`; sin descuento o vencido → sin `regularPrice`, `discount` ni `discountUntil` (vencido: `price` = el normal); cliente en moneda sin precio → `priceInClientCurrency:false` y el descuento de la base. `buildSystemParts` con `search_products` contiene la regla; sin ella, no. La instrucción de `draftFollowUp` contiene la frase.
- [ ] **Step 2:** correr → FALLA. **Step 3:** implementar; en `search_products` pedir `regularPrice`, `saleEndsAt` y `prices.regularAmount` y armar el precio con `agentPrice`. **Step 4:** `npm run test:discounts`, `test:playground`, `test:simulator`, `test:followups` → PASAN.
- [ ] **Step 5:** commit «Tell the agent about discounts so it never computes them».

### Task 6: Editor, lista y filtro

**Files:**
- Modify: `apps/web/src/features/products/ProductsManager.tsx` (formulario), `ProductResults.tsx` (tarjeta y tabla), `ProductFilters.tsx` («Con descuento»), `apps/web/src/app/globals.css` (`.prod-*`)
- Comprobación: guion de navegador en la carpeta de pruebas de la sesión (no va al repositorio)

**Interfaces — Consumes:** `ProductDto` de la Tarea 2; `discountPercent`, `checkDiscount`, `formatMoney`.

Formulario (etiquetas exactas): «Precio normal», «Precio con descuento (opcional)», «Hasta (opcional)» (campo de fecha), y el porcentaje que resulta al lado («−20 %»). Atajo: campo «−%» con botón «Aplicar» que rellena el precio con descuento de la base y de cada otra moneda con `normal × (1 − %/100)` redondeado a 2 decimales. Cada otra moneda: su importe normal y su importe con descuento. Al guardar y al abrir, el mapeo del diseño («Por dónde entra › Editor»). Fecha: fin de ese día en la hora del navegador. Producto de una tienda conectada: campos de solo lectura. El error de `checkDiscount` se muestra junto al campo antes de enviar.

Lista: precio de hoy; si hay descuento, el normal tachado y la marca «−20 %» (con «hasta 30 nov» si tiene fecha), en tarjeta y en tabla, también en las otras monedas.

- [ ] **Step 1:** implementar formulario, lista y filtro. `npx tsc --noEmit` en `apps/web`.
- [ ] **Step 2: comprobar en el navegador** (1440 px y 390 px, sin desborde ni errores de consola): crear un producto con normal 50 y descuento 40 hasta mañana → la lista muestra 40, 50 tachado y «−20 %»; el atajo «−25 %» sobre 200 PEN pone 150; descuento ≥ normal → mensaje y no guarda; borrar el descuento → vuelve a 50 sin marca; filtro «Con descuento» lo incluye y lo excluye; archivo de importación con «Precio normal» y «Precio oferta» → la vista previa muestra el descuento. Borrar al final lo creado.
- [ ] **Step 3:** commit «Edit and see product discounts».

### Task 7: Prueba con el agente real y cierre

- [ ] **Step 1:** con un producto de prueba con descuento (creado y borrado en la base local) y el agente real en `/bots/playground`: pregunta el precio → dice precio, el de antes y la fecha, con las cifras exactas; «¿me haces 30 %?» → no inventa otro descuento; con el descuento vencido → dice el precio normal y no menciona la oferta. Restaurar todo lo cambiado.
- [ ] **Step 2:** todas las suites (`test:*` de `apps/api`) + RLS con base nueva + `tsc` de las dos apps + `npm run build -w @crm/shared`.
- [ ] **Step 3:** anotar en la bitácora de Obsidian; el usuario pidió subirlo: unir a `main` y `git push`.
