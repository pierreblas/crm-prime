import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  currentUtms,
  IMPROVE_CASES_KEPT,
  IMPROVE_MAX_CASES,
  IMPROVE_PARALLEL,
  type AgentCorrection,
  type ApplyCorrectionInput,
  type CorrectionChat,
  type CorrectionOutcome,
  type ImproveChange,
  type ImproveRun,
  type MeasureCorrectionInput,
  type PlaygroundContact,
  type SimulationFinding,
  type SimulationReviewLine,
  type StartCorrectionInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { AgentService } from "./agent.service";
import { AgentImproveService } from "./agent-improve.service";
import { AiSettingsService } from "./ai-settings.service";
import { CORRECTION_SYSTEM, correctionRequest, JUDGE_SYSTEM, judgeRequest, parseCorrection, parseJudge, pickMoment, replayInput, spoken, type ChatCause, type PreviousAttempt } from "./agent-correction.logic";
import { applyProposal, checkProposal, improveLine } from "./agent-improve.logic";
import { loadChatTranscript } from "./chat-transcript";
import { LLM_PROVIDER, type LLMProvider } from "./llm.provider";
import { recordPromptVersion } from "./prompt-versions";
import { SIMULATION_REVIEW_MODEL } from "./simulation-review";

/** Intentos de propuesta: si el primero no arregla todos los chats, se prueba otro. */
const ATTEMPTS = 2;

/** Un chat ya preparado para repetirse. */
interface Work {
  row: { id: string; reviewId: string };
  summary: string;
  findings: SimulationFinding[];
  contact: PlaygroundContact;
  lines: SimulationReviewLine[];
  moment: number;
  today: string | null;
}

interface Replay {
  text: string;
  fixed: boolean;
  note: string;
  missing: string | null;
}

interface Attempt {
  prompt: string;
  changes: ImproveChange[];
  edits: { what: string; text: string }[];
  causes: ChatCause[];
  /** Cambios que no se pudieron poner, y por qué. */
  rejected: string[];
  /** Por chat (su posición): lo que respondió con el cambio. */
  replies: Map<number, Replay>;
}

type ReviewRow = {
  id: string;
  conversationId: string;
  verdict: string;
  summary: string;
  findings: unknown;
  conversation: { contact: { name: string | null; phone: string; metadata: unknown } };
};

type ChatRow = {
  id: string;
  reviewId: string;
  conversationId: string;
  customer: string;
  before: string;
  today: string | null;
  after: string | null;
  outcome: string;
  note: string;
  caseTitle: string | null;
  caseBrief: string | null;
  missing: string | null;
  review: { summary: string; findings: unknown } | null;
  conversation: { contact: { name: string | null; phone: string } };
};

type CorrectionRow = Prisma.AgentCorrectionGetPayload<object>;

/**
 * «Corregir al agente»: de los chats reales que la revisión marcó (y de lo que
 * pida el dueño) sale un cambio puntual en las instrucciones, y se prueba
 * repitiendo el momento exacto de cada chat: con las instrucciones de hoy y con
 * las corregidas. Nada se envía.
 *
 * Corre en segundo plano, una a la vez por empresa (gasta tokens). El agente
 * solo cambia cuando el dueño aplica, y la versión anterior queda guardada.
 */
@Injectable()
export class AgentCorrectionService implements OnModuleInit {
  private readonly logger = new Logger("Corregir agente");
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly agent: AgentService,
    private readonly improve: AgentImproveService,
    private readonly aiSettings: AiSettingsService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  /** Una corrección que estaba en marcha cuando se reinició la API no va a terminar sola: se dice. */
  async onModuleInit(): Promise<void> {
    await runUnscoped("correcciones interrumpidas por un reinicio", () =>
      this.prisma.agentCorrection.updateMany({
        where: { status: "running" },
        data: { status: "failed", error: "Se interrumpió al reiniciar el servidor. Vuelve a lanzarla.", finishedAt: new Date() },
      }),
    ).catch((e: Error) => this.logger.warn(`No se pudieron cerrar las correcciones interrumpidas: ${e.message}`));
  }

