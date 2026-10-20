import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Búsqueda del catálogo para el agente de IA.
 *
 * El cliente no escribe el nombre exacto: escribe «zapatilla runing», «curso
 * de python nivel 2», «la de 50 soles». Así que la búsqueda es por palabras,
 * sin tildes ni mayúsculas, sobre nombre, descripción, SKU y los campos
 * personalizados visibles, y ordena por cuántas palabras acierta cada
 * producto (y antes los que contienen la frase entera). Con catálogos grandes
 * devuelve además la lista de nombres de TODO el catálogo, para que el agente
 * sepa qué existe aunque la búsqueda no lo encuentre y pueda volver a buscar.
 */

export interface ProductSearchOptions {
  /** Máximo de productos con detalle cuando la búsqueda acierta. */
  max?: number;
  /** Máximo con detalle cuando se lista el catálogo (sin término o sin coincidencias). */
  listMax?: number;
  /** Claves de campos personalizados en los que también se busca. */
  attrKeys?: string[];
  /** Máximo de nombres en el índice del catálogo. */
  maxNames?: number;
}

export interface ProductSearchResult {
  /** Ids de los productos con detalle, en orden de relevancia (o alfabético si no hubo término). */
  ids: string[];
  /** Cuántos productos activos tiene el catálogo. */
  total: number;
  /** Hubo término pero nada coincidió: se listó el catálogo. */
  listedAll: boolean;
  /** Nombres de los productos que NO van con detalle en esta respuesta. */
  otherNames: string[];
}

/** Sin tildes, en minúsculas, espacios colapsados: lo mismo que hace el SQL con cada campo. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras con las que se busca: de dos letras en adelante, sin tildes. */
export function tokens(query: string): string[] {
  return [...new Set(fold(query).split(" ").filter((t) => t.length >= 2))].slice(0, 8);
}

// Quita tildes en SQL igual que `fold`, para comparar ambos lados sin extensiones.
const ACCENTS = "áéíóúàèìòùâêîôûäëïöüãõñçÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÃÕÑÇ";
const PLAIN = "aeiouaeiouaeiouaeiouaoncAEIOUAEIOUAEIOUAEIOUAONC";
const f = (col: Prisma.Sql) => Prisma.sql`lower(translate(coalesce(${col}, ''), ${ACCENTS}, ${PLAIN}))`;

export async function searchProducts(
  prisma: PrismaClient,
  orgId: string,
  query: string,
  opts: ProductSearchOptions = {},
): Promise<ProductSearchResult> {
  const max = opts.max ?? 50;
  const listMax = opts.listMax ?? max;
  const maxNames = opts.maxNames ?? 300;
  const words = tokens(query);
  const phrase = fold(query);
  const attrKeys = opts.attrKeys ?? [];

  const total = await prisma.product.count({ where: { orgId, isActive: true } });

  let ids: string[] = [];
  if (words.length) {
    // Texto donde se busca: nombre, descripción, SKU y los valores de los campos visibles.
    const attrText = attrKeys.length
      ? Prisma.sql`coalesce((SELECT string_agg(a.value, ' ') FROM jsonb_each_text(coalesce(p.attributes, '{}'::jsonb)) a WHERE a.key = ANY(${attrKeys})), '')`
      : Prisma.sql`''`;
    const haystack = Prisma.sql`(${f(Prisma.sql`p.name`)} || ' ' || ${f(Prisma.sql`p.description`)} || ' ' || ${f(Prisma.sql`p.sku`)} || ' ' || ${f(attrText)})`;
    const hits = words.map((w) => Prisma.sql`(CASE WHEN ${haystack} LIKE ${"%" + w + "%"} THEN 1 ELSE 0 END)`);
    const score = Prisma.join(hits, " + ");
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM (
        SELECT p.id, p.name,
          (${score}) AS score,
          (CASE WHEN ${f(Prisma.sql`p.name`)} LIKE ${"%" + phrase + "%"} THEN 3 ELSE 0 END) AS exact
        FROM products p
        WHERE p."orgId" = ${orgId} AND p."isActive"
      ) s
      WHERE s.score > 0
      ORDER BY (s.score + s.exact) DESC, s.name ASC
      LIMIT ${max}
    `;
    ids = rows.map((r) => r.id);
  }

  let listedAll = false;
  if (ids.length === 0) {
    const rows = await prisma.product.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      take: listMax,
      select: { id: true },
    });
    ids = rows.map((r) => r.id);
    listedAll = words.length > 0;
  }

  // Lo que no va con detalle, al menos por nombre: el agente sabe que existe y puede pedirlo.
  let otherNames: string[] = [];
  if (total > ids.length) {
    const rest = await prisma.product.findMany({
      where: { orgId, isActive: true, id: { notIn: ids } },
      orderBy: { name: "asc" },
      take: maxNames,
      select: { name: true },
    });
    otherNames = rest.map((r) => r.name);
  }

  return { ids, total, listedAll, otherNames };
}
