/**
 * Correo: las reglas que no tocan base de datos (dirección del contacto,
 * variables, paso de texto a HTML, enlace de baja, a qué servidores se puede
 * conectar) y el servicio real sobre una base y un servidor de correo de mentira.
 *
 *   npm run test:email --workspace=apps/api
 */
import "./email-env";
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendEmailHtml,
  buildEmailVars,
  contactEmailOf,
  emailAccountInputSchema,
  emailHtmlHasContent,
  emailHtmlToText,
  emailHtmlWarnings,
  emailPreviewDoc,
  emailTemplateInputSchema,
  emailTextToHtml,
  emptyEmailVars,
  renderEmailHtml,
  renderEmailText,
  sendEmailSchema,
  updateEmailTemplateSchema,
} from "@crm/shared";

import { isPrivateAddress, smtpTargetProblem } from "../src/modules/email/smtp-guard";
import { readUnsubscribeToken, unsubscribeToken, unsubscribeUrl } from "../src/modules/email/email-unsubscribe";
import { SmtpError } from "../src/modules/email/email.transport";
import { EmailAccountsService } from "../src/modules/email/email-accounts.service";
import { EmailService } from "../src/modules/email/email.service";
import { EmailTemplatesService } from "../src/modules/email/email-templates.service";
import { encryptSecret } from "../src/common/utils/secret-box";
import { changedEmail, resetEmail } from "../src/modules/auth/password-reset-emails";

// ── Reglas ────────────────────────────────────────────────────

test("el correo del contacto sale de sus campos, por la clave estándar o por las que llegan de fuera", () => {
  assert.equal(contactEmailOf({ email: " Ana@Clinica.PE " }), "ana@clinica.pe");
  assert.equal(contactEmailOf({ correo: "ventas@tienda.com" }), "ventas@tienda.com");
  assert.equal(contactEmailOf({ email: "no es un correo", work_email: "ana@empresa.com" }), "ana@empresa.com");
  assert.equal(contactEmailOf({ email: "ana@" }), null);
  assert.equal(contactEmailOf({ email: "ana@dominio" }), null);
  assert.equal(contactEmailOf({ ciudad: "Lima" }), null);
  assert.equal(contactEmailOf(null), null);
});

test("las variables se rellenan con el contacto, la empresa y quien envía; las del flujo mandan", () => {
  const vars = buildEmailVars({
    contact: { name: "Ana María Torres", phone: "+51999888777", fields: { email: "ana@x.com", ciudad: "Lima" } },
    orgName: "Clínica Sol",
    senderName: "Luis",
    extra: { pedido: "A-123", ciudad: "Cusco" },
  });
  assert.equal(
    renderEmailText("Hola {{primer_nombre}} ({{nombre}}), de {{ ciudad }}: tu pedido {{pedido}}. {{agente}}, {{empresa}}. {{correo}} {{telefono}}", vars),
    "Hola Ana (Ana María Torres), de Cusco: tu pedido A-123. Luis, Clínica Sol. ana@x.com +51999888777",
  );
});

test("una variable desconocida queda en blanco y se puede avisar antes de enviar", () => {
  const vars = buildEmailVars({ contact: { name: null, phone: "+51999888777", fields: {} }, orgName: "Clínica Sol", senderName: null });
  assert.equal(renderEmailText("Hola {{nombre}}, tu cita es {{fecha_cita}}.", vars), "Hola , tu cita es .");
  assert.deepEqual(emptyEmailVars("Hola {{nombre}}, {{empresa}}, {{fecha_cita}} {{nombre}}", vars), ["nombre", "fecha_cita"]);
});

test("el identificador de Messenger o Instagram no sale como teléfono en un correo", () => {
  const vars = buildEmailVars({ contact: { name: "Ana", phone: "FB.123456", fields: {} }, orgName: "X", senderName: null });
  assert.equal(vars.telefono, "");
});

test("el cuerpo pasa a HTML con párrafos, saltos y enlaces, y escapa todo lo demás", () => {
  const html = emailTextToHtml("Hola <b>Ana</b> & cía\nSegunda línea\n\nMira https://driony.com/precios?a=1&b=2.\n\n<script>alert(1)</script>");
  assert.ok(html.includes("Hola &lt;b&gt;Ana&lt;/b&gt; &amp; cía<br>Segunda línea</p>"));
  assert.ok(html.includes('<a href="https://driony.com/precios?a=1&amp;b=2" style="color:#1a56db">https://driony.com/precios?a=1&amp;b=2</a>.'));
  assert.ok(!html.includes("<script>"));
  assert.equal((html.match(/<p /g) ?? []).length, 3);
});

test("un nombre de contacto con marcado no mete HTML en el correo", () => {
  const vars = buildEmailVars({ contact: { name: '<img src=x onerror="alert(1)">', phone: "+51999888777", fields: {} }, orgName: "X", senderName: null });
  const html = emailTextToHtml(renderEmailText("Hola {{nombre}}", vars));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
});

