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

  // Lo armado en el simulador de la landing viaja con el alta y queda como
  // perfil del asistente de bienvenida, completo con valores por defecto.
  const slugSim = `alta-sim-${Date.now()}`;
  const conAgente = await svc.register(
    {
      companyName: "Alta con agente",
      slug: slugSim,
      adminName: "Ana",
      adminEmail: `ana@${slugSim}.test`,
      password: "clave-larga-123",
      setup: { businessType: "tienda", goal: "vender", tone: "juvenil" },
    },
    "127.0.0.1",
  );
  const { businessSetupSchema: perfilSchema } = await import("@crm/shared");
  const estado = await ctx.runInOrg(conAgente.orgId, () => prisma.onboardingState.findUnique({ where: { orgId: conAgente.orgId } }));
  const perfil = perfilSchema.safeParse(estado?.business);
  assert.equal(perfil.success, true, "el borrador se guarda como perfil completo");
  assert.equal(perfil.success ? perfil.data.businessType : null, "tienda");
  assert.equal(perfil.success ? perfil.data.tone : null, "juvenil");
  assert.equal(perfil.success ? perfil.data.agentName : null, "Asistente", "sin nombre, uno por defecto");
  assert.equal(estado?.setupCompletedAt, null, "la IA aún no se construyó: el asistente arranca rellenado");

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
  assert.equal(salud.queues.length, 10); // 7 colas + «Mensajes de Meta» + «Mensajes de TikTok» + «Catálogos conectados»
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
  assert.equal(inc.tokens, 33_000, "todo lo que corrió con la IA de Driony, también el copiloto, y solo lo suyo");
  assert.equal(inc.conversations, 1, "las conversaciones que atendió el agente, para decirlo en palabras");
  assert.ok(inc.costUsd > 0);
  assert.equal(await ctx.runInOrg("o_a", () => usage.countedThisMonth("o_a", "cv_a1")), true);
  assert.equal(await ctx.runInOrg("o_a", () => usage.countedThisMonth("o_a", "cv_b1")), false, "la conversación de otra empresa no cuenta");

  const plans = new PlansService(prisma, { orgId: () => "o_a" } as any, { active: async () => [] } as any);
  const usoPlan = await ctx.runInOrg("o_a", () => plans.usage());
  assert.equal(usoPlan.aiTokens, 33_000);
  assert.equal(usoPlan.aiOwnTokens, 11_000, "lo gastado con la clave propia se enseña aparte, sin cupo");

  const colaRota = { getJobCounts: async () => { throw new Error("sin redis"); } } as any;
  const svc = new PlatformService(prisma, {} as any, colaRota, colaRota, colaRota, colaRota, colaRota, colaRota, colaRota);
  const a = (await svc.orgs("")).find((o) => o.id === "o_a")!;
  assert.equal(a.aiIncludedTokens, 33_000);
  assert.ok(a.aiPlatformCostMonthUsd > 0 && a.aiCostMonthUsd > a.aiPlatformCostMonthUsd, "separa lo de Driony de lo suyo");
  const overview = await svc.overview();
  assert.equal(overview.aiIncluded.tokens, 44_000, "suma los tokens de todas las empresas");
  assert.equal(overview.aiIncluded.conversations, 2, "y las conversaciones atendidas");
  assert.equal(overview.aiIncluded.orgsUsing, 2);
  const ficha = await svc.detail("o_a");
  assert.ok(ficha.ai.some((r) => r.source === "platform") && ficha.ai.some((r) => r.source === "own"));
});

