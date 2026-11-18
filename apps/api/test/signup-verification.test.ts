/**
 * Confirmar el correo en el alta: el código que llega al administrador antes de
 * crear la empresa. El servicio y el alta, sobre una base y un servidor de
 * correo de mentira; y el correo, sin ninguno de los dos.
 *
 *   npm run test:signupcode --workspace=apps/api
 */
import "./email-env";
import test from "node:test";
import assert from "node:assert/strict";
import { JwtService } from "@nestjs/jwt";
import { registerOrgSchema, signupCodeSchema } from "@crm/shared";

import { SystemMailer } from "../src/modules/auth/system-mailer";
import { OrganizationService } from "../src/modules/organizations/organization.service";
import { signupCodeEmail } from "../src/modules/organizations/signup-code-email";
import {
  SIGNUP_CODE_MAX_ATTEMPTS,
  SignupVerificationService,
  hashCode,
} from "../src/modules/organizations/signup-verification.service";

process.env.JWT_ACCESS_SECRET ??= "secreto-de-prueba";
delete process.env.MAIL_SMTP_HOST;

type Row = Record<string, any>;

function setup(opts: { mail?: boolean; takenSlugs?: string[] } = {}) {
  const codes = new Map<string, Row>();
  const users: Row[] = [];
  const orgs: Row[] = [];
  const sent: Row[] = [];
  let failWith: Error | null = null;
  let seq = 0;

  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "lt" in v) return row[k] < (v as Row).lt;
      return row[k] === v;
    });

  const prisma = {
    signupVerification: {
      findUnique: async ({ where }: Row) => (codes.has(where.email) ? { ...codes.get(where.email) } : null),
      upsert: async ({ where, create, update }: Row) => {
        const current = codes.get(where.email);
        const row = current ? { ...current, ...update } : { id: `sv${++seq}`, attempts: 0, createdAt: new Date(), ...create };
        codes.set(where.email, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: Row) => {
        let count = 0;
        for (const row of codes.values()) {
          if (!matches(row, where)) continue;
          row.attempts += data.attempts.increment;
          count++;
        }
        return { count };
      },
      deleteMany: async ({ where }: Row) => {
        let count = 0;
        for (const [email, row] of codes) {
          if (matches(row, where)) {
            codes.delete(email);
            count++;
          }
        }
        return { count };
      },
    },
    organization: {
      findUnique: async ({ where }: Row) => ((opts.takenSlugs ?? []).includes(where.slug) ? { id: "otra" } : null),
    },
    $transaction: async (fn: (tx: Row) => Promise<unknown>) =>
      fn({
        organization: { create: async ({ data }: Row) => (orgs.push(data), { ...data }) },
        user: { create: async ({ data }: Row) => (users.push(data), { id: `u${users.length}`, ...data }) },
        pipeline: { create: async () => ({ id: "pl1" }), update: async () => ({}) },
        pipelineStage: { createMany: async () => ({}), findFirst: async () => ({ id: "st1" }) },
        agentConfig: { create: async () => ({}) },
        onboardingState: { create: async () => ({}) },
      }),
  };

  const transport = {
    sendMail: async (mail: Row) => {
      if (failWith) throw failWith;
      sent.push(mail);
    },
  };
  const mailer = opts.mail === false ? new SystemMailer() : new SystemMailer(transport);
  const verification = new SignupVerificationService(prisma as any, mailer);
  const orgService = new OrganizationService(prisma as any, new JwtService({ secret: process.env.JWT_ACCESS_SECRET }), verification);

  /** El código del último correo, como lo leería la persona. */
  const lastCode = () => /\b(\d{6})\b/.exec(sent.at(-1)!.text)![1]!;
  /** Hace como si el último código se hubiera mandado hace `s` segundos. */
  const age = (email: string, s: number) => {
    const row = codes.get(email)!;
    row.sentAt = new Date(row.sentAt.getTime() - s * 1000);
  };
  return { verification, orgService, codes, users, orgs, sent, lastCode, age, fail: (e: Error | null) => (failWith = e) };
}

const alta = (extra: Row = {}) =>
  registerOrgSchema.parse({
    companyName: "Clínica Sol",
    slug: `sol-${Math.random().toString(36).slice(2, 8)}`,
    adminName: "Ana",
    adminEmail: "Ana@ClinicaSol.pe",
    password: "clave-larga-123",
    ...extra,
  });

// ── El código ─────────────────────────────────────────────────

