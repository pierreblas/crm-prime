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

test("en los dos temas, cada color de texto se lee a 4,5:1 sobre el fondo y sobre el panel", () => {
  const css = fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
  const block = (head: string) => css.slice(css.indexOf(head), css.indexOf("\n}\n", css.indexOf(head)));
  const dark = block(":root {");
  const light = block(':root[data-theme="light"] {');
  const token = (b: string, n: string): string => {
    const find = (s: string) => new RegExp(`--${n}: (#[0-9a-f]{6}|var\\(--[a-z-]+\\));`).exec(s)?.[1];
    const v = find(b) ?? find(dark) ?? assert.fail(`falta --${n}`);
    const ref = /^var\(--([a-z-]+)\)$/.exec(v)?.[1];
    return ref ? token(b, ref) : v;
  };
  for (const [name, b] of [["claro", light], ["oscuro", dark]] as const) {
    for (const n of ["text", "muted", "placeholder", "accent-text", "cyan", "positive", "warning", "danger"]) {
      for (const bg of ["panel", "bg"]) {
        const r = ratio(token(b, n), token(b, bg));
        assert.ok(r >= 4.5, `${name}: --${n} sobre --${bg}: ${r.toFixed(2)}`);
      }
    }
    assert.ok(ratio(token(b, "danger-ink"), token(b, "danger")) >= 4.5, `${name}: la tinta sobre rojo`);
  }
  for (const n of ["accent-edge", "field-border"]) assert.ok(ratio(token(light, n), token(light, "panel")) >= 2.8, `--${n}`);
  assert.ok(ratio(token(dark, "noir"), token(dark, "lemon")) > 10, "petróleo sobre lima");
  assert.ok(ratio("#ffffff", token(dark, "noir")) > 12, "blanco sobre petróleo");
});

test("la portada usa los mismos petróleo y lima que el panel, y no vuelve el estilo anterior", () => {
  const read = (f: string) => fs.readFileSync(path.join(SRC, f), "utf8");
  const files = ["app/globals.css", "features/marketing/landing.css", "features/onboarding/setup.css", "app/docs/docs.css"];
  for (const f of files) {
    const css = read(f);
    for (const old of ["#00e5ff", "#0a0b10", "#12141f", "--chamfer", "[ + ]", "text-transform: uppercase"]) assert.ok(!css.includes(old), `${f}: ${old}`);
  }
  assert.match(read("features/marketing/landing.css"), /--accent-ink: #0b3a45;/);
  assert.match(read("app/globals.css"), /--noir: #0b3a45;/);
});

test("nadie usa un color de la marca suelto en estilos: rompería uno de los dos temas", () => {
  const loose = /rgba?\(\s*(?:0\s*,\s*229\s*,\s*255|134\s*,\s*223\s*,\s*226|142\s*,\s*158\s*,\s*175|165\s*,\s*196\s*,\s*199|126\s*,\s*226\s*,\s*168|246\s*,\s*194\s*,\s*116)\s*,/;
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
