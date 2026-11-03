import { META_FORM_SOURCE_NAME } from "@crm/shared";
import type { PrismaService } from "../../infra/prisma/prisma.service";

const AUTOMATICAS = {
  whatsapp: { name: "WhatsApp", color: "#25d366" },
  ad: { name: "Anuncio de Meta", color: "#1877f2" },
  form: { name: META_FORM_SOURCE_NAME, color: "#0866ff" },
} as const;

export type FuenteAutomatica = keyof typeof AUTOMATICAS;

/**
 * Fuente automática de los contactos que llegan por WhatsApp ("WhatsApp"),
 * por un anuncio de Meta ("Anuncio de Meta") o por un formulario de Facebook
 * o Instagram ("Formulario de Facebook"). Se crea una vez por empresa y se
 * reutiliza; si la empresa la renombra, se crea otra antes que pisar la suya.
 * Sirve para que el vendedor asignado a esa fuente vea al contacto sin que
 * nadie lo etiquete a mano.
 */
export async function fuenteAutomatica(
  prisma: PrismaService,
  orgId: string,
  kind: FuenteAutomatica,
): Promise<string> {
  const { name, color } = AUTOMATICAS[kind];
  const s = await prisma.source.upsert({
    where: { orgId_name: { orgId, name } },
    create: { orgId, name, color },
    update: {},
    select: { id: true },
  });
  return s.id;
}

/** Id de una fuente automática si la empresa ya la tiene, sin crearla. */
export async function fuenteAutomaticaExistente(
  prisma: PrismaService,
  orgId: string,
  kind: FuenteAutomatica,
): Promise<string | null> {
  const s = await prisma.source.findUnique({
    where: { orgId_name: { orgId, name: AUTOMATICAS[kind].name } },
    select: { id: true },
  });
  return s?.id ?? null;
}
