import type { SimulationReviewLine } from "@crm/shared";
import type { PrismaService } from "../../infra/prisma/prisma.service";
import { CHAT_REVIEW_MESSAGES, chatReviewLines, type ReviewRun } from "./chat-review.lines";

export interface ChatTranscript {
  channelKind: string;
  /** Lo que se dijeron, con lo que consultó el agente en cada respuesta. */
  lines: SimulationReviewLine[];
  /** El agente que respondió (el de la última respuesta con agente). */
  agentConfigId: string | null;
}

/**
 * Los últimos mensajes de una conversación real tal como los lee el revisor:
 * lo que dijo cada uno y, en cada respuesta de la IA, lo que consultó. La usan
 * la revisión de chats y «Mejorar agente» (para sacar un caso de un chat).
 * null si la conversación no existe.
 */
export async function loadChatTranscript(prisma: PrismaService, conversationId: string): Promise<ChatTranscript | null> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { channelKind: true } });
  if (!conversation) return null;
  const recent = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHAT_REVIEW_MESSAGES,
    select: { direction: true, author: true, type: true, content: true, transcript: true, note: true, aiRunId: true, interactive: true },
  });
  const messages = recent.reverse();
  const runIds = [...new Set(messages.map((m) => m.aiRunId).filter((x): x is string => !!x))];
  const runRows = runIds.length
    ? await prisma.aiRun.findMany({
        where: { id: { in: runIds }, conversationId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          escalationReason: true,
          agentConfigId: true,
          toolCalls: { orderBy: { createdAt: "asc" }, select: { toolName: true, input: true, output: true } },
        },
      })
    : [];
  const runs = new Map<string, ReviewRun>(runRows.map((r) => [r.id, r]));
  return {
    channelKind: conversation.channelKind,
    lines: chatReviewLines(messages, runs),
    agentConfigId: [...runRows].reverse().find((r) => r.agentConfigId)?.agentConfigId ?? null,
  };
}
