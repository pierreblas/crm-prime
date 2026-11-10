import { z } from "zod";

// Etiqueta (label) reutilizable en contactos y campañas.
export const tagDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  contactCount: z.number(),
  /** Viene de las etiquetas de la app de WhatsApp (coexistencia). */
  waLabel: z.boolean().default(false),
});
export type TagDto = z.infer<typeof tagDtoSchema>;

export const createTagSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).nullable().default(null),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().max(20).nullable().optional(),
});
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
