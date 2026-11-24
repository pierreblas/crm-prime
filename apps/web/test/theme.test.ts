/**
 * Claro / Oscuro / Automático: qué tema toca con cada elección, el guion que lo
 * pone antes de pintar, y que nadie vuelva a escribir un color suelto que en
 * uno de los dos no se lea.
 *
 *   npm run test:theme --workspace=apps/web
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { DEFAULT_THEME, nextTheme, serverTheme, THEME_COOKIE, THEME_SCRIPT, themeFrom } from "../src/lib/theme";

const SRC = path.join(__dirname, "..", "src");

test("sin elegir (o con algo raro en la cookie), oscuro: la cara de Driony", () => {
  assert.equal(DEFAULT_THEME, "dark");
  assert.equal(themeFrom(undefined), "dark");
  assert.equal(themeFrom("rosa"), "dark");
  assert.equal(themeFrom("light"), "light");
  assert.equal(themeFrom("auto"), "auto");
  assert.equal(serverTheme("light"), "light");
  assert.equal(serverTheme("dark"), "dark");
  assert.equal(serverTheme("auto"), "dark", "el servidor no conoce el del sistema: lo corrige el guion");
  // Desde oscuro, el primer toque se tiene que notar.
  assert.deepEqual([nextTheme("dark"), nextTheme("light"), nextTheme("auto")], ["light", "auto", "dark"]);
});

test("antes de pintar se pone el tema elegido, también en páginas estáticas y en automático", () => {
  const run = (cookie: string, systemLight: boolean, pref?: string) => {
    const dataset: Record<string, string> = { theme: "dark", ...(pref ? { themePref: pref } : {}) };
    vm.runInNewContext(THEME_SCRIPT, { document: { documentElement: { dataset }, cookie }, matchMedia: () => ({ matches: systemLight }) });
    return [dataset.theme, dataset.themePref];
  };
  assert.deepEqual(run(`locale=es; ${THEME_COOKIE}=light`, false), ["light", "light"]);
  assert.deepEqual(run(`${THEME_COOKIE}=dark; locale=es`, true), ["dark", "dark"]);
  assert.deepEqual(run(`${THEME_COOKIE}=auto`, true), ["light", "auto"]);
  assert.deepEqual(run(`${THEME_COOKIE}=auto`, false), ["dark", "auto"]);
  assert.deepEqual(run("", true), ["dark", "dark"], "sin elegir no sigue al sistema");
  assert.deepEqual(run(`otra_${THEME_COOKIE}=light`, true), ["dark", "dark"], "ni confunde otra cookie");
  assert.doesNotThrow(() => vm.runInNewContext(THEME_SCRIPT, {}), "si algo falta, la página sigue");
});

// ── Contraste de las fichas ────────────────────────────────────
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

test("en claro, cada color de texto se lee a 4,5:1 sobre el papel y sobre el panel", () => {
  const css = fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
  const block = css.slice(css.indexOf(':root[data-theme="light"] {'), css.indexOf("\n}\n", css.indexOf(':root[data-theme="light"] {')));
  const token = (n: string) => new RegExp(`--${n}: (#[0-9a-f]{6});`).exec(block)?.[1] ?? assert.fail(`falta --${n}`);
  for (const n of ["muted", "placeholder", "accent-text", "cyan", "positive", "warning", "danger"]) {
    for (const bg of ["panel", "bg"]) assert.ok(ratio(token(n), token(bg)) >= (n === "placeholder" ? 4.3 : 4.5), `--${n} sobre --${bg}: ${ratio(token(n), token(bg)).toFixed(2)}`);
  }
  for (const n of ["accent-edge", "field-border"]) assert.ok(ratio(token(n), token("panel")) >= 2.8, `--${n}: ${ratio(token(n), token("panel")).toFixed(2)}`);
  assert.ok(ratio("#0a0b10", "#e2f80d") > 15, "tinta noir sobre lima");
  assert.ok(ratio(token("danger-ink"), token("danger")) >= 4.5 || /--danger-ink: #ffffff/.test(block));
});

test("nadie usa un color de la marca suelto en estilos: rompería uno de los dos temas", () => {
  const loose = /rgba?\(\s*(?:0\s*,\s*229\s*,\s*255|226\s*,\s*248\s*,\s*13|142\s*,\s*158\s*,\s*175|126\s*,\s*226\s*,\s*168|240\s*,\s*180\s*,\s*90)\s*,/;
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(css|tsx?)$/.test(e.name)) fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => !/^\s*--/.test(l) && loose.test(l) && bad.push(`${path.relative(SRC, p)}:${i + 1}`));
    }
  };
  walk(SRC);
  assert.deepEqual(bad, [], "usa rgb(var(--cyan-rgb) / 0.1) y compañía");
});