test("el código llega al correo con 6 cifras, en el asunto y en el cuerpo; en la base solo queda su huella", async () => {
  const s = setup();
  const r = await s.verification.request({ email: " Ana@ClinicaSol.pe ", locale: "es" });
  assert.deepEqual(r, { email: "ana@clinicasol.pe", expiresInMinutes: 15, resendInSeconds: 60 });

  assert.equal(s.sent.length, 1);
  const mail = s.sent[0]!;
  assert.equal(mail.to, "ana@clinicasol.pe");
  const code = s.lastCode();
  assert.match(code, /^\d{6}$/);
  assert.equal(mail.subject, `${code} es tu código de Driony`);
  assert.ok(mail.html.includes(`>${code}</span>`), "el código va en el recuadro");

  const row = s.codes.get("ana@clinicasol.pe")!;
  assert.equal(row.codeHash, hashCode("ana@clinicasol.pe", code));
  assert.ok(!JSON.stringify(row).includes(code), "el código no se guarda");
  assert.equal(row.attempts, 0);
  assert.ok(row.expiresAt.getTime() - Date.now() > 14 * 60_000);
});

test("la huella depende del correo: el mismo código para otro correo no coincide", () => {
  assert.notEqual(hashCode("ana@x.com", "123456"), hashCode("luis@x.com", "123456"));
  assert.equal(hashCode(" ANA@x.com ", "123456"), hashCode("ana@x.com", "123456"));
});

test("el código se escribe como venga: con espacios o guión vale; con letras o cifras de menos, no", () => {
  assert.equal(signupCodeSchema.parse("123 456"), "123456");
  assert.equal(signupCodeSchema.parse("123-456"), "123456");
  assert.equal(signupCodeSchema.safeParse("12345").success, false);
  assert.equal(signupCodeSchema.safeParse("12a456").success, false);
});

test("no se puede pedir otro código antes de 60 s; el nuevo anula el anterior", async () => {
  const s = setup();
  await s.verification.request({ email: "ana@x.com" });
  const primero = s.lastCode();
  await assert.rejects(() => s.verification.request({ email: "ana@x.com" }), /Espera \d+ s/);
  assert.equal(s.sent.length, 1);

  s.age("ana@x.com", 61);
  await s.verification.request({ email: "ana@x.com" });
  const segundo = s.lastCode();
  assert.equal(s.sent.length, 2);
  if (primero !== segundo) {
    await assert.rejects(() => s.verification.verify("ana@x.com", primero), /no es correcto/);
  }
  assert.deepEqual(Object.keys(await s.verification.verify("ana@x.com", segundo)), ["id"]);
});

test("cinco códigos por correo y hora como mucho", async () => {
  const s = setup();
  for (let i = 0; i < 5; i++) {
    await s.verification.request({ email: "ana@x.com" });
    s.age("ana@x.com", 61);
  }
  await assert.rejects(() => s.verification.request({ email: "ana@x.com" }), /varios códigos/);
  assert.equal(s.sent.length, 5);
  // Otro correo no se ve afectado.
  await s.verification.request({ email: "luis@x.com" });
  assert.equal(s.sent.length, 6);
});

test("si el correo no sale, se dice y se puede pedir otro al momento", async () => {
  const s = setup();
  s.fail(new Error("550 mailbox unavailable"));
  await assert.rejects(() => s.verification.request({ email: "ana@x.com" }), /No pudimos enviar el correo/);
  assert.equal(s.codes.size, 0, "no queda un código que nadie recibió");
  s.fail(null);
  await s.verification.request({ email: "ana@x.com" });
  assert.equal(s.sent.length, 1);
});

// ── El alta ───────────────────────────────────────────────────

test("con el código bueno se crea la empresa, el correo queda confirmado y el código se gasta", async () => {
  const s = setup();
  await s.verification.request({ email: "ana@clinicasol.pe" });
  const r = await s.orgService.register(alta({ emailCode: s.lastCode() }), "127.0.0.10");

  assert.ok(r.handoffToken);
  assert.equal(s.users.length, 1);
  assert.equal(s.users[0]!.email, "ana@clinicasol.pe");
  assert.ok(s.users[0]!.emailVerifiedAt instanceof Date);
  assert.equal(s.codes.size, 0, "el código ya no sirve para otra empresa");
});

