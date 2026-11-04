/**
 * Candado de inmutabilidad del cotizador, en la propia base.
 *
 *   npm run test:impldb --workspace=apps/api
 *
 * El servicio ya impide editar lo que no está en borrador; aquí se comprueba
 * que un UPDATE escrito a mano tampoco puede. Corre contra crm_rls_test, que
 * `pretest:impldb` recrea con todas las migraciones (como dueño, sin RLS por
 * medio: estas tablas no son de ninguna empresa).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const DB = process.env.IMPL_DATABASE_URL ?? "postgresql://crm:crm@localhost:5433/crm_rls_test";

let base: any;
const sql = (q: string) => base.$executeRawUnsafe(q) as Promise<number>;
const rows = (q: string) => base.$queryRawUnsafe(q) as Promise<any[]>;
const fails = (q: string, re: RegExp) => assert.rejects(() => sql(q), (e: any) => re.test(String(e.message)));

before(async () => {
  const { PrismaClient } = await import("@prisma/client");
  base = new PrismaClient({ datasources: { db: { url: DB } } });
  await sql(`DELETE FROM implementation_assessments WHERE id = 'ia_test'`);
  await sql(`INSERT INTO implementation_assessments (id, title, "clientName", "ownerEmail", scope, "updatedAt") VALUES ('ia_test', 'Test', 'Cliente', 'ops@test', '{}', now())`);
  await sql(`INSERT INTO implementation_quotes (id, "assessmentId", version, status, "createdBy", "updatedAt", "proposedPriceCents") VALUES ('iq_test', 'ia_test', 1, 'DRAFT', 'ops@test', now(), 50000)`);
});

after(async () => {
  await sql(`DELETE FROM implementation_assessments WHERE id = 'ia_test'`).catch(() => 0);
  await base?.$disconnect();
});

test("en borrador se edita todo, partidas incluidas", async () => {
  await sql(`UPDATE implementation_quotes SET "proposedPriceCents" = 59000, deliverables = 'x' WHERE id = 'iq_test'`);
  await sql(`INSERT INTO implementation_quote_items (id, "quoteId", category, description, hours, "hourlyCostCents") VALUES ('ii_1', 'iq_test', 'AGENT', 'Agente', 20, 2000)`);
  await sql(`UPDATE implementation_quote_items SET hours = 21 WHERE id = 'ii_1'`);
  assert.equal((await rows(`SELECT hours FROM implementation_quote_items WHERE id = 'ii_1'`))[0].hours.toString(), "21");
});

test("fuera de borrador solo cambia el estado; los importes, textos y partidas no", async () => {
  await sql(`UPDATE implementation_quotes SET status = 'READY_FOR_REVIEW' WHERE id = 'iq_test'`);
  await fails(`UPDATE implementation_quotes SET "proposedPriceCents" = 1 WHERE id = 'iq_test'`, /ya no está en borrador/);
  await fails(`UPDATE implementation_quotes SET deliverables = 'otro' WHERE id = 'iq_test'`, /ya no está en borrador/);
  await fails(`UPDATE implementation_quotes SET "targetMarginBp" = 0 WHERE id = 'iq_test'`, /ya no está en borrador/);
  await fails(`INSERT INTO implementation_quote_items (id, "quoteId", category, description) VALUES ('ii_2', 'iq_test', 'QA', 'Pruebas')`, /ya no está en borrador/);
  await fails(`UPDATE implementation_quote_items SET hours = 1 WHERE id = 'ii_1'`, /ya no está en borrador/);
  await fails(`DELETE FROM implementation_quote_items WHERE id = 'ii_1'`, /ya no está en borrador/);
  // Volver a borrador sí, y entonces se edita otra vez.
  await sql(`UPDATE implementation_quotes SET status = 'DRAFT' WHERE id = 'iq_test'`);
  await sql(`UPDATE implementation_quotes SET "proposedPriceCents" = 80000 WHERE id = 'iq_test'`);
  await sql(`UPDATE implementation_quotes SET status = 'READY_FOR_REVIEW' WHERE id = 'iq_test'`);
});

test("la aprobación y su snapshot no se reescriben; un estado final no se mueve", async () => {
  await sql(`UPDATE implementation_quotes SET status = 'APPROVED', "approvedBy" = 'ops@test', "approvedAt" = now(), "approvedSnapshot" = '{"v":1}' WHERE id = 'iq_test'`);
  await fails(`UPDATE implementation_quotes SET "approvedSnapshot" = '{"v":2}' WHERE id = 'iq_test'`, /no se modifica/);
  await fails(`UPDATE implementation_quotes SET "approvedBy" = 'otro' WHERE id = 'iq_test'`, /no se reescribe/);
  await fails(`UPDATE implementation_quotes SET "exceptionReason" = 'inventado' WHERE id = 'iq_test'`, /no se reescribe/);
  await sql(`UPDATE implementation_quotes SET status = 'SENT', "sentAt" = now() WHERE id = 'iq_test'`);
  await sql(`UPDATE implementation_quotes SET status = 'ACCEPTED', "acceptedAt" = now() WHERE id = 'iq_test'`);
  await fails(`UPDATE implementation_quotes SET status = 'DRAFT' WHERE id = 'iq_test'`, /estado final/);
  await fails(`UPDATE implementation_quotes SET status = 'SENT' WHERE id = 'iq_test'`, /estado final/);
  // Lo que sí: enlazar la versión que la sustituye.
  await sql(`UPDATE implementation_quotes SET "supersededById" = 'otra' WHERE id = 'iq_test'`);
});

test("las horas reales se registran y borrar el diagnóstico arrastra todo en cascada", async () => {
  await sql(`INSERT INTO implementation_actuals (id, "quoteId", category, description, hours, "hourlyCostCents", "costCents", "workedOn", "createdBy") VALUES ('ix_1', 'iq_test', 'AGENT', 'Prompt', 25, 2000, 5000, '2026-11-10', 'ops@test')`);
  await fails(`INSERT INTO implementation_actuals (id, "quoteId", category, description, hours, "workedOn", "createdBy") VALUES ('ix_2', 'iq_test', 'AGENT', 'Mal', -1, '2026-11-10', 'ops@test')`, /nonneg/);
  await sql(`DELETE FROM implementation_assessments WHERE id = 'ia_test'`);
  assert.equal((await rows(`SELECT count(*)::int AS n FROM implementation_quote_items WHERE id = 'ii_1'`))[0].n, 0, "las partidas se fueron con la versión aunque no estuviera en borrador");
  assert.equal((await rows(`SELECT count(*)::int AS n FROM implementation_actuals WHERE id = 'ix_1'`))[0].n, 0);
});
