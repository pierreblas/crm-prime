import { z } from "zod";
import { DEFAULT_WEEKLY_HOURS, WEEKDAYS, isValidTimezone, type WeeklyHours } from "../booking.js";

// ── Piezas ──────────────────────────────────────────────────
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora en formato HH:MM");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato AAAA-MM-DD");

export const timeRangeSchema = z
  .object({ from: hhmm, to: hhmm })
  .refine((r) => r.from < r.to, "La hora de fin tiene que ser posterior a la de inicio");

export const weeklyHoursSchema = z
  .object(
    Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(timeRangeSchema).max(4).default([])])) as Record<
      (typeof WEEKDAYS)[number],
      z.ZodDefault<z.ZodArray<typeof timeRangeSchema>>
    >,
  )
  .refine(
    (h) =>
      WEEKDAYS.every((d) => {
        const r = [...h[d]].sort((a, b) => a.from.localeCompare(b.from));
        return r.every((x, i) => i === 0 || r[i - 1]!.to <= x.from);
      }),
    "Los tramos de un mismo día no pueden pisarse",
  );

export const dateRangeSchema = z
  .object({ from: ymd, to: ymd })
  .refine((r) => r.from <= r.to, "El día final no puede ser anterior al inicial");

/** Lee un horario guardado (JSON libre) sin fiarse: lo que no valga, el de por defecto. */
export function parseWeeklyHours(raw: unknown): WeeklyHours {
  const r = weeklyHoursSchema.safeParse(raw);
  return r.success ? (r.data as WeeklyHours) : DEFAULT_WEEKLY_HOURS;
}
export function parseDateRanges(raw: unknown): { from: string; to: string }[] {
  const r = z.array(dateRangeSchema).safeParse(raw);
  return r.success ? r.data : [];
}

export const bookingStatuses = ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const;
export type BookingStatus = (typeof bookingStatuses)[number];
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  COMPLETED: "Asistió",
  NO_SHOW: "No asistió",
};
export const bookingSources = ["ai", "manual", "api", "link"] as const;
export type BookingSource = (typeof bookingSources)[number];

// ── Reglas de la empresa ────────────────────────────────────
export const bookingSettingsSchema = z.object({
  timezone: z.string().refine(isValidTimezone, "Zona horaria desconocida").default("America/Lima"),
  /** Cada cuánto empieza una franja. */
  slotIntervalMin: z.number().int().refine((n) => [5, 10, 15, 20, 30, 45, 60].includes(n), "Intervalo no válido").default(30),
  /** Antelación mínima para reservar, en minutos. */
  minNoticeMin: z.number().int().min(0).max(14 * 24 * 60).default(120),
  /** Hasta cuántos días por delante. */
  maxDays: z.number().int().min(1).max(365).default(30),
  /** Etapa del embudo a la que pasa la oportunidad al reservar (null = no se mueve). */
  bookedStageId: z.string().nullable().default(null),
  /** Días cerrados de toda la empresa. */
  blackouts: z.array(dateRangeSchema).max(60).default([]),
});
export type BookingSettingsDto = z.infer<typeof bookingSettingsSchema>;
export const updateBookingSettingsSchema = bookingSettingsSchema.partial();
export type UpdateBookingSettingsInput = z.infer<typeof updateBookingSettingsSchema>;

// ── Servicios ───────────────────────────────────────────────
export const bookingServiceInputSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  durationMin: z.number().int().min(5, "Mínimo 5 minutos").max(8 * 60),
  bufferAfterMin: z.number().int().min(0).max(4 * 60).default(0),
  /** Quién lo atiende: al menos una persona. */
  staffIds: z.array(z.string()).min(1, "Elige al menos una persona que lo atienda").max(50),
  isActive: z.boolean().default(true),
});
export type BookingServiceInput = z.infer<typeof bookingServiceInputSchema>;
export const updateBookingServiceSchema = bookingServiceInputSchema.partial();
export type UpdateBookingServiceInput = z.infer<typeof updateBookingServiceSchema>;

export interface BookingServiceDto {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  bufferAfterMin: number;
  isActive: boolean;
  staff: { id: string; name: string }[];
  /** Citas confirmadas por delante (para avisar antes de desactivarlo). */
  upcoming: number;
}

// ── Horario de cada persona ─────────────────────────────────
export const staffScheduleInputSchema = z.object({
  hours: weeklyHoursSchema,
  blackouts: z.array(dateRangeSchema).max(60).default([]),
  /** Si se le pueden reservar citas (apagado: vacaciones largas, ya no atiende). */
  acceptsBookings: z.boolean().default(true),
});
export type StaffScheduleInput = z.infer<typeof staffScheduleInputSchema>;
export interface StaffScheduleDto {
  userId: string;
  name: string;
  hours: WeeklyHours;
  blackouts: { from: string; to: string }[];
  acceptsBookings: boolean;
  /** Aún no lo configuró: se usa el horario por defecto (L–V 09–18). */
  isDefault: boolean;
}

// ── Citas ───────────────────────────────────────────────────
export interface BookingDto {
  id: string;
  service: { id: string; name: string } | null;
  serviceName: string;
  staff: { id: string; name: string } | null;
  contact: { id: string; name: string | null; phone: string };
  dealId: string | null;
  conversationId: string | null;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  source: BookingSource;
  note: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export const createBookingSchema = z.object({
  contactId: z.string().min(1),
  serviceId: z.string().min(1),
  /** Sin persona: la primera libre a esa hora. */
  userId: z.string().nullable().optional(),
  startAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(1000).nullable().optional(),
  conversationId: z.string().nullable().optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const updateBookingSchema = z
  .object({
    startAt: z.string().datetime({ offset: true }).optional(),
    userId: z.string().optional(),
    status: z.enum(["CONFIRMED", "COMPLETED", "NO_SHOW"]).optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nada que cambiar");
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

export const cancelBookingSchema = z.object({ reason: z.string().trim().max(300).nullable().optional() });
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export const bookingsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  userId: z.string().optional(),
});
export type BookingsQuery = z.infer<typeof bookingsQuerySchema>;

export const slotsQuerySchema = z.object({
  serviceId: z.string().min(1),
  userId: z.string().optional(),
  /** «AAAA-MM-DD» en la zona del negocio. */
  from: ymd.optional(),
  days: z.coerce.number().int().min(1).max(31).default(7),
  /** Cita que se está moviendo: sus horas no cuentan como ocupadas. */
  excludeBookingId: z.string().optional(),
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export interface SlotDto {
  start: string;
  end: string;
  date: string;
  time: string;
  staff: { id: string; name: string };
}
