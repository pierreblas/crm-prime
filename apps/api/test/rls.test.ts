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
