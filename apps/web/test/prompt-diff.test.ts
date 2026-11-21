import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines } from "../src/features/bots/promptDiff";

test("lo añadido y lo quitado entre dos versiones de las instrucciones, línea a línea", () => {
  const before = ["Eres Lia.", "", "REGLAS", "- Responde corto.", "- Cierra siempre con una pregunta."].join("\n");
  const after = ["Eres Lia.", "", "REGLAS", "- Responde corto.", "- Propón el siguiente paso.", "- Si no sabes algo, dilo."].join("\n");
  assert.deepEqual(diffLines(before, after), [
    { kind: "same", text: "Eres Lia." },
    { kind: "same", text: "" },
    { kind: "same", text: "REGLAS" },
    { kind: "same", text: "- Responde corto." },
    { kind: "removed", text: "- Cierra siempre con una pregunta." },
    { kind: "added", text: "- Propón el siguiente paso." },
    { kind: "added", text: "- Si no sabes algo, dilo." },
  ]);
});

test("sin cambios todo es igual; los saltos de línea de Windows no cuentan como cambio", () => {
  assert.deepEqual(diffLines("a\r\nb", "a\nb"), [
    { kind: "same", text: "a" },
    { kind: "same", text: "b" },
  ]);
  assert.deepEqual(diffLines("", "nueva"), [{ kind: "added", text: "nueva" }]);
  assert.deepEqual(diffLines("vieja", ""), [{ kind: "removed", text: "vieja" }]);
});

test("una línea insertada en medio no marca como cambiado lo que viene después", () => {
  const before = Array.from({ length: 30 }, (_, i) => `línea ${i}`);
  const after = [...before.slice(0, 10), "REGLA NUEVA", ...before.slice(10)];
  const d = diffLines(before.join("\n"), after.join("\n"));
  assert.equal(d.filter((l) => l.kind === "added").length, 1);
  assert.equal(d.filter((l) => l.kind === "removed").length, 0);
  assert.equal(d[10]!.text, "REGLA NUEVA");
});

test("con textos enormes no se cuelga: marca todo como quitado y añadido", () => {
  const big = (p: string) => Array.from({ length: 3000 }, (_, i) => `${p} ${i}`).join("\n");
  const d = diffLines(big("a"), big("b"));
  assert.equal(d.length, 6000);
  assert.equal(d[0]!.kind, "removed");
  assert.equal(d.at(-1)!.kind, "added");
});