test("los ajustes de IA, su historial y el consumo quedan en su empresa con el rol restringido", async () => {
  // Las claves cifradas, el historial de quién las tocó y el consumo son lo más
  // sensible de una empresa: SQL crudo desde A no debe ver ni tocar lo de B.
  process.env.APP_ENCRYPTION_KEY ??= "clave-de-prueba-para-cifrar-secretos";
  const { AiSettingsService } = await import("../src/modules/ai/ai-settings.service");
  const { encryptSecret } = await import("../src/common/utils/secret-box");

  await ctx.runInOrg("o_a", () =>
    prisma.aiSetting.upsert({
      where: { orgId: "o_a" },
      create: { orgId: "o_a", openaiKeyEnc: encryptSecret("sk-de-acme-1111"), billingMode: "BYOK", credentialStatus: "untested" },
      update: {},
    }),
  );
  await ctx.runInOrg("o_b", () =>
    prisma.aiSetting.upsert({
      where: { orgId: "o_b" },
      create: { orgId: "o_b", anthropicKeyEnc: encryptSecret("sk-ant-globex-2222"), billingMode: "BYOK", credentialStatus: "untested" },
      update: {},
    }),
  );
  await ctx.runInOrg("o_b", () =>
    prisma.aiSettingEvent.create({ data: { orgId: "o_b", action: "key_set", provider: "anthropic", details: { masked: "sk-…2222" } } }),
  );

  await ctx.runInOrg("o_a", async () => {
    // Deliberadamente sin WHERE.
    const ajustes: any[] = await prisma.$queryRawUnsafe(`SELECT "orgId" FROM ai_settings`);
    assert.deepEqual(ajustes.map((r) => r.orgId), ["o_a"], "RLS: los ajustes (y las claves cifradas) de otra empresa no se ven");
    const eventos: any[] = await prisma.$queryRawUnsafe(`SELECT "orgId" FROM ai_setting_events`);
    assert.equal(eventos.length, 0, "el historial de B no se ve desde A");
    const consumo: any[] = await prisma.$queryRawUnsafe(`SELECT DISTINCT "orgId" FROM ai_usage`);
    assert.deepEqual(consumo.map((r) => r.orgId), ["o_a"]);
    const paquetes: any[] = await prisma.$queryRawUnsafe(`SELECT DISTINCT "orgId" FROM ai_packs`);
    assert.ok(paquetes.every((r) => r.orgId === "o_a"));

    // Escribir en la otra empresa: el UPDATE no alcanza su fila y el INSERT se rechaza.
    const tocadas = await prisma.$executeRawUnsafe(`UPDATE ai_settings SET "anthropicKeyEnc" = 'robada' WHERE "orgId" = 'o_b'`);
    assert.equal(tocadas, 0);
    await assert.rejects(
      prisma.$executeRawUnsafe(`INSERT INTO ai_setting_events (id, "orgId", action) VALUES ('ev_x', 'o_b', 'key_set')`),
      "RLS: no se puede escribir historial en otra empresa",
    );
  });
  const deB = await ctx.runInOrg("o_b", () => prisma.aiSetting.findUnique({ where: { orgId: "o_b" }, select: { anthropicKeyEnc: true } }));
  assert.notEqual(deB?.anthropicKeyEnc, "robada");

  // El servicio real con el rol restringido: A guarda una clave y el evento cae en A, nunca en B.
  const usage = { includedUsage: async () => ({ tokens: 0, conversations: 0, costUsd: 0 }), countedThisMonth: async () => false, ownTokensThisMonth: async () => 0 };
  const packs = { extra: async () => ({ remaining: 0, usedThisMonth: 0, nextExpiresAt: null }), settle: async () => 0 };
  const svc = new AiSettingsService(prisma, { orgId: () => "o_a" } as any, usage as any, packs as any);
  const dto = await ctx.runInOrg("o_a", () => svc.updateSettings({ anthropicKey: "sk-ant-de-acme-3333" }, "u_acme"));
  assert.equal(dto.billingMode, "BYOK");
  assert.equal(dto.credentialStatus, "untested");
  assert.equal(dto.anthropicKey.masked?.endsWith("3333"), true);
  const historial = await ctx.runInOrg("o_a", () => svc.events());
  assert.ok(historial.some((e) => e.action === "key_set" && e.provider === "anthropic"), "el alta queda en el historial de A");
  assert.ok(!JSON.stringify(historial).includes("sk-ant-de-acme-3333"), "la clave nunca va al historial");
  assert.equal(await ctx.runInOrg("o_b", () => prisma.aiSettingEvent.count()), 1, "B sigue con su único evento");
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

test("un flujo con varios disparadores arranca por cualquiera, respeta sus filtros y avisa en el chat si se detiene", async () => {
  const { FlowEngineService } = await import("../src/modules/ai/flow-engine.service");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_fl_${suf}`;
  await ctx.runUnscoped("prueba: empresa de flujos", () =>
    prisma.organization.create({ data: { id: orgId, slug: `fl-${suf}`, name: "Flujos" } }),
  );
  const sent: string[] = [];
  const notes: string[] = [];
  const queued: { name: string; data: any; opts: any }[] = [];
  const messaging = {
    queueOutbound: async (input: { text?: string }) => {
      if (input.text === "boom") throw new Error("La ventana de 24 h está cerrada");
      sent.push(input.text ?? "");
    },
    addNote: async (_c: string, _a: string, body: string) => void notes.push(body),
  };
  const engine = new FlowEngineService(
    prisma,
    { orgId: () => orgId } as any,
    messaging as any,
    {} as any,
    { add: async (name: string, data: any, opts: any) => void queued.push({ name, data, opts }) } as any,
    { emit: () => true } as any,
  );
  const graph = (text: string) => ({
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "n1", type: "sendMessage", position: { x: 0, y: 100 }, data: { text } },
    ],
    edges: [{ id: "e1", source: "start", target: "n1" }],
  });

  await ctx.runInOrg(orgId, async () => {
    await prisma.user.create({ data: { orgId, email: `admin-${suf}@prueba.test`, passwordHash: "x", name: "Admin", role: "ADMIN" } });
    const contact = await prisma.contact.create({ data: { orgId, phone: `+51992${suf}`, name: "Cliente Flujo" } });
    const conv = await prisma.conversation.create({ data: { orgId, contactId: contact.id, status: "OPEN" } });
    const inbound = (content: string) =>
      prisma.message.create({ data: { orgId, conversationId: conv.id, direction: "INBOUND", type: "TEXT", author: "CONTACT", content } });
    const triggers = [
      { id: "t1", type: "keyword", keywords: ["promo"], config: {} },
      { id: "t2", type: "tag_added", keywords: [], config: { tags: ["VIP"] } },
      { id: "t3", type: "no_reply", keywords: [], config: { hours: 2 } },
    ];
    const flow = await prisma.flow.create({
      data: { orgId, name: "Promo", isActive: true, triggerKeywords: [], triggers, ...graph("Hola, te cuento la promo") },
    });
    // Sin disparadores: solo desde el embudo; nunca arranca solo.
    await prisma.flow.create({
      data: { orgId, name: "Manual", isActive: true, triggerKeywords: [], triggers: [], ...graph("no debería salir") },
    });
    await prisma.flow.create({
      data: { orgId, name: "Roto", isActive: true, triggerKeywords: [], triggers: [{ id: "x", type: "keyword", keywords: ["falla"], config: {} }], ...graph("boom") },
    });

    // 1 · Por palabra clave.
    await inbound("quiero la PROMO de hoy");
    assert.equal(await engine.onInbound(conv.id), true);
    assert.deepEqual(sent, ["Hola, te cuento la promo"]);

    // 2 · Por etiqueta: solo con la del filtro (sin importar mayúsculas).
    await engine.onTagAdded(contact.id, "otra");
    assert.equal(sent.length, 1, "otra etiqueta no lo dispara");
    await engine.onTagAdded(contact.id, "vip");
    assert.equal(sent.length, 2);

    // 3 · Sin respuesta: se programa con sus horas y recuerda el flujo.
    await engine.onOutbound(conv.id, "m_out_1", "HUMAN");
    assert.equal(queued[0]?.name, "no_reply");
    assert.equal(queued[0]?.opts.delay, 2 * 3600_000);
    assert.equal(queued[0]?.data.flowId, flow.id);

    // 4 · Un mensaje cualquiera no arranca nada (ni el flujo sin disparadores).
    await inbound("gracias");
    assert.equal(await engine.onInbound(conv.id), false);

    // 5 · Un bloque que falla: el flujo se detiene y lo dice en el chat.
    await inbound("esto falla");
    assert.equal(await engine.onInbound(conv.id), true);
    assert.equal(notes.length, 1);
    assert.match(notes[0]!, /Flujo «Roto»: se detuvo: La ventana de 24 h está cerrada/);
    const session = await prisma.flowSession.findUnique({ where: { conversationId: conv.id } });
    assert.equal(session.status, "stopped");
    assert.ok(!sent.includes("no debería salir"));
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar la empresa de flujos", async () => {
      await prisma.flowSession.deleteMany({ where: { flow: { orgId } } });
      await prisma.flow.deleteMany({ where: { orgId } });
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
});

test("condiciones dentro de cada disparador, horario activo, espera que se recomprueba y pausa entre mensajes", async () => {
  const { FlowEngineService } = await import("../src/modules/ai/flow-engine.service");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_kt_${suf}`;
  await ctx.runUnscoped("prueba: empresa de condiciones", () =>
    prisma.organization.create({ data: { id: orgId, slug: `kt-${suf}`, name: "Condiciones" } }),
  );
  const sent: string[] = [];
  const queued: { name: string; data: any; opts: any }[] = [];
  const engine = new FlowEngineService(
    prisma,
    { orgId: () => orgId } as any,
    { queueOutbound: async (i: { text?: string }) => void sent.push(i.text ?? ""), addNote: async () => undefined } as any,
    {} as any,
    { add: async (name: string, data: any, opts: any) => void queued.push({ name, data, opts }) } as any,
    { emit: () => true } as any,
  );
  const graph = (text: string) => ({
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "n1", type: "sendMessage", position: { x: 0, y: 100 }, data: { text } },
    ],
    edges: [{ id: "e1", source: "start", target: "n1" }],
  });
  const always = { timezone: "America/Lima", days: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { from: "00:00", to: "23:59" }])) };
  const never = { timezone: "America/Lima", days: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, null])) };

  await ctx.runInOrg(orgId, async () => {
    const owner = await prisma.user.create({ data: { orgId, email: `v-${suf}@prueba.test`, passwordHash: "x", name: "Vendedora" } });
    const pipeline = await prisma.pipeline.create({ data: { orgId, name: "Ventas", isDefault: true } });
    const nuevo = await prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: "Nuevo", order: 0 } });
    const propuesta = await prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: "Propuesta", order: 1 } });
    const contact = await prisma.contact.create({ data: { orgId, phone: `+51993${suf}`, name: "Cliente Kommo", metadata: { utm_campaign: "verano" } } });
    const conv = await prisma.conversation.create({ data: { orgId, contactId: contact.id, status: "OPEN" } });
    await prisma.deal.create({ data: { orgId, contactId: contact.id, stageId: propuesta.id, title: "Op", currency: "USD", value: 500 } });
    const vip = await prisma.tag.create({ data: { orgId, name: "VIP" } });
    const inbound = (content: string) =>
      prisma.message.create({ data: { orgId, conversationId: conv.id, direction: "INBOUND", type: "TEXT", author: "CONTACT", content } });
    const rule = (field: string, op: string, value: string, key?: string) => ({ id: `r${Math.random()}`, field, op, value, ...(key ? { key } : {}) });

    // Palabra clave «precio», pero solo para quien tiene VIP y vino de la campaña «verano».
    await prisma.flow.create({
      data: {
        orgId, name: "Precio VIP", isActive: true, triggerKeywords: [], ...graph("precio vip"),
        triggers: [{ id: "k", type: "keyword", keywords: ["precio"], config: {}, conditions: { match: "all", rules: [rule("tag", "is", "VIP"), rule("utm", "equals", "verano", "utm_campaign")] } }],
      },
    });
    // Otra palabra clave, fuera de horario: nunca arranca.
    await prisma.flow.create({
      data: { orgId, name: "Nocturno", isActive: true, triggerKeywords: [], ...graph("nocturno"), triggers: [{ id: "n", type: "keyword", keywords: ["hola"], config: {}, activeHours: never }] },
    });
    // Cualquier mensaje, en horario, con pausa de 60 min.
    await prisma.flow.create({
      data: {
        orgId, name: "Cualquiera", isActive: true, triggerKeywords: [], ...graph("cualquiera"),
        triggers: [{ id: "a", type: "inbound_message", keywords: [], config: { cooldownMin: 60 }, activeHours: always, conditions: { match: "all", rules: [rule("stage", "is", propuesta.id)] } }],
      },
    });
    // Cambio de etapa con espera de 10 min; etiqueta quitada; cambio de responsable si es ella.
    const delayed = await prisma.flow.create({
      data: { orgId, name: "Seguimiento", isActive: true, triggerKeywords: [], ...graph("seguimiento"), triggers: [{ id: "d", type: "deal_stage", keywords: [], config: { stageIds: [nuevo.id] }, delayMin: 10 }] },
    });
    await prisma.flow.create({
      data: {
        orgId, name: "Sin VIP", isActive: true, triggerKeywords: [], ...graph("ya no es vip"),
        triggers: [
          { id: "u", type: "tag_removed", keywords: [], config: { tags: ["VIP"] } },
          { id: "o", type: "owner_changed", keywords: [], config: {}, conditions: { match: "all", rules: [rule("deal_owner", "is", owner.id)] } },
        ],
      },
    });

    // 1 · Sin VIP la palabra clave no arranca; cae en «cualquier mensaje» (está en Propuesta).
    await inbound("¿qué precio tiene?");
    assert.equal(await engine.onInbound(conv.id), true);
    assert.deepEqual(sent, ["cualquiera"]);
    // 2 · Con VIP sí: la palabra clave con sus condiciones gana.
    await prisma.contactTag.create({ data: { contactId: contact.id, tagId: vip.id } });
    await inbound("y el precio?");
    assert.equal(await engine.onInbound(conv.id), true);
    assert.equal(sent.at(-1), "precio vip");
    // 3 · Fuera de horario no arranca; y «cualquier mensaje» respeta su pausa… salvo que antes corrió otro flujo.
    await inbound("hola");
    await engine.onInbound(conv.id);
    assert.ok(!sent.includes("nocturno"), "fuera de su horario");
    assert.equal(sent.at(-1), "cualquiera", "el último flujo fue otro: la pausa no aplica");
    const n = sent.length;
    await inbound("otra cosa");
    assert.equal(await engine.onInbound(conv.id), false, "dentro de la pausa de 60 min no vuelve a arrancar");
    assert.equal(sent.length, n);

    // 4 · Cambio de etapa con espera: se programa y al vencer se comprueba que sigue en la etapa.
    await engine.onDealStage(contact.id, nuevo.id);
    const job = queued.find((q) => q.name === "trigger_delay");
    assert.ok(job, "programado");
    assert.equal(job!.opts.delay, 10 * 60_000);
    assert.equal(job!.data.flowId, delayed.id);
    assert.equal(await engine.runDelayedTrigger(job!.data), false, "la oportunidad sigue en Propuesta: no arranca");
    await prisma.deal.updateMany({ where: { contactId: contact.id }, data: { stageId: nuevo.id } });
    assert.equal(await engine.runDelayedTrigger(job!.data), true, "ya está en Nuevo: arranca");
    assert.equal(sent.at(-1), "seguimiento");

    // 5 · Etiqueta quitada y cambio de responsable (con condición sobre el responsable).
    await engine.onTagRemoved(contact.id, "vip");
    assert.equal(sent.at(-1), "ya no es vip");
    const before = sent.length;
    await engine.onOwnerChanged(contact.id, null);
    assert.equal(sent.length, before, "sin responsable no cumple la condición");
    await prisma.deal.updateMany({ where: { contactId: contact.id }, data: { ownerId: owner.id } });
    await engine.onOwnerChanged(contact.id, owner.id);
    assert.equal(sent.length, before + 1);
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar la empresa de condiciones", async () => {
      await prisma.flowSession.deleteMany({ where: { flow: { orgId } } });
      await prisma.flow.deleteMany({ where: { orgId } });
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.dealEvent.deleteMany({ where: { orgId } });
      await prisma.deal.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.contactTag.deleteMany({ where: { contact: { orgId } } });
      await prisma.tag.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.pipelineStage.deleteMany({ where: { orgId } });
      await prisma.pipeline.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
});