  // ── Lanzarla y verla ────────────────────────────────────────
  async start(botId: string, input: StartCorrectionInput): Promise<AgentCorrection> {
    const bot = await this.bot(botId);
    if (!bot.systemPrompt.trim()) throw new BadRequestException("Este agente todavía no tiene instrucciones que corregir.");
    const ids = [...new Set(input.reviewIds)];
    const reviews = (await this.prisma.conversationReview.findMany({
      where: { id: { in: ids }, agentConfigId: botId },
      select: { id: true, conversationId: true, verdict: true },
    })) as { id: string; conversationId: string; verdict: string }[];
    if (reviews.length !== ids.length) throw new BadRequestException("Alguno de esos chats ya no existe o lo atendió otro agente.");
    if (!input.note && reviews.some((r) => r.verdict === "ok")) {
      throw new BadRequestException("Ese chat salió bien en la revisión: escribe qué debió hacer el agente.");
    }
    if (await this.prisma.agentCorrection.count({ where: { status: "running" } })) {
      throw new ConflictException("Ya hay una corrección en marcha. Espera a que termine.");
    }
    await this.assertAi();
    const order = new Map(ids.map((id, i) => [id, i]));
    const row = await this.prisma.agentCorrection.create({
      data: {
        orgId: bot.orgId,
        agentConfigId: botId,
        note: input.note,
        basePrompt: bot.systemPrompt,
        total: ids.length * 2 + 1,
        chats: {
          create: [...reviews]
            .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
            .map((r, i) => ({ orgId: bot.orgId, reviewId: r.id, conversationId: r.conversationId, position: i })),
        },
      },
    });
    const work = runInOrg(bot.orgId, () => this.execute(row.id))
      .catch((e: Error) => this.logger.error(`Corrección ${row.id}: ${e.message}`))
      .finally(() => void this.inFlight.delete(row.id));
    this.inFlight.set(row.id, work);
    return this.get(botId, row.id);
  }

  /** Para las pruebas: cuándo terminó de verdad. */
  settled(id: string): Promise<void> {
    return this.inFlight.get(id) ?? Promise.resolve();
  }

  async get(botId: string, id: string): Promise<AgentCorrection> {
    const bot = await this.bot(botId);
    const row = await this.row(botId, id);
    const [chats, activeCases] = await Promise.all([this.chats(id), this.activeCases(botId)]);
    return {
      id: row.id,
      botId,
      botName: bot.name,
      status: row.status as AgentCorrection["status"],
      note: row.note,
      basePrompt: row.basePrompt,
      prompt: row.prompt,
      changes: (row.changes as ImproveChange[] | null) ?? [],
      chats: chats.map(toChat),
      done: row.done,
      total: row.total,
      tokens: row.tokens,
      error: row.error,
      // Tras aplicar, las instrucciones son las corregidas: eso no es «cambiaron».
      agentChanged: bot.systemPrompt !== row.basePrompt && bot.systemPrompt !== row.prompt,
      runId: row.runId,
      activeCases: activeCases.length,
      createdAt: row.createdAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString() ?? null,
    };
  }

  // ── Aplicarla, descartarla, medirla ─────────────────────────
  /** Pone las instrucciones corregidas. La pulsa una persona; la versión anterior queda guardada. */
  async apply(botId: string, id: string, input: ApplyCorrectionInput): Promise<AgentCorrection> {
    const bot = await this.bot(botId);
    const row = await this.row(botId, id);
    if (row.status === "applied") throw new ConflictException("Esta corrección ya se aplicó.");
    if (row.status !== "ready" || !row.prompt.trim()) throw new BadRequestException("Esta corrección no tiene ningún cambio que aplicar: no hay nada que poner.");
    if (bot.systemPrompt !== row.basePrompt && bot.systemPrompt !== row.prompt && !input.force) {
      throw new ConflictException("Las instrucciones del agente cambiaron desde que empezó la corrección. Si la aplicas se pierde ese cambio.");
    }
    if (bot.systemPrompt !== row.prompt) {
      await recordPromptVersion(this.prisma, { orgId: bot.orgId, agentConfigId: botId, systemPrompt: bot.systemPrompt, source: "improve" });
      await this.prisma.agentConfig.update({ where: { id: botId }, data: { systemPrompt: row.prompt } });
    }
    await this.prisma.agentCorrection.update({ where: { id }, data: { status: "applied", appliedAt: new Date() } });
    const chats = await this.chats(id);
    await this.prisma.conversationReview.updateMany({ where: { id: { in: chats.map((c) => c.reviewId) } }, data: { status: "done", doneAt: new Date() } });
    await this.keepAsCases(bot, chats);
    this.logger.log(`Agente ${bot.name}: aplicada la corrección ${id} (${chats.length} chat(s))`);
    return this.get(botId, id);
  }

