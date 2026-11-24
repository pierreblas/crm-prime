import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  AcceptKnowledgeSuggestionInput,
  AnalyzeKnowledgeResult,
  KnowledgeSuggestionDto,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { tenancyMode } from "../../infra/tenant/tenant.context";
import { AiSettingsService } from "../ai/ai-settings.service";
import { LLM_PROVIDER, type LLMProvider } from "../ai/llm.provider";
import { FAQ_GAPS_SYSTEM, parseGaps, questionKey } from "../ai/copilot.prompts";
import { KnowledgeService } from "./knowledge.service";

const MAX_CONVERSATIONS = 40;
const MAX_CHARS = 24_000;

/**
 * Preguntas sin respuesta: lo que los clientes preguntan y el conocimiento no
 * cubre. La IA lee las conversaciones recientes y propone pregunta y
 * respuesta (sacada de cómo contestó el equipo); una persona la aprueba y pasa
 * a ser un documento del conocimiento, o la descarta.
 *
 * Las ya propuestas, aprobadas o descartadas se le pasan al modelo y además se
 * filtran aquí, para no volver a proponer lo mismo en cada análisis.
 */
@Injectable()
export class KnowledgeGapsService {
  private readonly logger = new Logger("KnowledgeGaps");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly knowledge: KnowledgeService,
    private readonly settings: AiSettingsService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  async list(): Promise<KnowledgeSuggestionDto[]> {
    const rows = await this.prisma.knowledgeSuggestion.findMany({
      where: { status: "pending" },
      orderBy: [{ occurrences: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      occurrences: r.occurrences,
      conversationIds: r.conversationIds,
      status: r.status as KnowledgeSuggestionDto["status"],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async analyze(): Promise<AnalyzeKnowledgeResult> {
    const status = await this.settings.status();
    const devSimulado = tenancyMode !== "multi" && process.env.NODE_ENV !== "production";
    if (!status.ready && !devSimulado) {
      throw new BadRequestException({
        statusCode: 400,
        code: "AI_NOT_CONFIGURED",
        message: "Configura tu clave de OpenAI o Anthropic en Ajustes › Inteligencia Artificial para analizar conversaciones.",
      });
    }

    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const convs = await this.prisma.conversation.findMany({
      where: { lastInboundAt: { gte: since } },
      orderBy: { lastInboundAt: "desc" },
      take: MAX_CONVERSATIONS,
      select: { id: true },
    });

    const refs = new Map<string, string>();
    const blocks: string[] = [];
    let chars = 0;
    for (const c of convs) {
      const msgs = await this.prisma.message.findMany({
        where: { conversationId: c.id, content: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 14,
        select: { direction: true, author: true, content: true },
      });
      if (!msgs.some((m) => m.direction === "INBOUND")) continue;
      const ref = `C${refs.size + 1}`;
      const text = msgs
        .reverse()
        .map((m) => `${m.direction === "INBOUND" ? "Cliente" : m.author === "AI" ? "IA" : "Equipo"}: ${m.content!.slice(0, 300)}`)
        .join("\n");
      if (chars + text.length > MAX_CHARS) break;
      refs.set(ref, c.id);
      blocks.push(`[${ref}]\n${text}`);
      chars += text.length;
    }
    if (!blocks.length) return { analyzed: 0, created: 0 };

    const [docs, known] = await Promise.all([
      this.prisma.knowledgeDoc.findMany({ select: { title: true }, take: 300 }),
      this.prisma.knowledgeSuggestion.findMany({
        select: { id: true, question: true, status: true, occurrences: true, conversationIds: true },
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
    ]);

    const res = await this.llm.generate({
      feature: "knowledge_gaps",
      system: FAQ_GAPS_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `Documentos que ya existen:\n${docs.map((d) => `- ${d.title}`).join("\n") || "(ninguno)"}`,
            `Preguntas ya detectadas (no repetir):\n${known.map((k) => `- ${k.question}`).join("\n") || "(ninguna)"}`,
            `Conversaciones:\n${blocks.join("\n\n")}`,
          ].join("\n\n"),
        },
      ],
      maxTokens: 1800,
      effort: "medium",
    });
    const raw = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    const gaps = parseGaps(raw);

    const byKey = new Map(known.map((k) => [questionKey(k.question), k]));
    const docKeys = new Set(docs.map((d) => questionKey(d.title)));
    let created = 0;
    for (const g of gaps) {
      const key = questionKey(g.question);
      if (docKeys.has(key)) continue;
      const conversationIds = g.refs.map((r) => refs.get(r)).filter((x): x is string => !!x);
      const prev = byKey.get(key);
      if (prev) {
        // Ya se conocía: si sigue pendiente, suma apariciones; si se
        // descartó o aprobó, no se vuelve a proponer.
        if (prev.status === "pending") {
          await this.prisma.knowledgeSuggestion.update({
            where: { id: prev.id },
            data: {
              occurrences: prev.occurrences + Math.max(1, conversationIds.length),
              conversationIds: [...new Set([...prev.conversationIds, ...conversationIds])].slice(0, 20),
            },
          });
        }
        continue;
      }
      await this.prisma.knowledgeSuggestion.create({
        data: {
          orgId: this.tenant.orgId(),
          question: g.question,
          answer: g.answer,
          occurrences: Math.max(1, conversationIds.length),
          conversationIds: conversationIds.slice(0, 20),
        },
      });
      byKey.set(key, { id: "", question: g.question, status: "pending", occurrences: 1, conversationIds });
      created++;
    }
    this.logger.log(`Análisis de huecos: ${blocks.length} conversaciones, ${created} preguntas nuevas`);
    return { analyzed: blocks.length, created };
  }

  async accept(id: string, input: AcceptKnowledgeSuggestionInput): Promise<{ ok: true }> {
    const s = await this.prisma.knowledgeSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException("Sugerencia no encontrada");
    await this.knowledge.ingest({
      title: input.question,
      content: `Pregunta: ${input.question}\n\nRespuesta: ${input.answer}`,
      source: "Preguntas frecuentes",
    });
    await this.prisma.knowledgeSuggestion.update({
      where: { id },
      data: { status: "accepted", question: input.question, answer: input.answer },
    });
    return { ok: true };
  }

  async dismiss(id: string): Promise<{ ok: true }> {
    const s = await this.prisma.knowledgeSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException("Sugerencia no encontrada");
    await this.prisma.knowledgeSuggestion.update({ where: { id }, data: { status: "dismissed" } });
    return { ok: true };
  }
}