test("el clic en un botón sigue el flujo: el primer «Hola» no se toma como respuesta (conversación nueva)", async () => {
  const { FlowEngineService } = await import("../src/modules/ai/flow-engine.service");
  const { AutomationService } = await import("../src/modules/ai/automation.service");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_bt_${suf}`;
  await ctx.runUnscoped("prueba: empresa de botones", () =>
    prisma.organization.create({ data: { id: orgId, slug: `bt-${suf}`, name: "Botones" } }),
  );
  const sent: string[] = [];
  let ai = 0;
  const messaging = {
    queueOutbound: async (i: { text?: string }) => void sent.push(i.text ?? ""),
    queueInteractive: async (i: { body: string; buttons: { title: string }[] }) => void sent.push(`[botones] ${i.body}`),
    setAiMode: async () => undefined,
    addNote: async () => undefined,
  };
  const engine = new FlowEngineService(prisma, { orgId: () => orgId } as any, messaging as any, {} as any, { add: async () => undefined } as any, { emit: () => true } as any);
  const automation = new AutomationService(
    prisma,
    { resolveForConversation: async () => null } as any,
    messaging as any,
    { schedule: async () => void ai++ } as any,
    engine,
    { onInbound: async () => false } as any,
    { enrichLatest: async () => undefined } as any,
    { onInbound: async () => false } as any,
  );
  const node = (id: string, type: string, data: object) => ({ id, type, position: { x: 0, y: 0 }, data });
  const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

  await ctx.runInOrg(orgId, async () => {
    const contact = await prisma.contact.create({ data: { orgId, phone: `+51994${suf}`, name: "Cliente Botones" } });
    await prisma.flow.create({
      data: {
        orgId, name: "Menú", isActive: true, triggerKeywords: [],
        triggers: [{ id: "s", type: "conversation_start", keywords: [], config: {} }],
        nodes: [
          node("start", "start", {}),
          node("b", "buttons", { text: "¿Qué necesitas?", buttons: [{ id: "b1", title: "Precios" }, { id: "b2", title: "Hablar" }] }),
          node("n1", "sendMessage", { text: "Estos son los precios" }),
          node("n2", "sendMessage", { text: "Te paso con alguien" }),
          node("n3", "sendMessage", { text: "No entendí" }),
        ],
        edges: [edge("start", "b"), edge("b", "n1", "b1"), edge("b", "n2", "b2"), edge("b", "n3", "else")],
      },
    });
    const conv = await prisma.conversation.create({ data: { orgId, contactId: contact.id, status: "OPEN" } });
    await prisma.message.create({ data: { orgId, conversationId: conv.id, direction: "INBOUND", type: "TEXT", author: "CONTACT", content: "Hola" } });

    // Como la mensajería: «creada» y «entrante» seguidas, sin esperar una a otra.
    const created = automation.onCreated({ conversationId: conv.id });
    const inbound = automation.onInbound({ conversationId: conv.id });
    await Promise.all([created, inbound]);
    assert.deepEqual(sent, ["[botones] ¿Qué necesitas?"], "solo los botones: el «Hola» no fue la respuesta");
    assert.equal(ai, 0, "la IA no contesta encima del flujo");
    const waiting = await prisma.flowSession.findUnique({ where: { conversationId: conv.id } });
    assert.equal(waiting.currentNodeId, "b", "sigue esperando el clic");

    // 2 · El cliente pulsa «Precios»: el flujo sigue por ese botón.
    await new Promise((r) => setTimeout(r, 20));
    await prisma.message.create({
      data: { orgId, conversationId: conv.id, direction: "INBOUND", type: "TEXT", author: "CONTACT", content: "Precios", buttonPayload: "b1" },
    });
    await automation.onInbound({ conversationId: conv.id });
    assert.deepEqual(sent, ["[botones] ¿Qué necesitas?", "Estos son los precios"]);
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar la empresa de botones", async () => {
      await prisma.flowSession.deleteMany({ where: { flow: { orgId } } });
      await prisma.flow.deleteMany({ where: { orgId } });
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
});

test("flujo con lista, carrusel y adjuntos: envía lo que toca y sigue por la opción elegida", async () => {
  const { FlowEngineService } = await import("../src/modules/ai/flow-engine.service");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_md_${suf}`;
  await ctx.runUnscoped("prueba: empresa de multimedia", () =>
    prisma.organization.create({ data: { id: orgId, slug: `md-${suf}`, name: "Multimedia" } }),
  );
  const out: any[] = [];
  const interactive: any[] = [];
  const messaging = {
    queueOutbound: async (i: any) => void out.push(i),
    queueInteractive: async (i: any) => void interactive.push(i),
    addNote: async () => undefined,
  };
  const engine = new FlowEngineService(prisma, { orgId: () => orgId } as any, messaging as any, {} as any, { add: async () => undefined } as any, { emit: () => true } as any);
  const node = (id: string, type: string, data: object) => ({ id, type, position: { x: 0, y: 0 }, data });
  const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}-${sourceHandle ?? ""}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
  const kw = (w: string) => [{ id: w, type: "keyword", keywords: [w], config: {} }];

  await ctx.runInOrg(orgId, async () => {
    const contact = await prisma.contact.create({ data: { orgId, phone: `+51995${suf}`, name: "Cliente Media" } });
    const conv = await prisma.conversation.create({ data: { orgId, contactId: contact.id, status: "OPEN" } });
    const inbound = (content: string, buttonPayload?: string) =>
      prisma.message.create({ data: { orgId, conversationId: conv.id, direction: "INBOUND", type: "TEXT", author: "CONTACT", content, ...(buttonPayload ? { buttonPayload } : {}) } });
    const tick = () => new Promise((r) => setTimeout(r, 15));

    await prisma.flow.create({
      data: {
        orgId, name: "Lista", isActive: true, triggerKeywords: [], triggers: kw("servicios"),
        nodes: [
          node("start", "start", {}),
          node("l", "list", { text: "¿Qué servicio?", listButton: "Ver servicios", buttons: [{ id: "o1", title: "Corte", description: "30 min" }, { id: "o2", title: "Tinte" }] }),
          node("m1", "sendMessage", { text: "Corte elegido" }),
          node("m2", "sendMessage", { text: "Tinte elegido" }),
        ],
        edges: [edge("start", "l"), edge("l", "m1", "o1"), edge("l", "m2", "o2")],
      },
    });
    await prisma.flow.create({
      data: {
        orgId, name: "Carrusel", isActive: true, triggerKeywords: [], triggers: kw("modelos"),
        nodes: [
          node("start", "start", {}),
          node("c", "carousel", {
            text: "Nuestros modelos",
            cardMode: "reply",
            cards: [
              { id: "ca", mediaUrl: "storage://a", mediaKind: "IMAGE", text: "Modelo A", buttonTitle: "Quiero A" },
              { id: "cb", mediaUrl: "storage://b", mediaKind: "VIDEO", text: "Modelo B", buttonTitle: "Quiero B" },
            ],
          }),
          node("ma", "sendMessage", { text: "Elegiste A" }),
          node("mb", "sendMessage", { text: "Elegiste B" }),
        ],
        edges: [edge("start", "c"), edge("c", "ma", "ca"), edge("c", "mb", "cb")],
      },
    });
    await prisma.flow.create({
      data: {
        orgId, name: "Adjuntos", isActive: true, triggerKeywords: [], triggers: kw("adjuntos"),
        nodes: [
          node("start", "start", {}),
          node("v", "sendMessage", { text: "Mira el video", mediaUrl: "storage://v", mediaKind: "VIDEO", mediaName: "demo.mp4" }),
          node("a", "sendMessage", { text: "Y este audio", mediaUrl: "storage://au", mediaKind: "AUDIO" }),
          node("b", "buttons", { text: "¿Te gustó?", mediaUrl: "storage://img", mediaKind: "IMAGE", buttons: [{ id: "si", title: "Sí" }] }),
        ],
        edges: [edge("start", "v"), edge("v", "a"), edge("a", "b")],
      },
    });

    // 1 · Lista: se envía con sus opciones y sigue por la elegida (id que manda WhatsApp).
    await inbound("ver servicios");
    assert.equal(await engine.onInbound(conv.id), true);
    assert.deepEqual(interactive.at(-1).list, { button: "Ver servicios", rows: [{ id: "o1", title: "Corte", description: "30 min" }, { id: "o2", title: "Tinte" }] });
    await tick();
    await inbound("Tinte", "o2");
    await engine.onInbound(conv.id);
    assert.equal(out.at(-1).text, "Tinte elegido");

    // 2 · Carrusel con respuestas: cada tarjeta es una salida.
    await inbound("los modelos");
    await engine.onInbound(conv.id);
    const car = interactive.at(-1).carousel.cards;
    assert.deepEqual(car.map((c: any) => [c.id, c.kind, c.button.title]), [["ca", "IMAGE", "Quiero A"], ["cb", "VIDEO", "Quiero B"]]);
    await tick();
    await inbound("Quiero B", "cb");
    await engine.onInbound(conv.id);
    assert.equal(out.at(-1).text, "Elegiste B");
    // Y si escribe el número de la tarjeta, también vale.
    await inbound("los modelos");
    await engine.onInbound(conv.id);
    await tick();
    await inbound("1");
    await engine.onInbound(conv.id);
    assert.equal(out.at(-1).text, "Elegiste A");

    // 3 · Adjuntos: video con pie; audio sin pie y su texto aparte; botones con imagen arriba.
    const before = out.length;
    await inbound("adjuntos");
    await engine.onInbound(conv.id);
    const sentNow = out.slice(before);
    assert.deepEqual(sentNow[0], { conversationId: conv.id, type: "VIDEO", mediaUrl: "storage://v", caption: "Mira el video" });
    assert.deepEqual(sentNow[1], { conversationId: conv.id, type: "AUDIO", mediaUrl: "storage://au" });
    assert.equal(sentNow[2].text, "Y este audio");
    assert.deepEqual(interactive.at(-1).headerMedia, { kind: "IMAGE", mediaUrl: "storage://img" });
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar la empresa de multimedia", async () => {
      await prisma.flowSession.deleteMany({ where: { flow: { orgId } } });
      await prisma.flow.deleteMany({ where: { orgId } });
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
});

test("un mensaje antiguo se guarda pero no despierta a la IA (anterior a conectar o de hace horas)", async () => {
  const { MessagingService } = await import("../src/modules/messaging/messaging.service");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_st_${suf}`;
  await ctx.runUnscoped("prueba: empresa de mensajes antiguos", () =>
    prisma.organization.create({ data: { id: orgId, slug: `st-${suf}`, name: "Antiguos" } }),
  );
  const emitted: string[] = [];
  let channel: { id: string; orgId: string; connectedAt: Date } | null = null;
  const svc = new MessagingService(
    prisma,
    { orgId: () => orgId } as any,
    {} as any,
    {} as any,
    { resolveChannel: async () => channel } as any,
    {} as any,
    { emit: (name: string) => emitted.push(name) } as any,
    { emit: async () => undefined } as any,
    {} as any,
    { intakeFromWhatsapp: async () => void emitted.push("intake") } as any,
    {} as any,
  );

  await ctx.runInOrg(orgId, async () => {
    const conn = await prisma.whatsappConnection.create({
      data: { orgId, phoneNumberId: `pn-${suf}`, accessToken: "x", connectedAt: new Date(Date.now() - 5 * 60_000) },
    });
    channel = { id: conn.id, orgId, connectedAt: conn.connectedAt };
    const base = { type: "TEXT" as any, channelPhoneNumberId: `pn-${suf}` };

    // 1 · Escrito antes de conectar el número (aunque sea hace 20 min): pasado.
    await svc.handleInbound({ ...base, from: `+51996${suf}`, waMessageId: `w1-${suf}`, text: "hola de antes", timestampMs: Date.now() - 20 * 60_000 });
    assert.ok(!emitted.includes("conversation.inbound") && !emitted.includes("conversation.created"), "nada que lo conteste");
    assert.ok(!emitted.includes("intake"), "tampoco entra al embudo");
    const m1 = await prisma.message.findFirst({ where: { waMessageId: `w1-${suf}` } });
    assert.ok(m1, "pero queda guardado en la bandeja");

    // 2 · De hace 3 horas (después de conectar): también pasado.
    conn.connectedAt = new Date(Date.now() - 24 * 3600_000);
    channel = { id: conn.id, orgId, connectedAt: conn.connectedAt };
    await svc.handleInbound({ ...base, from: `+51997${suf}`, waMessageId: `w2-${suf}`, text: "viejo", timestampMs: Date.now() - 3 * 3600_000 });
    assert.ok(!emitted.includes("conversation.inbound"));

    // 3 · Uno de ahora sí se atiende.
    await svc.handleInbound({ ...base, from: `+51998${suf}`, waMessageId: `w3-${suf}`, text: "hola", timestampMs: Date.now() - 2_000 });
    assert.ok(emitted.includes("conversation.created") && emitted.includes("conversation.inbound"));
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar la empresa de mensajes antiguos", async () => {
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.source.deleteMany({ where: { orgId } });
      await prisma.whatsappConnection.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
});

test("conversaciones extra: se gastan una vez por conversación y mes, la que vence antes primero, y solo las de su empresa", async () => {
  const { AiPacksService } = await import("../src/modules/ai/ai-packs.service");
  const { PlatformService } = await import("../src/modules/platform/platform.service");
  const suf = String(Date.now()).slice(-7);
  const orgA = `o_pk_a_${suf}`;
  const orgB = `o_pk_b_${suf}`;
  await ctx.runUnscoped("prueba: empresas de paquetes", () =>
    prisma.organization.createMany({
      data: [
        { id: orgA, slug: `pk-a-${suf}`, name: "Paquetes A" },
        { id: orgB, slug: `pk-b-${suf}`, name: "Paquetes B" },
      ],
    }),
  );
  const packs = new AiPacksService(prisma);
  const colaRota = { getJobCounts: async () => { throw new Error("sin redis"); } } as any;
  const platform = new PlatformService(prisma, {} as any, colaRota, colaRota, colaRota, colaRota, colaRota, colaRota, colaRota);
  const day = 86_400_000;
  try {
    // El operador añade dos paquetes a A (el regalo vence antes) y uno vencido.
    await platform.grantAiPack(orgA, { tokens: 40_000, priceUsd: null, months: 1, note: "regalo" }, "op@driony.test");
    const ficha = await platform.grantAiPack(orgA, { tokens: 20_000_000, priceUsd: 12 }, "op@driony.test");
    assert.equal(ficha.aiPacks.length, 2);
    assert.ok(ficha.audit.some((e) => e.action === "ai_pack_added"), "queda en el diario");
    const [regalo] = ficha.aiPacks.filter((p) => p.tokens === 40_000);
    await ctx.runUnscoped("prueba: paquete vencido", () =>
      prisma.aiPack.create({ data: { orgId: orgA, tokens: 500_000, expiresAt: new Date(Date.now() - day) } }),
    );

    await ctx.runInOrg(orgA, async () => {
      const e0 = await packs.extra(orgA);
      assert.equal(e0.remaining, 20_040_000, "lo vencido no cuenta");
      assert.equal(e0.nextExpiresAt?.toISOString(), regalo!.expiresAt, "se gasta primero el que vence antes");

      // Lo gastado por encima del cupo se carga a los paquetes; la misma cifra no se carga dos veces.
      assert.equal(await packs.settle(orgA, 30_000), 30_000);
      assert.equal(await packs.settle(orgA, 30_000), 30_000, "ya estaba apuntado");
      await Promise.all([packs.settle(orgA, 50_000), packs.settle(orgA, 50_000)]);
      const e1 = await packs.extra(orgA);
      assert.equal(e1.usedThisMonth, 50_000);
      assert.equal(e1.remaining, 19_990_000, "el regalo se terminó (40.000) y el grande puso los otros 10.000");
    });

    // B no ve ni gasta lo de A.
    await ctx.runInOrg(orgB, async () => {
      assert.equal((await packs.extra(orgB)).remaining, 0);
      assert.equal(await packs.settle(orgB, 1_000), 0, "sin paquetes no hay de dónde cargar");
      const ajenos: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM ai_packs`);
      assert.equal(ajenos.length, 0, "RLS: los paquetes de otra empresa no se ven");
    });

    // La consola ve el saldo; quitar un paquete lo vence ya.
    const a = (await platform.orgs("")).find((o) => o.id === orgA)!;
    assert.equal(a.aiExtraRemaining, 19_990_000);
    assert.equal(a.aiExtraUsedMonth, 50_000);
    const grande = ficha.aiPacks.find((p) => p.tokens === 20_000_000)!;
    assert.equal(grande.priceUsd, 12);
    const tras = await platform.removeAiPack(orgA, grande.id, "op@driony.test");
    assert.equal(tras.aiPacks.find((p) => p.id === grande.id)?.active, false);
    assert.equal(tras.org.aiExtraRemaining, 0);
    await ctx.runInOrg(orgA, async () => {
      assert.equal(await packs.settle(orgA, 80_000), 50_000, "quitado ya no se gasta: lo apuntado se queda como está");
    });
  } finally {
    await ctx.runUnscoped("prueba: limpiar empresas de paquetes", async () => {
      await prisma.platformAuditLog.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    });
  }
});

