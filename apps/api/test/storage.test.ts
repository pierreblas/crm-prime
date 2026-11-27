/**
 * El almacén de archivos: la configuración de R2/S3 y lo que se dice cuando
 * falta algo, el respaldo en el disco cuando el almacén falla, la lectura de lo
 * que había antes del cambio y el traslado del disco al almacén.
 *
 * El almacén de objetos es uno en memoria. Al final, la librería de S3 de
 * verdad contra un servidor que se levanta dentro de la propia prueba: lo que
 * se manda, lo que se entiende de cada respuesta y cómo se dicen los fallos.
 *
 *   npm run test:storage --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Logger } from "@nestjs/common";
import { describeConfig, storageConfig, StorageConfigError } from "../src/infra/storage/storage.config";
import { humanBytes, migrateToBucket } from "../src/infra/storage/storage.migrate";
import { createStorage, s3Storage } from "../src/infra/storage/storage.module";
import { LocalStorageProvider } from "../src/infra/storage/providers/local-storage.provider";
import { explainStoreError, S3ObjectStore, type ObjectStore, type StoredObject } from "../src/infra/storage/providers/s3-object-store";
import { decodeName, encodeName, S3StorageProvider } from "../src/infra/storage/providers/s3-storage.provider";

// Los fallos que aquí se provocan a propósito no tienen que llenar la salida.
Logger.overrideLogger(false);

const R2 = {
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  S3_BUCKET: "driony-media",
  S3_ACCESS_KEY_ID: "AKIDEJEMPLO1234567890abcd",
  S3_SECRET_ACCESS_KEY: "secreto-de-ejemplo-que-nunca-se-imprime",
};

/** Un almacén de objetos en memoria, al que se le puede decir que falle. */
class MemoryStore implements ObjectStore {
  objects = new Map<string, StoredObject>();
  down = false;
  /** Las claves que fallan al guardar. */
  failPut = new Set<string>();
  /** Devuelve un tamaño falso al preguntar por estas claves. */
  wrongSize = new Set<string>();
  calls: string[] = [];

  private guard(op: string, key: string): void {
    this.calls.push(`${op} ${key}`);
    if (this.down) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  }
  async put(key: string, body: Buffer, contentType: string, metadata: Record<string, string>): Promise<void> {
    this.guard("put", key);
    if (this.failPut.has(key)) throw Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    this.objects.set(key, { body, contentType, metadata });
  }
  async get(key: string): Promise<StoredObject | null> {
    this.guard("get", key);
    return this.objects.get(key) ?? null;
  }
  async head(key: string): Promise<{ size: number } | null> {
    this.guard("head", key);
    const obj = this.objects.get(key);
    return obj ? { size: this.wrongSize.has(key) ? obj.body.length + 1 : obj.body.length } : null;
  }
  async delete(key: string): Promise<void> {
    this.guard("delete", key);
    this.objects.delete(key);
  }
}