test("sin código, o con uno equivocado, no se crea nada; cinco fallos gastan el código aunque luego llegue el bueno", async () => {
  const s = setup();
  await assert.rejects(() => s.orgService.register(alta(), "127.0.0.11"), /emailCode: Escribe el código/);
  await assert.rejects(() => s.orgService.register(alta({ emailCode: "123456" }), "127.0.0.11"), /emailCode: Ese código ya no sirve/);

  await s.verification.request({ email: "ana@clinicasol.pe" });
  const bueno = s.lastCode();
  const malo = bueno === "000000" ? "111111" : "000000";
  for (let i = 1; i < SIGNUP_CODE_MAX_ATTEMPTS; i++) {
    await assert.rejects(() => s.orgService.register(alta({ emailCode: malo }), "127.0.0.11"), /emailCode: El código no es correcto/);
  }
  await assert.rejects(() => s.orgService.register(alta({ emailCode: malo }), "127.0.0.11"), /emailCode: Demasiados intentos/);
  await assert.rejects(() => s.orgService.register(alta({ emailCode: bueno }), "127.0.0.11"), /emailCode: Demasiados intentos/);
  assert.equal(s.users.length, 0);
});

test("el código es del correo al que se mandó", async () => {
  const s = setup();
  await s.verification.request({ email: "ana@clinicasol.pe" });
  await assert.rejects(
    () => s.orgService.register(alta({ adminEmail: "luis@clinicasol.pe", emailCode: s.lastCode() }), "127.0.0.12"),
    /emailCode: Ese código ya no sirve/,
  );
  assert.equal(s.users.length, 0);
});

test("un código caducado no sirve", async () => {
  const s = setup();
  await s.verification.request({ email: "ana@clinicasol.pe" });
  s.codes.get("ana@clinicasol.pe")!.expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(() => s.orgService.register(alta({ emailCode: s.lastCode() }), "127.0.0.13"), /emailCode: Ese código ya no sirve/);
});

test("un subdominio ocupado no gasta intentos: se cambia y se reintenta con el mismo código", async () => {
  const s = setup({ takenSlugs: ["ocupado"] });
  await s.verification.request({ email: "ana@clinicasol.pe" });
  const code = s.lastCode();
  await assert.rejects(() => s.orgService.register(alta({ slug: "ocupado", emailCode: code }), "127.0.0.14"), /ya está ocupado/);
  assert.equal(s.codes.get("ana@clinicasol.pe")!.attempts, 0);
  await s.orgService.register(alta({ emailCode: code }), "127.0.0.14");
  assert.equal(s.users.length, 1);
});

test("sin correo del sistema el alta no pide código y el correo queda sin confirmar", async () => {
  const s = setup({ mail: false });
  assert.deepEqual(s.verification.options(), { emailCode: false });
  await assert.rejects(() => s.verification.request({ email: "ana@x.com" }), /no manda correos/);
  await s.orgService.register(alta(), "127.0.0.15");
  assert.equal(s.users.length, 1);
  assert.equal(s.users[0]!.emailVerifiedAt, null);
});

// ── El correo ─────────────────────────────────────────────────

test("el correo del código no lleva nada que escriba quien se registra y escapa la dirección", () => {
  const before = process.env.SAAS_BASE_DOMAIN;
  process.env.SAAS_BASE_DOMAIN = "driony.test";
  try {
    const es = signupCodeEmail("es", { email: '"<b>x</b>"@acme.test', code: "048213" });
    assert.equal(es.subject, "048213 es tu código de Driony");
    assert.ok(!es.html.includes("<b>x</b>"), "la dirección va escapada");
    assert.ok(es.html.includes("&lt;b&gt;x&lt;/b&gt;"));
    assert.ok(es.html.includes('src="https://driony.test/email/driony-logo.png"'));
    assert.match(es.text, /^Hola:\n\n/, "sin nombre: no se le pone el que escribió en el formulario");
    assert.match(es.text, /\n\n048213\n\nVale 15 minutos · Sirve una sola vez/);
    assert.ok(!/href="http/.test(es.html.replace(/href="https:\/\/driony\.test"/g, "")), "sin más enlaces que el de la web");

    const en = signupCodeEmail("en", { email: "ana@acme.test", code: "048213" });
    assert.equal(en.subject, "048213 is your Driony code");
    assert.match(en.text, /Works for 15 minutes/);
  } finally {
    if (before === undefined) delete process.env.SAAS_BASE_DOMAIN;
    else process.env.SAAS_BASE_DOMAIN = before;
  }
});
