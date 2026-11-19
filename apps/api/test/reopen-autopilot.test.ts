/**
 * Cuándo responde solo el agente a alguien que ya tenía historia con el negocio:
 *  - vuelve a escribir tras cerrar su chat (la conversación nueva heredaba
 *    «Copilot» de la anterior);
 *  - contesta a un chat que abrimos nosotros (difusión, formulario de Meta,
 *    recordatorio de cita, flujo, mensaje desde el celular): nadie decidía el
 *    modo y, con bienvenida activa, su primer mensaje no recibía nada;
 *  - pidió la baja y vuelve a escribir.
 * La IA apagada (OFF) para un cliente se respeta siempre.
 *
 *   npm run test:reopen --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AiMode } from "@crm/shared";
import { AutomationService } from "../src/modules/ai/automation.service";

interface Opts {
  aiMode: AiMode;
  optIn?: boolean;
  /** Mensajes del cliente que ya hay en la conversación (contando el de ahora). */
  inbound?: number;
  bot?: { autopilotByDefault: boolean; welcomeEnabled?: boolean; welcomeMessage?: string } | null;
  /** Un flujo se queda con el mensaje. */
  flowTakesIt?: boolean;
}

function setup(o: Opts) {
  const modes: string[] = [];
  const handled: string[] = [];
  const row = { id: "cv2", orgId: "org1", contactId: "ct1", channelId: null, status: "OPEN", aiMode: o.aiMode, contact: { optIn: o.optIn ?? true, name: "Ana" } };
  const bot = o.bot === null ? null : { autopilotByDefault: true, welcomeEnabled: false, welcomeMessage: "", keywordTriggers: [], businessHoursEnabled: false, replyDelaySec: 4, ...o.bot };
  const inbound = Array.from({ length: o.inbound ?? 1 }, (_, i) => ({ id: `m${i + 1}`, type: "TEXT", content: "hola" }));
  const svc = new AutomationService(
    {
      conversation: { findUnique: async () => row },
      message: {
        findFirst: async () => inbound.at(-1) ?? null,
        findMany: async ({ take }: { take?: number }) => inbound.slice(0, take ?? inbound.length),
        count: async () => inbound.length,
      },
    } as never,
    { resolveForConversation: async () => bot } as never,
    {
      setAiMode: async (_id: string, mode: AiMode) => {
        modes.push(mode);
        row.aiMode = mode;
      },
      queueOutbound: async () => void handled.push("bienvenida"),
    } as never,
    { schedule: async () => void handled.push("autopilot") } as never,
    {
      onCreated: async () => false,
      onInbound: async () => {
        if (o.flowTakesIt) handled.push("flujo");
        return !!o.flowTakesIt;
      },
    } as never,
    { onInbound: async () => false } as never,
    { enrichLatest: async () => undefined } as never,
    { onInbound: async () => false } as never,
  );
  return { svc, modes, handled };
}

/** La conversación la abre el cliente al escribir: «creada» y «entrante», como las emite la mensajería. */
async function customerOpens(s: ReturnType<typeof setup>, optOut = false) {
  const created = s.svc.onCreated({ conversationId: "cv2", messageId: "m1", ...(optOut ? { optOut } : {}) });
  const inbound = s.svc.onInbound({ conversationId: "cv2", messageId: "m1", ...(optOut ? { optOut } : {}) });
  await Promise.all([created, inbound]);
}

test("vuelve a escribir tras cerrar: «Responde solo» vale también para él", async () => {
  // La anterior quedó en Copilot (el agente pasó el chat a una persona) y la nueva lo heredó.
  const a = setup({ aiMode: AiMode.COPILOT });
  await customerOpens(a);
  assert.deepEqual(a.modes, [AiMode.AUTOPILOT]);
  assert.deepEqual(a.handled, ["autopilot"]);

  // La IA estaba apagada para este cliente: se respeta.
  const off = setup({ aiMode: AiMode.OFF });
  await customerOpens(off);
  assert.deepEqual(off.modes, []);

  // Si el agente solo sugiere, la nueva sigue como estaba.
  const copilot = setup({ aiMode: AiMode.COPILOT, bot: { autopilotByDefault: false } });
  await customerOpens(copilot);
  assert.deepEqual(copilot.modes, []);
});

test("contesta a un chat que abrimos nosotros (difusión, recordatorio…): el agente que responde solo le responde", async () => {
  // Su primer mensaje: no hubo «creada», nadie decidió el modo.
  const first = setup({ aiMode: AiMode.COPILOT, inbound: 1 });
  await first.svc.onInbound({ conversationId: "cv2", messageId: "m1" });
  assert.deepEqual(first.modes, [AiMode.AUTOPILOT]);
  assert.deepEqual(first.handled, ["autopilot"]);

  // Ya había escrito antes y alguien (o el agente al pasar el chat) lo dejó en Copilot: no se toca.
  const later = setup({ aiMode: AiMode.COPILOT, inbound: 2 });
  await later.svc.onInbound({ conversationId: "cv2", messageId: "m2" });
  assert.deepEqual(later.modes, [], "solo el primer mensaje del cliente decide el modo");

  // IA apagada en ese chat: tampoco.
  const off = setup({ aiMode: AiMode.OFF, inbound: 1 });
  await off.svc.onInbound({ conversationId: "cv2", messageId: "m1" });
  assert.deepEqual(off.modes, []);
});

test("bienvenida activa: solo se salta el primer mensaje si el saludo salió", async () => {
  const welcome = { autopilotByDefault: true, welcomeEnabled: true, welcomeMessage: "¡Hola! ¿En qué te ayudo?" };
  // El cliente abre el chat: sale el saludo y el agente entra desde el segundo mensaje.
  const opened = setup({ aiMode: AiMode.COPILOT, bot: welcome });
  await customerOpens(opened);
  assert.deepEqual(opened.handled, ["bienvenida"]);

  // El chat lo abrimos nosotros: no hubo saludo, así que el agente contesta (antes no recibía nada).
  const ours = setup({ aiMode: AiMode.COPILOT, bot: welcome, inbound: 1 });
  await ours.svc.onInbound({ conversationId: "cv2", messageId: "m1" });
  assert.deepEqual(ours.handled, ["autopilot"]);
});

test("la baja: al «BAJA» no se le contesta, a lo que escriba después sí", async () => {
  // Escribe «BAJA» y eso abre la conversación: ni flujo ni saludo ni agente, pero el modo queda decidido.
  const baja = setup({ aiMode: AiMode.COPILOT, bot: { autopilotByDefault: true, welcomeEnabled: true, welcomeMessage: "¡Hola!" }, flowTakesIt: true });
  await customerOpens(baja, true);
  assert.deepEqual(baja.handled, []);
  assert.deepEqual(baja.modes, [AiMode.AUTOPILOT]);

  // «BAJA» como respuesta a una difusión (el chat lo abrimos nosotros).
  const reply = setup({ aiMode: AiMode.COPILOT, inbound: 1 });
  await reply.svc.onInbound({ conversationId: "cv2", messageId: "m1", optOut: true });
  assert.deepEqual(reply.handled, []);

  // Dado de baja, vuelve a escribir una pregunta: se le atiende (antes se cortaba aquí).
  const again = setup({ aiMode: AiMode.AUTOPILOT, optIn: false, inbound: 2 });
  await again.svc.onInbound({ conversationId: "cv2", messageId: "m2" });
  assert.deepEqual(again.handled, ["autopilot"]);
});
