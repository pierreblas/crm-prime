import { z } from "zod";
import {
  estimateSimulationTokens,
  playgroundContactSchema,
  simulationFindingSchema,
  simulationReviewLineSchema,
  simulatorEndReasons,
  simulatorScenarioSchema,
  type SimulationFinding,
} from "./ai.schema.js";

// «Mejorar agente»: medir cómo atiende un agente una batería de casos, proponer
// un cambio en sus instrucciones que corrija lo que falló y comparar, con los
// mismos casos, el antes y el después. Corre sobre el simulador (nada se
// envía) y en el servidor (se puede cerrar la ventana). La IA propone y mide;
// aplicar es siempre un clic del dueño.

/** Casos guardados por agente, como mucho (marcados o no). */
export const IMPROVE_CASES_KEPT = 40;
/** Casos marcados por medición, como mucho. */
export const IMPROVE_MAX_CASES = 12;
/** Veces que se repite cada caso: una sola respuesta engaña. */
export const IMPROVE_REPETITION_OPTIONS = [1, 3, 5] as const;
export const IMPROVE_DEFAULT_REPETITIONS = 3;
/** Mensajes del cliente por conversación. De serie menos que el simulador, por coste. */
export const IMPROVE_TURN_OPTIONS = [4, 6, 8] as const;
export const IMPROVE_DEFAULT_TURNS = 4;
/** Vueltas de «proponer y comparar», como mucho. 0 = solo medir. */
export const IMPROVE_MAX_ROUNDS = 3;
/** Conversaciones simuladas a la vez. */
export const IMPROVE_PARALLEL = 3;
/** Versiones anteriores de las instrucciones que se conservan por agente. */
export const IMPROVE_VERSIONS_KEPT = 20;

// ── Casos de prueba ──────────────────────────────────────────
export const agentTestCaseSources = ["preset", "custom", "chat"] as const;
export type AgentTestCaseSource = (typeof agentTestCaseSources)[number];

export const agentTestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  brief: z.string(),
  /** preset: de serie del simulador; custom: escrito por el dueño; chat: sacado de un chat real. */
  source: z.enum(agentTestCaseSources),
  /** Marcado para entrar en la próxima medición. */
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type AgentTestCase = z.infer<typeof agentTestCaseSchema>;

/** Un caso nuevo: la misma forma que un escenario del simulador. Con el chat real del que salió, si salió de uno. */
export const saveAgentTestCaseSchema = simulatorScenarioSchema.extend({ conversationId: z.string().min(1).optional() });
export type SaveAgentTestCaseInput = z.infer<typeof saveAgentTestCaseSchema>;

/** Pedir que una IA redacte el caso (la situación del cliente) a partir de un chat real. */
export const draftCaseFromChatSchema = z.object({ conversationId: z.string().min(1) });
export type DraftCaseFromChatInput = z.infer<typeof draftCaseFromChatSchema>;
/** El borrador: el dueño lo revisa y lo guarda. */
export type CaseDraft = z.infer<typeof simulatorScenarioSchema>;

export const updateAgentTestCaseSchema = simulatorScenarioSchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdateAgentTestCaseInput = z.infer<typeof updateAgentTestCaseSchema>;

// ── Lanzar una medición ──────────────────────────────────────
const oneOf = <T extends readonly number[]>(options: T, what: string) =>
  z
    .number()
    .int()
    .refine((n) => (options as readonly number[]).includes(n), `${what}: ${options.join(", ")}`);

export const startImproveRunSchema = z.object({
  caseIds: z.array(z.string()).min(1, "Marca al menos un caso").max(IMPROVE_MAX_CASES),
  repetitions: oneOf(IMPROVE_REPETITION_OPTIONS, "Repeticiones").default(IMPROVE_DEFAULT_REPETITIONS),
  turns: oneOf(IMPROVE_TURN_OPTIONS, "Mensajes por conversación").default(IMPROVE_DEFAULT_TURNS),
  /** 0 = solo medir cómo está hoy; 1 a 3 = proponer y comparar esas vueltas. */
  rounds: z.number().int().min(0).max(IMPROVE_MAX_ROUNDS).default(0),
  /** El cliente de «Probar como» (nombre y país): el mismo para toda la medición. */
  contact: playgroundContactSchema.optional(),
});
export type StartImproveRunInput = z.infer<typeof startImproveRunSchema>;
export type StartImproveRunPayload = z.input<typeof startImproveRunSchema>;