function setup(prefix = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "driony-storage-"));
  const local = LocalStorageProvider.at(dir);
  const store = new MemoryStore();
  const s3 = new S3StorageProvider(store, local, { prefix, target: "Cloudflare R2 · driony-media" });
  return { dir, local, store, s3, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

test("sin configurar, los archivos van al disco del servidor", () => {
  assert.deepEqual(storageConfig({}), { driver: "local" });
  assert.deepEqual(storageConfig({ STORAGE_DRIVER: "local" }), { driver: "local" });
  // Unas claves sueltas no cambian nada: el cambio se enciende con STORAGE_DRIVER.
  assert.deepEqual(storageConfig({ ...R2, STORAGE_DRIVER: "" }), { driver: "local" });
});

test("la configuración de R2 se lee y se ordena", () => {
  const c = storageConfig(R2);
  assert.deepEqual(c, {
    driver: "s3",
    endpoint: R2.S3_ENDPOINT,
    region: "auto",
    bucket: "driony-media",
    accessKeyId: R2.S3_ACCESS_KEY_ID,
    secretAccessKey: R2.S3_SECRET_ACCESS_KEY,
    prefix: "",
    forcePathStyle: true,
    label: "Cloudflare R2",
  });
  // Como la enseña Cloudflare (con el bucket al final), con barra, entre comillas o sin https: vale igual.
  for (const endpoint of [`${R2.S3_ENDPOINT}/driony-media`, `${R2.S3_ENDPOINT}/`, `"${R2.S3_ENDPOINT}"`, R2.S3_ENDPOINT.replace("https://", "")]) {
    const got = storageConfig({ ...R2, S3_ENDPOINT: endpoint, STORAGE_DRIVER: "R2" });
    assert.equal(got.driver === "s3" && got.endpoint, R2.S3_ENDPOINT, endpoint);
  }
  const eu = storageConfig({ ...R2, S3_ENDPOINT: "https://abc123.eu.r2.cloudflarestorage.com", S3_PREFIX: "/media/prod/" });
  assert.equal(eu.driver === "s3" && eu.label, "Cloudflare R2");
  assert.equal(eu.driver === "s3" && eu.prefix, "media/prod/");
});

test("Amazon S3 y un servidor propio también valen", () => {
  const aws = storageConfig({ STORAGE_DRIVER: "s3", S3_REGION: "us-east-1", S3_BUCKET: "mi-bucket", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "b" });
  assert.equal(aws.driver === "s3" && aws.endpoint, null);
  assert.equal(aws.driver === "s3" && aws.label, "Amazon S3");
  assert.equal(aws.driver === "s3" && aws.forcePathStyle, false);
  const minio = storageConfig({ ...R2, S3_ENDPOINT: "http://minio:9000" });
  assert.equal(minio.driver === "s3" && minio.endpoint, "http://minio:9000");
  assert.equal(minio.driver === "s3" && minio.label, "minio");
  const local = storageConfig({ ...R2, S3_ENDPOINT: "http://localhost:9391", S3_FORCE_PATH_STYLE: "false" });
  assert.equal(local.driver === "s3" && local.forcePathStyle, false);
});

test("lo que falta se dice todo de una vez, sin enseñar la clave", () => {
  const problems = (env: Record<string, string>): string[] => {
    try {
      storageConfig(env);
      return [];
    } catch (e) {
      assert.ok(e instanceof StorageConfigError);
      assert.match(e.message, /^La configuración del almacén de archivos no sirve:/);
      return e.problems;
    }
  };
  const empty = problems({ STORAGE_DRIVER: "s3" });
  assert.equal(empty.length, 4);
  assert.match(empty.join("\n"), /falta S3_BUCKET/);
  assert.match(empty.join("\n"), /falta S3_ACCESS_KEY_ID/);
  assert.match(empty.join("\n"), /falta S3_SECRET_ACCESS_KEY/);
  assert.match(empty.join("\n"), /falta S3_ENDPOINT: en R2 es https:\/\/<cuenta>\.r2\.cloudflarestorage\.com/);

  assert.match(problems({ STORAGE_DRIVER: "bunny" })[0]!, /«bunny» no existe/);
  assert.match(problems({ ...R2, S3_BUCKET: "Mi Bucket" })[0]!, /no es un nombre de bucket/);
  assert.match(problems({ ...R2, S3_ENDPOINT: "http://cdn.ejemplo.com" })[0]!, /tiene que ser https/);
  assert.match(problems({ ...R2, S3_ENDPOINT: `${R2.S3_ENDPOINT}/otro-bucket` })[0]!, /sobra «\/otro-bucket»/);
  assert.match(problems({ ...R2, S3_ENDPOINT: "https://<cuenta>.r2.cloudflarestorage.com" })[0]!, /S3_ENDPOINT/);
  assert.match(problems({ ...R2, S3_PREFIX: "mis archivos" })[0]!, /S3_PREFIX/);

  const shown = describeConfig(storageConfig(R2)).join("\n");
  assert.match(shown, /Almacén: Cloudflare R2/);
  assert.match(shown, /Bucket: driony-media/);
  assert.match(shown, /Access Key ID: •{8}abcd/);
  assert.ok(!shown.includes(R2.S3_SECRET_ACCESS_KEY), "la clave secreta no se enseña");
  assert.ok(!shown.includes(R2.S3_ACCESS_KEY_ID), "el identificador de la clave no se enseña entero");
  assert.match(describeConfig({ driver: "local" })[0]!, /el disco del servidor/);
});

test("el nombre del archivo viaja en los metadatos, que solo admiten ASCII", () => {
  for (const name of ["Brochure Power BI — edición 2026.pdf", "comprobante 💸.jpg", "niño & niña (1).png", ""]) {
    const encoded = encodeName(name);
    assert.match(encoded, /^[\x20-\x7e]*$/, "solo ASCII");
    assert.equal(decodeName(encoded) ?? "", name);
  }
  const long = encodeName("ñ".repeat(900));
  assert.ok(long.length <= 1024, `cabe en los metadatos (${long.length})`);
  assert.match(decodeName(long)!, /^ñ+$/, "se acorta sin romper una letra");
  assert.equal(decodeName(undefined), null);
  assert.equal(decodeName("%E0%A4%A"), "%E0%A4%A", "algo mal codificado se devuelve tal cual");
});

test("guardar, leer y borrar en el almacén", async () => {
  const t = setup("media/");
  try {
    const saved = await t.s3.save(PNG, "image/png", "captura ñ.png");
    assert.match(saved.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ mimeType: saved.mimeType, size: saved.size }, { mimeType: "image/png", size: 8 });
    assert.deepEqual([...t.store.objects.keys()], [`media/${saved.id}`], "va a la carpeta del bucket");
    assert.deepEqual(readdirSync(t.dir), [], "nada en el disco");

    const file = await t.s3.read(saved.id);
    assert.ok(file);
    assert.ok(file.buffer.equals(PNG));
    assert.deepEqual({ mimeType: file.mimeType, size: file.size, fileName: file.fileName }, { mimeType: "image/png", size: 8, fileName: "captura ñ.png" });

    await t.s3.remove(saved.id);
    assert.equal(t.store.objects.size, 0);
    assert.equal(await t.s3.read(saved.id), null);
  } finally {
    t.cleanup();
  }
});

