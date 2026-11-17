import { Prisma } from "@prisma/client";

// Quita tildes en SQL igual que `fold` (utils/fold), para comparar ambos lados
// sin extensiones de Postgres: «Camión», «camion» y «CAMION» son lo mismo.
const ACCENTS = "áéíóúàèìòùâêîôûäëïöüãõñçÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÃÕÑÇ";
const PLAIN = "aeiouaeiouaeiouaeiouaoncAEIOUAEIOUAEIOUAEIOUAONC";

/** La columna o expresión sin tildes y en minúsculas (null → ''). */
export const foldSql = (col: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`lower(translate(coalesce(${col}, ''), ${ACCENTS}, ${PLAIN}))`;

/** Escapa % y _ para usar un texto dentro de LIKE. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, "\\$&");