// ── Puntuación ───────────────────────────────────────────────
export const improveCaseScoreSchema = z.object({
  caseId: z.string(),
  title: z.string(),
  conversations: z.number(),
  ok: z.number(),
  invented: z.number(),
  goal: z.number(),
});
export type ImproveCaseScore = z.infer<typeof improveCaseScoreSchema>;

export const improveScoreSchema = z.object({
  /** Conversaciones revisadas (las que fallaron al simular no cuentan). */
  conversations: z.number(),
  /** «Atendió bien»: veredicto «bien». */
  ok: z.number(),
  review: z.number(),
  bad: z.number(),
  /** Conversaciones con algún dato inventado. */
  invented: z.number(),
  /** «Llegó a buen fin». */
  goal: z.number(),
  /** Conversaciones que no se pudieron simular o revisar. */
  failed: z.number(),
  /** Puntuación interna para elegir la mejor versión, y su máximo. */
  points: z.number(),
  max: z.number(),
  cases: z.array(improveCaseScoreSchema),
});
export type ImproveScore = z.infer<typeof improveScoreSchema>;

/** Lo que hace falta de una conversación revisada para puntuarla. */
export interface ScoredConversation {
  caseId: string;
  caseTitle: string;
  /** null: no se pudo simular o revisar. */
  verdict: "ok" | "review" | "bad" | null;
  goal: boolean | null;
  findings: Pick<SimulationFinding, "kind">[];
}

/** Bien 2, revisar 1, mal 0; más 1 si llegó a buen fin. */
export const IMPROVE_POINTS_MAX = 3;
function points(c: ScoredConversation): number {
  return (c.verdict === "ok" ? 2 : c.verdict === "review" ? 1 : 0) + (c.goal ? 1 : 0);
}

/** Los conteos que ve el dueño y la puntuación con la que se elige la mejor versión. */
export function scoreImprovement(rows: ScoredConversation[]): ImproveScore {
  const judged = rows.filter((r) => r.verdict !== null);
  const invented = (r: ScoredConversation) => r.findings.some((f) => f.kind === "invented");
  const cases = new Map<string, ImproveCaseScore>();
  for (const r of rows) {
    const c = cases.get(r.caseId) ?? { caseId: r.caseId, title: r.caseTitle, conversations: 0, ok: 0, invented: 0, goal: 0 };
    if (r.verdict !== null) {
      c.conversations++;
      if (r.verdict === "ok") c.ok++;
      if (invented(r)) c.invented++;
      if (r.goal) c.goal++;
    }
    cases.set(r.caseId, c);
  }
  return {
    conversations: judged.length,
    ok: judged.filter((r) => r.verdict === "ok").length,
    review: judged.filter((r) => r.verdict === "review").length,
    bad: judged.filter((r) => r.verdict === "bad").length,
    invented: judged.filter(invented).length,
    goal: judged.filter((r) => r.goal).length,
    failed: rows.length - judged.length,
    points: judged.reduce((n, r) => n + points(r), 0),
    max: judged.length * IMPROVE_POINTS_MAX,
    cases: [...cases.values()],
  };
}

export const improveComparisons = ["better", "same", "worse"] as const;
export type ImproveComparison = (typeof improveComparisons)[number];

/** A partir de qué parte del máximo una diferencia deja de ser ruido. */
export const IMPROVE_CLEAR_GAIN = 0.1;

/**
 * La propuesta frente a la versión de partida. Una que inventa más nunca gana;
 * por debajo del 10 % del máximo la diferencia no se distingue del azar con las
 * repeticiones que se hacen, y se dice «sin diferencia clara».
 */
export function compareImprovement(base: ImproveScore, other: ImproveScore): ImproveComparison {
  if (!base.max || !other.max) return "same";
  if (other.invented > base.invented) return "worse";
  // Si alguna conversación falló, las dos no tienen el mismo máximo: se comparan en proporción.
  const gain = other.points / other.max - base.points / base.max;
  if (gain >= IMPROVE_CLEAR_GAIN) return "better";
  if (gain <= -IMPROVE_CLEAR_GAIN) return "worse";
  return "same";
}

/** Ya no queda nada que corregir: todas bien y a buen fin. */
export function improveIsPerfect(score: ImproveScore): boolean {
  return score.conversations > 0 && score.points === score.max;
}

// ── Una medición ─────────────────────────────────────────────
export const improveChangeSchema = z.object({
  /** Qué cambió en las instrucciones. */
  what: z.string(),
  /** Por qué: qué falló. */
  why: z.string(),
  /** El caso que lo motivó, si es de uno. */
  caseTitle: z.string().nullable().default(null),
});
export type ImproveChange = z.infer<typeof improveChangeSchema>;