test("si el almacén falla al guardar, el archivo va al disco y se sigue leyendo", async () => {
  const t = setup();
  try {
    t.store.down = true;
    const saved = await t.s3.save(PNG, "image/png", "comprobante.png");
    assert.equal(t.store.objects.size, 0);
    assert.deepEqual(await t.local.ids(), [saved.id], "quedó en el disco");
    const file = await t.s3.read(saved.id);
    assert.ok(file?.buffer.equals(PNG), "se lee aunque el almacén siga caído");
    assert.equal(file?.fileName, "comprobante.png");

    const down = await t.s3.health();
    assert.deepEqual({ kind: down.kind, target: down.target, ok: down.ok, onDisk: down.onDisk }, { kind: "s3", target: "Cloudflare R2 · driony-media", ok: false, onDisk: 1 });
    assert.match(down.detail!, /no responde/);

    // Vuelve: la consola dice que responde, y que hubo un fallo y dónde quedó el archivo.
    t.store.down = false;
    (t.s3 as unknown as { probe: null }).probe = null;
    const back = await t.s3.health();
    assert.equal(back.ok, true);
    assert.match(back.detail!, /Ahora responde, pero falló el .* UTC: El servidor del almacén no responde\. Lo que no se pudo guardar quedó en el disco\./);
    assert.equal(back.onDisk, 1);
  } finally {
    t.cleanup();
  }
});