  async discard(botId: string, id: string): Promise<AgentCorrection> {
    const row = await this.row(botId, id);
    if (row.status === "running") throw new ConflictException("La corrección sigue en marcha: espera a que termine.");
    if (row.status !== "applied") await this.prisma.agentCorrection.update({ where: { id }, data: { status: "discarded" } });
    return this.get(botId, id);
  }

  /** Antes de aplicarla: los casos marcados del agente, con las de hoy y con las corregidas. */
  async measure(botId: string, id: string, input: MeasureCorrectionInput): Promise<ImproveRun> {
    const row = await this.row(botId, id);
    if (row.status !== "ready" || !row.prompt.trim()) throw new BadRequestException("Esta corrección no tiene ningún cambio que medir.");
    const cases = await this.activeCases(botId);
    if (!cases.length) throw new BadRequestException("Este agente no tiene casos marcados: márcalos en «Mejorar».");
    const run = await this.improve.start(
      botId,
      { caseIds: cases.slice(0, IMPROVE_MAX_CASES).map((c) => c.id), repetitions: input.repetitions, turns: 4, rounds: 0 },
      { prompt: row.prompt, changes: (row.changes as ImproveChange[] | null) ?? [] },
    );
    await this.prisma.agentCorrection.update({ where: { id }, data: { runId: run.id } });
    return run;
  }

  /** La situación de cada chat, en la batería del agente: que no vuelva a fallar sin que se note. */
  private async keepAsCases(bot: { id: string; orgId: string }, chats: ChatRow[]): Promise<void> {
    const usable = chats.filter((c) => c.caseTitle && c.caseBrief && (c.outcome === "fixed" || c.outcome === "not_fixed"));
    if (!usable.length) return;
    const have = await this.prisma.agentTestCase.findMany({
      where: { agentConfigId: bot.id, conversationId: { in: usable.map((c) => c.conversationId) } },
      select: { conversationId: true },
    });
    const known = new Set(have.map((h) => h.conversationId));
    let room = IMPROVE_CASES_KEPT - (await this.prisma.agentTestCase.count({ where: { agentConfigId: bot.id } }));
    for (const c of usable) {
      if (room <= 0 || known.has(c.conversationId)) continue;
      known.add(c.conversationId);
      room--;
      await this.prisma.agentTestCase.create({
        data: { orgId: bot.orgId, agentConfigId: bot.id, title: c.caseTitle!, brief: c.caseBrief!, source: "chat", conversationId: c.conversationId },
      });
    }
  }

  // ── Por dentro ──────────────────────────────────────────────
  /** No lanza: lo que falle queda escrito en la corrección. */
  async execute(id: string): Promise<void> {
    const row = await this.prisma.agentCorrection.findUnique({ where: { id } });
    if (!row) return;
    const save = (data: Prisma.AgentCorrectionUncheckedUpdateInput) => this.prisma.agentCorrection.update({ where: { id }, data });
    try {
      const bot = await this.prisma.agentConfig.findUnique({ where: { id: row.agentConfigId } });
      if (!bot) throw new Error("El agente de esta corrección ya no existe.");
      const works = await this.prepare(row);

      // Hoy: puede que ya responda bien (cambiaron las instrucciones, el catálogo o Driony).
      const pending: Work[] = [];
      await inParallel(works, async (w) => {
        const r = await this.replay(row, bot, w, row.basePrompt);
        w.today = r.text;
        // Si el dueño pide algo, se corrige igual: él manda.
        const fine = r.fixed && !row.note.trim();
        await this.setChat(w, { today: r.text, missing: r.missing, ...(fine ? { outcome: "today_ok", note: r.note } : {}) });
        if (!fine) pending.push(w);
      });
      pending.sort((a, b) => works.indexOf(a) - works.indexOf(b));
      if (!pending.length) {
        await save({ status: "nothing", finishedAt: new Date(), done: row.total });
        return;
      }

      const best = await this.bestAttempt(row, bot, pending);
      for (const [i, w] of pending.entries()) {
        const cause = best.causes.find((c) => c.chat === i + 1);
        const reply = best.replies.get(i);
        const outcome: CorrectionOutcome = reply?.fixed ? "fixed" : reply && cause?.cause !== "data" ? "not_fixed" : cause?.cause === "system" ? "system" : "data";
        await this.setChat(w, {
          outcome,
          after: reply?.text ?? null,
          note: (outcome === "data" ? cause?.note || reply?.note : reply?.note || cause?.note) || (reply ? "" : "No se arregla con las instrucciones."),
          caseTitle: cause?.test?.title ?? null,
          caseBrief: cause?.test?.brief ?? null,
          ...(cause?.missing || reply?.missing ? { missing: cause?.missing ?? reply?.missing ?? null } : {}),
        });
      }
      await save({
        status: best.changes.length ? "ready" : "nothing",
        prompt: best.changes.length ? best.prompt : "",
        changes: best.changes as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        done: row.total,
      });
    } catch (e) {
      const error = (e as Error).message.slice(0, 500);
      this.logger.warn(`Corrección ${id} falló: ${error}`);
      await save({ status: "failed", error, finishedAt: new Date() });
    }
  }