test("renovar la sesión funciona con el rol restringido, sin empresa en contexto", async () => {
  // El refresh llega solo con la cookie: no hay subdominio ni token de acceso
  // que digan la empresa. El 2026-11-07 en producción, con crm_app, la sesión
  // salía sin usuario («Field user is required») y la bandeja quedaba vacía al
  // caducar el acceso. En desarrollo no se nota: el dueño se salta RLS.
  process.env.JWT_ACCESS_SECRET ??= "secreto-de-prueba";
  const { JwtService } = await import("@nestjs/jwt");
  const { OrganizationService } = await import("../src/modules/organizations/organization.service");
  const { AuthService } = await import("../src/modules/auth/auth.service");
  const { TenantService } = await import("../src/infra/tenant/tenant.service");
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const orgs = new OrganizationService(prisma, jwt);
  const auth = new AuthService(prisma, new TenantService(prisma), orgs, jwt);

  const slug = `sesion-${Date.now()}`;
  const email = `ana@${slug}.test`;
  const password = "clave-larga-123";
  await orgs.register({ companyName: "Sesión de prueba", slug, adminName: "Ana", adminEmail: email, password }, "127.0.0.1");

  const first = await auth.login({ email, password, orgSlug: slug }, { platform: "WEB" });
  assert.ok(first.refreshToken, "el login entrega un refresh");

  // Sin contexto de empresa, como lo recibe el servidor.
  const next = await auth.refresh(first.refreshToken);
  assert.ok(next.accessToken, "el refresh emite un acceso nuevo");
  assert.notEqual(next.refreshToken, first.refreshToken, "el refresh rota el token");
  assert.equal(next.user.email, email);

  // Y un token inventado sigue sin pasar.
  await assert.rejects(auth.refresh("no-existe"), /inválido/);
});

