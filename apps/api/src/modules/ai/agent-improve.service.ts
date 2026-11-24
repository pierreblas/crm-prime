import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  compareImprovement,
  IMPROVE_CASES_KEPT,
  IMPROVE_PARALLEL,
  improveIsPerfect,
  optionsNote,
  scoreImprovement,
  SIMULATOR_SCENARIOS,
  type AgentTestCase,
  type AgentTestCaseSource,
  type ApplyImproveInput,
  type CaseDraft,
  type ImproveOverview,
  type ImproveResult,
  type ImproveRun,
  type ImproveRunStatus,
  type ImproveVariant,
  type PlaygroundContact,
  type PlaygroundTurn,
  type PromptVersion,
  type SaveAgentTestCaseInput,
  type SimulationFinding,
  type SimulationReviewLine,
  type SimulatorEndReason,
  type StartImproveRunInput,
  type UpdateAgentTestCaseInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { AgentService } from "./agent.service";
import { AiSettingsService } from "./ai-settings.service";
import {
  applyProposal,
  CHAT_CASE_SYSTEM,
  chatCaseRequest,
  checkProposal,
  improveLine,
  parseChatCase,
  parseProposal,
  proposalRequest,
  PROPOSAL_SYSTEM,
  type ProposalFailure,
} from "./agent-improve.logic";
import { loadChatTranscript } from "./chat-transcript";
import { LLM_PROVIDER, type LLMProvider } from "./llm.provider";
import { recordPromptVersion } from "./prompt-versions";
import { SIMULATION_REVIEW_MODEL } from "./simulation-review";

/** Un caso tal como estaba al lanzar la medición. */
interface CaseSnap {
  id: string;
  title: string;
  brief: string;
}

/** Los de serie que salen marcados la primera vez: los de venta. Los demás, a un clic. */
const PRESETS_ON = new Set(["price", "undecided", "unknown"]);
/** Conversaciones de ejemplo que lee la IA que propone, como mucho, y por caso. */
const FAILURES_MAX = 6;
const FAILURES_PER_CASE = 2;

type RunRow = {
  id: string;
  agentConfigId: string;
  status: string;
  repetitions: number;
  turns: number;
  rounds: number;
  contact: unknown;
  cases: unknown;
  variants: unknown;
  best: number | null;
  done: number;
  total: number;
  tokens: number;
  error: string | null;
  appliedVariant: number | null;
  appliedAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
};

/**
 * «Mejorar agente»: mide cómo atiende un agente una batería de casos, propone
 * un cambio en sus instrucciones que corrija lo que falló y compara, con los
 * mismos casos, el antes y el después. Todo sobre el simulador: nada se envía.
 *
 * La medición corre aquí, en segundo plano, y guarda cada conversación: se
 * puede cerrar la ventana y volver. Una sola a la vez por empresa (gasta
 * tokens). La IA propone y mide; el agente solo cambia cuando el dueño aplica
 * la propuesta, y la versión anterior queda guardada para restaurarla.
 */
@Injectable()
export class AgentImproveService implements OnModuleInit {
  private readonly logger = new Logger("Mejorar agente");
  /** Mediciones a las que se pidió parar: se enteran entre un mensaje y el siguiente. */
  private readonly stopping = new Set<string>();
  /** Mediciones que se pararon porque la IA dejó de responder (sin tokens, sin clave): se dice así, no «detenida». */
  private readonly aiGone = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly agent: AgentService,
    private readonly aiSettings: AiSettingsService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  /** Una medición que estaba en marcha cuando se reinició la API no va a terminar sola: se dice. */
  async onModuleInit(): Promise<void> {
    await runUnscoped("mediciones interrumpidas por un reinicio", () =>
      this.prisma.agentImprovementRun.updateMany({ where: { status: "running" }, data: { status: "interrupted", finishedAt: new Date() } }),
    ).catch((e: Error) => this.logger.warn(`No se pudieron cerrar las mediciones interrumpidas: ${e.message}`));
  }