  /** Lee cada chat y elige el momento. El que no se puede repetir queda dicho y no entra. */
  private async prepare(row: CorrectionRow): Promise<Work[]> {
    const works: Work[] = [];
    const reviews = (await this.prisma.conversationReview.findMany({
      where: { id: { in: (await this.chats(row.id)).map((c) => c.reviewId) }, agentConfigId: row.agentConfigId },
      include: { conversation: { select: { contact: { select: { name: true, phone: true, metadata: true } } } } },
    })) as unknown as ReviewRow[];
    for (const chat of await this.chats(row.id)) {
      const review = reviews.find((r) => r.id === chat.reviewId);
      const transcript = review ? await loadChatTranscript(this.prisma, chat.conversationId) : null;
      const findings = (Array.isArray(review?.findings) ? review!.findings : []) as SimulationFinding[];
      const moment = transcript ? pickMoment(transcript.lines, findings) : null;
      const replay = transcript && moment !== null ? replayInput(transcript.lines, moment) : null;
      if (!review || !transcript || moment === null || !replay) {
        await this.prisma.agentCorrectionChat.update({ where: { id: chat.id }, data: { outcome: "error", note: "En ese chat no se encontró una respuesta del agente que repetir." } });
        continue;
      }
      await this.prisma.agentCorrectionChat.update({ where: { id: chat.id }, data: { customer: replay.message.slice(0, 2000), before: replay.before.slice(0, 4000) } });
      const { name, phone, metadata } = review.conversation.contact;
      const utms = currentUtms((metadata ?? {}) as Record<string, unknown>) as Record<string, string | undefined>;
      works.push({
        row: { id: chat.id, reviewId: chat.reviewId },
        summary: review.summary,
        findings,
        lines: transcript.lines,
        moment,
        today: null,
        contact: {
          ...(name?.trim() ? { name: name.trim().slice(0, 120) } : {}),
          phone,
          ...(utms.utm_campaign ? { campaign: utms.utm_campaign } : {}),
          ...(utms.utm_term ? { term: utms.utm_term } : {}),
        },
      });
    }
    if (!works.length) throw new Error("En esos chats no se encontró ninguna respuesta del agente que corregir.");
    return works;
  }

  /** El mejor de los intentos: el que arregla más chats; con empate, el primero. */
  private async bestAttempt(row: CorrectionRow, bot: { id: string; model: string }, works: Work[]): Promise<Attempt> {
    let best: Attempt | null = null;
    let previous: PreviousAttempt | null = null;
    const score = (a: Attempt) => [...a.replies.values()].filter((r) => r.fixed).length;
    for (let i = 0; i < ATTEMPTS; i++) {
      let attempt: Attempt;
      try {
        attempt = await this.attempt(row, bot, works, previous);
      } catch (e) {
        // Un segundo intento que falla no tira el primero.
        if (best) break;
        throw e;
      }
      if (!best || score(attempt) > score(best)) best = attempt;
      // Ya está todo (al que le falta un dato, otra regla no se lo da), o dijo que no es de las instrucciones.
      const settled = [...attempt.replies].every(([at, r]) => r.fixed || causeOf(attempt.causes, at) === "data");
      if (settled && (attempt.changes.length || !attempt.rejected.length)) break;
      previous = {
        changes: attempt.edits,
        results: [...attempt.replies].map(([at, r]) => ({ chat: at + 1, reply: r.text, note: r.fixed ? "bien" : r.note || "sigue fallando" })),
        rejected: attempt.rejected,
      };
    }
    // Nada de lo propuesto se pudo poner: mejor decir por qué que dar por bueno no cambiar nada.
    if (!best!.changes.length && best!.rejected.length) throw new Error(`La IA propuso cambios que no valen. ${best!.rejected[0]}`);
    return best!;
  }

