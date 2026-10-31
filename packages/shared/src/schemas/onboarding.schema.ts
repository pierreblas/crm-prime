import { z } from "zod";

/**
 * Primeros pasos: la lista de configuración inicial de una empresa nueva.
 *
 * El estado de cada paso NO se guarda: se deduce de los datos (hay un número
 * conectado, hay productos, llegó una conversación…), así que se marca solo
 * al hacer la tarea de verdad y no al pulsar un botón. Lo único persistido es
 * lo que no se puede deducir: pasos omitidos, pasos marcados por el sistema
 * (probar el agente) y si la empresa ocultó la lista.
 *
 * Orden = camino más corto al primer valor: que un cliente escriba y el
 * agente le responda con el catálogo del negocio.
 */
export const ONBOARDING_STEP_KEYS = [
  "whatsapp", // conectar un número
  "ai", // clave de OpenAI/Anthropic (o la comparte la plataforma)
  "agent", // personalizar el agente de IA
  "products", // cargar el catálogo
  "knowledge", // subir conocimiento (FAQ, políticas)
  "try_agent", // probarlo en el simulador
  "first_chat", // recibir la primera conversación real
  "team", // invitar a un compañero
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];
export const onboardingStepKeySchema = z.enum(ONBOARDING_STEP_KEYS);

export const onboardingStepStatuses = ["done", "pending", "skipped"] as const;
export type OnboardingStepStatus = (typeof onboardingStepStatuses)[number];

export const onboardingStepSchema = z.object({
  key: onboardingStepKeySchema,
  status: z.enum(onboardingStepStatuses),
  // Cifra que respalda el estado (productos cargados, documentos, usuarios…).
  count: z.number().nullable(),
});
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const onboardingDtoSchema = z.object({
  steps: z.array(onboardingStepSchema),
  // Hechos u omitidos, sobre el total: lo que pinta la barra de progreso.
  done: z.number(),
  total: z.number(),
  completedAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  orgCreatedAt: z.string(),
  // Cuándo se construyó la IA con el asistente de bienvenida (null: aún no).
  setupCompletedAt: z.string().nullable(),
  // Tours de pantalla que este usuario ya vio (claves de TOUR_KEYS).
  toursSeen: z.array(z.string()),
});
export type OnboardingDto = z.infer<typeof onboardingDtoSchema>;

/** Claves de los tours guiados. Viven aquí para validar lo que llega a la API. */
export const TOUR_KEYS = ["welcome", "inbox", "pipeline", "agents", "products", "whatsapp"] as const;
export type TourKey = (typeof TOUR_KEYS)[number];
export const tourKeySchema = z.enum(TOUR_KEYS);
