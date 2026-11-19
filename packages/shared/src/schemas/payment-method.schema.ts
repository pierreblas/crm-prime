import { z } from "zod";
import { COUNTRIES } from "../money.js";

/**
 * Métodos de pago de la empresa (Ajustes › Métodos de pago).
 *
 * El agente no escribe datos de pago: llama a send_payment_methods y el sistema
 * envía este texto tal cual, solo con los métodos del país del cliente (por el
 * prefijo de su teléfono). Un número de Yape o una cuenta inventados acaban en
 * un pago perdido; las respuestas por palabra clave tampoco servían (saltaban
 * con «¿el pago es mensual?», no entendían «¿a dónde te deposito?» y no
 * distinguían el país).
 */

/** Cuántos métodos puede tener una empresa. */
export const PAYMENT_METHODS_MAX = 30;

/** La acción del agente que los envía. */
export const PAYMENT_METHODS_TOOL = "send_payment_methods";

const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

const countriesSchema = z
  .array(z.string().trim().toUpperCase())
  .max(60)
  .refine((xs) => xs.every((c) => COUNTRY_CODES.has(c)), "Hay un país que no existe")
  .transform((xs) => [...new Set(xs)]);

export const paymentMethodDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** ISO 3166-1 alfa-2. Vacío: todos los países. */
  countries: z.array(z.string()),
  details: z.string(),
  instructions: z.string(),
  /** storage://… o URL: el QR o la imagen que se envía como foto. */
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  order: z.number(),
});
export type PaymentMethodDto = z.infer<typeof paymentMethodDtoSchema>;

export const createPaymentMethodSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre (Yape, Transferencia BCP…)").max(60),
  countries: countriesSchema.default([]),
  details: z.string().trim().min(1, "Escribe los datos que recibirá el cliente").max(1000),
  instructions: z.string().trim().max(300).default(""),
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((u) => u.startsWith("storage://") || /^https:\/\//.test(u), "La imagen debe subirse o ser un enlace https")
    .nullable()
    .default(null),
  isActive: z.boolean().default(true),
});
export type CreatePaymentMethodInput = z.input<typeof createPaymentMethodSchema>;

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial().extend({
  order: z.number().int().min(0).max(1000).optional(),
});
export type UpdatePaymentMethodInput = z.input<typeof updatePaymentMethodSchema>;

type Method = Pick<PaymentMethodDto, "name" | "countries" | "details" | "instructions" | "imageUrl" | "isActive" | "order">;

/**
 * Los métodos que ve un cliente de ese país (null: no se sabe): los activos de
 * su país y los de «todos», en el orden de la lista. `only`: solo esos nombres
 * (si pidió uno en concreto, «¿puedo pagar con Yape?»).
 */
export function paymentMethodsFor<T extends Method>(methods: T[], country: string | null, only: string[] = []): T[] {
  const names = new Set(only.map((n) => n.trim().toLowerCase()).filter(Boolean));
  return methods
    .filter((m) => m.isActive)
    .filter((m) => !m.countries.length || (!!country && m.countries.includes(country)))
    .filter((m) => !names.size || names.has(m.name.trim().toLowerCase()))
    .sort((a, b) => a.order - b.order);
}

/**
 * El mensaje que recibe el cliente, tal cual. *negrita* y _cursiva_ de
 * WhatsApp; en Instagram y Messenger se ven los asteriscos, que no estorban.
 */
export function paymentMethodsText(methods: Pick<Method, "name" | "details" | "instructions">[]): string {
  return methods
    .map((m) => [`*${m.name.trim()}*`, m.details.trim(), m.instructions.trim() ? `_${m.instructions.trim()}_` : ""].filter(Boolean).join("\n"))
    .join("\n\n");
}
