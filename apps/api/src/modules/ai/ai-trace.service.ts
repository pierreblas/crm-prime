import { Injectable, NotFoundException } from "@nestjs/common";
import type { AiRunTrace, Classification } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { traceToolCall } from "./playground-trace";

/**
 * «¿Por qué respondió esto?»: lo que hizo la IA para escribir una respuesta
 * real, a partir de lo que ya se guarda de cada respuesta (AiRun y sus
 * AiToolCall). Lo mismo que se ve en «Probar conversación», pero de un cliente
 * de verdad: qué entendió, qué consultó, qué encontró y qué acciones hizo.
 */
@Injectable()
export class AiTraceService {
  constructor(private readonly prisma: PrismaService) {}

  async trace(conversationId: string, runId: string): Promise<AiRunTrace> {
    // La conversación primero: la consulta va acotada a la empresa (y el guard
    // ya comprobó que entra en el alcance del vendedor). AiRun no lleva orgId,
    // así que se busca solo dentro de esa conversación.
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (!conversation) throw new NotFoundException("Conversación no encontrada");
    const run = await this.prisma.aiRun.findFirst({
      where: { id: runId, conversationId },
      include: {
        agentConfig: { select: { name: true } },
        toolCalls: { orderBy: { createdAt: "asc" }, select: { toolName: true, input: true, output: true, status: true } },
      },
    });
    if (!run) throw new NotFoundException("Esa respuesta de la IA no es de esta conversación");

    return {
      runId: run.id,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      agentName: run.agentConfig?.name ?? null,
      model: run.model,
      latencyMs: run.latencyMs,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: Number(run.costUsd),
      classification: (run.classification as Classification | null) ?? null,
      confidence: run.confidence,
      escalationReason: run.escalationReason,
      steps: run.toolCalls.map((c) => ({
        ...withoutEvidence(traceToolCall(c.toolName, (c.input ?? {}) as Record<string, unknown>, outputText(c.output))),
        status: c.status,
      })),
    };
  }
}

/** Se guarda como `{ result: "…" }`; lo antiguo puede ser otra cosa. */
function outputText(output: unknown): string {
  if (output && typeof output === "object" && "result" in output) {
    const r = (output as { result: unknown }).result;
    return typeof r === "string" ? r : JSON.stringify(r);
  }
  return output == null ? "" : typeof output === "string" ? output : JSON.stringify(output);
}

/** El extracto de lo que devolvió solo lo usa la revisión del simulador: aquí sobra. */
function withoutEvidence<T extends { evidence?: string }>(step: T): Omit<T, "evidence"> {
  const { evidence: _evidence, ...rest } = step;
  return rest;
}