test("HTML: las variables entran escapadas y el marcado propio queda intacto", () => {
  const vars = buildEmailVars({
    contact: { name: '<img src=x onerror="alert(1)">', phone: "+51999888777", fields: { ciudad: "Lima & Callao" } },
    orgName: "Clínica <Sol>",
    senderName: "Luis",
  });
  assert.equal(
    renderEmailHtml('<h1 style="color:#0b3a45">Hola {{nombre}}</h1><p>De {{ ciudad }}, {{empresa}}. {{no_existe}}</p>', vars),
    '<h1 style="color:#0b3a45">Hola &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1><p>De Lima &amp; Callao, Clínica &lt;Sol&gt;. </p>',
  );
});

test("HTML: su versión en texto conserva lo que se lee, los enlaces y los saltos", () => {
  const html = `<!DOCTYPE html><html><head><title>Promo</title><style>p{color:red}</style></head><body>
    <!-- nota interna --><!--[if mso]><table><tr><td>solo Outlook</td></tr></table><![endif]-->
    <h1>Hola&nbsp;Ana</h1>
    <p>Tu curso de <b>MLOps</b> empieza el lunes.<br>Te esperamos &amp; trae tus dudas.</p>
    <p><a href="https://driony.com/curso?a=1&amp;b=2" style="color:#fff">Ver el curso</a> · <a href="https://driony.com/">driony.com</a> · <a href="mailto:hola@driony.com?subject=x">Escríbenos</a></p>
    <ul><li>Uno</li><li>Dos &#8212; y medio</li></ul>
    <table><tr><td>Precio</td><td>S/ 120</td></tr></table>
    <img src="https://x.com/logo.png" alt="Logo Driony">
    <script>alert(1)</script>
  </body></html>`;
  assert.equal(
    emailHtmlToText(html),
    [
      "Hola Ana",
      "Tu curso de MLOps empieza el lunes.\nTe esperamos & trae tus dudas.",
      "Ver el curso (https://driony.com/curso?a=1&b=2) · driony.com · Escríbenos (hola@driony.com)",
      "- Uno\n- Dos — y medio",
      "Precio\nS/ 120",
      "Logo Driony",
    ].join("\n\n"),
  );
  assert.equal(emailHtmlToText("3 < 5 y 7 > 2"), "3 < 5 y 7 > 2", "un «<» que no abre etiqueta es texto");
  assert.equal(emailHtmlHasContent("<div><style>p{}</style> </div>"), false);
  assert.equal(emailHtmlHasContent('<a href="https://x.com"><img src="https://x.com/a.png"></a>'), true, "una imagen sola ya es un correo");
});

test("HTML: un marcado roto o hecho para atascar se recorre igual, y rápido", () => {
  for (const broken of ["<", "<a href=", "hola <b", "<!-- sin cerrar", "<style>p{}", "<<<>>>", "</p></div>", "<img alt='x"]) {
    emailHtmlToText(broken);
    emailHtmlWarnings(broken);
    emailPreviewDoc(broken);
  }
  const started = Date.now();
  for (const piece of ["<a href=x>", "<a href=\"", "<!--", "<img ", "< ", "<style>", "<p", "<head ", "&#", "{{", "<script "]) {
    const big = piece.repeat(Math.floor(100_000 / piece.length));
    emailHtmlToText(big);
    emailHtmlWarnings(big);
    emailPreviewDoc(big);
    emailHtmlHasContent(big);
    renderEmailHtml(big, {});
    appendEmailHtml(big, "<p>pie</p>");
  }
  assert.ok(Date.now() - started < 2000, `tardó ${Date.now() - started} ms`);
});

test("HTML: lo que se añade al final entra antes de </body>, o detrás si es un fragmento", () => {
  assert.equal(appendEmailHtml("<html><body><p>Hola</p></BODY></html>", "<p>pie</p>"), "<html><body><p>Hola</p><p>pie</p></BODY></html>");
  assert.equal(appendEmailHtml("<p>Hola</p>", "<p>pie</p>"), "<p>Hola</p><p>pie</p>");
  assert.equal(appendEmailHtml("<p>Hola</p>", ""), "<p>Hola</p>");
});

test("HTML: el tope del cuerpo depende del formato y un HTML sin nada que ver no vale", () => {
  const send = (format: string, body: string) => sendEmailSchema.safeParse({ contactId: "c1", accountId: "a1", subject: "Hola", body, format });
  assert.equal(send("text", "x".repeat(20_001)).success, false, "el texto sigue con su tope");
  assert.equal(send("html", `<p>${"x".repeat(20_001)}</p>`).success, true);
  const over = send("html", `<p>${"x".repeat(100_000)}</p>`);
  assert.equal(over.success, false, "más de 100.000 caracteres");
  assert.equal(over.success ? 0 : over.error.issues.length, 1, "y lo dice una sola vez");
  assert.equal(send("html", "<div><style>p{}</style></div>").success, false, "nada que mostrar");
  assert.equal(send("html", '<img src="https://x.com/a.png">').success, true);
  assert.equal(send("pdf", "Hola").success, false);
  assert.equal(sendEmailSchema.parse({ contactId: "c1", accountId: "a1", subject: "Hola", body: "Texto" }).format, "text", "sin decir nada, texto");

  assert.equal(emailTemplateInputSchema.parse({ name: "A", subject: "B", body: "<p>Hola</p>", format: "html" }).format, "html");
  assert.equal(emailTemplateInputSchema.parse({ name: "A", subject: "B", body: "Hola" }).format, "text");
  assert.deepEqual(updateEmailTemplateSchema.parse({ name: "Otra" }), { name: "Otra" }, "al editar, lo que no llega no se inventa");
  assert.equal(updateEmailTemplateSchema.safeParse({ format: "text", body: "x".repeat(20_001) }).success, false);
});

