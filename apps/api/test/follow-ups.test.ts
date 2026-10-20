/**
 * Seguimientos automáticos: las reglas que no tocan base de datos (qué se
 * guarda, cuándo toca el siguiente toque, en qué chats aplica) y la
 * validación de la secuencia (pasadas 24 h, solo plantilla).
 *
 *   npm run test:followups --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { followUpsSchema, type FollowUpStep } from "@crm/shared";
import { FOLLOW_UP_CANCELLED, dueAtFor, followUpAllowed, parseFollowUps } from "../src/modules/ai/follow-up.rules";

const ai = (afterMinutes: number): FollowUpStep => ({ afterMinutes, kind: "ai", text: "", templateId: null });
const text = (afterMinutes: number): FollowUpStep => ({ afterMinutes, kind: "text", text: "¿Pudiste verlo?", templateId: null });
const template = (afterMinutes: number): FollowUpStep => ({ afterMinutes, kind: "template", text: "", templateId: "tpl_1" });

test("parseFollowUps: solo cuenta lo activado y con toques", () => {
  assert.equal(parseFollowUps(null), null);
  assert.equal(parseFollowUps("basura"), null);
  assert.equal(parseFollowUps({ enabled: false, steps: [ai(60)] }), null);
  assert.equal(parseFollowUps({ enabled: true, steps: [] }), null);
  const ok = parseFollowUps({ enabled: true, steps: [ai(120)] });
  assert.equal(ok?.steps.length, 1);
  assert.equal(ok?.includeHuman, false);
});

test("dueAtFor: cada toque cuenta desde el mensaje anterior; al acabar, nada", () => {
  const from = new Date("2026-10-20T10:00:00Z");
  const steps = [ai(120), template(1440)];
  assert.equal(dueAtFor(steps, 0, from)?.toISOString(), "2026-10-20T12:00:00.000Z");
  assert.equal(dueAtFor(steps, 1, from)?.toISOString(), "2026-10-21T10:00:00.000Z");
  assert.equal(dueAtFor(steps, 2, from), null);
  assert.equal(dueAtFor(steps, FOLLOW_UP_CANCELLED, from), null);
});

test("followUpAllowed: por defecto solo en chats que atiende la IA", () => {
  const cfg = { enabled: true, steps: [ai(60)], includeHuman: false };
  assert.equal(followUpAllowed(cfg, { aiMode: "AUTOPILOT", handoffAt: null }), true);
  assert.equal(followUpAllowed(cfg, { aiMode: "AUTOPILOT", handoffAt: new Date() }), false);
  assert.equal(followUpAllowed(cfg, { aiMode: "COPILOT", handoffAt: null }), false);
  assert.equal(followUpAllowed({ ...cfg, includeHuman: true }, { aiMode: "COPILOT", handoffAt: null }), true);
});

test("secuencia: pasadas 24 h acumuladas solo se admite plantilla", () => {
  const bad = followUpsSchema.safeParse({ enabled: true, steps: [ai(120), text(1320)] });
  assert.equal(bad.success, false);
  assert.deepEqual(bad.success ? [] : bad.error.issues.map((i) => i.path.join(".")), ["steps.1.kind"]);

  const ok = followUpsSchema.safeParse({ enabled: true, steps: [ai(120), text(600), template(1440)] });
  assert.equal(ok.success, true);

  // Apagado no se valida: se puede guardar a medias.
  const off = followUpsSchema.safeParse({ enabled: false, steps: [ai(120), text(1440)] });
  assert.equal(off.success, true);
});

test("secuencia: una plantilla sin elegir y un texto vacío no pasan", () => {
  const noTpl = followUpsSchema.safeParse({ enabled: true, steps: [{ ...template(60), templateId: null }] });
  assert.equal(noTpl.success, false);
  const noText = followUpsSchema.safeParse({ enabled: true, steps: [{ ...text(60), text: "  " }] });
  assert.equal(noText.success, false);
  // La IA sin objetivo sí: el objetivo es opcional.
  assert.equal(followUpsSchema.safeParse({ enabled: true, steps: [ai(60)] }).success, true);
});