test("lo que había en el disco antes del cambio se sigue leyendo y borrando", async () => {
  const t = setup();
  try {
    const old = await t.local.save(PNG, "image/png", "de-antes.png");
    const file = await t.s3.read(old.id);
    assert.ok(file?.buffer.equals(PNG));
    assert.equal(file?.fileName, "de-antes.png");

    // Con el almacén caído también: primero lo intenta, luego el disco.
    t.store.down = true;
    assert.ok((await t.s3.read(old.id))?.buffer.equals(PNG));
    t.store.down = false;

    assert.equal(await t.s3.read("11111111-2222-3333-4444-555555555555"), null, "lo que no está en ningún sitio");
    t.store.calls = [];
    assert.equal(await t.s3.read("../../etc/passwd"), null);
    await t.s3.remove("no-es-un-id");
    assert.deepEqual(t.store.calls, [], "un id que no lo es ni se pregunta");

    await t.s3.remove(old.id);
    assert.deepEqual(await t.local.ids(), []);
  } finally {
    t.cleanup();
  }
});

test("la comprobación dice por qué no responde, con palabras", async () => {
  const t = setup();
  try {
    assert.equal(await t.s3.check(), null);
    assert.deepEqual(t.store.calls, ["get 00000000-0000-0000-0000-000000000000"], "comprobar no escribe nada");
    t.store.down = true;
    assert.equal(await t.s3.check(), "El servidor del almacén no responde");
  } finally {
    t.cleanup();
  }
  const err = (name: string, status?: number, code?: string) => Object.assign(new Error("x"), { name, code, $metadata: { httpStatusCode: status } });
  assert.match(explainStoreError(err("InvalidAccessKeyId", 403)), /Las claves no sirven/);
  assert.match(explainStoreError(err("SignatureDoesNotMatch", 403)), /Las claves no sirven/);
  assert.match(explainStoreError(err("AccessDenied", 403)), /«Object Read & Write»/);
  assert.match(explainStoreError(err("NoSuchBucket", 404)), /Ese bucket no existe/);
  assert.match(explainStoreError(err("Error", undefined, "ENOTFOUND")), /revisa S3_ENDPOINT/);
  assert.equal(explainStoreError(new Error("otra cosa")), "Error: otra cosa");
});

test("el traslado sube lo del disco, no repite y solo borra lo comprobado", async () => {
  const t = setup("media/");
  try {
    const a = await t.local.save(Buffer.from("uno"), "text/plain", "uno.txt");
    const b = await t.local.save(Buffer.from("dos dos"), "audio/ogg", "nota de voz.ogg");
    const c = await t.local.save(PNG, "image/png", "tres.png");
    // Uno ya estaba arriba (de un traslado anterior).
    await t.s3.put(b.id, (await t.local.read(b.id))!);

    const progress: string[] = [];
    const first = await migrateToBucket(t.local, t.s3, { onProgress: (done, total) => progress.push(`${done}/${total}`) });
    assert.deepEqual(first, { total: 3, copied: 2, already: 1, deleted: 0, bytes: 3 + 8, failed: [] });
    assert.deepEqual(progress, ["1/3", "2/3", "3/3"]);
    assert.equal((await t.local.ids()).length, 3, "sin pedirlo, no borra nada del disco");
    assert.deepEqual([...t.store.objects.keys()].sort(), [a.id, b.id, c.id].map((id) => `media/${id}`).sort());
    assert.equal(decodeName(t.store.objects.get(`media/${b.id}`)!.metadata.name), "nota de voz.ogg");
    assert.equal(t.store.objects.get(`media/${b.id}`)!.contentType, "audio/ogg");

    // Repetirlo no vuelve a subir nada.
    t.store.calls = [];
    const again = await migrateToBucket(t.local, t.s3);
    assert.deepEqual({ copied: again.copied, already: again.already }, { copied: 0, already: 3 });
    assert.ok(!t.store.calls.some((c2) => c2.startsWith("put ")), "ningún envío");

    // Borrando del disco: solo lo que el almacén devuelve con su tamaño.
    t.store.objects.delete(`media/${c.id}`);
    t.store.failPut.add(`media/${c.id}`);
    const withDelete = await migrateToBucket(t.local, t.s3, { deleteLocal: true });
    assert.deepEqual({ already: withDelete.already, copied: withDelete.copied, deleted: withDelete.deleted }, { already: 2, copied: 0, deleted: 2 });
    assert.equal(withDelete.failed.length, 1);
    assert.equal(withDelete.failed[0]!.id, c.id);
    assert.match(withDelete.failed[0]!.error, /«Object Read & Write»/);
    assert.deepEqual(await t.local.ids(), [c.id], "el que falló sigue en el disco");
    assert.ok((await t.s3.read(c.id))?.buffer.equals(PNG), "y se sigue leyendo");
    assert.equal((await t.s3.read(a.id))?.fileName, "uno.txt", "lo borrado del disco se lee del almacén");
  } finally {
    t.cleanup();
  }
});