  // ── Lo que ve la ventana ────────────────────────────────────
  async overview(botId: string): Promise<ImproveOverview> {
    const bot = await this.bot(botId);
    await this.seedPresets(bot);
    const [cases, run, versions, busy] = await Promise.all([
      this.prisma.agentTestCase.findMany({ where: { agentConfigId: botId }, orderBy: { createdAt: "asc" } }),
      this.prisma.agentImprovementRun.findFirst({ where: { agentConfigId: botId }, orderBy: { createdAt: "desc" } }),
      this.prisma.agentPromptVersion.findMany({ where: { agentConfigId: botId }, orderBy: { createdAt: "desc" }, take: 20 }),
      this.prisma.agentImprovementRun.count({ where: { status: "running" } }),
    ]);
    return {
      cases: cases.map(toCase),
      run: run ? toRun(run, bot.systemPrompt) : null,
      versions: versions.map(toVersion),
      busy: busy > 0,
    };
  }

  /** La primera vez, los casos de siempre del simulador, para no empezar con la batería vacía. */
  private async seedPresets(bot: { id: string; orgId: string }): Promise<void> {
    if (await this.prisma.agentTestCase.count({ where: { agentConfigId: bot.id } })) return;
    // Uno a uno y con su fecha, para que salgan en el orden de siempre.
    const now = Date.now();
    await this.prisma.agentTestCase.createMany({
      data: SIMULATOR_SCENARIOS.map((s, i) => ({
        orgId: bot.orgId,
        agentConfigId: bot.id,
        title: s.title,
        brief: s.brief,
        source: "preset",
        presetId: s.id,
        isActive: PRESETS_ON.has(s.id),
        createdAt: new Date(now + i),
      })),
    });
  }

  // ── Casos de prueba ─────────────────────────────────────────
  /** Un caso nuevo: escrito por el dueño o, si viene con su chat, sacado de una conversación real. */
  async createCase(botId: string, input: SaveAgentTestCaseInput): Promise<AgentTestCase> {
    const bot = await this.bot(botId);
    if ((await this.prisma.agentTestCase.count({ where: { agentConfigId: botId } })) >= IMPROVE_CASES_KEPT) {
      throw new BadRequestException(`Un agente guarda como mucho ${IMPROVE_CASES_KEPT} casos de prueba: borra alguno que ya no uses.`);
    }
    if (input.conversationId && !(await this.prisma.conversation.findUnique({ where: { id: input.conversationId }, select: { id: true } }))) {
      throw new NotFoundException("Ese chat ya no existe.");
    }
    const source: AgentTestCaseSource = input.conversationId ? "chat" : "custom";
    const row = await this.prisma.agentTestCase.create({
      data: {
        orgId: bot.orgId,
        agentConfigId: botId,
        title: input.title,
        brief: input.brief,
        source,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      },
    });
    return toCase(row);
  }

  /**
   * De un chat real, la situación del cliente como caso de prueba: la redacta
   * una IA y la revisa el dueño antes de guardarla (no se guarda aquí). El
   * simulador no repite un chat palabra por palabra; repite la situación.
   */
  async draftCaseFromChat(botId: string, conversationId: string): Promise<CaseDraft> {
    await this.bot(botId);
    const chat = await loadChatTranscript(this.prisma, conversationId);
    if (!chat) throw new NotFoundException("Ese chat ya no existe.");
    if (!chat.lines.some((l) => l.who === "agent")) throw new BadRequestException("En ese chat no respondió el agente: no hay nada que probar.");
    await this.assertAi();
    const res = await this.llm.generate({
      feature: "improve",
      system: CHAT_CASE_SYSTEM,
      messages: [{ role: "user", content: chatCaseRequest(chat.lines) }],
      effort: "low",
      maxTokens: 500,
    });
    const draft = parseChatCase(textOf(res.content));
    if (!draft) throw new BadRequestException("No se pudo redactar el caso a partir de ese chat: escríbelo tú con «Nuevo caso».");
    return draft;
  }

