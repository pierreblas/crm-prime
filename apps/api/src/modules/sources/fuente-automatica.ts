import { META_FORM_SOURCE_NAME, type SourceKind } from "@crm/shared";
import type { PrismaService } from "../../infra/prisma/prisma.service";

/** Nombre y color con los que nace la fuente de cada vía de entrada. */
export const FUENTES_AUTOMATICAS: Record<SourceKind, { name: string; color: string }> = {
  whatsapp: { name: "WhatsApp", color: "#25d366" },
  ad: { name: "Anuncio de Meta", color: "#1877f2" },
  form: { name: META_FORM_SOURCE_NAME, color: "#0866ff" },
  messenger: { name: "Messenger", color: "#0084ff" },
  instagram: { name: "Instagram", color: "#e1306c" },
  tiktok: { name: "TikTok", color: "#fe2c55" },
};

export type FuenteAutomatica = SourceKind;

/**
 * La fuente de una vía de entrada: quien escribe por WhatsApp, llega desde un
 * anuncio, llena un formulario o escribe por Messenger o Instagram entra con
 * ella sin que nadie lo etiquete. Una por empresa y vía, reconocida por su
 * `kind` y no por su nombre: la empresa puede renombrarla o cambiarle el color
 * sin que el siguiente mensaje cree otra. Se crea al conectar el canal (o, si
 * faltara, con el primer mensaje). Sirve para que el vendedor asignado a esa
 * fuente vea al contacto desde el primer momento.
 */
export async function fuenteAutomatica(prisma: PrismaService, orgId: string, kind: FuenteAutomatica): Promise<string> {
  const found = await fuenteAutomaticaExistente(prisma, orgId, kind);
  if (found) return found;
  const { name, color } = FUENTES_AUTOMATICAS[kind];
  try {
    const s = await prisma.source.create({ data: { orgId, name, color, kind }, select: { id: true } });
    return s.id;
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    // Dos mensajes a la vez la crearon en paralelo, o el nombre está ocupado
    // por otra fuente con tipo distinto: se vuelve a mirar y, si no, nace con apellido.
    const again = await fuenteAutomaticaExistente(prisma, orgId, kind);
    if (again) return again;
    const s = await prisma.source.create({ data: { orgId, name: `${name} (automática)`, color, kind }, select: { id: true } });
    return s.id;
  }
}

/**
 * Id de la fuente automática de una vía si la empresa ya la tiene, sin crearla.
 * Las anteriores a `kind` se reconocen por el nombre con el que nacieron y se
 * marcan al pasar; una creada a mano con ese mismo nombre se adopta igual.
 */
export async function fuenteAutomaticaExistente(prisma: PrismaService, orgId: string, kind: FuenteAutomatica): Promise<string | null> {
  const byKind = await prisma.source.findFirst({
    where: { orgId, kind },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (byKind) return byKind.id;
  const legacy = await prisma.source.findUnique({
    where: { orgId_name: { orgId, name: FUENTES_AUTOMATICAS[kind].name } },
    select: { id: true, kind: true },
  });
  if (legacy && !legacy.kind) {
    await prisma.source.update({ where: { id: legacy.id }, data: { kind } });
    return legacy.id;
  }
  return null;
}