  /** Una propuesta y lo que respondería el agente con ella en cada chat que depende de las instrucciones. */
  private async attempt(row: CorrectionRow, bot: { id: string; model: string }, works: Work[], previous: PreviousAttempt | null): Promise<Attempt> {
    const res = await this.ask(row.id, bot.model, {
      system: CORRECTION_SYSTEM,
      content: correctionRequest({
        instructions: row.basePrompt,
        note: row.note,
        chats: works.map((w) => ({ lines: w.lines, moment: w.moment, summary: w.summary, findings: w.findings, today: w.today })),
        previous,
      }),
      maxTokens: 7000,
    });
    const parsed = parseCorrection(res);
    if (!parsed) throw new Error("La IA no devolvió una propuesta que se pueda leer. Vuelve a intentarlo.");
    if (!previous) await this.prisma.agentCorrection.update({ where: { id: row.id }, data: { done: { increment: 1 } } });
    const causes = parsed.chats;
    if (!parsed.edits.length) {
      // Sin cambios: solo vale si dijo que no es de las instrucciones.
      if (causes.some((c) => c.cause !== "instructions")) return { prompt: "", changes: [], edits: [], causes, rejected: [], replies: new Map() };
      throw new Error("La IA no propuso ningún cambio. Escribe qué debió hacer el agente y vuelve a intentarlo.");
    }
    const applied = applyProposal(row.basePrompt, parsed.edits, row.note);
    const edits = parsed.edits.map((e) => ({ what: e.what, text: e.text }));
    const check = applied.changes.length ? checkProposal(row.basePrompt, applied.instructions) : null;
    if (!check?.ok) {
      return { prompt: "", changes: [], edits, causes, rejected: applied.skipped.length ? applied.skipped : [check && !check.ok ? check.reason : "No cambiaba nada."], replies: new Map() };
    }

    const replies = new Map<number, Replay>();
    // Al que le falta un dato también: una regla («si no lo sabes, dilo») puede bastarle.
    const targets = works.map((w, i) => ({ w, i })).filter(({ i }) => causeOf(causes, i) !== "system" || !!row.note.trim());
    await inParallel(targets, async ({ w, i }) => void replies.set(i, await this.replay(row, bot, w, applied.instructions)));
    return {
      prompt: applied.instructions,
      changes: applied.changes,
      edits,
      causes,
      rejected: applied.skipped,
      replies,
    };
  }

  /** Esa respuesta otra vez, con esas instrucciones, y si arregla lo que se marcó. No lanza por la comprobación. */
  private async replay(row: CorrectionRow, bot: { id: string; model: string }, w: Work, prompt: string): Promise<Replay> {
    const input = replayInput(w.lines, w.moment)!;
    const r = await this.agent.playground({ botId: bot.id, message: input.message, history: input.history, contact: w.contact }, "improve", { systemPrompt: prompt });
    await this.prisma.agentCorrection.update({ where: { id: row.id }, data: { tokens: { increment: r.inputTokens + r.outputTokens }, done: { increment: 1 } } });
    // Sin texto y con un error: la IA no respondió (sin clave o sin tokens). Seguir solo gastaría.
    if (!r.reply && r.escalationReason === "Error al generar la respuesta.") throw new Error("La IA dejó de responder (sin tokens o sin una clave válida). Revisa Ajustes › Inteligencia Artificial.");
    const line = improveLine(r);
    const text = spoken(line).slice(0, 4000);
    const judged = parseJudge(
      await this.ask(row.id, bot.model, {
        system: JUDGE_SYSTEM,
        // Con las del dueño: lo que añadió la propuesta no vale como prueba de que un dato es cierto.
        content: judgeRequest({ instructions: row.basePrompt, lines: w.lines, moment: w.moment, summary: w.summary, findings: w.findings, note: row.note, reply: line }),
        maxTokens: 1200,
      }),
    );
    if (!judged) return { text, fixed: false, note: "No se pudo comprobar sola: léela tú.", missing: null };
    return { text, fixed: judged.fixed && !judged.invented, note: judged.note, missing: judged.missing };
  }