test("un archivo que el almacén no devuelve igual no se da por subido", async () => {
  const t = setup();
  try {
    const a = await t.local.save(Buffer.from("contenido"), "text/plain", "a.txt");
    t.store.wrongSize.add(a.id);
    const r = await migrateToBucket(t.local, t.s3, { deleteLocal: true });
    assert.deepEqual({ copied: r.copied, deleted: r.deleted, failed: r.failed.length }, { copied: 0, deleted: 0, failed: 1 });
    assert.match(r.failed[0]!.error, /no lo devuelve con el mismo tamaño/);
    assert.deepEqual(await t.local.ids(), [a.id]);

    // Un fichero del disco sin su contenido tampoco tumba el traslado.
    const dir2 = setup();
    writeFileSync(path.join(dir2.dir, "11111111-2222-3333-4444-555555555555.json"), JSON.stringify({ mimeType: "x/y", size: 3, originalName: "roto" }));
    const broken = await migrateToBucket(dir2.local, dir2.s3);
    assert.equal(broken.failed.length, 1);
    assert.match(broken.failed[0]!.error, /no se pudo leer del disco/);
    dir2.cleanup();

    const empty = setup();
    assert.deepEqual(await migrateToBucket(empty.local, empty.s3), { total: 0, copied: 0, already: 0, deleted: 0, bytes: 0, failed: [] });
    empty.cleanup();
  } finally {
    t.cleanup();
  }
});

test("el disco: cuenta sus archivos y dice cómo está", async () => {
  const t = setup();
  try {
    assert.deepEqual(await t.local.health(), { kind: "local", target: "El disco del servidor", ok: true, detail: null, onDisk: 0 });
    await t.local.save(PNG, "image/png", "a.png");
    writeFileSync(path.join(t.dir, "otra-cosa.json"), "{}");
    assert.equal((await t.local.health()).onDisk, 1, "solo cuenta lo que es un archivo guardado");
  } finally {
    t.cleanup();
  }
});

test("una configuración a medias no tumba el CRM: sigue en el disco y lo dice", async () => {
  const t = setup();
  try {
    assert.equal(createStorage(t.local, {}), t.local, "sin configurar, el disco");
    assert.equal(t.local.notice, null);

    const chosen = createStorage(t.local, { STORAGE_DRIVER: "s3", S3_BUCKET: "driony-media" });
    assert.equal(chosen, t.local);
    const health = await chosen.health();
    assert.equal(health.ok, false);
    assert.match(health.detail!, /La configuración del almacén de archivos no sirve: falta S3_ACCESS_KEY_ID/);
    assert.match(health.detail!, /Mientras tanto se usa el disco del servidor\.$/);
    // Y guardar sigue funcionando.
    assert.ok((await chosen.save(PNG, "image/png", "a.png")).id);
  } finally {
    t.cleanup();
  }
});