test("los avisos de cita salen con el rol restringido: confirmación, recordatorio con botones y respuesta del cliente", async () => {
  const { BookingsService } = await import("../src/modules/bookings/bookings.service");
  const { BookingNotificationsService } = await import("../src/modules/bookings/booking-notifications.service");
  const { addDays, utcToZoned, zonedToUtc } = await import("@crm/shared");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_bn_${suf}`;
  await ctx.runUnscoped("prueba: empresa de avisos", () =>
    prisma.organization.create({ data: { id: orgId, slug: `bn-${suf}`, name: "Clínica Avisos" } }),
  );
  const emitted: { name: string; payload: any }[] = [];
  const events = { emit: (name: string, payload: unknown) => emitted.push({ name, payload }) } as any;
  const svc = new BookingsService(prisma, { orgId: () => orgId } as any, events);
  const sent: { kind: string; text: string; buttons?: string[]; templateId?: string; values?: string[] }[] = [];
  const messaging = {
    queueOutbound: async (input: any) => void sent.push({ kind: "text", text: input.text }),
    queueInteractive: async (input: any) => void sent.push({ kind: "buttons", text: input.body, buttons: input.buttons.map((b: any) => b.id) }),
    sendTemplateMessage: async (input: any) =>
      void sent.push({ kind: "template", text: "", templateId: input.templateId, values: input.fill.body.map((v: any) => v.value) }),
  } as any;
  const webhooks: string[] = [];
  const notif = new BookingNotificationsService(prisma, messaging, { emit: async (e: string) => void webhooks.push(e) } as any, svc, events);
  const lastEvent = (name: string) => emitted.filter((e) => e.name === name).at(-1)!.payload;
  const LIMA = "America/Lima";
  const allDay = { from: "08:00", to: "20:00" };
  const everyDay = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [allDay]]));

  await ctx.runInOrg(orgId, async () => {
    const ana = await prisma.user.create({ data: { orgId, email: `ana-${suf}@prueba.test`, passwordHash: "x", name: "Ana" } });
    const contact = await prisma.contact.create({ data: { orgId, phone: `+51993${suf}`, name: "Rosa" } });
    // El cliente escribió hace poco: la ventana de 24 h está abierta.
    const conv = await prisma.conversation.create({
      data: { orgId, contactId: contact.id, status: "OPEN", windowExpiresAt: new Date(Date.now() + 3_600_000) },
    });
    await svc.updateSettings({ timezone: LIMA, minNoticeMin: 0, reminderHoursBefore: 24 });
    await svc.saveSchedule(ana.id, { hours: everyDay as any, blackouts: [], acceptsBookings: true });
    const service = await svc.createService({ name: "Limpieza dental", durationMin: 30, bufferAfterMin: 0, staffIds: [ana.id], isActive: true });
    const day = addDays(utcToZoned(new Date(), LIMA).date, 2);
    const at10 = zonedToUtc(day, "10:00", LIMA);

    // 1 · El equipo crea la cita: el recordatorio queda a 24 h y la confirmación sale en texto.
    const b = await svc.create({ contactId: contact.id, serviceId: service.id, startAt: at10.toISOString(), conversationId: conv.id }, "manual", ana.id);
    assert.equal(b.reminderAt, new Date(at10.getTime() - 24 * 3_600_000).toISOString());
    await notif.onCreated(lastEvent("booking.created"));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, "text");
    assert.match(sent[0].text, /Rosa.*Limpieza dental.*10:00.*Ana/s);
    assert.deepEqual(webhooks, ["booking.created"]);

    // 2 · Si la reservó el agente de IA, no se repite: ya lo dijo en el chat.
    await notif.onCreated({ ...lastEvent("booking.created"), actor: "ai" });
    assert.equal(webhooks.length, 2, "el webhook sí sale aunque reserve el agente");
    assert.equal(sent.length, 1);

    // 3 · Vence el recordatorio: sale con botones y no se vuelve a mandar.
    await prisma.booking.update({ where: { id: b.id }, data: { reminderAt: new Date(Date.now() - 1000) } });
    assert.equal(await notif.sweep(), 1);
    assert.equal(sent[1].kind, "buttons");
    assert.deepEqual(sent[1].buttons, ["booking_confirm", "booking_cancel"]);
    assert.match(sent[1].text, /Te recordamos tu cita de Limpieza dental/);
    assert.equal(await notif.sweep(), 0);
    assert.ok((await prisma.booking.findUnique({ where: { id: b.id } })).reminderSentAt, "queda marcada como enviada");

    // 4 · El cliente pulsa «Confirmar»: la cita queda confirmada por él y se le contesta.
    const inbound = (content: string, buttonPayload?: string) =>
      prisma.message.create({ data: { orgId, conversationId: conv.id, direction: "INBOUND", type: "TEXT", author: "CONTACT", content, buttonPayload } });
    const m1 = await inbound("Confirmar", "booking_confirm");
    assert.equal(await notif.onInbound(conv.id, m1.id), true);
    assert.ok((await prisma.booking.findUnique({ where: { id: b.id } })).confirmedByContactAt);
    assert.match(sent[2].text, /queda confirmada/);

    // 5 · Un «hola» no es respuesta al recordatorio: lo atiende quien toque (flujo, agente…).
    const m2 = await inbound("hola");
    assert.equal(await notif.onInbound(conv.id, m2.id), false);
    assert.equal(sent.length, 3);

    // 6 · «cancelar» escrito, sin tilde ni botón: cancela, avisa y sale el webhook.
    const m3 = await inbound("CANCELAR");
    assert.equal(await notif.onInbound(conv.id, m3.id), true);
    const cancelled = await prisma.booking.findUnique({ where: { id: b.id } });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.reminderAt, null);
    assert.match(cancelled.cancelReason, /recordatorio/);
    assert.match(sent[3].text, /cancelamos tu cita/);
    await notif.onCancelled(lastEvent("booking.cancelled"));
    assert.equal(webhooks.at(-1), "booking.cancelled");

    // 7 · Ventana cerrada y sin plantilla: no sale nada y no rompe.
    await prisma.conversation.update({ where: { id: conv.id }, data: { windowExpiresAt: new Date(Date.now() - 1000) } });
    const b2 = await svc.create({ contactId: contact.id, serviceId: service.id, startAt: zonedToUtc(day, "12:00", LIMA).toISOString(), conversationId: conv.id }, "manual", ana.id);
    await notif.onCreated(lastEvent("booking.created"));
    assert.equal(sent.length, 4);

    // 8 · Con plantilla aprobada: sale la plantilla, llenada con los datos de la cita en el orden elegido.
    const tpl = await prisma.template.create({
      data: { orgId, name: `cita_${suf}`, language: "es", category: "UTILITY", status: "APPROVED", body: "Hola {{1}}, tu cita de {{2}} es el {{3}}." },
    });
    await svc.updateSettings({ confirmTemplateId: tpl.id, confirmTemplateVars: ["contact_name", "service", "datetime"] });
    await notif.onRescheduled({ ...lastEvent("booking.created"), bookingId: b2.id, previousStartAt: at10.toISOString() });
    assert.equal(sent[4].kind, "template");
    assert.equal(sent[4].templateId, tpl.id);
    assert.deepEqual(sent[4].values?.slice(0, 2), ["Rosa", "Limpieza dental"]);
    assert.match(sent[4].values![2]!, /12:00/);
    assert.equal(webhooks.at(-1), "booking.rescheduled");

    // 9 · Una plantilla sin aprobar no se puede elegir.
    const pending = await prisma.template.create({ data: { orgId, name: `cita_p_${suf}`, language: "es", category: "UTILITY", status: "PENDING", body: "Hola" } });
    await assert.rejects(svc.updateSettings({ reminderTemplateId: pending.id }), /aprobada/);

    // 10 · Cambiar la antelación reprograma las citas que aún no recibieron su recordatorio.
    await svc.updateSettings({ reminderHoursBefore: 2 });
    const moved = await prisma.booking.findUnique({ where: { id: b2.id } });
    assert.equal(moved.reminderAt.toISOString(), new Date(Date.parse(b2.startAt) - 2 * 3_600_000).toISOString());
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar la empresa de avisos", async () => {
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.booking.deleteMany({ where: { orgId } });
      await prisma.bookingSettings.deleteMany({ where: { orgId } });
      await prisma.template.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.dealEvent.deleteMany({ where: { orgId } });
      await prisma.deal.deleteMany({ where: { orgId } });
      await prisma.bookingServiceStaff.deleteMany({ where: { orgId } });
      await prisma.bookingService.deleteMany({ where: { orgId } });
      await prisma.staffSchedule.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
});

test("Messenger e Instagram entran por la página de Facebook y salen con el token de la página, solo en su empresa", async () => {
  const { MessagingService } = await import("../src/modules/messaging/messaging.service");
  const { normalizeMetaMessaging } = await import("../src/modules/meta-leads/meta-messaging.types");
  const suf = String(Date.now()).slice(-7);
  const orgA = `o_mm_a_${suf}`;
  const orgB = `o_mm_b_${suf}`;
  await ctx.runUnscoped("prueba: empresas de Messenger", () =>
    prisma.organization.createMany({
      data: [
        { id: orgA, slug: `mm-a-${suf}`, name: "Clínica Mensajes" },
        { id: orgB, slug: `mm-b-${suf}`, name: "Otra empresa" },
      ],
    }),
  );
  const sent: { page: any; to: string; text?: string; opts?: any; kind: string }[] = [];
  const meta = {
    sendText: async (page: any, to: string, text: string, opts: any) => {
      sent.push({ kind: "text", page, to, text, opts });
      return { mid: `m_${sent.length}` };
    },
    sendMedia: async (page: any, to: string) => {
      sent.push({ kind: "media", page, to });
      return { mid: `m_${sent.length}` };
    },
    sendGenericTemplate: async (page: any, to: string) => {
      sent.push({ kind: "generic", page, to });
      return { mid: `m_${sent.length}` };
    },
    uploadMedia: async () => "att_1",
    react: async () => undefined,
  };
  const emitted: string[] = [];
  const intakes: any[] = [];
  const svc = new MessagingService(
    prisma,
    { orgId: () => orgA } as any,
    { add: async () => undefined } as any,
    {} as any,
    { resolveChannel: async () => null } as any,
    {} as any,
    { emit: (name: string) => emitted.push(name) } as any,
    { emit: async () => undefined } as any,
    {} as any,
    { intakeFromWhatsapp: async (...args: unknown[]) => void intakes.push(args) } as any,
    {} as any,
    meta as any,
  );

  await ctx.runInOrg(orgA, async () => {
    const page = await prisma.metaPage.create({
      data: {
        orgId: orgA,
        pageId: `pg${suf}`,
        name: "Clínica",
        accessToken: "tok-pagina",
        messengerEnabled: true,
        messagingSubscribedAt: new Date(Date.now() - 60_000),
      },
    });

    // 1 · El webhook de Meta se traduce a trabajos: un mensaje y un «leído».
    const now = Date.now();
    const jobs = normalizeMetaMessaging({
      object: "page",
      entry: [
        {
          id: `pg${suf}`,
          time: now,
          messaging: [
            { sender: { id: "111" }, recipient: { id: `pg${suf}` }, timestamp: now, message: { mid: `mid1-${suf}`, text: "Hola, ¿precio?" } },
            { sender: { id: "111" }, recipient: { id: `pg${suf}` }, timestamp: now, read: { watermark: now } },
            { sender: { id: `pg${suf}` }, recipient: { id: "111" }, timestamp: now, message: { mid: `eco-${suf}`, text: "desde Meta", is_echo: true } },
          ],
        },
      ],
    });
    assert.deepEqual(jobs.map((j) => j.kind), ["message", "read", "message"]);
    assert.equal((jobs[2] as any).isEcho, true);

    // 2 · El mensaje entra como contacto de Messenger (sin teléfono) y conversación de la página.
    const social = { kind: "messenger" as const, metaPageId: page.id, since: page.messagingSubscribedAt, label: "Clínica", pipelineId: null };
    await svc.handleInbound({ from: "FB.111", name: "Rosa", waMessageId: `mid1-${suf}`, type: "TEXT" as any, text: "Hola, ¿precio?", timestampMs: now - 1000, social });
    const contact = await prisma.contact.findFirst({ where: { phone: "FB.111" } });
    assert.ok(contact, "contacto creado");
    assert.equal(contact.fbPsid, "111");
    assert.equal(contact.origin, "messenger");
    assert.equal(contact.name, "Rosa");
    const convo = await prisma.conversation.findFirst({ where: { contactId: contact.id } });
    assert.equal(convo.channelKind, "messenger");
    assert.equal(convo.metaPageId, page.id);
    assert.ok(convo.windowExpiresAt > new Date(), "ventana de 24 h abierta");
    assert.ok(emitted.includes("conversation.inbound"), "despierta a la automatización");
    assert.equal(intakes[0]?.[1], null, "sin número de WhatsApp");

    // 3 · Dentro de la ventana: sale como respuesta, al PSID, con el token de la página.
    const out = await svc.queueOutbound({ conversationId: convo.id, type: "TEXT" as any, text: "Cuesta S/ 80" }, "AI" as any);
    await svc.processOutbound(out.id);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "111");
    assert.equal(sent[0].page.accessToken, "tok-pagina");
    assert.equal(sent[0].page.platform, "messenger");
    assert.equal(sent[0].opts.humanAgent, false);
    const m = await prisma.message.findUnique({ where: { id: out.id } });
    assert.equal(m.status, "SENT");
    assert.equal(m.waMessageId, "m_1");

    // 4 · Las plantillas son de WhatsApp.
    const tpl = await prisma.template.create({
      data: { orgId: orgA, name: `t_${suf}`, language: "es", category: "UTILITY", status: "APPROVED", body: "Hola" },
    });
    await assert.rejects(svc.sendTemplateMessage({ conversationId: convo.id, templateId: tpl.id, fill: { body: [], urlButtons: [] } }, "HUMAN" as any), /WhatsApp/);

    // 5 · Ventana cerrada hace 2 h: una persona aún puede responder, como agente humano.
    await prisma.conversation.update({ where: { id: convo.id }, data: { windowExpiresAt: new Date(Date.now() - 2 * 3_600_000) } });
    const out2 = await svc.queueOutbound({ conversationId: convo.id, type: "TEXT" as any, text: "¿Seguimos?" }, "HUMAN" as any);
    await svc.processOutbound(out2.id);
    assert.equal(sent[1].opts.humanAgent, true);

    // 6 · Pasados 7 días, no.
    await prisma.conversation.update({ where: { id: convo.id }, data: { windowExpiresAt: new Date(Date.now() - 8 * 86_400_000) } });
    await assert.rejects(svc.queueOutbound({ conversationId: convo.id, type: "TEXT" as any, text: "Hola" }, "HUMAN" as any), /7 días/);

    // 7 · «Leído hasta ahora» marca los salientes como leídos.
    await svc.markReadUpTo("FB.111", Date.now() + 1000);
    assert.equal((await prisma.message.findUnique({ where: { id: out.id } })).status, "READ");

    // 8 · Lo que el equipo contesta desde la bandeja de Meta entra como saliente humano.
    await svc.handleSocialEcho({ social, to: "FB.111", mid: `eco-${suf}`, type: "TEXT" as any, text: "desde Meta" });
    const echo = await prisma.message.findFirst({ where: { waMessageId: `eco-${suf}` } });
    assert.equal(echo.direction, "OUTBOUND");
    assert.equal(echo.author, "HUMAN");

    // 9 · La bandeja sabe de qué canal es.
    const list = await svc.listConversations("u", { filter: "all" } as any, "ADMIN");
    const row = list.find((c) => c.id === convo.id);
    assert.equal(row?.channel?.kind, "messenger");
    assert.equal(row?.channel?.label, "Clínica");
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar Messenger", async () => {
      await prisma.message.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
      await prisma.conversation.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
      await prisma.template.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
      await prisma.contact.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
      await prisma.source.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
      await prisma.metaPage.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }),
  );

  // 10 · La otra empresa no ve nada, ni con SQL crudo.
  // (Se comprueba antes de la limpieza: la limpieza va en finally, así que aquí ya no quedan filas;
  //  la prueba real de aislamiento es el SQL de abajo sobre lo que exista.)
  await ctx.runInOrg(orgB, async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM conversations WHERE "metaPageId" IS NOT NULL`);
    assert.equal(rows.length, 0);
  });
});

