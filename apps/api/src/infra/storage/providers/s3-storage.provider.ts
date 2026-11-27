import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { ReadFile, StorageHealth, StorageProvider, StoredFile } from "../storage.provider";
import type { LocalStorageProvider } from "./local-storage.provider";
import { explainStoreError, type ObjectStore } from "./s3-object-store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cada cuánto se vuelve a comprobar el almacén para la consola. */
const PROBE_TTL_MS = 60_000;
/** Un fallo al guardar se sigue enseñando en la consola durante este tiempo. */
const ERROR_SHOWN_MS = 24 * 60 * 60 * 1000;
/** Fallos seguidos a partir de los cuales se deja de intentar el almacén un rato… */
const FAILURES_TO_PAUSE = 3;
/** …y cuánto dura ese rato. Después se vuelve a probar. */
const PAUSE_MS = 20_000;
/** Como mucho, una línea de error en el registro cada tanto. */
const LOG_EVERY_MS = 30_000;
/** Un objeto que nunca existe: pedirlo dice si las claves y el bucket sirven, sin escribir nada. */
const PROBE_ID = "00000000-0000-0000-0000-000000000000";

/** El nombre del archivo, para los metadatos del objeto: solo admiten ASCII y poco más de 1 KB. */
export function encodeName(name: string): string {
  let n = name.slice(0, 255);
  while (encodeURIComponent(n).length > 1024) n = n.slice(0, Math.floor(n.length * 0.8));
  return encodeURIComponent(n);
}

export function decodeName(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Guarda los ficheros en un almacén compatible con S3 (Cloudflare R2, Amazon
 * S3…), con el disco del servidor de respaldo:
 *
 * - Lo nuevo va al almacén. Si el almacén falla, se guarda en el disco: un
 *   archivo que manda un cliente no se pierde por una clave caducada o un corte.
 * - Al leer, primero el almacén y después el disco. Así lo que había antes del
 *   cambio se sigue viendo sin esperar al traslado (`storage migrate`), y lo
 *   que cayó al disco en un fallo también.
 * - Tras varios fallos seguidos deja de intentar el almacén unos segundos, para
 *   que un corte no cuelgue cada foto de la bandeja.
 *
 * El id es un UUID generado aquí, igual que en el disco: las referencias
 * `storage://…` guardadas en la base valen para los dos.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly logger = new Logger("Storage");
  private lastError: { at: number; text: string } | null = null;
  private probe: { at: number; error: string | null } | null = null;

  constructor(
    private readonly store: ObjectStore,
    private readonly local: LocalStorageProvider,
    /** `prefix`: carpeta dentro del bucket ("" o «media/»). `target`: «Cloudflare R2 · driony-media». */
    private readonly opts: { prefix: string; target: string },
  ) {}

  private key(id: string): string {
    return `${this.opts.prefix}${id}`;
  }

  /** El reloj, aparte para poder moverlo en las pruebas. */
  private clock: () => number = () => Date.now();
  private failures = 0;
  private pausedUntil = 0;
  private loggedAt = 0;
  private unlogged = 0;

  /**
   * Con el almacén caído, cada intento espera a que la red se rinda. Tras
   * varios fallos seguidos se deja de intentar un rato y se va directo al
   * disco: la bandeja no se queda colgada por cada foto.
   */
  private get paused(): boolean {
    return this.clock() < this.pausedUntil;
  }

  private worked(): void {
    this.failures = 0;
  }

  private failed(what: string, e: unknown): string {
    const text = explainStoreError(e);
    const now = this.clock();
    this.lastError = { at: now, text };
    this.probe = null;
    if (++this.failures >= FAILURES_TO_PAUSE) this.pausedUntil = now + PAUSE_MS;
    // En un corte fallan todas las lecturas: una línea cada medio minuto basta.
    if (now - this.loggedAt >= LOG_EVERY_MS) {
      this.logger.error(`No se pudo ${what} en ${this.opts.target}: ${text}${this.unlogged ? ` (y ${this.unlogged} fallos más desde el último aviso)` : ""}`);
      this.loggedAt = now;
      this.unlogged = 0;
    } else this.unlogged++;
    return text;
  }

  async save(buffer: Buffer, mimeType: string, originalName: string): Promise<StoredFile> {
    if (!this.paused) {
      const id = randomUUID();
      try {
        await this.store.put(this.key(id), buffer, mimeType, { name: encodeName(originalName) });
        this.worked();
        return { id, mimeType, size: buffer.length };
      } catch (e) {
        this.failed("guardar un archivo", e);
      }
    }
    // No se pierde: queda en el disco, se sigue leyendo y «storage migrate» lo sube cuando el almacén vuelva.
    return this.local.save(buffer, mimeType, originalName);
  }

  async read(id: string): Promise<ReadFile | null> {
    if (!UUID_RE.test(id)) return null;
    if (!this.paused) {
      try {
        const obj = await this.store.get(this.key(id));
        this.worked();
        if (obj) {
          return { buffer: obj.body, mimeType: obj.contentType ?? "application/octet-stream", size: obj.body.length, fileName: decodeName(obj.metadata.name) ?? id };
        }
      } catch (e) {
        this.failed("leer un archivo", e);
      }
    }
    return this.local.read(id);
  }

  async remove(id: string): Promise<void> {
    if (!UUID_RE.test(id)) return;
    await Promise.all([
      this.store.delete(this.key(id)).catch((e) => void this.failed("borrar un archivo", e)),
      this.local.remove(id),
    ]);
  }

  /** Lo que ocupa ese fichero en el almacén, o null si no está. Lanza si el almacén falla. */
  async sizeOf(id: string): Promise<number | null> {
    return (await this.store.head(this.key(id)))?.size ?? null;
  }

  /** Sube un fichero que ya tiene id (el traslado desde el disco). Lanza si el almacén falla. */
  async put(id: string, file: ReadFile): Promise<void> {
    if (!UUID_RE.test(id)) throw new Error(`«${id}» no es un id de archivo`);
    await this.store.put(this.key(id), file.buffer, file.mimeType, { name: encodeName(file.fileName) });
  }

  /**
   * ¿Responden las claves y el bucket? null = sí; si no, el motivo. No escribe
   * nada: pide un objeto que no existe (con GET, que sí dice si lo que falta es el bucket).
   */
  async check(): Promise<string | null> {
    try {
      await this.store.get(this.key(PROBE_ID));
      return null;
    } catch (e) {
      return explainStoreError(e);
    }
  }

  async health(): Promise<StorageHealth> {
    if (!this.probe || Date.now() - this.probe.at > PROBE_TTL_MS) this.probe = { at: Date.now(), error: await this.check() };
    const onDisk = await this.local.ids().then((ids) => ids.length).catch(() => null);
    const recent = this.lastError && Date.now() - this.lastError.at < ERROR_SHOWN_MS ? this.lastError : null;
    let detail = this.probe.error;
    if (!detail && recent) {
      const when = new Date(recent.at).toISOString().slice(0, 16).replace("T", " ");
      detail = `Ahora responde, pero falló el ${when} UTC: ${recent.text}. Lo que no se pudo guardar quedó en el disco.`;
    }
    return { kind: "s3", target: this.opts.target, ok: !this.probe.error, detail, onDisk };
  }
}
