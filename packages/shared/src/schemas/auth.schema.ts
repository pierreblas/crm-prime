import { z } from "zod";
import { userPermissionsSchema } from "../permissions.js";
import { Platform, Role } from "../enums.js";

// ── Login ────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  // Subdominio desde el que se accede, en modo SaaS. Lo pone el servidor a
  // partir del `Host`, no el formulario.
  //
  // Sirve para SABER A QUIÉN BUSCAR, no para dar acceso: el mismo correo puede
  // existir en dos empresas. La autorización sigue saliendo de la contraseña, y
  // el `orgId` del token se toma de la fila del usuario, nunca del `Host`.
  orgSlug: z.string().max(63).optional(),
  // metadatos del dispositivo (para la Session). Opcionales: el server
  // completa con userAgent/ip si no llegan.
  platform: z.nativeEnum(Platform).default(Platform.WEB),
  deviceName: z.string().max(120).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ── Registro ─────────────────────────────────────────────────
export const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// ── Pase tras el alta (entrar en el subdominio nuevo) ────────
export const handoffSchema = z.object({
  token: z.string().min(1),
  platform: z.nativeEnum(Platform).default(Platform.WEB),
  deviceName: z.string().max(120).optional(),
});
export type HandoffInput = z.infer<typeof handoffSchema>;

// ── Refresh ──────────────────────────────────────────────────
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

// ── Logout ───────────────────────────────────────────────────
export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

// ── Perfil de la cuenta ──────────────────────────────────────
export const updateProfileSchema = z.object({
  name: z.string().min(1).max(120),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ── Respuestas ───────────────────────────────────────────────
export const publicUserSchema = z.object({
  // Subdominio de la empresa del usuario. La web lo guarda en la sesión para
  // poder mandar al sitio correcto a quien entra por el dominio raíz.
  orgSlug: z.string().optional(),
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.nativeEnum(Role),
  // Cuenta maestra del SaaS (admin.<dominio>); los usuarios de empresa, nunca.
  // Es distinto de ADMIN, que es "administrador de su empresa".
  platformAdmin: z.boolean().optional(),
  /** Qué ve y qué puede hacer (en vigor: un admin lo tiene todo). */
  permissions: userPermissionsSchema.optional(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(), // segundos de vida del access token
  user: publicUserSchema,
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  platform: z.nativeEnum(Platform),
  deviceName: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  current: z.boolean(),
});
export type SessionDto = z.infer<typeof sessionSchema>;

// Claims del JWT de acceso.
export interface AccessTokenClaims {
  sub: string; // userId
  sid: string; // sessionId
  role: Role;
  // Organización del usuario. Va FIRMADA en el token a propósito: es lo que
  // impide que alguien cambie de empresa manipulando el subdominio o una
  // cabecera. El Host nunca decide de quién son los datos.
  org: string; // orgId
}