test("las fuentes de los canales se reconocen por su tipo: renombrar no duplica, no se borran, y un número puede apuntar a otra", async () => {
  const { fuenteAutomatica } = await import("../src/modules/sources/fuente-automatica");
  const { SourceService } = await import("../src/modules/sources/source.service");
  const { MessagingService } = await import("../src/modules/messaging/messaging.service");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_src_${suf}`;
  await ctx.runUnscoped("prueba: empresa de fuentes", () => prisma.organization.create({ data: { id: orgId, slug: `src-${suf}`, name: "Fuentes" } }));

  await ctx.runInOrg(orgId, async () => {
    const svc = new SourceService({} as any, prisma, { orgId: () => orgId } as any, { invalidate: () => undefined } as any);

    // 1 · La automática de WhatsApp nace una vez y, renombrada, sigue siendo la misma.
    const wa = await fuenteAutomatica(prisma, orgId, "whatsapp");
    await svc.update(wa, { name: "Chats", color: "#000000" });
    assert.equal(await fuenteAutomatica(prisma, orgId, "whatsapp"), wa, "renombrada no se duplica");

    // 2 · Una fuente de la empresa con el nombre de nacimiento no la confunde.
    const manual = await svc.create({ name: "WhatsApp", color: null });
    assert.equal(await fuenteAutomatica(prisma, orgId, "whatsapp"), wa);

    // 3 · No se borra; una de la empresa sí.
    await assert.rejects(svc.remove(wa), /canales/);

    // 4 · Una heredada (sin tipo, con el nombre de nacimiento) se adopta y queda marcada.
    const legacy = await prisma.source.create({ data: { orgId, name: "Instagram" } });
    assert.equal(await fuenteAutomatica(prisma, orgId, "instagram"), legacy.id);
    assert.equal((await prisma.source.findUnique({ where: { id: legacy.id } })).kind, "instagram");

    // 5 · Un número con fuente propia: quien le escribe entra con ella.
    const conn = await prisma.whatsappConnection.create({
      data: { orgId, phoneNumberId: `pn-src-${suf}`, accessToken: "x", sourceId: manual.id, connectedAt: new Date(Date.now() - 60_000) },
    });
    const msgSvc = new MessagingService(
      prisma,
      { orgId: () => orgId } as any,
      {} as any,
      {} as any,
      { resolveChannel: async () => ({ id: conn.id, orgId, connectedAt: conn.connectedAt, sourceId: manual.id }) } as any,
      {} as any,
      { emit: () => undefined } as any,
      { emit: async () => undefined } as any,
      {} as any,
      { intakeFromWhatsapp: async () => undefined } as any,
      {} as any,
    );
    await msgSvc.handleInbound({ from: `+51994${suf}`, waMessageId: `src1-${suf}`, type: "TEXT" as any, text: "hola", channelPhoneNumberId: `pn-src-${suf}`, timestampMs: Date.now() - 1000 });
    const c1 = await prisma.contact.findUnique({ where: { orgId_phone: { orgId, phone: `+51994${suf}` } } });
    assert.equal(c1.sourceId, manual.id);

    // 6 · El listado dice de qué vía es cada fuente y qué canal la alimenta.
    const list = await svc.list();
    assert.equal(list.find((s) => s.id === wa)?.kind, "whatsapp");
    assert.deepEqual(list.find((s) => s.id === manual.id)?.channels.map((c) => c.kind), ["whatsapp"]);
    assert.equal(list.find((s) => s.id === manual.id)?.kind, null);
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar fuentes", async () => {
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.whatsappConnection.deleteMany({ where: { orgId } });
      await prisma.source.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );
});

test("TikTok entra por la cuenta de empresa con 48 h de ventana, sale con su token y solo en su empresa", async () => {
  const { MessagingService } = await import("../src/modules/messaging/messaging.service");
  const { verifyTikTokSignature } = await import("../src/modules/messaging/tiktok.client");
  const { parseTikTokContent } = await import("../src/modules/tiktok/tiktok-messaging.service");
  const { createHmac } = await import("node:crypto");
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_tt_${suf}`;
  await ctx.runUnscoped("prueba: empresa de TikTok", () => prisma.organization.create({ data: { id: orgId, slug: `tt-${suf}`, name: "Tienda TikTok" } }));

  // 1 · La firma del webhook: «t.cuerpo» con el secreto; caducada o cambiada, no vale.
  const raw = JSON.stringify({ event: "im_receive_msg", user_openid: `biz${suf}`, content: JSON.stringify({ conversation_id: "c1", message_id: "m1", type: "text", text: { body: "hola" } }) });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "secreto").update(`${t}.${raw}`).digest("hex");
  assert.equal(verifyTikTokSignature("secreto", `t=${t},s=${sig}`, raw), true);
  assert.equal(verifyTikTokSignature("secreto", `t=${t},s=${sig}`, raw + " "), false, "cuerpo distinto");
  assert.equal(verifyTikTokSignature("secreto", `t=${t - 3600},s=${sig}`, raw), false, "hora vieja");
  assert.equal(verifyTikTokSignature("otro", `t=${t},s=${sig}`, raw), false, "otro secreto");
  assert.equal(parseTikTokContent(JSON.parse(raw).content)?.message_id, "m1");

  const sent: { businessId: string; conversationId: string; text?: string; kind: string }[] = [];
  const tiktok = {
    validToken: async () => "tok-vivo",
    sendText: async (creds: any, conversationId: string, text: string) => {
      sent.push({ kind: "text", businessId: creds.businessId, conversationId, text });
      return { messageId: `tt_${sent.length}` };
    },
    sendImage: async (creds: any, conversationId: string) => {
      sent.push({ kind: "image", businessId: creds.businessId, conversationId });
      return { messageId: `tt_${sent.length}` };
    },
  };
  const emitted: string[] = [];
  const svc = new MessagingService(
    prisma,
    { orgId: () => orgId } as any,
    { add: async () => undefined } as any,
    {} as any,
    { resolveChannel: async () => null } as any,
    {} as any,
    { emit: (name: string) => emitted.push(name) } as any,
    { emit: async () => undefined } as any,
    {} as any,
    { intakeFromWhatsapp: async () => undefined } as any,
    {} as any,
    undefined,
    tiktok as any,
  );

  await ctx.runInOrg(orgId, async () => {
    const acc = await prisma.tikTokAccount.create({
      data: {
        orgId,
        businessId: `biz${suf}`,
        username: "tienda.tt",
        accessToken: "a",
        refreshToken: "r",
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
        connectedAt: new Date(Date.now() - 60_000),
      },
    });
    const social = {
      kind: "tiktok" as const,
      tiktokAccountId: acc.id,
      externalId: `conv-${suf}`,
      since: acc.connectedAt,
      label: "@tienda.tt",
      pipelineId: null,
      sourceId: null,
      windowMs: 48 * 3_600_000,
    };

    // 2 · Entra: contacto de TikTok (sin teléfono), conversación con el id de TikTok y 48 h de ventana.
    const now = Date.now();
    await svc.handleInbound({ from: "TIK.u555", name: "ana.tt", username: "ana.tt", waMessageId: `tt-in-${suf}`, type: "TEXT" as any, text: "¿Tienen stock?", timestampMs: now - 1000, social });
    const contact = await prisma.contact.findFirst({ where: { phone: "TIK.u555" } });
    assert.ok(contact, "contacto creado");
    assert.equal(contact.ttUserId, "u555");
    assert.equal(contact.origin, "tiktok");
    assert.equal(contact.waUsername, "ana.tt");
    const convo = await prisma.conversation.findFirst({ where: { contactId: contact.id } });
    assert.equal(convo.channelKind, "tiktok");
    assert.equal(convo.tiktokAccountId, acc.id);
    assert.equal(convo.externalId, `conv-${suf}`);
    assert.ok(convo.windowExpiresAt.getTime() > now + 47 * 3_600_000, "ventana de 48 h");
    assert.ok(emitted.includes("conversation.inbound"));

    // 3 · Sale por la cuenta, a la conversación de TikTok.
    const out = await svc.queueOutbound({ conversationId: convo.id, type: "TEXT" as any, text: "Sí, nos queda" }, "AI" as any);
    await svc.processOutbound(out.id);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].businessId, `biz${suf}`);
    assert.equal(sent[0].conversationId, `conv-${suf}`);
    assert.equal((await prisma.message.findUnique({ where: { id: out.id } })).waMessageId, "tt_1");

    // 4 · Botones: van numerados en el texto.
    const buttons = await svc.queueInteractive({ conversationId: convo.id, body: "¿Talla?", buttons: [{ id: "s", title: "S" }, { id: "m", title: "M" }] } as any, "AI" as any);
    await svc.processOutbound(buttons.id);
    assert.match(sent[1].text!, /1\) S[\s\S]*2\) M/);

    // 5 · A las 48 h se cierra, sin «agente humano».
    await prisma.conversation.update({ where: { id: convo.id }, data: { windowExpiresAt: new Date(Date.now() - 60_000) } });
    await assert.rejects(svc.queueOutbound({ conversationId: convo.id, type: "TEXT" as any, text: "hola" }, "HUMAN" as any), /48 h/);

    // 6 · Lo contestado desde la app de TikTok entra como saliente humano.
    await svc.handleSocialEcho({ social, to: "TIK.u555", mid: `tt-echo-${suf}`, type: "TEXT" as any, text: "desde la app" });
    const echo = await prisma.message.findFirst({ where: { waMessageId: `tt-echo-${suf}` } });
    assert.equal(echo.direction, "OUTBOUND");
    assert.equal(echo.author, "HUMAN");

    // 7 · La bandeja sabe que es TikTok.
    const list = await svc.listConversations("u", { filter: "all" } as any, "ADMIN");
    const row = list.find((c) => c.id === convo.id);
    assert.equal(row?.channel?.kind, "tiktok");
    assert.equal(row?.channel?.label, "@tienda.tt");
  }).finally(() =>
    ctx.runUnscoped("prueba: limpiar TikTok", async () => {
      await prisma.message.deleteMany({ where: { orgId } });
      await prisma.conversation.deleteMany({ where: { orgId } });
      await prisma.contact.deleteMany({ where: { orgId } });
      await prisma.source.deleteMany({ where: { orgId } });
      await prisma.tikTokAccount.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }),
  );

  // 8 · Otra empresa no ve cuentas de TikTok ajenas, ni con SQL crudo.
  await ctx.runInOrg("o_b", async () => {
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM tiktok_accounts`);
    assert.equal(rows.length, 0);
  });
});

test("un catálogo conectado se lee solo en su empresa: crea, actualiza, desactiva, adopta por SKU y crea sus campos", async () => {
  const { ProductSyncService } = await import("../src/modules/products/product-sync.service");
  const { ProductSourceService } = await import("../src/modules/products/product-source.service");
  process.env.APP_ENCRYPTION_KEY ??= "clave-de-prueba-para-cifrar-secretos";
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_cat_${suf}`;
  await ctx.runUnscoped("prueba: empresa del catálogo", () => prisma.organization.create({ data: { id: orgId, slug: `cat-${suf}`, name: "Catálogo" } }));

  await ctx
    .runInOrg(orgId, async () => {
      // Sin Redis ni internet: la cola se apunta y la «tienda» es una lista en memoria.
      const encolados: string[] = [];
      const queue = { add: async (_n: string, data: any) => void encolados.push(data.sourceId) } as any;
      const sync = new ProductSyncService(prisma, queue);
      let items: any[] = [
        { externalId: "p1", name: "Camiseta", sku: "CAM-1", description: "Algodón", price: 50, currency: "PEN", imageUrl: "https://t.example/c.jpg", isActive: true, attributes: { talla: "M" } },
        { externalId: "p2", name: "Gorra", sku: "GOR-1", description: null, price: 20, currency: "PEN", imageUrl: null, isActive: true, attributes: {} },
      ];
      sync.useConnectors([
        {
          kind: "woocommerce",
          normalizeTarget: (raw: string) => raw.replace(/\/+$/, ""),
          test: async () => ({ ok: true as const, name: "Tienda X", currency: "PEN", count: 2, sample: ["Camiseta", "Gorra"], warnings: [] }),
          pull: async () => ({ items, storeName: "Tienda X", currency: "PEN", fields: [{ key: "talla", label: "Talla", type: "text" as const, showOnCard: true }], warnings: [] }),
        },
      ]);
      const sources = new ProductSourceService(prisma, { orgId: () => orgId } as any, sync);

      // 1 · Conectar prueba, guarda cifrado y encola la primera lectura.
      const src = await sources.create({ kind: "woocommerce", url: "https://tienda.example/", consumerKey: "ck_1234567890abcdef", consumerSecret: "cs_abcdef1234567890", syncEvery: 60 });
      assert.equal(src.name, "Tienda X", "el nombre sale de la tienda");
      assert.equal(src.target, "https://tienda.example");
      assert.equal(src.credentialsHint, "ck_123…cdef");
      assert.deepEqual(encolados, [src.id]);
      const guardada = await prisma.productSource.findUnique({ where: { id: src.id } });
      assert.ok(guardada.credentials && !guardada.credentials.includes("ck_1234567890abcdef"), "las claves no están en claro");

      // 2 · Primera lectura: crea los productos y el campo «Talla».
      const r1 = await sync.run(src.id);
      assert.equal(r1.summary?.created, 2);
      const cam = await prisma.product.findFirst({ where: { sku: "CAM-1" } });
      assert.equal(cam.sourceId, src.id);
      assert.equal(cam.externalId, "p1");
      assert.equal(cam.attributes.talla, "M");
      assert.ok(await prisma.productField.findFirst({ where: { key: "talla" } }), "el campo de la opción se crea solo");

      // 3 · Segunda lectura: el precio cambia, la gorra desaparece (se desactiva) y lo de Driony se conserva.
      await prisma.product.update({ where: { id: cam.id }, data: { attributes: { ...cam.attributes, nota: "mía" } } });
      await prisma.productPrice.create({ data: { orgId, productId: cam.id, currency: "USD", amount: 14 } });
      items = [{ ...items[0], price: 55 }];
      const r2 = await sync.run(src.id);
      assert.equal(r2.summary?.updated, 1);
      assert.equal(r2.summary?.deactivated, 1);
      const cam2 = await prisma.product.findUnique({ where: { id: cam.id }, include: { prices: true } });
      assert.equal(Number(cam2.price), 55);
      assert.equal(cam2.attributes.nota, "mía", "un campo propio no se pierde");
      assert.equal(cam2.attributes.talla, "M");
      assert.equal(cam2.prices.length, 1, "el precio en otra moneda se conserva");
      assert.equal((await prisma.product.findFirst({ where: { sku: "GOR-1" } })).isActive, false, "lo que la tienda ya no trae queda inactivo");

      // 4 · Sin cambios no se escribe; un producto manual con el mismo SKU se adopta.
      await prisma.product.create({ data: { orgId, name: "Polo", sku: "POL-1", price: 10 } });
      items = [items[0], { externalId: "p3", name: "Polo nuevo", sku: "POL-1", description: null, price: 12, currency: "PEN", imageUrl: null, isActive: true, attributes: {} }];
      const r3 = await sync.run(src.id);
      assert.equal(r3.summary?.unchanged, 1);
      assert.equal(r3.summary?.created, 0, "no se duplica");
      const polo = await prisma.product.findFirst({ where: { sku: "POL-1" } });
      assert.equal(polo.sourceId, src.id);
      assert.equal(polo.name, "Polo nuevo");

      // 5 · El estado se ve en la lista; otra empresa no ve la conexión ni con SQL crudo.
      const [dto] = await sources.list();
      assert.equal(dto.status, "ok");
      assert.equal(dto.productCount, 3);
      assert.equal(dto.lastSummary?.total, 2);
      await ctx.runInOrg("o_b", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM product_sources`);
        assert.equal(rows.length, 0);
      });

      // 6 · Quitar conservando: los productos se quedan, sin conexión.
      await sources.remove(src.id, "keep");
      assert.equal((await prisma.product.findUnique({ where: { id: cam.id } })).sourceId, null);
      assert.equal(await prisma.productSource.count(), 0);
    })
    .finally(() =>
      ctx.runUnscoped("prueba: limpiar catálogo", async () => {
        await prisma.productPrice.deleteMany({ where: { orgId } });
        await prisma.product.deleteMany({ where: { orgId } });
        await prisma.productField.deleteMany({ where: { orgId } });
        await prisma.productSource.deleteMany({ where: { orgId } });
        await prisma.organization.delete({ where: { id: orgId } });
      }),
    );
});

test("la API pública carga productos por SKU ligados a su clave, y el webhook de una tienda solo dispara con firma válida", async () => {
  const { ProductSyncService } = await import("../src/modules/products/product-sync.service");
  const { ProductSourceService } = await import("../src/modules/products/product-source.service");
  const { PublicProductsService } = await import("../src/modules/public-api/public-products.service");
  const { createHmac } = await import("node:crypto");
  process.env.APP_ENCRYPTION_KEY ??= "clave-de-prueba-para-cifrar-secretos";
  // Sin dirección pública: los webhooks de la tienda no se pueden registrar (y así no se sale a internet).
  const urlPublica = process.env.API_PUBLIC_URL;
  const dominio = process.env.SAAS_BASE_DOMAIN;
  delete process.env.API_PUBLIC_URL;
  delete process.env.SAAS_BASE_DOMAIN;
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_api_${suf}`;
  await ctx.runUnscoped("prueba: empresa de la API de catálogo", () => prisma.organization.create({ data: { id: orgId, slug: `api-${suf}`, name: "API catálogo" } }));

  await ctx
    .runInOrg(orgId, async () => {
      const encolados: string[] = [];
      const avisos: string[] = [];
      const queue = { add: async (_n: string, data: any) => void encolados.push(data.sourceId) } as any;
      const webhooks = { emit: async (event: string) => void avisos.push(event) } as any;
      const sync = new ProductSyncService(prisma, queue, webhooks);
      const sources = new ProductSourceService(prisma, { orgId: () => orgId } as any, sync);
      const api = new PublicProductsService(prisma, { orgId: () => orgId } as any, sources, sync);

      // 1 · La carga en bloque crea los productos y los liga a la conexión «api» de la clave.
      const r1 = await api.bulk(
        {
          products: [
            { sku: "A-1", name: "Taza", price: 10, currency: "PEN", fields: { Color: "rojo" } },
            { sku: "B-2", name: "Plato", price: 20, currency: "PEN" },
          ],
          deactivateMissing: false,
        },
        "erp",
      );
      assert.equal(r1.created, 2);
      assert.equal(r1.errors.length, 0);
      const apiSrc = (await sources.list()).find((s) => s.kind === "api");
      assert.ok(apiSrc, "la conexión api nace sola");
      assert.equal(apiSrc.target, "erp");
      assert.equal(apiSrc.productCount, 2);
      assert.equal(apiSrc.lastSummary?.created, 2);
      assert.ok(avisos.includes("catalog.synced"), "se avisa por webhook saliente");
      const taza = await prisma.product.findFirst({ where: { sku: "A-1" } });
      assert.equal(taza.sourceId, apiSrc.id);
      assert.equal(taza.attributes.color, "rojo", "el campo se guarda por su clave");

      // 2 · Segundo envío: actualiza lo que viene y desactiva lo que esta clave cargó y ya no manda.
      const r2 = await api.bulk({ products: [{ sku: "A-1", name: "Taza grande", price: 12 }], deactivateMissing: true }, "erp");
      assert.equal(r2.updated, 1);
      assert.equal(r2.deactivated, 1);
      assert.equal(Number((await prisma.product.findFirst({ where: { sku: "A-1" } })).price), 12);
      assert.equal((await prisma.product.findFirst({ where: { sku: "B-2" } })).isActive, false);

      // 3 · Se lista y se lee con el molde público.
      const page = await api.list({ limit: 10, sku: "A-1" });
      assert.equal(page.data.length, 1);
      assert.equal(page.data[0].source, "API · erp");
      assert.equal(page.data[0].fields.color, "rojo");
      assert.equal((await api.list({ limit: 10, active: "false" })).data.length, 1);

      // 4 · Webhook de tienda: sin URL pública queda pendiente; la firma de WooCommerce manda.
      sync.useConnectors([
        {
          kind: "woocommerce",
          normalizeTarget: (raw: string) => raw.replace(/\/+$/, ""),
          test: async () => ({ ok: true as const, name: "W", currency: "PEN", count: 0, sample: [], warnings: [] }),
          pull: async () => ({ items: [], storeName: "W", currency: "PEN", fields: [], warnings: [] }),
        },
      ]);
      const woo = await sources.create({ kind: "woocommerce", url: "https://w.example/", consumerKey: "ck_1234567890", consumerSecret: "cs_1234567890", syncEvery: 60 });
      assert.equal(woo.webhookUrl, null);
      assert.match(woo.webhookError ?? "", /dirección pública/);
      const token = (await prisma.productSource.findUnique({ where: { id: woo.id } })).webhookToken as string;
      assert.ok(token && token.length >= 32);
      const body = Buffer.from(JSON.stringify({ id: 1 }));
      encolados.length = 0;
      await assert.rejects(sources.receiveHook(token, { "x-wc-webhook-signature": "mala" }, body), /firma/i);
      assert.equal(encolados.length, 0, "con firma mala no se relee");
      const firma = createHmac("sha256", token).update(body).digest("base64");
      await sources.receiveHook(token, { "x-wc-webhook-signature": firma }, body);
      assert.deepEqual(encolados, [woo.id], "con firma buena se encola la relectura");
      assert.ok((await prisma.productSource.findUnique({ where: { id: woo.id } })).lastWebhookAt);
      await assert.rejects(sources.receiveHook("deadbeefdeadbeefdeadbeefdeadbeef", {}, body), /no existe/);
      assert.equal((await sources.syncNow(apiSrc.id)).queued, false, "una conexión api no se lee");

      // 5 · Otra empresa no ve estos productos ni la conexión por SQL crudo.
      await ctx.runInOrg("o_b", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM products WHERE sku = 'A-1'`);
        assert.equal(rows.length, 0);
        const srcs: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM product_sources WHERE kind = 'api'`);
        assert.equal(srcs.length, 0);
      });
    })
    .finally(() =>
      ctx.runUnscoped("prueba: limpiar API de catálogo", async () => {
        if (urlPublica) process.env.API_PUBLIC_URL = urlPublica;
        if (dominio) process.env.SAAS_BASE_DOMAIN = dominio;
        await prisma.productPrice.deleteMany({ where: { orgId } });
        await prisma.product.deleteMany({ where: { orgId } });
        await prisma.productField.deleteMany({ where: { orgId } });
        await prisma.productSource.deleteMany({ where: { orgId } });
        await prisma.organization.delete({ where: { id: orgId } });
      }),
    );
});

test("Mercado Libre: la autorización crea la conexión del vendedor en su empresa, las publicaciones se traducen con variaciones y el aviso de la app relee", async () => {
  const { ProductSyncService } = await import("../src/modules/products/product-sync.service");
  const { MercadoLibreConnectService } = await import("../src/modules/products/mercadolibre-connect.service");
  const { mapMercadoLibreItem } = await import("../src/modules/products/connectors/mercadolibre.connector");
  const { decryptSecret } = await import("../src/common/utils/secret-box");
  process.env.APP_ENCRYPTION_KEY ??= "clave-de-prueba-para-cifrar-secretos";
  const appIdAntes = process.env.MERCADOLIBRE_APP_ID;
  const dominio = process.env.SAAS_BASE_DOMAIN;
  process.env.MERCADOLIBRE_APP_ID = "424242";
  delete process.env.SAAS_BASE_DOMAIN;
  const suf = String(Date.now()).slice(-7);
  const orgId = `o_ml_${suf}`;
  await ctx.runUnscoped("prueba: empresa de Mercado Libre", () => prisma.organization.create({ data: { id: orgId, slug: `ml-${suf}`, name: "ML catálogo" } }));

  try {
    // 1 · Una publicación con variaciones, en el molde de Driony (sin salir a internet).
    const fields = new Map<string, any>();
    const productos = mapMercadoLibreItem(
      {
        id: "MPE100",
        title: "Polo básico",
        price: 49.9,
        currency_id: "PEN",
        status: "active",
        permalink: "https://articulo.mercadolibre.com.pe/MPE-100",
        pictures: [
          { id: "p1", secure_url: "https://img.test/p1.jpg" },
          { id: "p2", secure_url: "https://img.test/p2.jpg" },
        ],
        attributes: [
          { id: "BRAND", name: "Marca", value_name: "Acme" },
          { id: "SELLER_SKU", name: "SKU", value_name: "POLO" },
        ],
        category_id: "MPE1430",
        condition: "new",
        variations: [
          {
            id: 1,
            price: 49.9,
            available_quantity: 3,
            attribute_combinations: [
              { id: "SIZE", name: "Talla", value_name: "M" },
              { id: "COLOR", name: "Color", value_name: "Rojo" },
            ],
            picture_ids: ["p2"],
            attributes: [{ id: "SELLER_SKU", value_name: "POLO-M-R" }],
          },
          {
            id: 2,
            price: 54.9,
            available_quantity: 0,
            attribute_combinations: [
              { id: "SIZE", name: "Talla", value_name: "L" },
              { id: "COLOR", name: "Color", value_name: "Rojo" },
            ],
            picture_ids: [],
          },
        ],
      },
      "Polo de algodón",
      "Ropa",
      fields,
      "PEN",
    );
    assert.equal(productos.length, 2);
    assert.equal(productos[0].externalId, "MPE100:1");
    assert.equal(productos[0].name, "Polo básico – M / Rojo");
    assert.equal(productos[0].sku, "POLO-M-R");
    assert.equal(productos[0].imageUrl, "https://img.test/p2.jpg", "la foto de la variación");
    assert.equal(productos[0].description, "Polo de algodón");
    assert.equal(productos[0].attributes.talla, "M");
    assert.equal(productos[0].attributes.color, "Rojo");
    assert.equal(productos[0].attributes.stock, "3");
    assert.equal(productos[0].attributes.enlace, "https://articulo.mercadolibre.com.pe/MPE-100");
    assert.equal(productos[0].attributes.categoria, "Ropa");
    assert.equal(productos[0].attributes.marca, "Acme");
    assert.equal(productos[1].price, 54.9);
    assert.equal(productos[1].sku, null, "con varias variaciones, la que no tiene SKU no hereda el del padre");
    assert.equal(productos[1].imageUrl, "https://img.test/p1.jpg", "sin foto propia, la de la publicación");
    assert.ok(fields.has("talla") && fields.has("color") && fields.has("marca"), "los campos de las combinaciones y la marca (stock, enlace y categoría los pone la lectura)");
    const pausado = mapMercadoLibreItem({ id: "MPE200", title: "Gorra", price: 20, currency_id: "PEN", status: "paused", available_quantity: 5, seller_custom_field: "GORRA-1" }, null, null, fields, "PEN");
    assert.equal(pausado.length, 1);
    assert.equal(pausado[0].externalId, "MPE200");
    assert.equal(pausado[0].isActive, false, "pausada = inactiva en Driony");
    assert.equal(pausado[0].sku, "GORRA-1");
    assert.equal(pausado[0].attributes.stock, "5");

    await ctx.runInOrg(orgId, async () => {
      // 2 · La vuelta de la autorización crea la conexión en la empresa del pase.
      const admin = await prisma.user.create({ data: { orgId, email: `ml-admin-${suf}@prueba.test`, passwordHash: "x", name: "Admin", role: "ADMIN" } });
      const encolados: string[] = [];
      const queue = { add: async (_n: string, data: any) => void encolados.push(data.sourceId) } as any;
      const sync = new ProductSyncService(prisma, queue);
      const tickets = { issue: async () => "pase", redeem: async () => ({ sub: admin.id, org: orgId, site: "MPE", syncEvery: 360, pkce: "k" }) } as any;
      let canjes = 0;
      const client = {
        configured: true,
        appId: "424242",
        authorizeUrl: () => "https://auth.mercadolibre.com.pe/authorization?x",
        exchangeCode: async () => {
          canjes++;
          return { accessToken: "APP_USR-1", refreshToken: "TG-1", expiresAt: Date.now() + 6 * 3_600_000, userId: "777", scope: "offline_access read" };
        },
        me: async () => ({ id: 777, nickname: "TIENDA_PRUEBA", site_id: "MPE" }),
      } as any;
      const ml = new MercadoLibreConnectService(prisma, sync, tickets, client);
      const vuelta = await ml.complete({ code: "TG-code", state: "pase" });
      assert.match(vuelta, /\/products\?stores=mercadolibre&connected=1$/);
      assert.equal(canjes, 1);
      const src = await prisma.productSource.findFirst({ where: { kind: "mercadolibre" } });
      assert.ok(src, "la conexión existe");
      assert.equal(src.target, "777");
      assert.equal(src.name, "TIENDA_PRUEBA");
      assert.equal(src.defaultCurrency, "PEN");
      assert.equal(src.syncEvery, 360);
      assert.deepEqual(encolados, [src.id], "se encola la primera lectura");
      const creds = JSON.parse(decryptSecret(src.credentials) as string);
      assert.equal(creds.refreshToken, "TG-1");
      assert.equal(creds.nickname, "TIENDA_PRUEBA");
      assert.equal(creds.siteId, "MPE");

      // Volver a autorizar la misma cuenta renueva la conexión en vez de duplicarla.
      await ml.complete({ code: "TG-code-2", state: "pase" });
      assert.equal(await prisma.productSource.count({ where: { kind: "mercadolibre" } }), 1);

      // Mercado Libre devuelve un error: se vuelve con el motivo y no se toca nada.
      const cancelada = await ml.complete({ state: "pase", error: "access_denied", errorDescription: "El usuario canceló" });
      assert.match(cancelada, /stores=mercadolibre&error=El%20usuario%20cancel/);
      assert.equal(canjes, 2);

      // 3 · Los avisos de la app: solo los de nuestra app, de un vendedor conectado y de un tema de publicaciones releen.
      encolados.length = 0;
      assert.equal((await ml.handleNotification({ topic: "items", resource: "/items/MPE100", user_id: 777, application_id: 424242 })).queued, 1);
      assert.deepEqual(encolados, [src.id]);
      assert.ok((await prisma.productSource.findUnique({ where: { id: src.id } })).lastWebhookAt);
      assert.equal((await ml.handleNotification({ topic: "items", user_id: 777, application_id: 999 })).queued, 0, "otra app");
      assert.equal((await ml.handleNotification({ topic: "items", user_id: 123456, application_id: 424242 })).queued, 0, "vendedor desconocido");
      assert.equal((await ml.handleNotification({ topic: "orders_v2", user_id: 777, application_id: 424242 })).queued, 0, "otro tema");
      assert.equal((await ml.handleNotification("basura")).queued, 0);

      // Sin app en el servidor no se puede ni empezar.
      const sinApp = new MercadoLibreConnectService(prisma, sync, tickets, { configured: false, appId: "" } as any);
      await assert.rejects(sinApp.start({ sub: admin.id, org: orgId }, { site: "MPE", syncEvery: 60 }), /MERCADOLIBRE_APP_ID/);

      // La conexión se lista como las demás, sin URL de webhook propia.
      const { ProductSourceService } = await import("../src/modules/products/product-source.service");
      const sources = new ProductSourceService(prisma, { orgId: () => orgId } as any, sync);
      const dto = (await sources.list()).find((x) => x.kind === "mercadolibre");
      assert.ok(dto);
      assert.equal(dto.webhookUrl, null);
      assert.equal(dto.credentialsHint, "Vendedor TIENDA_PRUEBA");
    });

    // 4 · Otra empresa no ve la conexión.
    await ctx.runInOrg("o_b", async () => {
      const rows: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM product_sources WHERE kind = 'mercadolibre' AND target = '777'`);
      assert.equal(rows.length, 0);
    });
  } finally {
    await ctx.runUnscoped("prueba: limpiar Mercado Libre", async () => {
      if (appIdAntes === undefined) delete process.env.MERCADOLIBRE_APP_ID;
      else process.env.MERCADOLIBRE_APP_ID = appIdAntes;
      if (dominio) process.env.SAAS_BASE_DOMAIN = dominio;
      await prisma.productSource.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    });
  }
});