test("HTML: se avisa de lo que no va a funcionar en un programa de correo", () => {
  assert.deepEqual(emailHtmlWarnings('<header>Hola</header><img src="https://x.com/a.png"><img src="{{foto}}">'), []);
  const warnings = emailHtmlWarnings('<script>x</script><form></form><img src="logo.png"><img alt="x" src=\'data:image/png;base64,AAA\'><imagen>');
  assert.equal(warnings.length, 3);
  assert.match(warnings[0]!, /<script>/);
  assert.match(warnings[1]!, /Formularios/);
  assert.match(warnings[2]!, /^2 imágenes no se verán/);
  assert.match(emailHtmlWarnings("<img>")[0]!, /^Una imagen no se verá/);
});

test("HTML: la vista previa lleva su política de contenido, sea documento o fragmento", () => {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none';`;
  const full = emailPreviewDoc('<!DOCTYPE html><html lang="es"><head><title>x</title></head><body><header>h</header></body></html>');
  assert.ok(full.startsWith(`<!DOCTYPE html><html lang="es"><head>${policy}`), "al principio del <head>, antes que nada suyo");
  assert.ok(full.endsWith("<title>x</title></head><body><header>h</header></body></html>"), "el resto queda como estaba");
  assert.ok(emailPreviewDoc("<html><body>hola</body></html>").startsWith(`<html><head>${policy}`));
  const fragment = emailPreviewDoc("<header>h</header><p>Hola</p>");
  assert.ok(fragment.startsWith(`<!doctype html><html><head><meta charset="utf-8">${policy}`), "«<header» no es «<head»");
  assert.ok(fragment.endsWith("<header>h</header><p>Hola</p></body></html>"));
  assert.ok(!/script-src|unsafe-eval|frame-src/.test(full), "nada que abra la puerta a scripts o marcos");
  assert.ok(full.includes('<base target="_blank">'));
});

test("al conectar un buzón se limpia la dirección y se rechaza un servidor mal escrito", () => {
  const ok = emailAccountInputSchema.parse({ address: " Ventas@Tienda.com ", smtpHost: "SMTP.Tienda.com", smtpPort: 465, smtpUser: "ventas@tienda.com", smtpPass: "x" });
  assert.equal(ok.address, "ventas@tienda.com");
  assert.equal(ok.smtpHost, "smtp.tienda.com");
  assert.equal(ok.userId, null);
  assert.equal(ok.dailyLimit, 300);
  for (const smtpHost of ["https://smtp.tienda.com", "smtp.tienda.com:465", "smtp tienda", "smtp.tienda.com/", "-smtp.tienda.com"]) {
    assert.equal(emailAccountInputSchema.safeParse({ address: "a@b.com", smtpHost, smtpPort: 465, smtpUser: "a", smtpPass: "x" }).success, false, smtpHost);
  }
  assert.equal(emailAccountInputSchema.safeParse({ address: "no-es-correo", smtpHost: "smtp.b.com", smtpPort: 465, smtpUser: "a", smtpPass: "x" }).success, false);
});

test("los adjuntos tienen tope de cantidad y de peso, y solo valen archivos propios", () => {
  const file = (size: number, i = 0) => ({ ref: `storage://0f8fad5b-d9cb-469f-a165-70867728950${i}`, name: `doc${i}.pdf`, mimeType: "application/pdf", size });
  const send = (attachments: unknown[]) => sendEmailSchema.safeParse({ contactId: "c1", accountId: "a1", subject: "Hola", body: "Texto", attachments });
  assert.equal(send([file(1000)]).success, true);
  assert.equal(send([0, 1, 2, 3, 4, 5].map((i) => file(10, i))).success, false, "más de cinco");
  assert.equal(send([file(9 * 1024 * 1024, 1), file(9 * 1024 * 1024, 2)]).success, false, "más de 15 MB");
  assert.equal(send([{ ...file(10), ref: "https://ejemplo.com/a.pdf" }]).success, false, "una URL no es un adjunto");
  assert.equal(send([{ ...file(10), ref: "storage://../../etc/passwd" }]).success, false, "ni una ruta");
});

test("en SaaS solo se conecta a servidores públicos por los puertos de envío", () => {
  assert.equal(smtpTargetProblem("smtp.gmail.com", 465), null);
  assert.equal(smtpTargetProblem("smtp.office365.com", 587), null);
  assert.match(smtpTargetProblem("smtp.gmail.com", 25)!, /puerto/);
  assert.match(smtpTargetProblem("smtp.gmail.com", 6379)!, /puerto/);
  assert.match(smtpTargetProblem("10.0.0.5", 587)!, /IP/);
  assert.match(smtpTargetProblem("localhost", 587)!, /pública/);
  assert.match(smtpTargetProblem("redis.internal", 587)!, /pública/);
  assert.match(smtpTargetProblem("crm-db", 587)!, /pública/);
});