test("los tamaños, dichos para una persona", () => {
  assert.equal(humanBytes(0), "0 B");
  assert.equal(humanBytes(900), "900 B");
  assert.equal(humanBytes(1536), "1,5 KB");
  assert.equal(humanBytes(5 * 1024 * 1024), "5,0 MB");
  assert.equal(humanBytes(3.2 * 1024 ** 3), "3,2 GB");
});

test("con el almacén caído no se insiste en cada archivo: un rato directo al disco, y después se vuelve a probar", async () => {
  const t = setup();
  try {
    let now = 1_000_000;
    (t.s3 as unknown as { clock: () => number }).clock = () => now;
    const old = await t.local.save(PNG, "image/png", "de-antes.png");

    t.store.down = true;
    for (let i = 0; i < 3; i++) assert.ok(await t.s3.read(old.id), "se lee del disco aunque el almacén falle");
    assert.equal(t.store.calls.length, 3, "tres intentos, tres fallos");

    // En pausa: ni leer ni guardar esperan al almacén.
    assert.ok(await t.s3.read(old.id));
    const kept = await t.s3.save(PNG, "image/png", "durante-el-corte.png");
    assert.equal(t.store.calls.length, 3, "en la pausa no se llama al almacén");
    assert.deepEqual((await t.local.ids()).sort(), [old.id, kept.id].sort(), "lo nuevo quedó en el disco");

    // Pasa el rato y el almacén volvió: se vuelve a usar.
    now += 21_000;
    t.store.down = false;
    const fresh = await t.s3.save(PNG, "image/png", "despues.png");
    assert.ok(t.store.objects.has(fresh.id));
    assert.ok((await t.s3.read(fresh.id))?.buffer.equals(PNG));

    // Un fallo suelto no pausa nada.
    t.store.down = true;
    await t.s3.read(old.id);
    t.store.down = false;
    const before = t.store.calls.length;
    await t.s3.read(fresh.id);
    assert.equal(t.store.calls.length, before + 1);
  } finally {
    t.cleanup();
  }
});

// ── La librería de S3, contra un servidor de mentira que habla su idioma ──

interface Seen {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
}

