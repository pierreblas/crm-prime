/**
 * La bandeja se ordena por lo último que se envió, sea del cliente, del equipo,
 * de la IA o una plantilla. Y «espera respuesta» cuenta desde que escribió el
 * cliente: una difusión posterior no reinicia ese reloj. Sin base de datos: lo
 * que mantiene la base (el trigger) se prueba en rls.test.ts.
 *
 *   npm run test:inboxorder --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { lastInboundMs, waitingMs } from "@crm/shared";
import { MessagingService } from "../src/modules/messaging/messaging.service";
import { PipelineService } from "../src/modules/pipeline/pipeline.service";
import { KnowledgeGapsService } from "../src/modules/knowledge/knowledge-gaps.service";

const T = (min: number) => new Date(Date.UTC(2026, 10, 23, 12, min));
const convo = (o: Record<string, unknown> = {}) => ({
  id: "cv1", status: "OPEN", aiMode: "COPILOT", aiPausedUntil: null, awaitingReply: true, windowExpiresAt: null,
  lastMessageAt: T(30), lastInboundAt: T(10), contact: { id: "c1", phone: "+51987654321", name: "Ana" }, assignedAgent: null, ...o,
});

test("la lista pide lo último enviado primero, y lo que no tenga fecha al final", async () => {
  let asked: { orderBy?: unknown } = {};
  const svc = Object.create(MessagingService.prototype) as Record<string, unknown>;
  svc.prisma = { conversation: { findMany: async (a: typeof asked) => ((asked = a), [convo()]) } };
  const rows = await (svc as unknown as MessagingService).listConversations("u1", {} as never, "ADMIN");
  assert.deepEqual(asked.orderBy, [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }]);
  assert.equal(rows[0]!.lastMessageAt, T(30).toISOString());
  assert.equal(rows[0]!.lastInboundAt, T(10).toISOString());
});

test("«espera respuesta» cuenta desde que escribió el cliente, no desde una difusión posterior", () => {
  const now = T(60).getTime();
  const c = { awaitingReply: true, lastMessageAt: T(30).toISOString(), lastInboundAt: T(10).toISOString() };
  assert.equal(waitingMs(c, now), 50 * 60_000);
  assert.equal(waitingMs({ ...c, awaitingReply: false }, now), null, "ya respondida");
  assert.equal(waitingMs({ ...c, lastInboundAt: null }, now), 30 * 60_000, "sin dato: como antes");
  assert.equal(waitingMs({ awaitingReply: true, lastMessageAt: null }, now), null);
  assert.equal(lastInboundMs({ lastMessageAt: null }), 0);
});

test("la tarjeta del pipeline recibe las dos fechas", () => {
  const svc = Object.create(PipelineService.prototype) as unknown as { toDealDto(d: unknown): { conversation: { lastMessageAt: string; lastInboundAt: string } } };
  const dto = svc.toDealDto({
    id: "d1", title: "x", value: null, currency: "PEN", stageId: "s1", stage: { pipelineId: "p1" }, createdAt: T(0), stageEnteredAt: T(0), discardedAt: null, discardReason: null,
    contact: { id: "c1", name: "Ana", phone: "+51", metadata: {}, conversations: [{ id: "cv1", awaitingReply: true, lastMessageAt: T(30), lastInboundAt: T(10), unreadCount: 0 }] },
  });
  assert.equal(dto.conversation.lastMessageAt, T(30).toISOString());
  assert.equal(dto.conversation.lastInboundAt, T(10).toISOString());
});

test("«Lo que preguntan y falta» lee los chats donde escribió el cliente, no los de una difusión", async () => {
  let asked: { where?: { lastInboundAt?: { gte: Date } }; orderBy?: unknown } = {};
  const svc = Object.create(KnowledgeGapsService.prototype) as Record<string, unknown>;
  const stop = new Error("basta");
  svc.prisma = { conversation: { findMany: async (a: typeof asked) => { asked = a; throw stop; } } };
  svc.settings = { status: async () => ({ ready: true }) };
  await assert.rejects((svc as unknown as KnowledgeGapsService).analyze(), stop);
  assert.ok(asked.where?.lastInboundAt?.gte instanceof Date);
  assert.deepEqual(asked.orderBy, { lastInboundAt: "desc" });
});