export const improveVariantSchema = z.object({
  /** 0 = las instrucciones de partida; 1…N = la propuesta de esa vuelta. */
  index: z.number(),
  kind: z.enum(["baseline", "proposal"]),
  status: z.enum(["pending", "running", "done", "failed"]),
  /** Las instrucciones de esta versión. */
  prompt: z.string(),
  changes: z.array(improveChangeSchema).default([]),
  score: improveScoreSchema.nullable().default(null),
  /** Frente a la de partida. Null en la de partida o si aún no se midió. */
  comparison: z.enum(improveComparisons).nullable().default(null),
  /** Por qué se descartó (la IA devolvió algo que no cumple, o falló). */
  error: z.string().nullable().default(null),
});
export type ImproveVariant = z.infer<typeof improveVariantSchema>;

export const improveRunStatuses = ["running", "done", "cancelled", "failed", "interrupted"] as const;
export type ImproveRunStatus = (typeof improveRunStatuses)[number];

export const improveRunSchema = z.object({
  id: z.string(),
  status: z.enum(improveRunStatuses),
  repetitions: z.number(),
  turns: z.number(),
  rounds: z.number(),
  /** Los casos tal como estaban al lanzarla. */
  cases: z.array(z.object({ id: z.string(), title: z.string() })),
  /** Conversaciones hechas y previstas. */
  done: z.number(),
  total: z.number(),
  tokens: z.number(),
  error: z.string().nullable(),
  variants: z.array(improveVariantSchema),
  /** La mejor propuesta (su índice), si alguna mejora con claridad. */
  best: z.number().nullable(),
  appliedVariant: z.number().nullable(),
  appliedAt: z.string().nullable(),
  /** Las instrucciones del agente ya no son las que se midieron: aplicar las pisaría. */
  agentChanged: z.boolean(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ImproveRun = z.infer<typeof improveRunSchema>;

export const promptVersionSchema = z.object({
  id: z.string(),
  /** Por qué se guardó: se editó a mano, se aplicó una mejora o se restauró otra versión. */
  source: z.enum(["manual", "improve", "restore"]),
  chars: z.number(),
  /** El principio del texto, para reconocerla. */
  preview: z.string(),
  createdAt: z.string(),
});
export type PromptVersion = z.infer<typeof promptVersionSchema>;

export const improveOverviewSchema = z.object({
  cases: z.array(agentTestCaseSchema),
  /** La última medición del agente (en marcha o terminada). */
  run: improveRunSchema.nullable(),
  versions: z.array(promptVersionSchema),
  /** Hay una medición en marcha en la empresa (de este agente o de otro): no se puede lanzar otra. */
  busy: z.boolean(),
});
export type ImproveOverview = z.infer<typeof improveOverviewSchema>;

/** Una conversación de una medición, para «ver chats». */
export const improveResultSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  caseTitle: z.string(),
  variant: z.number(),
  repetition: z.number(),
  verdict: z.enum(["ok", "review", "bad"]).nullable(),
  goal: z.boolean().nullable(),
  summary: z.string(),
  findings: z.array(simulationFindingSchema),
  lines: z.array(simulationReviewLineSchema),
  ended: z.enum(simulatorEndReasons).nullable(),
  error: z.string().nullable(),
});
export type ImproveResult = z.infer<typeof improveResultSchema>;

export const applyImproveSchema = z.object({
  /** La propuesta que se aplica (su índice, 1…N). */
  variant: z.number().int().min(1).max(IMPROVE_MAX_ROUNDS),
  /** Aplicar aunque el agente se haya editado desde que empezó la medición. */
  force: z.boolean().default(false),
});
export type ApplyImproveInput = z.infer<typeof applyImproveSchema>;

/**
 * Tokens que gastará, más o menos, una medición: las conversaciones de la
 * versión de partida y de cada vuelta, más lo que cuesta redactar cada
 * propuesta: lee las instrucciones y las conversaciones que fallaron y razona
 * (medido con gpt-5-mini: unas 6.000 de entrada y 3.000 de salida).
 */
export function estimateImprovementTokens(promptChars: number, cases: number, repetitions: number, turns: number, rounds: number): number {
  const perConversation = estimateSimulationTokens(promptChars, turns);
  const conversations = cases * repetitions * (1 + rounds);
  const perProposal = Math.ceil(promptChars / 3.5) + 9000;
  return Math.round((conversations * perConversation + rounds * perProposal) / 1000) * 1000;
}
