import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { AdminCopilotFree, AdminCopilotReply, AdminCopilotRequest } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { tenancyMode } from "../../infra/tenant/tenant.context";
import { AiSettingsService } from "./ai-settings.service";
import { AdminCopilotTools } from "./admin-copilot.tools";
import { docsIndex } from "./admin-copilot.docs";
import { adminCopilotContext, adminCopilotSystem } from "./admin-copilot.prompt";
import { LLM_PROVIDER, type LLMProvider } from "./llm.provider";
import type { LlmAnyBlock, LlmMessage, LlmToolResultBlock, LlmToolUseBlock } from "./llm.types";

/** Rondas de consultas por pregunta: de sobra para diagnosticar, y un tope al gasto. */
export const MAX_STEPS = 6;
/** Turnos del hilo que se mandan al modelo: los últimos. */
const HISTORY_TURNS = 20;

const FINAL_NUDGE =
  "Ya no puedes hacer más consultas. Responde ahora al administrador con lo que tienes; si algo no pudiste comprobar, dilo.";
const NO_ANSWER = "No llegué a una respuesta con lo que pude consultar. ¿Me das algún dato más concreto?";

/**
 * Copiloto del administrador: un chat de ayuda en toda la app que explica
 * Driony con su documentación y mira la configuración de la cuenta para
 * diagnosticar. Solo lee (ver AdminCopilotTools).
 *
 * Es la ayuda del producto: donde la IA de Driony está encendida, las primeras
 * preguntas de cada mes (ADMIN_COPILOT_FREE_QUESTIONS) las paga Driony con su
 * IA, aunque la empresa tenga clave propia o el cupo gastado. Las siguientes
 * usan la IA de la empresa como el resto: su clave o su cupo. En una
 * instalación propia, siempre la de la empresa. El consumo aparece como
 * «Copiloto del administrador» en Ajustes › Consumo de IA; el gratis, aparte.
 */
@Injectable()
export class AdminCopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly tenant: TenantService,
    private readonly tools: AdminCopilotTools,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  async ask(input: AdminCopilotRequest, userId: string): Promise<AdminCopilotReply> {
    // ¿Queda alguna gratis este mes? Dos preguntas a la vez justo en el límite
    // pueden salir gratis las dos: es una de más, no vale un bloqueo.
    const quota = await this.settings.copilotFree();
    const free = !!quota && quota.used < quota.limit && !!this.settings.courtesyCreds();
    if (!free) await this.assertReady(quota);
    const reply = await this.answer(input, userId, free);
    // Cuenta la pregunta solo si hubo respuesta: un fallo no gasta una de las gratis.
    await this.prisma.adminCopilotQuestion
      .create({ data: { orgId: this.tenant.orgId(), userId, free } })
      .catch(() => undefined);
    return reply;
  }

  private async answer(input: AdminCopilotRequest, userId: string, free: boolean): Promise<AdminCopilotReply> {
    const [org, me] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: this.tenant.orgId() }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    ]);

    const system = adminCopilotSystem(docsIndex(this.tools.docs()));
    const systemDynamic = adminCopilotContext({
      orgName: org?.name ?? "",
      userName: me?.name ?? me?.email ?? "",
      path: input.path ?? null,
      now: new Date(),
    });
    const tools = this.tools.definitions();
    const messages = toLlmHistory(input.messages);
    const consulted: string[] = [];
    const seen = new Set<string>();
    let model = "";

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await this.llm.generate({
        system,
        systemDynamic,
        cacheKey: "admin-copilot",
        messages,
        tools,
        maxTokens: 1500,
        effort: "medium",
        feature: "admin_copilot",
        courtesy: free,
      });
      model = res.model;
      const text = res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const toolUses = res.content.filter((b): b is LlmToolUseBlock => b.type === "tool_use");

      if (!toolUses.length || step === MAX_STEPS - 1) {
        return { reply: text || NO_ANSWER, consulted, provider: this.llm.name, model, free };
      }

      messages.push({ role: "assistant", content: res.content });
      // Repetir una consulta no aporta nada: se le avisa en vez de repetirla.
      const results: LlmAnyBlock[] = await Promise.all(
        toolUses.map(async (tu): Promise<LlmToolResultBlock> => {
          const key = `${tu.name}:${JSON.stringify(tu.input ?? {})}`;
          if (seen.has(key)) {
            return { type: "tool_result", tool_use_id: tu.id, content: "Ya lo consultaste: usa ese resultado." };
          }
          seen.add(key);
          const label = this.tools.label(tu.name, tu.input ?? {});
          if (!consulted.includes(label)) consulted.push(label);
          return { type: "tool_result", tool_use_id: tu.id, content: await this.tools.run(tu.name, tu.input ?? {}) };
        }),
      );
      if (step === MAX_STEPS - 2) results.push({ type: "text", text: FINAL_NUDGE });
      messages.push({ role: "user", content: results });
    }
    return { reply: NO_ANSWER, consulted, provider: this.llm.name, model, free };
  }

  /**
   * Sin preguntas gratis, la IA de la empresa: igual que el copiloto del chat,
   * sin IA un error claro y, en desarrollo local, el simulado.
   */
  private async assertReady(quota: AdminCopilotFree | null): Promise<void> {
    const s = await this.settings.status();
    if (s.ready) return;
    if (tenancyMode !== "multi" && process.env.NODE_ENV !== "production") return;
    const day = quota ? new Date(quota.resetsAt).toLocaleDateString("es", { day: "numeric", month: "long", timeZone: "UTC" }) : "";
    const spentFree = quota ? `Ya usaste tus ${quota.limit} preguntas gratis de este mes (vuelven el ${day}) y ` : "";
    throw new BadRequestException({
      statusCode: 400,
      code: "AI_NOT_CONFIGURED",
      message: s.included?.exhausted || s.included?.full
        ? `${spentFree ? `${spentFree}t` : "T"}us tokens de IA de este mes se gastaron. Puedes sumar tokens extra en Ajustes › Plan o usar tu propia clave en Ajustes › Inteligencia Artificial.`
        : `${spentFree ? `${spentFree}para` : "Para"} seguir preguntando hace falta IA: configura tu clave de OpenAI o Anthropic en Ajustes › Inteligencia Artificial.`,
    });
  }
}

/**
 * El hilo que manda el navegador, listo para el modelo: los últimos turnos,
 * empezando por una pregunta (los proveedores no aceptan que empiece el
 * asistente) y sin dos turnos seguidos del mismo rol.
 */
export function toLlmHistory(turns: AdminCopilotRequest["messages"]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const t of turns.slice(-HISTORY_TURNS)) {
    const prev = out[out.length - 1];
    if (!prev && t.role === "assistant") continue;
    if (prev && prev.role === t.role) prev.content = `${prev.content as string}\n\n${t.content}`;
    else out.push({ role: t.role, content: t.content });
  }
  return out;
}
