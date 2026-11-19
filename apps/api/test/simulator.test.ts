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
  simulateReviewRequestSchema,
  simulateTurnRequestSchema,
  simulatorScenarioSchema,
  type PlaygroundReply,
} from "@crm/shared";
import { AgentService } from "../src/modules/ai/agent.service";
import { traceToolCall } from "../src/modules/ai/playground-trace";
import { groundReview, parseSimulationReview, SIMULATION_REVIEW_MODEL, SIMULATION_REVIEW_SYSTEM, simulationReviewInput } from "../src/modules/ai/simulation-review";

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

// ── Más realista: conoce el catálogo y pulsa botones ───────────
test("el cliente simulado sabe qué vende el negocio y pulsa los botones que le ofrecen", async () => {
  const s = setup();
  s.service.prisma.product = { findMany: async () => [{ name: "Genómica bacteriana" }, { name: "Excel avanzado" }] };
  await s.service.simulateTurn({ scenario, history: [], maxTurns: 6 });
  const system = s.llmCalls[0].system as string;
  assert.match(system, /Lo que vende .*: Genómica bacteriana, Excel avanzado\./);
  assert.match(system, /verás «\[Botones: …\]» al final de su mensaje/);
  // Sin catálogo (o si falla), el cliente sigue funcionando como antes.
  const sin = setup();
  await sin.service.simulateTurn({ scenario, history: [], maxTurns: 6 });
  assert.doesNotMatch(sin.llmCalls[0].system, /Lo que vende/);
});

// ── La revisión al terminar ────────────────────────────────────
const conversation = {
  scenario,
  lines: [
    { who: "customer" as const, text: "hola, cuánto cuesta el curso de genómica? dan certificado?" },
    {
      who: "agent" as const,
      text: "Cuesta USD 50 y empieza el 29 de junio. Incluye certificado digital. ¿Te separo un cupo?",
      consulted: ['Consultar tus productos y precios «genómica» → Encontró 1: Genómica bacteriana.\nDevolvió: {"products":[{"name":"Genómica bacteriana","price":50,"missingDetails":["Certificado"]}]}'],
      options: ["Sí, sepárame", "Tengo dudas"],
    },
  ],
  ended: "max_turns" as const,
};

