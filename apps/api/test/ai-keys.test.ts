/**
 * De quién es la API key de IA que usa una empresa.
 *
 * Con una sola empresa, el .env es suyo y sirve de respaldo. En SaaS el .env
 * es de la plataforma: una empresa sin key propia NO la hereda —quedaría el
 * operador pagando la IA de todos sin saberlo— salvo que lo pida con
 * AI_SHARED_KEYS=true. Una key propia guardada gana siempre.
 *
 * IA de Driony (AI_INCLUDED=true): sin key propia, la empresa usa la de la
 * plataforma con el modelo fijo. Con el cupo de conversaciones lleno, el
 * agente solo sigue las que ya atendía; con el tope en dólares, no hay key
 * salvo para indexar el conocimiento.
 *
 * Cada caso corre en un subproceso con su TENANCY_MODE, porque el modo se lee
 * al importar y no se puede cambiar en caliente.
 *
 *   npm run test:aikeys --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function corre(
  modo: "single" | "multi",
  compartidas: boolean,
  propia: "db" | "none",
  incluida?: { conversaciones?: number; gasto?: number; plan?: string; yaContada?: boolean },
) {
  const args = ["tsx", "test/fixtures/ai-keys-run.ts", propia];
  if (incluida) {
    args.push(String(incluida.conversaciones ?? 0), String(incluida.gasto ?? 0), incluida.plan ?? "free");
    args.push(incluida.yaContada ? "counted" : "new");
  }
  const out = execFileSync("npx", args, {
    env: {
      ...process.env,
      TENANCY_MODE: modo,
      AI_SHARED_KEYS: compartidas ? "true" : "",
      AI_INCLUDED: incluida ? "true" : "",
      AI_INCLUDED_MODEL: "",
      OPENAI_API_KEY: "sk-de-la-plataforma",
      ANTHROPIC_API_KEY: "",
      APP_ENCRYPTION_KEY: "clave-de-prueba-para-cifrar-secretos",
    },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return JSON.parse(out.trim().split("\n").pop()!) as {
    ok: boolean;
    source?: "db" | "env" | "none";
    active?: string;
    platformKeys?: boolean;
    saas?: boolean;
    activeModel?: string;
    ready?: boolean;
    statusSource?: string;
    included?: { conversations: number; limit: number; capUsd: number; full: boolean; exhausted: boolean; resetsAt: string } | null;
    resolvedIncluded?: boolean;
    resolvedBaseUrl?: string | null;
    resolvedIsPlatformKey?: boolean;
    embeddingsIsPlatformKey?: boolean;
    allowsConversation?: boolean;
  };
}

test("SaaS: sin key propia y sin préstamo, la empresa no hereda la key de la plataforma", () => {
  const r = corre("multi", false, "none");
  assert.equal(r.ok, true);
  assert.equal(r.source, "none");
  assert.equal(r.active, "fake");
  assert.equal(r.platformKeys, false);
  assert.equal(r.saas, true);
});

test("SaaS: con AI_SHARED_KEYS=true la key de la plataforma sirve de respaldo", () => {
  const r = corre("multi", true, "none");
  assert.equal(r.source, "env");
  assert.equal(r.active, "openai");
  assert.equal(r.platformKeys, true);
});

test("SaaS: la key propia de la empresa gana aunque no haya préstamo", () => {
  const r = corre("multi", false, "db");
  assert.equal(r.source, "db");
  assert.equal(r.active, "openai");
});

test("una sola empresa: el .env sigue siendo su respaldo, como siempre", () => {
  const r = corre("single", false, "none");
  assert.equal(r.source, "env");
  assert.equal(r.platformKeys, true);
  assert.equal(r.saas, false);
});

test("IA de Driony: sin key propia y con cupo, el agente usa la de la plataforma con el modelo fijo", () => {
  const r = corre("multi", false, "none", { conversaciones: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.ready, true);
  assert.equal(r.statusSource, "included");
  assert.equal(r.active, "openai");
  assert.equal(r.activeModel, "gpt-5-mini", "el modelo del bot o de la empresa no vale con la IA de Driony");
  assert.equal(r.resolvedIncluded, true);
  assert.equal(r.resolvedIsPlatformKey, true);
  assert.equal(r.resolvedBaseUrl, null, "la clave de Driony nunca va al gateway de la empresa");
  assert.deepEqual(
    { conversations: r.included?.conversations, limit: r.included?.limit, exhausted: r.included?.exhausted },
    { conversations: 10, limit: 100, exhausted: false },
  );
});

test("IA de Driony: el cupo sale del plan", () => {
  const r = corre("multi", false, "none", { conversaciones: 150, plan: "pro" });
  assert.equal(r.included?.limit, 2000);
  assert.equal(r.ready, true);
});

test("IA de Driony: con el cupo lleno no empieza conversaciones nuevas", () => {
  const r = corre("multi", false, "none", { conversaciones: 100 });
  assert.equal(r.included?.full, true);
  assert.equal(r.included?.exhausted, false);
  assert.equal(r.ready, true, "la IA sigue disponible para lo que ya atendía y para el equipo");
  assert.equal(r.allowsConversation, false, "una conversación nueva pasa al equipo");
});

test("IA de Driony: con el cupo lleno termina las conversaciones que ya atendía este mes", () => {
  const r = corre("multi", false, "none", { conversaciones: 100, yaContada: true });
  assert.equal(r.allowsConversation, true);
});

test("IA de Driony: el cupo vuelve el día 1 del mes siguiente", () => {
  const r = corre("multi", false, "none", { conversaciones: 1 });
  const d = new Date(r.included!.resetsAt);
  assert.equal(d.getUTCDate(), 1);
  assert.equal(d.getUTCHours(), 0);
  assert.ok(d.getTime() > Date.now());
});

test("IA de Driony: el tope en dólares corta aunque queden conversaciones, menos la indexación", () => {
  const tope = corre("multi", false, "none", { conversaciones: 5 }).included!.capUsd;
  const r = corre("multi", false, "none", { conversaciones: 5, gasto: tope });
  assert.equal(r.ready, false);
  assert.equal(r.included?.exhausted, true);
  assert.equal(r.resolvedIsPlatformKey, false);
  assert.equal(r.embeddingsIsPlatformKey, true, "indexar sigue con la misma clave: cambiar de embedder rompería la búsqueda");
});

test("IA de Driony: la key propia gana y usa su modelo y su gateway", () => {
  const r = corre("multi", false, "db", { conversaciones: 100 });
  assert.equal(r.ready, true);
  assert.equal(r.allowsConversation, true, "con clave propia no hay cupo");
  assert.equal(r.statusSource, "own");
  assert.equal(r.activeModel, "gpt-4o");
  assert.equal(r.resolvedIncluded, false);
  assert.equal(r.resolvedBaseUrl, "https://gateway.de-la-empresa.example/v1");
});

test("IA de Driony: en una instalación propia no existe", () => {
  const r = corre("single", false, "none", { conversaciones: 0 });
  assert.equal(r.included, null);
  assert.equal(r.statusSource, "platform");
  assert.equal(r.source, "env");
});
