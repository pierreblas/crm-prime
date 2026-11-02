/**
 * Los mensajes de una conversación se atienden de uno en uno y en orden: si
 * el cliente escribe dos seguidos, cada uno ve lo que dejó hecho el anterior
 * (si no, los dos veían «no hay flujo en marcha» y el flujo salía dos veces).
 *
 *   npm run test:order --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AutomationService } from "../src/modules/ai/automation.service";

test("la bandeja atiende los mensajes de una conversación de uno en uno y en orden", async () => {
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  const flows = {
    onInbound: async (_c: string, messageId?: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(`inicio ${messageId}`);
      await new Promise((r) => setTimeout(r, 15));
      order.push(`fin ${messageId}`);
      active--;
      return true;
    },
  };
  const prisma = { conversation: { findUnique: async () => ({ id: "cv1", contact: { optIn: true } }) } };
  const svc = new AutomationService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    flows as never,
    {} as never,
    { enrichLatest: async () => undefined } as never,
  );
  await Promise.all([
    svc.onInbound({ conversationId: "cv1", messageId: "m1" }),
    svc.onInbound({ conversationId: "cv1", messageId: "m2" }),
    svc.onInbound({ conversationId: "cv1", messageId: "m3" }),
  ]);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["inicio m1", "fin m1", "inicio m2", "fin m2", "inicio m3", "fin m3"]);
});
