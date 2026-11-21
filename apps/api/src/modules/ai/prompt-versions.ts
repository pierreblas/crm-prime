import { IMPROVE_VERSIONS_KEPT } from "@crm/shared";

/** Lo mínimo de Prisma que hace falta, para poder llamarlo desde cualquier servicio (y probarlo solo). */
interface VersionStore {
  agentPromptVersion: {
    create(args: { data: { orgId: string; agentConfigId: string; systemPrompt: string; source: string } }): Promise<unknown>;
    findMany(args: { where: { agentConfigId: string }; orderBy: { createdAt: "desc" }; skip: number; select: { id: true } }): Promise<{ id: string }[]>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<unknown>;
  };
}

export type PromptVersionSource = "manual" | "improve" | "restore";

/**
 * Guarda las instrucciones que el agente está a punto de dejar atrás, para
 * poder volver a ellas: al editarlas a mano, al aplicar una mejora o al
 * restaurar otra versión. Se conservan las últimas de cada agente.
 */
export async function recordPromptVersion(
  prisma: VersionStore,
  v: { orgId: string; agentConfigId: string; systemPrompt: string; source: PromptVersionSource },
): Promise<void> {
  if (!v.systemPrompt.trim()) return; // un agente recién creado sin instrucciones no deja nada que recuperar
  await prisma.agentPromptVersion.create({ data: v });
  const old = await prisma.agentPromptVersion.findMany({
    where: { agentConfigId: v.agentConfigId },
    orderBy: { createdAt: "desc" },
    skip: IMPROVE_VERSIONS_KEPT,
    select: { id: true },
  });
  if (old.length) await prisma.agentPromptVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}