/** Lo justo de S3 (con el bucket en la ruta): guardar, leer, preguntar y borrar, y sus errores en XML. */
async function fakeS3(bucket: string, accessKeyId: string) {
  const objects = new Map<string, { body: Buffer; type: string; meta: Record<string, string> }>();
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const { pathname } = new URL(req.url ?? "/", "http://x");
      const [, b, ...rest] = pathname.split("/");
      const key = decodeURIComponent(rest.join("/"));
      const head = req.method === "HEAD";
      seen.push({ method: req.method ?? "", path: pathname, headers: req.headers });
      const fail = (status: number, code: string): void => {
        res.writeHead(status, { "content-type": "application/xml" });
        res.end(head ? undefined : `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
      };
      if (!String(req.headers.authorization ?? "").includes(`Credential=${accessKeyId}/`)) return fail(403, "InvalidAccessKeyId");
      if (b !== bucket) return fail(404, "NoSuchBucket");
      if (req.method === "PUT") {
        const meta = Object.fromEntries(
          Object.entries(req.headers)
            .filter(([k]) => k.startsWith("x-amz-meta-"))
            .map(([k, v]) => [k, String(v)]),
        );
        objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]), meta });
        res.writeHead(200, { etag: '"etag"' });
        return res.end();
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      const obj = objects.get(key);
      if (!obj) return fail(404, "NoSuchKey");
      res.writeHead(200, { "content-type": obj.type, "content-length": obj.body.length, etag: '"etag"', ...obj.meta });
      res.end(head ? undefined : obj.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    objects,
    seen,
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test("la librería de S3: lo que manda, lo que entiende y cómo dice los fallos", async () => {
  const fake = await fakeS3("driony-media", "CLAVE-BUENA");
  const dir = mkdtempSync(path.join(tmpdir(), "driony-storage-"));
  try {
    const config = storageConfig({ STORAGE_DRIVER: "s3", S3_ENDPOINT: fake.endpoint, S3_BUCKET: "driony-media", S3_ACCESS_KEY_ID: "CLAVE-BUENA", S3_SECRET_ACCESS_KEY: "secreto", S3_PREFIX: "media" });
    assert.ok(config.driver === "s3");
    const store = new S3ObjectStore(config);
    const bytes = Buffer.from([0, 1, 2, 10, 13, 250, 251, 252, 253, 254, 255]);
    const name = "nota de voz ñ 💬.ogg";

    await store.put("media/abc", bytes, "audio/ogg", { name: encodeName(name) });
    const put = fake.seen.at(-1)!;
    assert.deepEqual({ method: put.method, path: put.path }, { method: "PUT", path: "/driony-media/media/abc" }, "el bucket va en la ruta");
    assert.equal(put.headers["content-type"], "audio/ogg");
    assert.equal(put.headers["content-length"], String(bytes.length));
    assert.equal(put.headers["x-amz-meta-name"], encodeName(name));
    assert.match(String(put.headers.authorization), /^AWS4-HMAC-SHA256 Credential=CLAVE-BUENA\/\d{8}\/auto\/s3\/aws4_request/);
    assert.ok(!String(put.headers.authorization).includes("secreto"), "la clave secreta firma, no viaja");
    // Sin el envío por trozos con la suma al final: no todos los servicios compatibles lo aceptan.
    assert.notEqual(put.headers["content-encoding"], "aws-chunked");
    assert.ok(!String(put.headers["x-amz-content-sha256"] ?? "").startsWith("STREAMING"));
    assert.equal(put.headers["x-amz-trailer"], undefined);
    assert.ok(fake.objects.get("media/abc")!.body.equals(bytes), "los bytes llegan intactos");

    const got = await store.get("media/abc");
    assert.ok(got?.body.equals(bytes));
    assert.equal(got?.contentType, "audio/ogg");
    assert.equal(decodeName(got?.metadata.name), name);
    assert.deepEqual(await store.head("media/abc"), { size: bytes.length });
    assert.equal(await store.get("media/no-existe"), null);
    assert.equal(await store.head("media/no-existe"), null);
    await store.delete("media/abc");
    assert.equal(fake.objects.size, 0);
    await store.delete("media/abc"); // borrar lo que no está no falla

    // El proveedor entero encima: guarda en la carpeta del bucket y lo lee de vuelta.
    const local = LocalStorageProvider.at(dir);
    const provider = s3Storage(config, local);
    assert.equal(await provider.check(), null);
    const saved = await provider.save(PNG, "image/png", "foto ñ.png");
    assert.deepEqual([...fake.objects.keys()], [`media/${saved.id}`]);
    const file = await provider.read(saved.id);
    assert.ok(file?.buffer.equals(PNG));
    assert.deepEqual({ mimeType: file?.mimeType, fileName: file?.fileName }, { mimeType: "image/png", fileName: "foto ñ.png" });
    assert.equal(await provider.sizeOf(saved.id), PNG.length);
    assert.deepEqual(await local.ids(), []);

    // Unas claves que no son y un bucket que no existe se dicen con palabras…
    const badKey = s3Storage({ ...config, accessKeyId: "OTRA-CLAVE" }, local);
    assert.match((await badKey.check())!, /^Las claves no sirven: revisa S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY/);
    const badBucket = s3Storage({ ...config, bucket: "otro-bucket" }, local);
    assert.match((await badBucket.check())!, /^Ese bucket no existe en la cuenta/);
    // …y lo que se guarde mientras tanto no se pierde: va al disco.
    const kept = await badKey.save(PNG, "image/png", "comprobante.png");
    assert.deepEqual(await local.ids(), [kept.id]);
    assert.ok((await badKey.read(kept.id))?.buffer.equals(PNG));
    assert.equal(fake.objects.size, 1, "en el almacén no entró");
  } finally {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
