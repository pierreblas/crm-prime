import { contactVarValues, fillContactText, type ContactVarValues } from "@crm/shared";
import type { PrismaService } from "../../infra/prisma/prisma.service";

/**
 * Los mensajes fijos del agente (saludo, fuera de horario, respuestas por
 * palabra clave, aviso al pasar el chat, seguimientos de texto fijo) con las
 * variables del contacto rellenas: «Hola {{nombre}}» llega como «Hola Ana».
 * Si falta un dato, la variable se quita y la frase se arregla
 * (`fillContactText`). Un texto sin llaves sale tal cual, sin tocar la base.
 */

type VarsContact = { name: string | null; phone: string; currency?: string | null; metadata?: unknown };

async function valuesOf(prisma: PrismaService, contact: VarsContact): Promise<ContactVarValues> {
  const fields = await prisma.customField.findMany({ select: { key: true, label: true } });
  return contactVarValues(contact, fields);
}

/** Con el contacto ya cargado. */
export async function customerText(prisma: PrismaService, contact: VarsContact, text: string): Promise<string> {
  if (!text.includes("{{")) return text;
  return fillContactText(text, await valuesOf(prisma, contact)).trim();
}

/** Con solo la conversación. */
export async function customerTextFor(prisma: PrismaService, conversationId: string, text: string): Promise<string> {
  if (!text.includes("{{")) return text;
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { contact: { select: { name: true, phone: true, currency: true, metadata: true } } },
  });
  return fillContactText(text, convo ? await valuesOf(prisma, convo.contact) : {}).trim();
}