  async updateCase(botId: string, caseId: string, input: UpdateAgentTestCaseInput): Promise<AgentTestCase> {
    await this.caseOf(botId, caseId);
    const row = await this.prisma.agentTestCase.update({
      where: { id: caseId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.brief !== undefined ? { brief: input.brief } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return toCase(row);
  }

  async deleteCase(botId: string, caseId: string): Promise<{ ok: true }> {
    await this.caseOf(botId, caseId);
    await this.prisma.agentTestCase.delete({ where: { id: caseId } });
    return { ok: true };
  }

  // ── Mediciones ──────────────────────────────────────────────
  /** Lanza una medición y vuelve enseguida: corre en segundo plano y la ventana pregunta por el avance. */
  // `proposal`: unas instrucciones ya propuestas («Corregir al agente») que medir frente a las de hoy.
  async start(botId: string, input: StartImproveRunInput, proposal?: { prompt: string; changes: ImproveVariant["changes"] }): Promise<ImproveRun> {
    const bot = await this.bot(botId);
    if (!bot.systemPrompt.trim()) throw new BadRequestException("Este agente todavía no tiene instrucciones que medir.");
    if (await this.prisma.agentImprovementRun.count({ where: { status: "running" } })) {
      throw new ConflictException("Ya hay una medición en marcha. Espera a que termine o detenla.");
    }
    const cases = await this.prisma.agentTestCase.findMany({
      where: { agentConfigId: botId, id: { in: input.caseIds } },
      orderBy: { createdAt: "asc" },
    });
    if (!cases.length) throw new BadRequestException("Marca al menos un caso de prueba.");
    await this.assertAi();

    const variants: ImproveVariant[] = [
      { index: 0, kind: "baseline", status: "pending", prompt: bot.systemPrompt, changes: [], score: null, comparison: null, error: null },
      ...(proposal ? [{ index: 1, kind: "proposal" as const, status: "pending" as const, prompt: proposal.prompt, changes: proposal.changes, score: null, comparison: null, error: null }] : []),
    ];
    const snap: CaseSnap[] = cases.map((c) => ({ id: c.id, title: c.title, brief: c.brief }));
    const run = await this.prisma.agentImprovementRun.create({
      data: {
        orgId: bot.orgId,
        agentConfigId: botId,
        status: "running",
        repetitions: input.repetitions,
        turns: input.turns,
        rounds: input.rounds,
        ...(input.contact ? { contact: input.contact as Prisma.InputJsonValue } : {}),
        cases: snap as unknown as Prisma.InputJsonValue,
        variants: variants as unknown as Prisma.InputJsonValue,
        total: cases.length * input.repetitions * (1 + input.rounds + (proposal ? 1 : 0)),
      },
    });
    const work = runInOrg(bot.orgId, () => this.execute(run.id))
      .catch((e: Error) => this.logger.error(`Medición ${run.id}: ${e.message}`))
      .finally(() => {
        this.inFlight.delete(run.id);
        this.stopping.delete(run.id);
        this.aiGone.delete(run.id);
      });
    this.inFlight.set(run.id, work);
    return toRun(run, bot.systemPrompt);
  }

  /** Para las pruebas: cuándo terminó de verdad la medición lanzada. */
  settled(runId: string): Promise<void> {
    return this.inFlight.get(runId) ?? Promise.resolve();
  }

  async run(botId: string, runId: string): Promise<ImproveRun> {
    const bot = await this.bot(botId);
    return toRun(await this.runOf(botId, runId), bot.systemPrompt);
  }

  /** Las conversaciones de una versión (y de un caso, si se pide), para «ver chats». */
  async results(botId: string, runId: string, variant: number, caseId?: string): Promise<ImproveResult[]> {
    await this.runOf(botId, runId);
    const rows = await this.prisma.agentImprovementResult.findMany({
      where: { runId, variant, ...(caseId ? { caseId } : {}) },
      orderBy: [{ caseId: "asc" }, { repetition: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      caseTitle: r.caseTitle,
      variant: r.variant,
      repetition: r.repetition,
      verdict: r.verdict === "ok" || r.verdict === "review" || r.verdict === "bad" ? r.verdict : null,
      goal: r.goal,
      summary: r.summary,
      findings: (r.findings as SimulationFinding[] | null) ?? [],
      lines: (r.lines as SimulationReviewLine[] | null) ?? [],
      ended: (r.ended as SimulatorEndReason | null) ?? null,
      error: r.error,
    }));
  }

  /** Detiene la medición: las conversaciones a medias se cortan y lo ya medido se conserva. */
  async cancelRun(botId: string, runId: string): Promise<ImproveRun> {
    const run = await this.runOf(botId, runId);
    if (run.status === "running") {
      if (this.inFlight.has(runId)) this.stopping.add(runId);
      // Sin proceso detrás (la API se reinició), no hay nada que parar: se cierra aquí.
      else await this.prisma.agentImprovementRun.update({ where: { id: runId }, data: { status: "cancelled", finishedAt: new Date() } });
    }
    return this.run(botId, runId);
  }

  /**
   * Pone la propuesta como instrucciones del agente. Es la única vía por la que
   * una medición cambia el agente, y la pulsa una persona. La versión anterior
   * queda guardada.
   */
  async apply(botId: string, runId: string, input: ApplyImproveInput): Promise<ImproveRun> {
    const bot = await this.bot(botId);
    const run = await this.runOf(botId, runId);
    if (run.status === "running") throw new ConflictException("La medición sigue en marcha: espera a que termine o detenla.");
    const variants = variantsOf(run);
    const proposal = variants.find((v) => v.index === input.variant && v.kind === "proposal" && v.status === "done" && v.prompt.trim());
    if (!proposal) throw new NotFoundException("Esa propuesta no existe o no llegó a medirse.");
    if (bot.systemPrompt !== variants[0]?.prompt && !input.force) {
      throw new ConflictException("Las instrucciones del agente cambiaron desde que empezó la medición. Si aplicas la propuesta se pierde ese cambio.");
    }
    await recordPromptVersion(this.prisma, { orgId: bot.orgId, agentConfigId: botId, systemPrompt: bot.systemPrompt, source: "improve" });
    await this.prisma.agentConfig.update({ where: { id: botId }, data: { systemPrompt: proposal.prompt } });
    await this.prisma.agentImprovementRun.update({ where: { id: runId }, data: { appliedVariant: input.variant, appliedAt: new Date() } });
    this.logger.log(`Agente ${bot.name}: aplicada la propuesta ${input.variant} de la medición ${runId}`);
    return this.run(botId, runId);
  }

  /** Vuelve a una versión anterior de las instrucciones; las de ahora quedan guardadas a su vez. */
  async restore(botId: string, versionId: string): Promise<ImproveOverview> {
    const bot = await this.bot(botId);
    const version = await this.prisma.agentPromptVersion.findFirst({ where: { id: versionId, agentConfigId: botId } });
    if (!version) throw new NotFoundException("Esa versión ya no existe.");
    if (version.systemPrompt !== bot.systemPrompt) {
      await recordPromptVersion(this.prisma, { orgId: bot.orgId, agentConfigId: botId, systemPrompt: bot.systemPrompt, source: "restore" });
      await this.prisma.agentConfig.update({ where: { id: botId }, data: { systemPrompt: version.systemPrompt } });
    }
    return this.overview(botId);
  }

  // ── La medición, por dentro ─────────────────────────────────
  /**
   * Mide las instrucciones de partida y, por cada vuelta pedida, propone un
   * cambio desde la mejor versión hasta el momento y lo mide con los mismos
   * casos. No lanza: lo que falle queda escrito en la medición.
   */
  async execute(runId: string): Promise<void> {
    const run = await this.prisma.agentImprovementRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const bot = await this.prisma.agentConfig.findUnique({ where: { id: run.agentConfigId } });
    const cases = (run.cases as CaseSnap[] | null) ?? [];
    const variants = variantsOf(run);
    const save = (extra: Prisma.AgentImprovementRunUncheckedUpdateInput = {}) =>
      this.prisma.agentImprovementRun.update({ where: { id: runId }, data: { variants: variants as unknown as Prisma.InputJsonValue, ...extra } });

    let status: ImproveRunStatus = "done";
    let error: string | null = null;
    try {
      const base = variants[0];
      if (!bot || !base) throw new Error("El agente de esta medición ya no existe.");
      await this.measure(run, bot, base, cases, save);
      // Detenida antes de acabar ninguna conversación no es un fallo: es una medición detenida.
      if (base.status === "failed" && !this.stopping.has(runId)) throw new Error(base.error ?? "No se pudo medir.");

      // Una propuesta que ya venía hecha: se mide con los mismos casos.
      for (const given of variants.filter((v) => v.kind === "proposal" && v.status === "pending")) {
        if (this.stopping.has(runId)) break;
        await this.measure(run, bot, given, cases, save);
        if (given.score && base.score) given.comparison = compareImprovement(base.score, given.score);
        await save();
      }

      for (let round = 1; round <= run.rounds && !this.stopping.has(runId); round++) {
        const from = bestSoFar(variants);
        if (!from.score || improveIsPerfect(from.score)) break; // ya no queda nada que corregir
        const proposal = await this.propose(run, from, cases, round, bot.model);
        variants.push(proposal);
        await save();
        if (proposal.status === "failed") continue; // la siguiente vuelta lo intenta de nuevo
        await this.measure(run, bot, proposal, cases, save);
        if (proposal.score && base.score) proposal.comparison = compareImprovement(base.score, proposal.score);
        await save();
      }
      if (this.aiGone.has(runId)) {
        status = "failed";
        error = AI_GONE_MESSAGE;
      } else if (this.stopping.has(runId)) status = "cancelled";
    } catch (e) {
      status = "failed";
      error = (e as Error).message.slice(0, 500);
      this.logger.warn(`Medición ${runId} falló: ${error}`);
    }
    const done = await this.prisma.agentImprovementResult.count({ where: { runId } });
    const best = bestProposal(variants);
    // El total era lo previsto; al terminar es lo que de verdad se hizo (pudo parar antes).
    await save({ status, error, best: best?.index ?? null, finishedAt: new Date(), total: done, done });
  }

  /** Todas las conversaciones de una versión: cada caso, las veces pedidas, unas pocas a la vez. */
  private async measure(
    run: RunRow,
    bot: { id: string; model: string },
    variant: ImproveVariant,
    cases: CaseSnap[],
    save: () => Promise<unknown>,
  ): Promise<void> {
    variant.status = "running";
    await save();
    const jobs = cases.flatMap((c) => Array.from({ length: run.repetitions }, (_, i) => ({ c, repetition: i + 1 })));
    let next = 0;
    const worker = async () => {
      while (next < jobs.length && !this.stopping.has(run.id)) {
        const job = jobs[next++]!;
        const r = await this.conversation(run, bot, variant, job.c);
        // Sin tokens o sin clave, las que quedan fallarían igual: se para con lo que hay.
        if (r.error && AI_GONE.test(r.error)) {
          this.aiGone.add(run.id);
          this.stopping.add(run.id);
        }
        await this.prisma.agentImprovementResult.create({
          data: {
            orgId: this.tenant.orgId(),
            runId: run.id,
            caseId: job.c.id,
            caseTitle: job.c.title,
            variant: variant.index,
            repetition: job.repetition,
            verdict: r.verdict,
            goal: r.goal,
            summary: r.summary,
            findings: r.findings as unknown as Prisma.InputJsonValue,
            lines: r.lines as unknown as Prisma.InputJsonValue,
            ended: r.ended,
            error: r.error,
            tokens: r.tokens,
          },
        });
        await this.prisma.agentImprovementRun.update({ where: { id: run.id }, data: { done: { increment: 1 }, tokens: { increment: r.tokens } } });
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMPROVE_PARALLEL, jobs.length) }, worker));

    const rows = await this.prisma.agentImprovementResult.findMany({ where: { runId: run.id, variant: variant.index } });
    variant.score = scoreImprovement(
      rows.map((r) => ({
        caseId: r.caseId,
        caseTitle: r.caseTitle,
        verdict: r.verdict === "ok" || r.verdict === "review" || r.verdict === "bad" ? r.verdict : null,
        goal: r.goal,
        findings: (r.findings as SimulationFinding[] | null) ?? [],
      })),
    );
    if (variant.score.conversations) variant.status = "done";
    else {
      variant.status = "failed";
      variant.error = rows.find((r) => r.error)?.error ?? "No se pudo simular ninguna conversación.";
    }
    await save();
  }

  /** Una conversación simulada entera con las instrucciones de esa versión, y su revisión. No lanza. */
  private async conversation(run: RunRow, bot: { id: string; model: string }, variant: ImproveVariant, c: CaseSnap) {
    const scenario = { title: c.title, brief: c.brief };
    const contact = (run.contact as PlaygroundContact | null) ?? null;
    const history: PlaygroundTurn[] = [];
    const lines: SimulationReviewLine[] = [];
    let ended: SimulatorEndReason | null = null;
    let error: string | null = null;
    let tokens = 0;
    try {
      while (!ended) {
        if (this.stopping.has(run.id)) {
          ended = "error";
          error = "Se detuvo la medición.";
          break;
        }
        const step = await this.agent.simulateTurn(
          { botId: bot.id, scenario, history, maxTurns: run.turns, ...(contact ? { contact } : {}) },
          { systemPrompt: variant.prompt, feature: "improve" },
        );
        tokens += step.tokens;
        if (step.customer) {
          lines.push({ who: "customer", text: step.customer.slice(0, 4000), consulted: [], options: [], handoff: null });
          history.push({ role: "user", content: step.customer });
        }
        if (step.agent) {
          lines.push(improveLine(step.agent));
          // Sin texto (pasó el chat a una persona) no hay nada que añadir a lo hablado.
          if (step.agent.reply) {
            history.push({ role: "assistant", content: step.agent.options?.length ? `${step.agent.reply}\n${optionsNote(step.agent.options)}` : step.agent.reply });
          }
        }
        if (step.ended) {
          ended = step.ended;
          error = step.error;
        } else if (!step.agent?.reply) {
          ended = "error";
          error = "El agente no respondió.";
        }
      }
    } catch (e) {
      ended = "error";
      error = (e as Error).message.slice(0, 300);
    }
    const none = { verdict: null, goal: null, summary: "", findings: [] as SimulationFinding[] };
    // Una conversación que falló o se cortó no se juzga: contaría como mala sin serlo.
    if (ended === "error") return { lines, ended, error: error ?? "No se pudo simular.", tokens, ...none };
    try {
      const review = await this.agent.reviewTranscript({ scenario, lines, ended, ...(contact ? { contact } : {}) }, { instructions: variant.prompt, model: bot.model, feature: "improve" });
      return { lines, ended, error: null, tokens: tokens + review.tokens, verdict: review.verdict, goal: review.goal ?? null, summary: review.summary, findings: review.findings };
    } catch (e) {
      return { lines, ended, error: `No se pudo revisar: ${(e as Error).message.slice(0, 200)}`, tokens, ...none };
    }
  }

  /**
   * La propuesta de una vuelta: la IA lee las instrucciones de la mejor versión
   * y las conversaciones que le salieron mal, y propone cambios puntuales que
   * se colocan sobre ellas. Si ninguno vale, la vuelta queda descartada con
   * el motivo.
   */
  private async propose(run: RunRow, from: ImproveVariant, cases: CaseSnap[], round: number, agentModel: string): Promise<ImproveVariant> {
    const variant: ImproveVariant = { index: round, kind: "proposal", status: "pending", prompt: "", changes: [], score: null, comparison: null, error: null };
    const fail = (reason: string) => ({ ...variant, status: "failed" as const, error: reason });
    try {
      const rows = await this.prisma.agentImprovementResult.findMany({ where: { runId: run.id, variant: from.index }, orderBy: { createdAt: "asc" } });
      const content = proposalRequest({ instructions: from.prompt, score: from.score!, failures: pickFailures(rows, cases) });
      const ask = (model: string) =>
        this.llm.generate({
          feature: "improve",
          system: PROPOSAL_SYSTEM,
          messages: [{ role: "user", content }],
          model,
          // Medio: con «alto», gpt-5-mini a veces se gastaba todo el margen pensando y no llegaba a responder.
          effort: "medium",
          // Devuelve solo los cambios, no las instrucciones enteras.
          maxTokens: 6000,
        });
      // Con el modelo que razona, como el revisor (uno sin razonamiento confundía lo que dijo el agente
      // con sus instrucciones); si la clave no lo tiene, con el del agente.
      const res = await ask(SIMULATION_REVIEW_MODEL).catch((e: Error) => {
        this.logger.warn(`Propuesta con ${SIMULATION_REVIEW_MODEL} falló (${e.message}); con el modelo del agente`);
        return ask(agentModel);
      });
      await this.prisma.agentImprovementRun.update({
        where: { id: run.id },
        data: { tokens: { increment: res.usage.inputTokens + res.usage.outputTokens } },
      });
      const edits = parseProposal(textOf(res.content));
      if (!edits) return fail("La IA no devolvió una propuesta que se pueda leer.");
      // Los cambios se colocan aquí, sobre el texto del dueño: lo que no tocan queda letra por letra.
      const applied = applyProposal(from.prompt, edits);
      if (applied.skipped.length) this.logger.log(`Medición ${run.id}, vuelta ${round}: ${applied.skipped.length} cambio(s) descartado(s)`);
      if (!applied.changes.length) return fail(applied.skipped.length ? `La IA propuso cambios que no valen. ${applied.skipped[0]}` : "La IA no propuso ningún cambio.");
      const check = checkProposal(from.prompt, applied.instructions);
      if (!check.ok) return fail(check.reason);
      return { ...variant, prompt: applied.instructions, changes: applied.changes };
    } catch (e) {
      return fail(`No se pudo redactar la propuesta: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  // ── Comprobaciones ──────────────────────────────────────────
  private async bot(botId: string) {
    const bot = await this.prisma.agentConfig.findUnique({ where: { id: botId } });
    if (!bot) throw new NotFoundException("Agente no encontrado");
    return bot;
  }

  private async caseOf(botId: string, caseId: string) {
    const row = await this.prisma.agentTestCase.findFirst({ where: { id: caseId, agentConfigId: botId } });
    if (!row) throw new NotFoundException("Caso de prueba no encontrado");
    return row;
  }

  private async runOf(botId: string, runId: string): Promise<RunRow> {
    const run = await this.prisma.agentImprovementRun.findFirst({ where: { id: runId, agentConfigId: botId } });
    if (!run) throw new NotFoundException("Medición no encontrada");
    return run;
  }

  /** Sin IA disponible la medición fallaría en la primera conversación: mejor decirlo antes. */
  private async assertAi(): Promise<void> {
    const ai = await this.aiSettings.status();
    if (!ai.ready) throw new BadRequestException("La IA no está disponible: revisa la clave o el plan en Ajustes › Inteligencia Artificial.");
    if (ai.included && (ai.included.full || ai.included.exhausted)) {
      throw new BadRequestException("Se agotaron los tokens de IA de este periodo: no se puede medir hasta que se renueven.");
    }
  }
}

// ── Sin estado ────────────────────────────────────────────────
/** El error de un proveedor sin tokens o sin clave válida (no un fallo puntual, que se reintenta en la siguiente conversación). */
const AI_GONE = /insufficient_quota|exceeded your current quota|credit balance|api key|clave|cupo|AI_NOT_CONFIGURED|\b401\b/i;
const AI_GONE_MESSAGE =
  "La IA dejó de responder a mitad (sin tokens o sin una clave válida): se enseña lo que llegó a medirse. Revisa Ajustes › Inteligencia Artificial y vuelve a lanzarla.";

/** El texto de una respuesta del modelo. */
function textOf(content: { type: string }[]): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: string; text?: string }).text ?? "")
    .join("");
}

function variantsOf(run: { variants: unknown }): ImproveVariant[] {
  return Array.isArray(run.variants) ? (run.variants as ImproveVariant[]) : [];
}

/** Desde qué versión se propone la siguiente: la de partida o, si alguna propuesta la mejora con claridad, la mejor de ellas. */
export function bestSoFar(variants: ImproveVariant[]): ImproveVariant {
  return bestProposal(variants) ?? variants[0]!;
}

/** La propuesta que mejora con claridad a la de partida y puntúa más; null si ninguna lo hace. */
export function bestProposal(variants: ImproveVariant[]): ImproveVariant | null {
  const ratio = (v: ImproveVariant) => (v.score && v.score.max ? v.score.points / v.score.max : 0);
  const better = variants.filter((v) => v.kind === "proposal" && v.status === "done" && v.comparison === "better");
  return better.sort((a, b) => ratio(b) - ratio(a) || a.index - b.index)[0] ?? null;
}

/** Las conversaciones que más enseñan a la IA que propone: primero las malas, luego las mejorables y las que no llegaron a buen fin; pocas por caso. */
export function pickFailures(
  rows: { caseId: string; caseTitle: string; verdict: string | null; goal: boolean | null; summary: string; findings: unknown; lines: unknown }[],
  cases: CaseSnap[],
): ProposalFailure[] {
  const rank = (r: { verdict: string | null; goal: boolean | null }) => (r.verdict === "bad" ? 0 : r.verdict === "review" ? 1 : 2);
  const perCase = new Map<string, number>();
  return rows
    .filter((r) => r.verdict !== null && (r.verdict !== "ok" || r.goal === false))
    .sort((a, b) => rank(a) - rank(b))
    .filter((r) => {
      const n = perCase.get(r.caseId) ?? 0;
      perCase.set(r.caseId, n + 1);
      return n < FAILURES_PER_CASE;
    })
    .slice(0, FAILURES_MAX)
    .map((r) => ({
      caseTitle: r.caseTitle,
      brief: cases.find((c) => c.id === r.caseId)?.brief ?? "",
      verdict: r.verdict!,
      goal: r.goal,
      summary: r.summary,
      findings: (r.findings as SimulationFinding[] | null) ?? [],
      lines: (r.lines as SimulationReviewLine[] | null) ?? [],
    }));
}

function toCase(c: { id: string; title: string; brief: string; source: string; isActive: boolean; createdAt: Date }): AgentTestCase {
  return {
    id: c.id,
    title: c.title,
    brief: c.brief,
    source: c.source === "preset" || c.source === "chat" ? c.source : "custom",
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  };
}

function toVersion(v: { id: string; source: string; systemPrompt: string; createdAt: Date }): PromptVersion {
  return {
    id: v.id,
    source: v.source === "improve" || v.source === "restore" ? v.source : "manual",
    chars: v.systemPrompt.length,
    preview: v.systemPrompt.replace(/\s+/g, " ").trim().slice(0, 140),
    createdAt: v.createdAt.toISOString(),
  };
}

function toRun(run: RunRow, currentPrompt: string): ImproveRun {
  const variants = variantsOf(run);
  const status = (["running", "done", "cancelled", "failed", "interrupted"] as const).find((s) => s === run.status) ?? "failed";
  return {
    id: run.id,
    status,
    repetitions: run.repetitions,
    turns: run.turns,
    rounds: run.rounds,
    cases: ((run.cases as CaseSnap[] | null) ?? []).map((c) => ({ id: c.id, title: c.title })),
    done: run.done,
    total: run.total,
    tokens: run.tokens,
    error: run.error,
    variants,
    best: run.best,
    appliedVariant: run.appliedVariant,
    appliedAt: run.appliedAt?.toISOString() ?? null,
    // Tras aplicar, las instrucciones del agente son las de la propuesta: eso no es «cambió».
    agentChanged: currentPrompt !== variants[0]?.prompt && currentPrompt !== variants.find((v) => v.index === run.appliedVariant)?.prompt,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
