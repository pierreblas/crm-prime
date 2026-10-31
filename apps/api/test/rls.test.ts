/**
 * Row-Level Security: la capa 2.
 *
 * La capa 1 (extensión que inyecta el `where`) ya se prueba en tenancy.test.ts.
 * Aquí se comprueba lo que la capa 1 **no puede** cubrir: SQL crudo. Si estos
 * tests pasan, una consulta escrita a mano sin filtro de empresa devuelve los
 * datos de quien pregunta y nada más.
 *
 *   npm run test:rls --workspace=apps/api
 *
 * Requiere una base con las políticas aplicadas y el rol restringido creado
 * (scripts/create-app-role.sql). El script `pretest:rls` lo deja listo.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

const DB =
  process.env.RLS_DATABASE_URL ??
  "postgresql://crm_app:clave-de-prueba@localhost:5433/crm_rls_test";

process.env.TENANCY_MODE = "multi";
process.env.DB_RLS = "on";
process.env.DATABASE_URL = DB;

let prisma: any;
let base: any;
let ctx: typeof import("../src/infra/tenant/tenant.context");

before(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { tenantScopeExtension } = await import("../src/infra/tenant/tenant-scope");
  const { createRlsExtension, withAtomicTransactions } = await import("../src/infra/tenant/rls");
  ctx = await import("../src/infra/tenant/tenant.context");

  base = new PrismaClient({ datasources: { db: { url: DB } } });
  const ext = base.$extends(tenantScopeExtension).$extends(createRlsExtension(base));
  prisma = withAtomicTransactions(ext, base);
});

after(async () => {
  await base?.$disconnect();
});

test("el rol de la aplicación no es dueño de las tablas ni se salta RLS", async () => {
  const [rol] = await ctx.runUnscoped("test", () =>
    base.$queryRawUnsafe(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    ),
  );
  assert.equal(rol.rolsuper, false, "el rol es superusuario: RLS no protege nada");
  assert.equal(rol.rolbypassrls, false, "el rol tiene BYPASSRLS");

  const [dueño] = await ctx.runUnscoped("test", () =>
    base.$queryRawUnsafe(
      `SELECT tableowner = current_user AS es_dueño FROM pg_tables WHERE tablename = 'contacts'`,
    ),
  );
  assert.equal(dueño.es_dueño, false, "la app es dueña de las tablas: las políticas no se aplican");
});

test("SQL crudo sin filtro de empresa solo devuelve lo propio", async () => {
  await ctx.runInOrg("o_a", async () => {
    // Deliberadamente sin WHERE: esto es lo que la capa 1 NO puede acotar.
    const filas: any[] = await prisma.$queryRawUnsafe(`SELECT id, "orgId" FROM contacts`);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].orgId, "o_a");
  });
});

test("la búsqueda del RAG no alcanza los documentos de otra empresa", async () => {
  // Es la consulta real del servicio de conocimiento: un JOIN sin filtro.
  const sql = `SELECT kc.content FROM knowledge_chunks kc
               JOIN knowledge_docs kd ON kd.id = kc."docId"`;
  await ctx.runInOrg("o_a", async () => {
    const filas: any[] = await prisma.$queryRawUnsafe(sql);
    assert.deepEqual(filas.map((r) => r.content), ["secreto de Acme"]);
  });
  await ctx.runInOrg("o_b", async () => {
    const filas: any[] = await prisma.$queryRawUnsafe(sql);
    assert.deepEqual(filas.map((r) => r.content), ["secreto de Globex"]);
  });
});

test("sin organización en contexto, el SQL crudo devuelve vacío (falla cerrado)", async () => {
  const filas: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM contacts`);
  assert.equal(filas.length, 0, "debería no ver nada, no verlo todo");
});

test("no se puede escribir una fila en otra empresa", async () => {
  await ctx.runInOrg("o_a", async () => {
    await assert.rejects(
      () =>
        prisma.$executeRawUnsafe(
          `INSERT INTO contacts (id,"orgId",phone,"updatedAt") VALUES ('x1','o_b','+51911111111',now())`,
        ),
      /row-level security|violates/i,
    );
  });
});

test("las transacciones por lotes de la aplicación siguen funcionando", async () => {
  await ctx.runInOrg("o_a", async () => {
    // Es la forma que usa pipeline.service para reordenar etapas.
    const r = await prisma.$transaction([
      prisma.pipelineStage.update({ where: { id: "s1" }, data: { order: 10 } }),
      prisma.pipelineStage.update({ where: { id: "s2" }, data: { order: 11 } }),
    ]);
    assert.equal(r.length, 2);
    assert.equal(r[0].order, 10);
    assert.equal(r[1].order, 11);
  });
});

test("runUnscoped atraviesa RLS, que es para lo que existe", async () => {
  await ctx.runUnscoped("test", async () => {
    const filas: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM contacts`);
    assert.equal(filas.length, 2);
  });
});

test("un lote que falla a la mitad no deja la primera operación aplicada", async () => {
  await ctx.runInOrg("o_a", async () => {
    const antes = await prisma.pipelineStage.findUnique({ where: { id: "s1" } });
    await assert.rejects(() =>
      prisma.$transaction([
        prisma.pipelineStage.update({ where: { id: "s1" }, data: { order: 777 } }),
        prisma.pipelineStage.update({ where: { id: "no-existe" }, data: { order: 1 } }),
      ]),
    );
    const despues = await prisma.pipelineStage.findUnique({ where: { id: "s1" } });
    assert.equal(
      despues.order,
      antes.order,
      "envolver cada operación en su propia transacción rompería la atomicidad",
    );
  });
});

test("el atajo runUnscoped(() => consulta) aplica de verdad la escapatoria", async () => {
  // Las promesas de Prisma son perezosas: si `runUnscoped` no espera dentro del
  // contexto, la consulta se ejecuta ya fuera y la escapatoria no aplica. Con
  // RLS activo eso dejaría a todo el mundo sin poder iniciar sesión, porque el
  // login busca al usuario por correo antes de saber de qué empresa es.
  const filas: any[] = await ctx.runUnscoped("test", () =>
    prisma.$queryRawUnsafe(`SELECT id FROM contacts`),
  );
  assert.equal(filas.length, 2, "la escapatoria no se aplicó a la consulta");
});

test("el atajo runInOrg(() => consulta) acota de verdad", async () => {
  const filas: any[] = await ctx.runInOrg("o_b", () =>
    prisma.$queryRawUnsafe(`SELECT id, "orgId" FROM contacts`),
  );
  assert.equal(filas.length, 1);
  assert.equal(filas[0].orgId, "o_b");
});

test("el alta de una empresa funciona con el rol restringido", async () => {
  // El alta llega por el dominio raíz, sin empresa en contexto. Si la
  // transacción no fija app.current_org, el rol restringido de producción
  // rechaza la primera fila con dueño. En desarrollo no se nota porque el
  // usuario de la base es dueño de las tablas y se salta las políticas.
  process.env.JWT_ACCESS_SECRET ??= "secreto-de-prueba";
  const { JwtService } = await import("@nestjs/jwt");
  const { OrganizationService } = await import(
    "../src/modules/organizations/organization.service"
  );
  const svc = new OrganizationService(
    prisma,
    new JwtService({ secret: process.env.JWT_ACCESS_SECRET }),
  );

  const slug = `alta-${Date.now()}`;
  const r = await svc.register(
    {
      companyName: "Alta de prueba",
      slug,
      adminName: "Ana",
      adminEmail: `ana@${slug}.test`,
      password: "clave-larga-123",
    },
    "127.0.0.1",
  );
  assert.equal(r.slug, slug);

  // Todo lo creado lleva el mismo dueño y se ve desde esa empresa…
  const [cuenta] = await ctx.runInOrg(r.orgId, () =>
    prisma.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM users) AS usuarios,
              (SELECT count(*) FROM pipeline_stages) AS etapas,
              (SELECT count(*) FROM agent_configs) AS agentes`,
    ),
  );
  assert.equal(Number(cuenta.usuarios), 1);
  assert.equal(Number(cuenta.etapas), 6);
  assert.equal(Number(cuenta.agentes), 1);

  // En la nube el alta empieza con la prueba de Pro de 15 días.
  const [org]: any[] = await ctx.runUnscoped("prueba: leer la empresa nueva", () =>
    prisma.$queryRawUnsafe(`SELECT plan, "trialEndsAt" FROM organizations WHERE id = '${r.orgId}'`),
  );
  assert.equal(org.plan, "free");
  const dias = (new Date(org.trialEndsAt).getTime() - Date.now()) / 86_400_000;
  assert.ok(dias > 14.9 && dias <= 15, `la prueba dura 15 días (quedan ${dias.toFixed(2)})`);

  // …y desde otra empresa no se ve nada de ello.
  const ajenos: any[] = await ctx.runInOrg("o_a", () =>
    prisma.$queryRawUnsafe(`SELECT id FROM users WHERE "orgId" = '${r.orgId}'`),
  );
  assert.equal(ajenos.length, 0);
});

test("la consola de plataforma agrega todas las empresas con el rol restringido", async () => {
  // Es el único sitio que lee todas las empresas a la vez: va con runUnscoped
  // y en SQL. Se comprueba contra el esquema real, que es donde se rompería.
  const { PlatformService } = await import("../src/modules/platform/platform.service");
  // Sin Redis en la prueba: las colas fallan y la salud lo cuenta como "sin Redis".
  const colaRota = { getJobCounts: async () => { throw new Error("sin redis"); } } as any;
  const svc = new PlatformService(prisma, {} as any, colaRota, colaRota, colaRota, colaRota, colaRota, colaRota, colaRota);

  const overview = await svc.overview();
  assert.ok(overview.orgs >= 2, "hay al menos las dos empresas sembradas");
  assert.equal(typeof overview.trialing, "number");
  assert.ok(Array.isArray(overview.signupsByDay));
  assert.ok(overview.byPlan.some((p) => p.plan === "free"));

  const orgs = await svc.orgs("");
  const a = orgs.find((o) => o.id === "o_a");
  assert.ok(a, "la empresa o_a aparece en el listado");
  assert.equal(a.contacts, 1, "los agregados se calculan por empresa");
  assert.ok((await svc.orgs(a.slug)).some((o) => o.id === "o_a"), "la búsqueda por subdominio funciona");
  assert.equal((await svc.orgs("zzz-no-existe")).length, 0);

  // Cambiar de plan y suspender pasan por la misma tabla sin RLS, y quedan en el diario.
  const cambiada = await svc.update("o_b", { plan: "pro" }, "ops@prueba.test");
  assert.equal(cambiada.plan, "pro");
  const conNotas = await svc.update("o_b", { planExpiresAt: "2030-01-31T23:59:59.000Z", platformNotes: "Pagó por transferencia" }, "ops@prueba.test");
  assert.equal(conNotas.platformNotes, "Pagó por transferencia");
  assert.ok(conNotas.planExpiresAt?.startsWith("2030-01-31"));
  await svc.update("o_b", { plan: "free", planExpiresAt: null, platformNotes: null }, "ops@prueba.test");
  const diario = await svc.auditList(20);
  assert.ok(diario.some((e) => e.action === "plan_changed" && e.orgId === "o_b" && e.actorEmail === "ops@prueba.test"), "el cambio de plan queda en el diario");
  assert.ok(diario.some((e) => e.action === "expiry_changed" && e.orgId === "o_b"), "el vencimiento queda en el diario");

  // La ficha lee equipo, números, IA y actividad de UNA empresa con el rol restringido.
  const ficha = await svc.detail("o_a");
  assert.equal(ficha.org.id, "o_a");
  assert.ok(Array.isArray(ficha.users) && Array.isArray(ficha.numbers) && Array.isArray(ficha.activity));
  assert.ok(ficha.audit.every((e) => e.orgId === "o_a"), "el historial de la ficha es solo de esa empresa");

  // Salud: las consultas SQL funcionan y las colas sin Redis se señalan, no rompen.
  const salud = await svc.health();
  assert.equal(salud.queues.length, 7);
  assert.ok(salud.queues.every((q) => q.ok === false));
  assert.ok(Array.isArray(salud.numbersWithError) && Array.isArray(salud.failedByOrg) && Array.isArray(salud.webhooksFailing));
});

test("la IA incluida se cuenta con el rol restringido, por empresa y en la consola", async () => {
  // Cupo de la IA de Driony: SQL crudo sobre ai_usage desde tres sitios (el
  // cupo, Ajustes › Plan y la consola). Con RLS, cada uno ve lo que debe.
  const { AiUsageService } = await import("../src/modules/ai/ai-usage.service");
  const { PlansService } = await import("../src/modules/plans/plans.service");
  const { PlatformService } = await import("../src/modules/platform/platform.service");
  const fila = (orgId: string, conversationId: string, source: string, feature = "agent") => ({
    orgId, feature, model: "gpt-5-mini", inputTokens: 10_000, outputTokens: 1_000, conversationId, source,
  });
  await ctx.runInOrg("o_a", () =>
    prisma.aiUsage.createMany({
      data: [fila("o_a", "cv_a1", "platform"), fila("o_a", "cv_a1", "platform"), fila("o_a", "cv_a2", "platform", "copilot"), fila("o_a", "cv_a3", "own")],
    }),
  );
  await ctx.runInOrg("o_b", () => prisma.aiUsage.create({ data: fila("o_b", "cv_b1", "platform") }));

  const usage = new AiUsageService(prisma, { orgId: () => "o_a" } as any);
  const inc = await ctx.runInOrg("o_a", () => usage.includedUsage("o_a"));
  assert.equal(inc.conversations, 1, "solo cuentan las del agente con la IA de Driony, y solo las suyas");
  assert.ok(inc.costUsd > 0);
  assert.equal(await ctx.runInOrg("o_a", () => usage.countedThisMonth("o_a", "cv_a1")), true);
  assert.equal(await ctx.runInOrg("o_a", () => usage.countedThisMonth("o_a", "cv_b1")), false, "la conversación de otra empresa no cuenta");

  const plans = new PlansService(prisma, { orgId: () => "o_a" } as any);
  assert.equal((await ctx.runInOrg("o_a", () => plans.usage())).aiConversations, 1);

  const colaRota = { getJobCounts: async () => { throw new Error("sin redis"); } } as any;
  const svc = new PlatformService(prisma, {} as any, colaRota, colaRota, colaRota, colaRota, colaRota, colaRota, colaRota);
  const a = (await svc.orgs("")).find((o) => o.id === "o_a")!;
  assert.equal(a.aiIncludedConversations, 1);
  assert.ok(a.aiPlatformCostMonthUsd > 0 && a.aiCostMonthUsd > a.aiPlatformCostMonthUsd, "separa lo de Driony de lo suyo");
  const overview = await svc.overview();
  assert.equal(overview.aiIncluded.conversations, 2, "suma las de todas las empresas");
  assert.equal(overview.aiIncluded.orgsUsing, 2);
  const ficha = await svc.detail("o_a");
  assert.ok(ficha.ai.some((r) => r.source === "platform") && ficha.ai.some((r) => r.source === "own"));
});

test("el panel funciona con el rol restringido y solo cuenta lo de su empresa", async () => {
  // Son consultas SQL crudas: la capa de Prisma no las filtra, así que se
  // comprueba aquí que llevan el filtro de empresa y que RLS no las rompe.
  const { DashboardService } = await import("../src/modules/dashboard/dashboard.service");
  const svc = new DashboardService(prisma, { orgId: () => "o_a" } as any);
  const r = await ctx.runInOrg("o_a", () => svc.get("30d", "America/Lima"));
  assert.equal(r.tz, "America/Lima");
  assert.equal(r.daily.length >= 30, true);
  assert.equal(r.heatmap.length, 7);
  assert.equal(r.funnel.pipelines.every((p: { id: string }) => p.id === "pl_a"), true, "solo embudos propios");
});

test("las difusiones (sin orgId) solo las ve la empresa de su plantilla", async () => {
  await ctx.runUnscoped("test", async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM campaigns WHERE id IN ('camp_a','camp_b')`);
    await prisma.$executeRawUnsafe(`DELETE FROM templates WHERE id IN ('tpl_a','tpl_b')`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO templates (id,"orgId",name,body,"updatedAt") VALUES ('tpl_a','o_a','promo','hola',now()),('tpl_b','o_b','promo','hola',now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO campaigns (id,name,"templateId","updatedAt") VALUES ('camp_a','A','tpl_a',now()),('camp_b','B','tpl_b',now())`,
    );
  });
  await ctx.runInOrg("o_a", async () => {
    const filas: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM campaigns WHERE id IN ('camp_a','camp_b')`);
    assert.deepEqual(filas.map((r) => r.id), ["camp_a"]);
    // Por id, como hace el servicio: la de otra empresa no aparece.
    assert.equal(await prisma.campaign.findFirst({ where: { id: "camp_b" } }), null);
  });
  await ctx.runUnscoped("test", async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM campaigns WHERE id IN ('camp_a','camp_b')`);
    await prisma.$executeRawUnsafe(`DELETE FROM templates WHERE id IN ('tpl_a','tpl_b')`);
  });
});

test("el asistente de bienvenida construye la IA con el rol restringido, solo en su empresa", async () => {
  // Escribe en cinco tablas (estado, etapas, respuestas rápidas, conocimiento
  // con su vector y el agente) y una de ellas por lotes: con RLS, todo debe
  // caer en la empresa que construye y nada debe verse desde otra.
  process.env.JWT_ACCESS_SECRET ??= "secreto-de-prueba";
  const { JwtService } = await import("@nestjs/jwt");
  const { OrganizationService } = await import("../src/modules/organizations/organization.service");
  const { BusinessSetupService } = await import("../src/modules/ai/business-setup.service");
  const { BotService } = await import("../src/modules/ai/bot.service");
  const { AgentActionsService } = await import("../src/modules/ai/agent-actions.service");
  const { KnowledgeService } = await import("../src/modules/knowledge/knowledge.service");
  const { FakeEmbeddingProvider } = await import("../src/modules/knowledge/embeddings/fake-embedding.provider");
  const { businessSetupSchema } = await import("@crm/shared");

  const slug = `bienvenida-${Date.now()}`;
  const alta = await new OrganizationService(prisma, new JwtService({ secret: process.env.JWT_ACCESS_SECRET })).register(
    { companyName: "Cevichería de prueba", slug, adminName: "Ana", adminEmail: `ana@${slug}.test`, password: "clave-larga-123" },
    "127.0.0.2",
  );
  const tenant = { orgId: () => alta.orgId } as any;
  const { BookingsService } = await import("../src/modules/bookings/bookings.service");
  const actions = new AgentActionsService(prisma, tenant, {} as any, { emit: () => true } as any, new BookingsService(prisma, tenant, { emit: () => true } as any));
  const svc = new BusinessSetupService(
    prisma,
    tenant,
    new BotService(prisma, tenant, actions),
    {} as any, // sin IA: no se llama al redactor
    new KnowledgeService(prisma, tenant, new FakeEmbeddingProvider()),
    actions,
    { status: async () => ({ ready: false }) } as any,
  );
  const perfil = businessSetupSchema.parse({
    businessType: "restaurante",
    description: "Cevichería familiar con delivery",
    agentName: "Carla",
    goal: "vender",
    tone: "cercano",
    answers: { carta: "Ceviche 35", delivery: "Zona sur por 7" },
    hours: { days: "ls", from: "09:00", to: "19:00" },
  });

  await ctx.runInOrg(alta.orgId, async () => {
    const p = await svc.saveProfile(perfil);
    assert.equal(p.stages?.[1], "Viendo la carta", "el embudo toma las etapas del rubro");
    assert.equal(p.quickReplies, 3);
    const k = await svc.buildKnowledge();
    assert.equal(k.facts, 4);
    const a = await svc.buildAgent();
    assert.equal(a.writtenBy, "template");
    assert.equal(a.botName, "Carla");
    assert.equal(a.hours, true);
    // Repetirlo no duplica: el documento se reemplaza y las respuestas rápidas no se pisan.
    assert.equal((await svc.saveProfile(perfil)).quickReplies, 0);
    await svc.buildKnowledge();
    const estado = await svc.state();
    assert.ok(estado.completedAt);
    assert.equal(estado.profile?.businessType, "restaurante");
  });

  const [cuenta] = await ctx.runInOrg(alta.orgId, () =>
    prisma.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM knowledge_docs) AS docs,
              (SELECT count(*) FROM knowledge_chunks) AS trozos,
              (SELECT count(*) FROM quick_replies) AS rapidas,
              (SELECT name FROM agent_configs WHERE "isDefault") AS agente`,
    ),
  );
  assert.equal(Number(cuenta.docs), 1, "un solo documento aunque se repita");
  assert.ok(Number(cuenta.trozos) >= 1);
  assert.equal(Number(cuenta.rapidas), 3);
  assert.equal(cuenta.agente, "Carla");

  const ajenos: any[] = await ctx.runInOrg("o_a", () =>
    prisma.$queryRawUnsafe(`SELECT id FROM quick_replies WHERE "orgId" = '${alta.orgId}' UNION ALL SELECT id FROM knowledge_docs WHERE "orgId" = '${alta.orgId}'`),
  );
  assert.equal(ajenos.length, 0, "desde otra empresa no se ve nada");
});

test("lo que llega de un anuncio queda en el mensaje y en el chat abierto, y el lead de México se une a su WhatsApp", async () => {
  const { MessagingService } = await import("../src/modules/messaging/messaging.service");
  // Empresa propia: el resto de pruebas cuentan las filas de las sembradas.
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_ads_${suf}`;
  await ctx.runUnscoped("prueba: empresa de anuncios", () =>
    prisma.organization.create({ data: { id: orgId, slug: `ads-${suf}`, name: "Anuncios" } }),
  );
  const emitted: string[] = [];
  const svc = new MessagingService(
    prisma,
    { orgId: () => orgId } as any,
    {} as any, // cola de salida: no se envía nada
    {} as any, // proveedor de WhatsApp
    { resolveChannel: async () => null } as any,
    {} as any, // almacenamiento
    { emit: (name: string) => emitted.push(name) } as any,
    { emit: async () => undefined } as any,
    {} as any,
    { intakeFromWhatsapp: async () => undefined } as any,
    {} as any,
  );
  const anuncio = (id: string, headline: string) => ({
    source_url: `https://fb.me/${id}`,
    source_id: id,
    source_type: "ad",
    headline,
    body: "Envío gratis esta semana",
    ctwa_clid: `clid-${id}`,
  });

  await ctx.runInOrg(orgId, async () => {
    // 1 · Primer mensaje tras el clic: el anuncio en el mensaje, el chat y el contacto.
    const phone = `+51990${suf}`;
    await svc.handleInbound({ from: phone, waMessageId: `wamid.ad1.${suf}`, type: "TEXT" as any, text: "Hola, ¿precio?", referral: anuncio("111", "Zapatillas") });
    const c1 = await prisma.contact.findUnique({ where: { orgId_phone: { orgId, phone } } });
    assert.equal(c1.origin, "ad");
    const conv = await prisma.conversation.findFirst({ where: { contactId: c1.id } });
    assert.equal(conv.referral.sourceId, "111");
    assert.equal(conv.referral.ctwaClid, "clid-111", "se guarda en camelCase");
    const m1 = await prisma.message.findFirst({ where: { waMessageId: `wamid.ad1.${suf}` } });
    assert.equal(m1.referral.headline, "Zapatillas");

    // 2 · Con el chat abierto vuelve por OTRO anuncio: cuenta el último clic.
    await svc.handleInbound({ from: phone, waMessageId: `wamid.ad2.${suf}`, type: "TEXT" as any, text: "Y estas?", referral: anuncio("222", "Mochilas") });
    const convs = await prisma.conversation.findMany({ where: { contactId: c1.id } });
    assert.equal(convs.length, 1, "sigue siendo el mismo chat");
    assert.equal(convs[0].referral.sourceId, "222");
    const m2 = await prisma.message.findFirst({ where: { waMessageId: `wamid.ad2.${suf}` } });
    assert.equal(m2.referral.ctwaClid, "clid-222");
    // Un mensaje normal después no borra el anuncio del chat.
    await svc.handleInbound({ from: phone, waMessageId: `wamid.ad3.${suf}`, type: "TEXT" as any, text: "gracias" });
    const after = await prisma.conversation.findUnique({ where: { id: convs[0].id } });
    assert.equal(after.referral.sourceId, "222");

    // 3 · El lead del formulario llegó como +52 55…; WhatsApp escribe como +521 55…
    const mx = `+5255${suf}000`.slice(0, 13);
    const lead = await prisma.contact.create({ data: { orgId, phone: mx, name: "Lead MX", origin: "webhook" } });
    const wa = `+521${mx.slice(3)}`;
    await svc.handleInbound({ from: wa, waMessageId: `wamid.mx.${suf}`, type: "TEXT" as any, text: "Hola, llené el formulario" });
    const merged = await prisma.contact.findUnique({ where: { id: lead.id } });
    assert.equal(merged.phone, wa, "el contacto del lead pasa a tener el número de WhatsApp");
    assert.equal(await prisma.contact.count({ where: { phone: { in: [mx, wa] } } }), 1, "no se duplica");
  }).finally(() =>
    // Lo creado aquí se borra: las pruebas de arriba cuentan todas las filas.
    ctx.runUnscoped("prueba: limpiar la empresa de anuncios", async () => {
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.source.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
  assert.ok(emitted.includes("conversation.created"));
});

test("la agenda reserva con el rol restringido, la base impide dos citas a la vez y otra empresa no las ve", async () => {
  const { BookingsService } = await import("../src/modules/bookings/bookings.service");
  const { addDays, utcToZoned, zonedToUtc } = await import("@crm/shared");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_bk_${suf}`;
  await ctx.runUnscoped("prueba: empresa de la agenda", () =>
    prisma.organization.create({ data: { id: orgId, slug: `bk-${suf}`, name: "Agenda" } }),
  );
  const emitted: string[] = [];
  const svc = new BookingsService(prisma, { orgId: () => orgId } as any, { emit: (name: string) => emitted.push(name) } as any);
  const LIMA = "America/Lima";
  const tomorrow = addDays(utcToZoned(new Date(), LIMA).date, 1);
  const allDay = { from: "08:00", to: "20:00" };
  const everyDay = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [allDay]]));

  await ctx.runInOrg(orgId, async () => {
    const ana = await prisma.user.create({ data: { orgId, email: `ana-${suf}@prueba.test`, passwordHash: "x", name: "Ana" } });
    const pipeline = await prisma.pipeline.create({ data: { orgId, name: "Ventas", isDefault: true } });
    await prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: "Entrantes", order: 0 } });
    const booked = await prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: "Cita reservada", order: 1 } });
    const contact = await prisma.contact.create({ data: { orgId, phone: `+51991${suf}`, name: "Cliente Agenda" } });

    await svc.updateSettings({ timezone: LIMA, minNoticeMin: 0, slotIntervalMin: 30, bookedStageId: booked.id });
    await svc.saveSchedule(ana.id, { hours: everyDay as any, blackouts: [], acceptsBookings: true });
    const service = await svc.createService({ name: "Corte", durationMin: 45, bufferAfterMin: 15, staffIds: [ana.id], isActive: true });

    // 1 · Horas libres de mañana: cada 30 minutos desde las 08:00.
    const slots = await svc.slots({ serviceId: service.id, from: tomorrow, days: 1 });
    assert.equal(slots[0].time, "08:00");
    assert.equal(slots[1].time, "08:30");
    assert.equal(slots[0].staff.name, "Ana");

    // 2 · Reservar: la oportunidad se crea en «Cita reservada» y queda en su historial.
    const at10 = zonedToUtc(tomorrow, "10:00", LIMA).toISOString();
    const first = await svc.create({ contactId: contact.id, serviceId: service.id, startAt: at10 }, "manual", ana.id);
    assert.equal(first.staff?.name, "Ana");
    const deal = await prisma.deal.findUnique({ where: { id: first.dealId } });
    assert.equal(deal.stageId, booked.id);
    const ev = await prisma.dealEvent.findFirst({ where: { dealId: deal.id, kind: "booking" } });
    assert.equal(ev.meta.action, "created");

    // 3 · La misma hora otra vez: la aplicación la rechaza (10:00–10:45 + 15 de margen).
    await assert.rejects(svc.create({ contactId: contact.id, serviceId: service.id, startAt: zonedToUtc(tomorrow, "10:30", LIMA).toISOString() }, "manual", ana.id), /libre/);
    const after = await svc.slots({ serviceId: service.id, from: tomorrow, days: 1 });
    assert.ok(!after.some((x) => x.time === "10:00" || x.time === "10:30"), "las que pisan la cita y su margen desaparecen");
    assert.ok(after.some((x) => x.time === "11:00"));

    // 4 · Y si dos peticiones validan a la vez, la base decide: la restricción de exclusión.
    await assert.rejects(
      prisma.booking.create({
        data: {
          orgId, serviceId: service.id, serviceName: "Corte", userId: ana.id, contactId: contact.id,
          startAt: new Date(at10), endAt: new Date(Date.parse(at10) + 45 * 60_000), blockEndAt: new Date(Date.parse(at10) + 60 * 60_000),
        },
      }),
      /bookings_no_overlap|23P01|exclusion/,
    );

    // 5 · El equipo puede apuntar a las 13:15 (no es una franja de 30) pero no fuera del horario.
    const odd = await svc.create({ contactId: contact.id, serviceId: service.id, startAt: zonedToUtc(tomorrow, "13:15", LIMA).toISOString() }, "manual", ana.id);
    await assert.rejects(svc.create({ contactId: contact.id, serviceId: service.id, startAt: zonedToUtc(tomorrow, "19:45", LIMA).toISOString() }, "manual", ana.id), /libre/);

    // 6 · Mover y cancelar: la hora vuelve a quedar libre.
    const moved = await svc.update(odd.id, { startAt: zonedToUtc(tomorrow, "15:00", LIMA).toISOString() });
    assert.equal(utcToZoned(new Date(moved.startAt), LIMA).time, "15:00");
    await svc.cancel(first.id, "Se enfermó");
    const again = await svc.slots({ serviceId: service.id, from: tomorrow, days: 1 });
    assert.ok(again.some((x) => x.time === "10:00"), "cancelada, las 10:00 vuelven a estar libres");

    // 7 · El agente: consulta horas, reserva con hora del negocio y no duplica.
    const avail = JSON.parse(await svc.agentAvailability({ service: "corte", date: tomorrow }));
    assert.equal(avail.days[0].date, tomorrow);
    assert.ok(avail.days[0].times.includes("10:00"));
    // Ya tiene «Corte» a las 15:00: no reserva otra, la mueve.
    await assert.rejects(svc.agentBook(contact.id, null, { service: "Corte", start: `${tomorrow}T10:00` }), /reschedule_appointment/);
    assert.match(await svc.agentReschedule(contact.id, { start: `${tomorrow}T10:00` }), /Cita movida: Corte, ahora el .*10:00 con Ana/);
    assert.match(await svc.agentContextText(contact.id), /Corte: .*10:00 con Ana/);
    assert.match(await svc.agentCancel(contact.id, { reason: "No puede" }), /Cita cancelada: Corte/);
    const text = await svc.agentBook(contact.id, null, { service: "Corte", start: `${tomorrow}T16:00` });
    assert.match(text, /Cita reservada: Corte, .*16:00 con Ana/);
    await assert.rejects(svc.agentBook(contact.id, null, { service: "Corte", start: "mañana a las 5" }), /AAAA-MM-DDTHH:mm/);

    // 8 · Otra empresa no ve ninguna, ni con SQL crudo.
    await ctx.runInOrg("o_a", async () => {
      const rows: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM bookings`);
      assert.equal(rows.length, 0);
      assert.equal((await svc.listServices()).length, 0);
    });
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar la empresa de la agenda", async () => {
      await prisma.booking.deleteMany({ where: { orgId } });
      await prisma.dealEvent.deleteMany({ where: { orgId } });
      await prisma.deal.deleteMany({ where: { orgId } });
      await prisma.bookingServiceStaff.deleteMany({ where: { orgId } });
      await prisma.bookingService.deleteMany({ where: { orgId } });
      await prisma.staffSchedule.deleteMany({ where: { orgId } });
      await prisma.bookingSettings.deleteMany({ where: { orgId } });
      await prisma.pipelineStage.deleteMany({ where: { orgId } });
      await prisma.pipeline.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
  assert.ok(emitted.includes("booking.created") && emitted.includes("booking.cancelled") && emitted.includes("booking.rescheduled"));
});