test("el revisor recibe las instrucciones, la situación y la conversación con lo que consultó el agente", () => {
  const input = simulateReviewRequestSchema.parse(conversation);
  const text = simulationReviewInput(input, "Eres Lia, de Flyteek. Los cursos se pagan por Yape.");
  assert.match(text, /## Instrucciones del agente\nEres Lia, de Flyteek/);
  assert.match(text, /## Situación del cliente\nPregunta el precio: /);
  assert.match(text, /terminó porque se llegó al tope de mensajes/);
  assert.match(text, /CLIENTE: hola, cuánto cuesta/);
  // Lo que dijo el agente, separado de lo que le devolvió el sistema.
  assert.match(text, /AGENTE dijo: «Cuesta USD 50 y empieza el 29 de junio\. Incluye certificado digital\. ¿Te separo un cupo\?»/);
  assert.match(text, /Lo que le devolvió el sistema al consultar \(no lo dijo el agente\):\n    - Consultar tus productos .*\n      Devolvió: .*"missingDetails":\["Certificado"\]/);
  assert.match(text, /Botones que ofreció: Sí, sepárame · Tengo dudas/);
  // Unas instrucciones larguísimas se recortan.
  assert.match(simulationReviewInput(input, "x".repeat(9000)), /Instrucciones del agente \(recortadas\)/);
  assert.equal(simulateReviewRequestSchema.safeParse({ scenario, lines: [] }).success, false, "sin conversación no hay nada que revisar");
});

test("del veredicto se queda lo válido: tipos conocidos, como mucho 4 hallazgos; sin JSON, null", () => {
  const r = parseSimulationReview(
    'Aquí va: {"verdict":"bad","summary":"Inventó el certificado.","findings":[' +
      '{"kind":"invented","note":"Dijo que incluye certificado y el producto no lo tiene.","quote":"Incluye certificado digital."},' +
      '{"kind":"rara","note":"x"},{"kind":"good","note":"Ofreció separar el cupo.","quote":""},' +
      '{"kind":"tone","note":"a"},{"kind":"tone","note":"b"},{"kind":"tone","note":"c"}]}',
  );
  assert.equal(r?.verdict, "bad");
  assert.equal(r?.findings.length, 4);
  assert.deepEqual(r?.findings[0], { kind: "invented", note: "Dijo que incluye certificado y el producto no lo tiene.", quote: "Incluye certificado digital." });
  assert.equal(r?.findings[1]?.quote, null);
  assert.equal(parseSimulationReview('{"verdict":"genial"}'), null);
  assert.equal(parseSimulationReview("no sé"), null);
});

test("la revisión usa el modelo del agente; si no se entiende la respuesta, pide leerla a mano", async () => {
  const calls: any[] = [];
  const service = Object.create(AgentService.prototype) as AgentService & Record<string, any>;
  service.logger = { warn: () => undefined };
  service.prisma = { agentConfig: { findUnique: async () => ({ systemPrompt: "Eres Lia.", model: "gpt-4.1-mini" }) } };
  service.bots = { resolveForChannel: async () => ({ systemPrompt: "Agente por defecto", model: "gpt-4.1-mini" }) };
  let answer = '{"verdict":"ok","summary":"Atendió bien.","findings":[{"kind":"good","note":"Respondió con el catálogo.","quote":null}]}';
  service.llm = {
    generate: async (req: any) => {
      calls.push(req);
      return { content: [{ type: "text", text: answer }], usage: { inputTokens: 2000, outputTokens: 120 }, model: "gpt-4.1-mini" };
    },
  };
  const r = await service.reviewSimulation(simulateReviewRequestSchema.parse({ ...conversation, botId: "bot1" }));
  assert.equal(r.verdict, "ok");
  assert.equal(r.tokens, 2120);
  assert.equal(calls[0].system, SIMULATION_REVIEW_SYSTEM);
  assert.equal(calls[0].feature, "simulator");
  assert.equal(calls[0].model, SIMULATION_REVIEW_MODEL, "revisa con un modelo que razona");
  // Si la clave no tiene ese modelo, se revisa con el del agente.
  calls.length = 0;
  const generate = service.llm.generate;
  let first = true;
  service.llm.generate = async (req: any) => {
    if (first) {
      first = false;
      calls.push(req);
      throw new Error("model_not_found");
    }
    return generate(req);
  };
  const retried = await service.reviewSimulation(simulateReviewRequestSchema.parse({ ...conversation, botId: "bot1" }));
  assert.equal(retried.verdict, "ok");
  assert.deepEqual(calls.map((c) => c.model), [SIMULATION_REVIEW_MODEL, "gpt-4.1-mini"]);
  service.llm.generate = generate;
  answer = "lo siento";
  const fallback = await service.reviewSimulation(simulateReviewRequestSchema.parse(conversation));
  assert.equal(fallback.verdict, "review");
  assert.match(fallback.summary, /léela tú/);
});

test("las consultas de datos llevan un extracto de lo que devolvieron; las acciones, no", () => {
  const out = JSON.stringify({ total: 1, note: 'Resultados para "genómica".', products: [{ name: "Genómica bacteriana", price: 50 }] });
  assert.equal(traceToolCall("search_products", { query: "genómica" }, out).evidence, out);
  assert.equal(traceToolCall("search_knowledge", { query: "yape" }, "x".repeat(5000)).evidence?.length, 3000);
  assert.equal(traceToolCall("move_deal_stage", { stage: "Interesado" }, "Movería…").evidence, undefined);
});

test("un hallazgo que cita algo que el agente no dijo se descarta; sin datos inventados, el «Mal» baja", () => {
  const said = ["Cuesta USD 50 y empieza el 29 de junio. ¿Quieres que te comparta los datos para pagar y reservar tu cupo?"];
  const review = {
    verdict: "bad" as const,
    summary: "Inventó precios en pesos.",
    findings: [
      // Citaba el documento de conocimiento, no al agente.
      { kind: "invented" as const, note: "Dio precios en pesos.", quote: "El plan Pro cuesta 499 pesos al mes…" },
      { kind: "no_next_step" as const, note: "No propuso avanzar.", quote: null },
      { kind: "good" as const, note: "Tono amable.", quote: "cualquier cosa" },
    ],
  };
  const grounded = groundReview(review, said);
  assert.deepEqual(grounded.findings.map((f) => f.kind), ["no_next_step", "good"]);
  assert.equal(grounded.verdict, "review");
  assert.equal(grounded.summary, "", "el resumen hablaba de lo descartado");

  // Una cita que sí dijo (aunque recortada, con otras tildes o signos) se queda, y el veredicto también.
  const kept = groundReview(
    { verdict: "bad" as const, summary: "Inventó la fecha.", findings: [{ kind: "invented" as const, note: "La fecha no estaba.", quote: "empieza el 29 de junio…" }] },
    said,
  );
  assert.equal(kept.verdict, "bad");
  assert.equal(kept.findings.length, 1);
  assert.equal(kept.summary, "Inventó la fecha.");
});

test("el cliente simulado se llama como el cliente de prueba", async () => {
  const s = setup();
  await s.service.simulateTurn({ scenario, history: [], maxTurns: 6, contact: { name: "Ana", phone: "+51987654321" } });
  assert.match(s.llmCalls[0].system, /Te llamas Ana: si te presentas o te piden tu nombre, usa ese\./);
});