test("las direcciones internas se reconocen, también en IPv6 y disfrazadas de IPv4", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["142.250.0.108", "172.32.0.1", "52.96.0.1", "2607:f8b0:4004:c1b::6c", "::ffff:142.250.0.108"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("el enlace de baja va firmado: lo lee quien lo generó y no admite retoques", () => {
  const token = unsubscribeToken("org1", "Ana@X.com");
  assert.deepEqual(readUnsubscribeToken(token), { orgId: "org1", address: "ana@x.com" });
  const [payload, signature] = token.split(".");
  const other = Buffer.from(JSON.stringify(["org2", "ana@x.com"])).toString("base64url");
  assert.equal(readUnsubscribeToken(`${other}.${signature}`), null, "cambiar la empresa invalida la firma");
  assert.equal(readUnsubscribeToken(`${payload}.${signature!.slice(0, -2)}xx`), null);
  assert.equal(readUnsubscribeToken(payload), null);
  assert.equal(readUnsubscribeToken(undefined), null);
  assert.ok(unsubscribeUrl("org1", "ana@x.com")!.startsWith("https://api.driony.test/api/v1/email/unsubscribe?t="));
});

// ── El servicio, sobre una base y un servidor de correo de mentira ──

type Row = Record<string, any>;

function setup(opts: { contactFields?: Row; accounts?: Row[]; sentToday?: number } = {}) {
  const contact: Row = { id: "ct1", orgId: "org1", name: "Ana Torres", phone: "+51999888777", metadata: opts.contactFields ?? { email: "ana@cliente.com" } };
  const accounts: Row[] = (
    opts.accounts ?? [
      { id: "acc_shared", userId: null, address: "ventas@clinica.pe", fromName: "Clínica Sol", signature: "Clínica Sol · Av. Larco 123" },
      { id: "acc_luis", userId: "u_luis", address: "luis@clinica.pe", fromName: "Luis de Clínica Sol", signature: "Luis" },
    ]
  ).map((a, i) => ({
    orgId: "org1",
    provider: "gmail",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpUser: a.address,
    smtpPassEnc: encryptSecret("clave-de-aplicacion"),
    dailyLimit: 300,
    status: "ok",
    lastError: null,
    createdAt: new Date(2026, 0, i + 1),
    ...a,
  }));
  const emails: Row[] = [];
  const notes: Row[] = [];
  const unsubscribed = new Set<string>();
  const templates = new Map<string, Row>([
    ["tpl1", { id: "tpl1", name: "Bienvenida", subject: "Hola {{primer_nombre}}", body: "Gracias por escribir a {{empresa}}.\n\nTu pedido: {{pedido}}", attachments: [] }],
  ]);
  const files = new Map<string, Row>([["0f8fad5b-d9cb-469f-a165-708677289501", { buffer: Buffer.from("pdf"), mimeType: "application/pdf", size: 3, fileName: "x" }]]);
  const jobs: Row[] = [];
  const sent: Row[] = [];
  let failWith: Error | null = null;

  const prisma = {
    contact: {
      findFirst: async ({ where }: Row) => (where.id === contact.id ? { ...contact } : null),
      findUnique: async ({ where }: Row) => (where.id === contact.id ? { ...contact } : null),
      update: async ({ data }: Row) => Object.assign(contact, data),
    },
    conversation: {
      findFirst: async () => ({ id: "cv1" }),
      findUnique: async () => ({ assignedAgent: { id: "u_luis", name: "Luis" } }),
    },
    organization: { findUnique: async () => ({ name: "Clínica Sol" }) },
    user: {
      findUnique: async ({ where }: Row) => ({ id: where.id, name: where.id === "u_luis" ? "Luis" : "Marta" }),
      findFirst: async () => ({ id: "u_admin" }),
      findMany: async () => [{ id: "u_luis", name: "Luis", email: "luis@clinica.pe" }],
    },
    emailTemplate: { findUnique: async ({ where }: Row) => templates.get(where.id) ?? null },
    emailUnsubscribe: {
      findFirst: async ({ where }: Row) => (unsubscribed.has(where.address) ? { id: "un1" } : null),
      upsert: async ({ create }: Row) => unsubscribed.add(create.address),
    },
    emailAccount: {
      findUnique: async ({ where }: Row) => accounts.find((a) => a.id === where.id) ?? null,
      findFirst: async ({ where }: Row) => accounts.find((a) => a.userId === where.userId) ?? null,
      update: async ({ where, data }: Row) => Object.assign(accounts.find((a) => a.id === where.id)!, data),
    },
    email: {
      create: async ({ data }: Row) => {
        const row = { id: `em${emails.length + 1}`, status: "queued", automated: false, userId: null, origin: null, errorReason: null, createdAt: new Date(), sentAt: null, ...data };
        emails.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: Row) => {
        const row = emails.find((e) => e.id === where.id);
        return row ? { ...row, account: accounts.find((a) => a.id === row.accountId) ?? null } : null;
      },
      update: async ({ where, data }: Row) => ({ ...Object.assign(emails.find((e) => e.id === where.id)!, data) }),
      // El historial no carga el HTML: como en la base, `omit` lo deja fuera.
      findMany: async ({ omit }: Row) =>
        emails.map((e) => {
          const row = { ...e };
          if (omit?.bodyHtml) delete row.bodyHtml;
          return row;
        }),
      count: async () => opts.sentToday ?? 0,
    },
    note: { create: async ({ data }: Row) => notes.push(data) },
  };
  const transport = {
    verify: async () => undefined,
    send: async (account: Row, mail: Row) => {
      if (failWith) throw failWith;
      sent.push({ account, mail });
      return { messageId: "<abc@clinica.pe>" };
    },
  };
  const tenant = { orgId: () => "org1" };
  const perms = { contactWhere: async () => null, canSeePhone: async () => true };
  const storage = { read: async (id: string) => files.get(id) ?? null };
  const queue = { add: async (_name: string, data: Row) => jobs.push(data) };
  const accountsSvc = new EmailAccountsService(prisma as any, tenant as any, transport as any);
  const service = new EmailService(prisma as any, tenant as any, accountsSvc, perms as any, storage as any, transport as any, queue as any);
  const luis = { sub: "u_luis", sid: "s", role: "AGENT", org: "org1" } as any;
  const marta = { sub: "u_marta", sid: "s", role: "AGENT", org: "org1" } as any;
  return { service, contact, accounts, emails, notes, sent, jobs, unsubscribed, files, templates, luis, marta, fail: (e: Error | null) => (failWith = e) };
}

const manual = {
  contactId: "ct1",
  accountId: "acc_shared",
  subject: "Tu cotización, {{primer_nombre}}",
  body: "Hola {{nombre}}:\n\nTe adjunto la cotización.",
  format: "text" as "text" | "html",
  saveToContact: false,
  attachments: [],
};

test("escribir a mano: sale por el buzón elegido, con las variables puestas, y queda en el historial y en el chat", async () => {
  const s = setup();
  const dto = await s.service.send(manual, s.luis);

  assert.equal(s.sent.length, 1);
  const { account, mail } = s.sent[0]!;
  assert.deepEqual(account, { host: "smtp.gmail.com", port: 465, user: "ventas@clinica.pe", pass: "clave-de-aplicacion" });
  assert.deepEqual(mail.from, { name: "Clínica Sol", address: "ventas@clinica.pe" });
  assert.equal(mail.to, "ana@cliente.com");
  assert.equal(mail.subject, "Tu cotización, Ana");
  assert.equal(mail.text, "Hola Ana Torres:\n\nTe adjunto la cotización.");
  assert.ok(mail.html.includes("Hola Ana Torres:</p>"));
  assert.equal(mail.headers, undefined, "a mano no lleva enlace de baja");
  assert.ok(!mail.text.includes("baja"));

  assert.equal(dto.status, "sent");
  assert.equal(dto.sentBy, "Luis");
  assert.equal(s.emails[0]!.messageId, "<abc@clinica.pe>");
  assert.equal(s.emails[0]!.conversationId, "cv1");
  assert.deepEqual(s.notes, [{ conversationId: "cv1", authorId: "u_luis", body: "✉️ Correo enviado a ana@cliente.com · «Tu cotización, Ana»" }]);
  assert.equal(s.accounts[0]!.lastError, null);
  assert.ok(s.accounts[0]!.lastSentAt instanceof Date);
});

test("un contacto sin correo pide la dirección; al darla se puede guardar en su ficha", async () => {
  const s = setup({ contactFields: { ciudad: "Lima" } });
  await assert.rejects(() => s.service.send(manual, s.luis), /no tiene correo/);
  assert.equal(s.sent.length, 0);

  await s.service.send({ ...manual, to: "ana@nueva.com", saveToContact: true }, s.luis);
  assert.equal(s.sent[0]!.mail.to, "ana@nueva.com");
  assert.deepEqual(s.contact.metadata, { ciudad: "Lima", email: "ana@nueva.com" });
});

test("nadie escribe desde el buzón personal de otra persona", async () => {
  const s = setup();
  await assert.rejects(() => s.service.send({ ...manual, accountId: "acc_luis" }, s.marta), /personal de otra persona/);
  await s.service.send({ ...manual, accountId: "acc_luis" }, s.luis);
  assert.equal(s.sent[0]!.mail.from.address, "luis@clinica.pe");
});

test("con el tope diario del buzón alcanzado no sale nada más", async () => {
  const s = setup({ sentToday: 300 });
  await assert.rejects(() => s.service.send(manual, s.luis), /tope de 300 correos por día/);
  assert.equal(s.emails.length, 0);
  assert.deepEqual(await s.service.sendAutomated({ contactId: "ct1", conversationId: "cv1", templateId: "tpl1", vars: {}, origin: "Flujo «X»" }), {
    ok: false,
    reason: "el buzón ventas@clinica.pe llegó a su tope de 300 correos por día",
  });
});

test("si el servidor rechaza la contraseña, el correo queda fallido, el buzón marcado y el aviso trae la pista del proveedor", async () => {
  const s = setup();
  s.fail(new SmtpError("El servidor de correo rechazó el usuario o la contraseña.", false, true));
  await assert.rejects(() => s.service.send(manual, s.luis), /contraseña de aplicación/);
  assert.equal(s.emails[0]!.status, "failed");
  assert.match(s.emails[0]!.errorReason, /rechazó el usuario o la contraseña/);
  assert.equal(s.accounts[0]!.status, "error");
  assert.equal(s.notes.length, 0, "el error ya se ve en pantalla: sin nota");
});

test("un adjunto que ya no existe detiene el envío con un motivo claro", async () => {
  const s = setup();
  const attachments = [{ ref: "storage://ffffffff-d9cb-469f-a165-708677289501", name: "cotizacion.pdf", mimeType: "application/pdf", size: 3 }];
  await assert.rejects(() => s.service.send({ ...manual, attachments }, s.luis), /cotizacion\.pdf.*ya no está disponible/);
  assert.equal(s.sent.length, 0);

  const ok = [{ ...attachments[0]!, ref: "storage://0f8fad5b-d9cb-469f-a165-708677289501" }];
  await s.service.send({ ...manual, attachments: ok }, s.luis);
  assert.deepEqual(s.sent[0]!.mail.attachments, [{ filename: "cotizacion.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }]);
});

test("automático: se encola con la plantilla rellenada y la firma del buzón, y al salir lleva la baja", async () => {
  const s = setup();
  const res = await s.service.sendAutomated({ contactId: "ct1", conversationId: "cv1", templateId: "tpl1", vars: { pedido: "A-123" }, origin: "Flujo «Bienvenida»" });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(s.jobs, [{ emailId: "em1", orgId: "org1" }]);
  assert.equal(s.sent.length, 0, "todavía no salió: va por la cola");
  const row = s.emails[0]!;
  assert.equal(row.automated, true);
  assert.equal(row.accountId, "acc_shared");
  assert.equal(row.subject, "Hola Ana");
  assert.equal(row.bodyText, "Gracias por escribir a Clínica Sol.\n\nTu pedido: A-123\n\nClínica Sol · Av. Larco 123");

  await s.service.deliver("em1", false);
  const { mail } = s.sent[0]!;
  const link = /https:\/\/api\.driony\.test\/api\/v1\/email\/unsubscribe\?t=[\w.-]+/.exec(mail.text)?.[0];
  assert.ok(link, "el texto lleva el enlace de baja");
  assert.equal(mail.headers["List-Unsubscribe"], `<${link}>`);
  assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(mail.html.includes(`<a href="${link}"`));
  assert.deepEqual(readUnsubscribeToken(link!.split("t=")[1]), { orgId: "org1", address: "ana@cliente.com" });
  assert.deepEqual(s.notes, [{ conversationId: "cv1", authorId: "u_admin", body: "✉️ Flujo «Bienvenida»: correo enviado a ana@cliente.com · «Hola Ana»" }]);
});

test("automático: no se envía a quien se dio de baja, ni sin correo, ni sin buzón de la empresa", async () => {
  const req = { contactId: "ct1", conversationId: "cv1", templateId: "tpl1", vars: {}, origin: "Flujo «X»" };

  const baja = setup();
  baja.unsubscribed.add("ana@cliente.com");
  assert.deepEqual(await baja.service.sendAutomated(req), { ok: false, reason: "ana@cliente.com pidió no recibir correos automáticos" });
  // A mano sí se le puede escribir: la baja es de lo automático.
  await baja.service.send(manual, baja.luis);
  assert.equal(baja.sent.length, 1);

  const sinCorreo = setup({ contactFields: {} });
  assert.deepEqual(await sinCorreo.service.sendAutomated(req), { ok: false, reason: "el contacto no tiene correo" });

  const sinBuzon = setup({ accounts: [{ id: "acc_luis", userId: "u_marta", address: "marta@clinica.pe" }] });
  assert.match(((await sinBuzon.service.sendAutomated(req)) as { reason: string }).reason, /no hay un buzón de la empresa/);

  assert.deepEqual(await setup().service.sendAutomated({ ...req, templateId: "no" }), { ok: false, reason: "la plantilla de correo ya no existe" });
});

test("automático: «el buzón del responsable» usa el suyo y, si no tiene, el de la empresa", async () => {
  const req = { contactId: "ct1", conversationId: "cv1", templateId: "tpl1", vars: {}, origin: "Flujo «X»" };
  const s = setup();
  await s.service.sendAutomated({ ...req, account: "assignee" });
  assert.equal(s.emails[0]!.accountId, "acc_luis");
  assert.equal(s.emails[0]!.fromName, "Luis de Clínica Sol");

  const sinPersonal = setup({ accounts: [{ id: "acc_shared", userId: null, address: "ventas@clinica.pe", fromName: null }] });
  await sinPersonal.service.sendAutomated({ ...req, account: "assignee" });
  assert.equal(sinPersonal.emails[0]!.accountId, "acc_shared");
  assert.equal(sinPersonal.emails[0]!.fromName, "Clínica Sol", "sin nombre propio, el de la empresa");

  await s.service.sendAutomated({ ...req, account: "acc_luis" });
  assert.equal(s.emails[1]!.accountId, "acc_luis");
  await s.service.sendAutomated({ ...req, account: "borrado" });
  assert.equal(s.emails[2]!.accountId, "acc_shared", "un buzón que ya no existe cae al de la empresa");
});

test("automático: un fallo pasajero se reintenta; en el último intento queda fallido con su nota", async () => {
  const s = setup();
  await s.service.sendAutomated({ contactId: "ct1", conversationId: "cv1", templateId: "tpl1", vars: {}, origin: "Flujo «Bienvenida»" });
  s.fail(new SmtpError("No se pudo conectar con smtp.gmail.com:465. Revisa el servidor y el puerto.", true));

  await assert.rejects(() => s.service.deliver("em1", false), /No se pudo conectar/);
  assert.equal(s.emails[0]!.status, "queued", "sigue en cola: la cola lo reintenta");
  assert.equal(s.notes.length, 0);
  assert.equal(s.accounts[0]!.status, "ok", "un corte de red no marca el buzón como roto");

  await s.service.deliver("em1", true);
  assert.equal(s.emails[0]!.status, "failed");
  assert.deepEqual(s.notes.map((n) => n.body), [
    "✉️ Flujo «Bienvenida»: no se pudo enviar el correo «Hola Ana» a ana@cliente.com: No se pudo conectar con smtp.gmail.com:465. Revisa el servidor y el puerto.",
  ]);

  // Ya resuelto: entregarlo otra vez no lo vuelve a mandar.
  s.fail(null);
  await s.service.deliver("em1", true);
  assert.equal(s.sent.length, 0);
});

test("automático: quien se da de baja mientras el correo espera en la cola ya no lo recibe", async () => {
  const s = setup();
  await s.service.sendAutomated({ contactId: "ct1", conversationId: "cv1", templateId: "tpl1", vars: {}, origin: "Flujo «X»" });
  await s.service.unsubscribe("org1", " Ana@Cliente.com ");
  await s.service.deliver("em1", true);
  assert.equal(s.sent.length, 0);
  assert.equal(s.emails[0]!.status, "failed");
  assert.match(s.emails[0]!.errorReason, /pidió no recibir/);
});

test("escribir en HTML: sale el diseño tal cual, con las variables escapadas y su versión en texto", async () => {
  const s = setup();
  s.contact.name = "Ana <script>alert(1)</script>";
  const body = '<div style="font-family:Georgia"><h1>Hola {{nombre}}</h1><p>Mira <a href="https://clinica.pe/c/1">tu cotización</a>.</p></div>';
  const dto = await s.service.send({ ...manual, subject: "Tu cotización", format: "html", body }, s.luis);

  const { mail } = s.sent[0]!;
  assert.equal(
    mail.html,
    '<div style="font-family:Georgia"><h1>Hola Ana &lt;script&gt;alert(1)&lt;/script&gt;</h1><p>Mira <a href="https://clinica.pe/c/1">tu cotización</a>.</p></div>',
    "ni se envuelve ni se reescribe: solo entran las variables, como texto",
  );
  assert.equal(mail.text, "Hola Ana <script>alert(1)</script>\n\nMira tu cotización (https://clinica.pe/c/1).", "quien no ve HTML lee esto");
  assert.ok(!mail.html.includes("Av. Larco"), "la firma del buzón no se pega a un diseño");
  assert.equal(mail.headers, undefined);

  assert.equal(dto.format, "html");
  assert.equal(dto.body, mail.text, "el historial enseña el texto, no el marcado");
  assert.equal(s.emails[0]!.format, "html");
  assert.equal(s.emails[0]!.bodyHtml, mail.html);
  assert.deepEqual(s.notes.map((n) => n.body), ["✉️ Correo enviado a ana@cliente.com · «Tu cotización»"]);
});

test("automático en HTML: la plantilla sale con su diseño y la baja entra dentro del <body>", async () => {
  const s = setup();
  s.templates.set("tplHtml", {
    id: "tplHtml",
    name: "Pedido",
    subject: "Hola {{primer_nombre}}",
    format: "html",
    body: '<html><body><h1 style="color:#0b3a45">Hola {{primer_nombre}}</h1><p>Tu pedido {{pedido}} ya salió. <a href="https://clinica.pe/pedidos">Verlo</a></p></body></html>',
    attachments: [],
  });
  const res = await s.service.sendAutomated({ contactId: "ct1", conversationId: "cv1", templateId: "tplHtml", vars: { pedido: "A-1 <b>" }, origin: "Flujo «Pedido»" });
  assert.deepEqual(res, { ok: true });
  const row = s.emails[0]!;
  assert.equal(row.format, "html");
  assert.ok(row.bodyHtml.includes('<h1 style="color:#0b3a45">Hola Ana</h1>'));
  assert.ok(row.bodyHtml.includes("Tu pedido A-1 &lt;b&gt; ya salió"), "una variable del flujo tampoco mete marcado");
  assert.equal(row.bodyText, "Hola Ana\n\nTu pedido A-1 <b> ya salió. Verlo (https://clinica.pe/pedidos)");
  assert.ok(!row.bodyHtml.includes("Av. Larco") && !row.bodyText.includes("Av. Larco"), "sin la firma de texto del buzón");

  await s.service.deliver("em1", false);
  const { mail } = s.sent[0]!;
  const link = /https:\/\/api\.driony\.test\/api\/v1\/email\/unsubscribe\?t=[\w.-]+/.exec(mail.text)?.[0];
  assert.ok(link, "el texto lleva el enlace de baja");
  assert.ok(mail.html.includes(`<a href="${link}"`));
  assert.match(mail.html, /date de baja aquí<\/a>\.<\/p><\/body><\/html>$/, "el pie queda dentro del documento");
  assert.equal(mail.headers["List-Unsubscribe"], `<${link}>`);
});

test("historial: un correo HTML se lista con su texto y sin su marcado", async () => {
  const s = setup();
  await s.service.send(manual, s.luis);
  await s.service.send({ ...manual, format: "html", body: "<p>Hola <b>{{primer_nombre}}</b></p>" }, s.luis);
  const list = await s.service.history("ct1", s.luis);
  assert.deepEqual(
    list.map((e) => [e.format, e.body]),
    [
      ["text", "Hola Ana Torres:\n\nTe adjunto la cotización."],
      ["html", "Hola Ana"],
    ],
  );
  assert.ok(list.every((e) => !JSON.stringify(e).includes("<p>")));
});

test("plantillas: guardan su formato y, al editar, el cuerpo tiene que caber en él", async () => {
  const rows: Row[] = [];
  const prisma = {
    emailTemplate: {
      findFirst: async () => null,
      findUnique: async ({ where }: Row) => rows.find((r) => r.id === where.id) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: `t${rows.length + 1}`, updatedAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => Object.assign(rows.find((r) => r.id === where.id)!, data),
    },
  };
  const service = new EmailTemplatesService(prisma as any, { orgId: () => "org1" } as any);

  const created = await service.create(emailTemplateInputSchema.parse({ name: "Promo", subject: "Hola", body: "<p>Hola {{nombre}}</p>", format: "html" }));
  assert.equal(created.format, "html");
  const long = `<p>${"x".repeat(30_000)}</p>`;
  assert.equal((await service.update(created.id, { body: long })).body, long, "en HTML cabe");
  await assert.rejects(() => service.update(created.id, { format: "text" }), /pasa de 20\.000 caracteres/, "ese cuerpo no cabe como texto");
  assert.equal(rows[0]!.format, "html", "y no se guardó a medias");
  assert.equal((await service.update(created.id, { format: "text", body: "Hola {{nombre}}" })).format, "text");
  await assert.rejects(() => service.update(created.id, { format: "html", body: "<style>p{}</style>" }), /nada que mostrar/);

  // Una plantilla de antes de que existiera el formato es de texto.
  rows.push({ id: "vieja", name: "Vieja", subject: "Hola", body: "Texto", attachments: [], updatedAt: new Date() });
  assert.equal((await service.update("vieja", { subject: "Otra" })).format, "text");
});

test("redactar: la pantalla recibe el correo del contacto, sus variables y los buzones que puede usar", async () => {
  const s = setup();
  (s as any).service.accounts.usableBy = async (userId: string) => s.accounts.filter((a) => !a.userId || a.userId === userId).map((a) => ({ id: a.id }));
  const forLuis = await s.service.compose("ct1", s.luis);
  assert.equal(forLuis.to, "ana@cliente.com");
  assert.equal(forLuis.vars.primer_nombre, "Ana");
  assert.equal(forLuis.vars.agente, "Luis");
  assert.equal(forLuis.unsubscribed, false);
  assert.deepEqual(forLuis.accounts.map((a) => a.id), ["acc_shared", "acc_luis"]);
  assert.deepEqual((await s.service.compose("ct1", s.marta)).accounts.map((a) => a.id), ["acc_shared"]);
});

test("correos del sistema: la plantilla escapa lo que escribe la gente, lleva texto plano y el logo de la web", () => {
  const before = process.env.SAAS_BASE_DOMAIN;
  process.env.SAAS_BASE_DOMAIN = "driony.test";
  try {
    const url = "https://acme.driony.test/login/reset?token=abc_123";
    const reset = resetEmail("es", { name: "<b>Ana</b>", email: "ana@acme.test", orgName: 'Acme "<script>"', url });
    assert.match(reset.subject, /contraseña nueva/);
    assert.ok(!reset.html.includes("<script>") && !reset.html.includes("<b>Ana</b>"), "nombre y empresa van escapados");
    assert.ok(reset.html.includes("Acme &quot;&lt;script&gt;&quot;"));
    assert.ok(reset.html.includes(`href="${url}"`), "el botón lleva el enlace");
    assert.ok(reset.html.includes('src="https://driony.test/email/driony-logo.png"'), "el logo sale de la web");
    assert.ok(reset.html.includes('alt="Driony"'), "sin imágenes queda el nombre");
    assert.equal(/https:\/\/\S+/.exec(reset.text)![0], url, "en el texto plano, el primer enlace es el del cambio");
    assert.match(reset.text, /Vale 30 minutos/);

    const changed = changedEmail("es", { name: null, email: "ana@acme.test", orgName: "Acme", forgotUrl: "https://acme.driony.test/login/forgot" });
    assert.match(changed.subject, /Se cambió tu contraseña/);
    assert.match(changed.text, /^Acme\n\nHola:/, "sin nombre, «Hola:»");
    assert.ok(changed.html.includes('href="https://acme.driony.test/login/forgot"'), "«Recuperar mi cuenta» lleva a pedir otro enlace");
    assert.match(changedEmail("en", { name: "Ana", email: "a@b.c", orgName: "Acme", forgotUrl: "https://x" }).html, /Get my account back/);
  } finally {
    if (before === undefined) delete process.env.SAAS_BASE_DOMAIN;
    else process.env.SAAS_BASE_DOMAIN = before;
  }
});