  /** Con el modelo que razona, como el revisor; si la clave no lo tiene, con el del agente. */
  private async ask(id: string, agentModel: string, req: { system: string; content: string; maxTokens: number }): Promise<string> {
    const call = (model: string) =>
      this.llm.generate({ feature: "improve", system: req.system, messages: [{ role: "user", content: req.content }], model, effort: "medium", maxTokens: req.maxTokens });
    const res = await call(SIMULATION_REVIEW_MODEL).catch((e: Error) => {
      this.logger.warn(`Con ${SIMULATION_REVIEW_MODEL} falló (${e.message}); con el modelo del agente`);
      return call(agentModel);
    });
    await this.prisma.agentCorrection.update({ where: { id }, data: { tokens: { increment: res.usage.inputTokens + res.usage.outputTokens } } });
    return res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text?: string }).text ?? "")
      .join("");
  }

  // ── Lecturas ────────────────────────────────────────────────
  private setChat(w: Work, data: Prisma.AgentCorrectionChatUncheckedUpdateInput) {
    return this.prisma.agentCorrectionChat.update({ where: { id: w.row.id }, data });
  }

  private async chats(correctionId: string): Promise<ChatRow[]> {
    return (await this.prisma.agentCorrectionChat.findMany({
      where: { correctionId },
      orderBy: { position: "asc" },
      include: { review: { select: { summary: true, findings: true } }, conversation: { select: { contact: { select: { name: true, phone: true } } } } },
    })) as unknown as ChatRow[];
  }

  private activeCases(botId: string): Promise<{ id: string }[]> {
    return this.prisma.agentTestCase.findMany({ where: { agentConfigId: botId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  }

  private async bot(botId: string) {
    const bot = await this.prisma.agentConfig.findUnique({ where: { id: botId } });
    if (!bot) throw new NotFoundException("Agente no encontrado");
    return bot;
  }

  private async row(botId: string, id: string): Promise<CorrectionRow> {
    const row = await this.prisma.agentCorrection.findFirst({ where: { id, agentConfigId: botId } });
    if (!row) throw new NotFoundException("Corrección no encontrada");
    return row;
  }

  private async assertAi(): Promise<void> {
    const ai = await this.aiSettings.status();
    if (!ai.ready) throw new BadRequestException("La IA no está disponible: revisa la clave o el plan en Ajustes › Inteligencia Artificial.");
    if (ai.included && (ai.included.full || ai.included.exhausted)) {
      throw new BadRequestException("Se agotaron los tokens de IA de este periodo: no se puede corregir hasta que se renueven.");
    }
  }
}

// ── Sin estado ────────────────────────────────────────────────
/** La causa que dio la IA al chat de esa posición; sin decirla, las instrucciones. */
function causeOf(causes: ChatCause[], at: number): ChatCause["cause"] {
  return causes.find((c) => c.chat === at + 1)?.cause ?? "instructions";
}

/** Unas pocas a la vez. Si una falla, se deja terminar a las demás y se lanza la primera. */
async function inParallel<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown;
  const worker = async () => {
    while (next < items.length && !failed) {
      const item = items[next++]!;
      try {
        await run(item);
      } catch (e) {
        failed ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMPROVE_PARALLEL, items.length) }, worker));
  if (failed) throw failed;
}

function toChat(c: ChatRow): CorrectionChat {
  const worst = ((c.review?.findings ?? []) as SimulationFinding[]).find((f) => f.kind !== "good");
  return {
    id: c.id,
    reviewId: c.reviewId,
    conversationId: c.conversationId,
    contactName: c.conversation.contact.name?.trim() || c.conversation.contact.phone,
    problem: c.review?.summary.trim() || worst?.note || "",
    customer: c.customer,
    before: c.before,
    today: c.today,
    after: c.after,
    outcome: c.outcome as CorrectionOutcome,
    note: c.note,
    missing: c.missing,
  };
}
