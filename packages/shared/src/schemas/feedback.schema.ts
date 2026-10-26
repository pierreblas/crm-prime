import { z } from "zod";

/**
 * Lo que las empresas nos cuentan desde el panel: errores, sugerencias y su
 * opinión de Driony. Lo leemos en la consola de plataforma.
 */
export const feedbackKinds = ["bug", "suggestion", "other", "opinion"] as const;
export type FeedbackKind = (typeof feedbackKinds)[number];

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "Error",
  suggestion: "Sugerencia",
  other: "Otro",
  opinion: "Opinión",
};

export const feedbackStatuses = ["new", "seen", "done"] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "Nuevo",
  seen: "Visto",
  done: "Resuelto",
};

export const createFeedbackSchema = z
  .object({
    kind: z.enum(feedbackKinds),
    message: z.string().trim().max(4000).default(""),
    /** Solo en «opinion»: de 1 a 5. */
    rating: z.number().int().min(1).max(5).nullable().default(null),
    /** Pantalla desde la que se envió (ruta, sin dominio). */
    pagePath: z.string().max(300).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "opinion") {
      if (!v.rating) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rating"], message: "elige de 1 a 5 estrellas" });
    } else if (v.message.length < 5) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["message"], message: "cuéntanos un poco más (al menos 5 caracteres)" });
    }
  });
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

export const feedbackCreatedSchema = z.object({ id: z.string() });
export type FeedbackCreated = z.infer<typeof feedbackCreatedSchema>;

// ── Consola de plataforma ──
export const platformFeedbackSchema = z.object({
  id: z.string(),
  kind: z.enum(feedbackKinds),
  status: z.enum(feedbackStatuses),
  message: z.string(),
  rating: z.number().nullable(),
  pagePath: z.string().nullable(),
  userAgent: z.string().nullable(),
  orgId: z.string(),
  orgName: z.string(),
  orgSlug: z.string(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  createdAt: z.string(),
});
export type PlatformFeedback = z.infer<typeof platformFeedbackSchema>;

export const platformFeedbackListSchema = z.object({
  items: z.array(platformFeedbackSchema),
  /** Sin filtrar: cuántos nuevos hay y la media de las opiniones. */
  newCount: z.number(),
  opinions: z.number(),
  avgRating: z.number().nullable(),
});
export type PlatformFeedbackList = z.infer<typeof platformFeedbackListSchema>;

export const updatePlatformFeedbackSchema = z.object({ status: z.enum(feedbackStatuses) });
export type UpdatePlatformFeedbackInput = z.infer<typeof updatePlatformFeedbackSchema>;
