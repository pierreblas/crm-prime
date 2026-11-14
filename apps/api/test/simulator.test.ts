/**
 * Simulador de conversaciones: una IA hace de cliente y el agente responde como
 * en el playground. Se prueba el paso (`simulateTurn`) con un modelo de mentira:
 * qué se le pide al cliente simulado, cuándo termina la conversación y qué se
 * cuenta de tokens. La respuesta del agente es la del playground, sustituida aquí.
 *
 *   npm run test:simulator --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SIMULATOR_MAX_BATCH,
  SIMULATOR_MAX_TURNS,
  SIMULATOR_SCENARIOS,
  estimateSimulationTokens,
  simulateTurnRequestSchema,
  simulatorScenarioSchema,
  type PlaygroundReply,
} from "@crm/shared";
import { AgentService } from "../src/modules/ai/agent.service";

const scenario = { title: "Pregunta el precio", brief: "Viste un anuncio y quieres saber cuánto cuesta. Preguntas el precio pronto." };

const agentReply = (patch: Partial<PlaygroundReply> = {}): PlaygroundReply => ({
  reply: "Claro, la consulta cuesta 80 soles.",
  simulatedActions: [],
  escalate: false,
  escalationReason: null,
  model: "gpt-4.1-mini",
  provider: "openai",
  toolsUsed: [],
  inputTokens: 900,
  outputTokens: 40,
  costUsd: 0,
  ...patch,
});

function setup(opts: { customerSays?: string; customerFails?: string; agent?: Partial<PlaygroundReply> } = {}) {
  const llmCalls: any[] = [];
  const agentCalls: any[] = [];
  // Solo lo que usa el paso del simulador; el resto del servicio no interviene.
  const service = Object.create(AgentService.prototype) as AgentService & Record<string, any>;
  service.logger = { warn: () => undefined, error: () => undefined };
  service.prisma = {
    agentConfig: { findUnique: async () => ({ orgId: "org1", systemPrompt: "Eres el asistente de Clínica Sol.   Atiendes citas de odontología en Lima." }) },
    organization: { findUnique: async () => ({ name: "Clínica Sol" }) },
  };
  service.bots = { resolveForChannel: async () => ({ orgId: "org1", systemPrompt: "Agente por defecto" }) };
  service.llm = {
    name: "openai",
    generate: async (req: any) => {
      llmCalls.push(req);
      if (opts.customerFails) throw new Error(opts.customerFails);
      return { stopReason: "end_turn", content: [{ type: "text", text: opts.customerSays ?? "hola, cuánto cuesta la consulta?" }], usage: { inputTokens: 300, outputTokens: 20 }, model: "gpt-4.1-mini" };
    },
  };
  service.playground = async (input: any, feature: string) => {
    agentCalls.push({ input, feature });
    return agentReply(opts.agent);
  };
  return { service, llmCalls, agentCalls };
}

test("el primer paso: el cliente simulado escribe según su escenario y el agente le responde", async () => {
  const s = setup();
  const r = await s.service.simulateTurn({ botId: "bot1", scenario, history: [], maxTurns: 6 });

  assert.equal(r.customer, "hola, cuánto cuesta la consulta?");
  assert.equal(r.agent?.reply, "Claro, la consulta cuesta 80 soles.");
  assert.equal(r.ended, null);
  assert.equal(r.tokens, 300 + 20 + 900 + 40, "se cuentan los dos lados");

  const [llm] = s.llmCalls;
  assert.equal(llm.feature, "simulator");
  assert.equal(llm.tools, undefined, "el cliente de mentira no tiene herramientas");
  assert.match(llm.system, /eres el CLIENTE/);
  assert.match(llm.system, /Clínica Sol/);
  assert.match(llm.system, /Atiendes citas de odontología en Lima/);
  assert.ok(llm.system.includes(scenario.brief));
  assert.match(llm.system, /como mucho 6 mensajes/);
  assert.deepEqual(llm.messages, [{ role: "user", content: "(Empieza la conversación. Escribe tu primer mensaje al negocio.)" }]);

  assert.deepEqual(s.agentCalls, [{ input: { message: "hola, cuánto cuesta la consulta?", botId: "bot1", history: [] }, feature: "simulator" }]);
});

test("para la IA que hace de cliente la conversación va al revés: lo suyo es suyo y lo del agente le llega", async () => {
  const s = setup({ customerSays: "y atienden sábados?" });
  const history = [
    { role: "user" as const, content: "hola, cuánto cuesta la consulta?" },
    { role: "assistant" as const, content: "Claro, la consulta cuesta 80 soles." },
  ];
  const r = await s.service.simulateTurn({ scenario, history, maxTurns: 6 });
  assert.deepEqual(s.llmCalls[0].messages, [
    { role: "user", content: "(Empieza la conversación. Escribe tu primer mensaje al negocio.)" },
    { role: "assistant", content: "hola, cuánto cuesta la consulta?" },
    { role: "user", content: "Claro, la consulta cuesta 80 soles." },
  ]);
  // Al agente le llega el historial tal cual, y el mensaje nuevo aparte.
  assert.deepEqual(s.agentCalls[0].input, { message: "y atienden sábados?", botId: undefined, history });
  assert.equal(r.ended, null);
});

test("cuando el cliente se despide, la marca [FIN] no se enseña, el agente contesta y la conversación termina", async () => {
  const s = setup({ customerSays: "listo, muchas gracias  [FIN] " });
  const r = await s.service.simulateTurn({ scenario, history: [], maxTurns: 6 });
  assert.equal(r.customer, "listo, muchas gracias");
  assert.equal(r.ended, "customer_done");
  assert.equal(s.agentCalls.length, 1, "el agente responde también a la despedida");
});

test("si el agente pasa el chat a una persona, la conversación termina ahí", async () => {
  const s = setup({ agent: { reply: null, escalate: true, escalationReason: "Pidió hablar con una persona", toolsUsed: ["escalate_to_human"] } });
  const r = await s.service.simulateTurn({ scenario, history: [], maxTurns: 6 });
  assert.equal(r.ended, "escalated");
  assert.equal(r.agent?.escalationReason, "Pidió hablar con una persona");
});

test("el tope de mensajes corta la conversación y, pasado, no se gasta nada más", async () => {
  const turno = (n: number) => [
    { role: "user" as const, content: `pregunta ${n}` },
    { role: "assistant" as const, content: `respuesta ${n}` },
  ];
  const s = setup();
  // Tercer y último mensaje de una conversación de tres.
  const last = await s.service.simulateTurn({ scenario, history: [...turno(1), ...turno(2)], maxTurns: 3 });
  assert.equal(last.ended, "max_turns");
  assert.ok(last.customer && last.agent, "el último turno sí se juega");

  const after = await s.service.simulateTurn({ scenario, history: [...turno(1), ...turno(2), ...turno(3)], maxTurns: 3 });
  assert.deepEqual(after, { customer: null, agent: null, ended: "max_turns", error: null, tokens: 0 });
  assert.equal(s.llmCalls.length, 1, "no se llamó otra vez al modelo");
  assert.equal(s.agentCalls.length, 1);
});

test("si la IA no puede hacer de cliente (sin tokens, sin clave), el paso termina con el motivo y no molesta al agente", async () => {
  const s = setup({ customerFails: "Se gastaron los tokens de IA de este mes" });
  const r = await s.service.simulateTurn({ scenario, history: [], maxTurns: 6 });
  assert.deepEqual(r, { customer: null, agent: null, ended: "error", error: "Se gastaron los tokens de IA de este mes", tokens: 0 });
  assert.equal(s.agentCalls.length, 0);

  const vacio = setup({ customerSays: " [FIN] " });
  const r2 = await vacio.service.simulateTurn({ scenario, history: [], maxTurns: 6 });
  assert.equal(r2.ended, "error");
  assert.equal(vacio.agentCalls.length, 0);
});

test("sin elegir agente, se simula contra el agente por defecto", async () => {
  const s = setup();
  await s.service.simulateTurn({ scenario, history: [], maxTurns: 4 });
  assert.match(s.llmCalls[0].system, /Agente por defecto/);
});

test("los escenarios de serie son válidos y la petición tiene sus topes", () => {
  assert.ok(SIMULATOR_SCENARIOS.length >= SIMULATOR_MAX_BATCH);
  for (const sc of SIMULATOR_SCENARIOS) assert.equal(simulatorScenarioSchema.safeParse(sc).success, true, sc.id);
  assert.equal(new Set(SIMULATOR_SCENARIOS.map((x) => x.id)).size, SIMULATOR_SCENARIOS.length);

  assert.equal(simulateTurnRequestSchema.parse({ scenario }).maxTurns, 6);
  assert.equal(simulateTurnRequestSchema.safeParse({ scenario, maxTurns: SIMULATOR_MAX_TURNS + 1 }).success, false);
  assert.equal(simulateTurnRequestSchema.safeParse({ scenario: { title: "x", brief: "corto" } }).success, false);
  const largo = Array.from({ length: SIMULATOR_MAX_TURNS * 2 + 1 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
  assert.equal(simulateTurnRequestSchema.safeParse({ scenario, history: largo }).success, false);
});

test("la estimación de tokens crece con el prompt y con los turnos", () => {
  const corta = estimateSimulationTokens(2000, 4);
  assert.ok(corta > 8000 && corta < 30000, String(corta));
  assert.ok(estimateSimulationTokens(2000, 8) > corta * 1.8);
  assert.ok(estimateSimulationTokens(12000, 4) > corta);
  assert.equal(estimateSimulationTokens(2000, 6) % 1000, 0, "se redondea a miles");
});
