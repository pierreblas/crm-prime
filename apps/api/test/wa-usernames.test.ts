/**
 * Usuarios de WhatsApp: quien usa nombre de usuario puede no compartir su
 * número. Meta manda entonces su identificador (BSUID) en vez de `from` y
 * `wa_id`, y para contestarle hay que usar `recipient` en vez de `to`.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
 *
 *   npm run test:wausers --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { countryFromPhone, isWaUserId, normalizePhone, phoneLabel, phoneVariants } from "@crm/shared";
import { normalizeWebhook } from "../src/modules/whatsapp/webhook.types";
import { withRecipient } from "../src/modules/whatsapp/providers/meta-whatsapp.provider";

const BSUID = "PE.13491208655302741918";
const meta = { display_phone_number: "15550783881", phone_number_id: "106540352242922" };
const change = (value: object, field = "messages") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field, value: { messaging_product: "whatsapp", metadata: meta, ...value } }] }],
});

test("un mensaje sin número (solo el identificador de usuario) entra en la cola, con su nombre y su usuario", () => {
  const jobs = normalizeWebhook(
    change({
      contacts: [{ profile: { name: "Ana Torres", username: "tienda.ana" }, user_id: BSUID }],
      messages: [{ from_user_id: BSUID, id: "wamid.u1", timestamp: "1767225600", type: "text", text: { body: "Hola, quiero información" } }],
    }) as never,
  );
  assert.equal(jobs.length, 1);
  assert.deepEqual(
    { ...jobs[0] },
    {
      kind: "message",
      from: BSUID,
      name: "Ana Torres",
      waUserId: BSUID,
      username: "tienda.ana",
      waMessageId: "wamid.u1",
      type: "TEXT",
      text: "Hola, quiero información",
      mediaId: undefined,
      channelPhoneNumberId: "106540352242922",
      timestampMs: 1767225600000,
    },
  );
});

test("con número, sigue entrando por el número y además trae su identificador", () => {
  const jobs = normalizeWebhook(
    change({
      contacts: [{ profile: { name: "Luis" }, wa_id: "51999888777", user_id: BSUID }],
      messages: [{ from: "51999888777", from_user_id: BSUID, id: "wamid.p1", type: "text", text: { body: "hola" } }],
    }) as never,
  );
  const job = jobs[0] as { from: string; waUserId?: string; name?: string };
  assert.equal(job.from, "+51999888777");
  assert.equal(job.waUserId, BSUID);
  assert.equal(job.name, "Luis");
});

test("un mensaje sin número no tumba el resto del aviso (estados que vienen con él)", () => {
  const jobs = normalizeWebhook(
    change({
      contacts: [{ profile: { name: "Ana" }, user_id: BSUID }],
      messages: [{ from_user_id: BSUID, id: "wamid.u2", type: "text", text: { body: "precio?" } }],
      statuses: [{ id: "wamid.out1", status: "delivered", recipient_user_id: BSUID }],
    }) as never,
  );
  assert.deepEqual(jobs.map((j) => j.kind), ["message", "status"]);
});

test("el aviso de WhatsApp «cambió de identificador» no es un mensaje: mueve el contacto al nuevo", () => {
  const jobs = normalizeWebhook(
    change({
      messages: [
        {
          from_user_id: "PE.99999999999999999999",
          id: "wamid.sys",
          type: "system",
          system: { type: "user_changed_user_id", body: "User changed…", user_id: "PE.99999999999999999999", previous_user_id: BSUID },
        },
      ],
    }) as never,
  );
  assert.deepEqual(jobs, [
    { kind: "user_id_change", previousUserId: BSUID, userId: "PE.99999999999999999999", channelPhoneNumberId: "106540352242922" },
  ]);
});

test("coexistencia: lo que contestas desde el celular a un usuario sin número también se registra", () => {
  const jobs = normalizeWebhook(
    change({ message_echoes: [{ from: "15550783881", to_user_id: BSUID, id: "wamid.e1", type: "text", text: { body: "Te paso el catálogo" } }] }, "smb_message_echoes") as never,
  );
  assert.equal(jobs.length, 1);
  assert.equal((jobs[0] as { to: string }).to, BSUID);
  assert.equal((jobs[0] as { toUserId?: string }).toUserId, BSUID);
});

test("se le contesta por `recipient`; a un número, por `to` como siempre", () => {
  assert.deepEqual(withRecipient({ messaging_product: "whatsapp", to: BSUID, type: "text", text: { body: "hola" } }), {
    messaging_product: "whatsapp",
    recipient: BSUID,
    type: "text",
    text: { body: "hola" },
  });
  const byPhone = { messaging_product: "whatsapp", to: "+51999888777", type: "text" };
  assert.deepEqual(withRecipient(byPhone), byPhone);
});

test("el identificador se guarda tal cual, da el país y se muestra como su usuario", () => {
  assert.equal(isWaUserId(BSUID), true);
  assert.equal(isWaUserId("PE.ENT.11815799212886844830"), true);
  assert.equal(isWaUserId("+51999888777"), false);
  assert.equal(normalizePhone(` ${BSUID} `), BSUID);
  assert.equal(normalizePhone("51 999 888 777"), "+51999888777");
  assert.deepEqual(phoneVariants(BSUID), [BSUID]);
  assert.equal(countryFromPhone(BSUID)?.code, "PE");
  assert.equal(phoneLabel(BSUID, "tienda.ana"), "@tienda.ana");
  assert.equal(phoneLabel(BSUID, null), "Usuario de WhatsApp");
  assert.equal(phoneLabel("+51999888777", "tienda.ana"), "+51999888777");
});
