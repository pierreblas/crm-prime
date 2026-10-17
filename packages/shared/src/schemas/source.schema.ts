import { z } from "zod";
import { Role } from "../enums.js";
import { userPermissionsSchema } from "../permissions.js";

// Fuente (origen del lead).
export const sourceDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  contactCount: z.number(),
  createdAt: z.string(),
});
export type SourceDto = z.infer<typeof sourceDtoSchema>;

export const createSourceSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().max(20).nullable().default(null),
});
export type CreateSourceInput = z.infer<typeof createSourceSchema>;

export const updateSourceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  color: z.string().max(20).nullable().optional(),
});
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;

// Vendedor con las fuentes que tiene asignadas.
export const sellerDtoSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  sourceIds: z.array(z.string()),
  /** En vigor (un admin, todo). */
  permissions: userPermissionsSchema,
  stats: z.object({
    /** Chats abiertos asignados a esta persona. */
    openAssigned: z.number(),
    /** Chats suyos con mensajes en los últimos 7 días. */
    active7d: z.number(),
    lastSeenAt: z.string().nullable(),
  }),
});
export type SellerDto = z.infer<typeof sellerDtoSchema>;

// Crear un usuario del equipo (solo admin).
export const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.nativeEnum(Role).default(Role.AGENT),
  permissions: userPermissionsSchema.optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

// Editar rol o estado (activo/inactivo) de un usuario (solo admin).
export const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  permissions: userPermissionsSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// Respuesta del panel de vendedores.
export const sellersResponseSchema = z.object({
  sellers: z.array(sellerDtoSchema),
  sources: z.array(sourceDtoSchema),
});
export type SellersResponse = z.infer<typeof sellersResponseSchema>;

// Asignar fuentes a un vendedor (reemplaza las actuales).
export const assignSourcesSchema = z.object({
  sourceIds: z.array(z.string()),
});
export type AssignSourcesInput = z.infer<typeof assignSourcesSchema>;

// Fijar la fuente de un contacto (null = quitar).
export const setContactSourceSchema = z.object({
  contactId: z.string(),
  sourceId: z.string().nullable(),
});
export type SetContactSourceInput = z.infer<typeof setContactSourceSchema>;
