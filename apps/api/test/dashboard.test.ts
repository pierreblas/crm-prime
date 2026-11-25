/**
 * Panel: utilidades de fecha y zona horaria (lo que decide qué es "hoy").
 *
 *   npm run test:dashboard --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { localDay, median, safeTimeZone, sourceRow } from "../src/modules/dashboard/dashboard.service";

test("la zona horaria solo acepta nombres IANA válidos", () => {
  assert.equal(safeTimeZone("America/Lima"), "America/Lima");
  assert.equal(safeTimeZone("America/Argentina/Buenos_Aires"), "America/Argentina/Buenos_Aires");
  assert.equal(safeTimeZone("UTC"), "UTC");
  assert.equal(safeTimeZone(undefined), "UTC");
  assert.equal(safeTimeZone("Marte/Olympus"), "UTC", "inexistente");
  assert.equal(safeTimeZone("'; DROP TABLE deals; --"), "UTC", "inyección");
});

test("el día local depende de la zona: las 02:00 UTC aún son ayer en Lima", () => {
  const d = new Date("2026-09-30T02:00:00Z");
  assert.equal(localDay(d, "UTC"), "2026-09-30");
  assert.equal(localDay(d, "America/Lima"), "2026-09-29");
  assert.equal(localDay(d, "Europe/Madrid"), "2026-09-30");
});

test("mediana del tiempo de respuesta", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
});

test("cada fuente del panel sale con su tipo y su color, para pintarle el símbolo", () => {
  assert.deepEqual(
    sourceRow({ id: "s1", name: "Anuncios de Meta", kind: "ad", color: null, n: 12n }),
    { id: "s1", name: "Anuncios de Meta", kind: "ad", color: null, count: 12 },
    "automática de un canal",
  );
  assert.deepEqual(
    sourceRow({ id: "s2", name: "Referidos", kind: null, color: "#7a5cff", n: 3 }),
    { id: "s2", name: "Referidos", kind: null, color: "#7a5cff", count: 3 },
    "creada por la empresa, con el color que eligió",
  );
  assert.deepEqual(
    sourceRow({ id: null, name: "Sin fuente", kind: null, color: null, n: "4" }),
    { id: null, name: "Sin fuente", kind: null, color: null, count: 4 },
    "contactos sin fuente: sin id, y la web no les pone símbolo de fuente",
  );
});
