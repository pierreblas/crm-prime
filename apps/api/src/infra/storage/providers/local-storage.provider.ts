import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import type { ReadFile, StorageHealth, StorageProvider, StoredFile } from "../storage.provider";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Metadata {
  mimeType: string;
  size: number;
  originalName: string;
}

/**
 * Guarda los ficheros en disco, bajo MEDIA_DIR (en producción, el volumen
 * `crm-media` montado en /data/media; por defecto `./storage`, ignorado por
 * git). STORAGE_DIR se acepta como nombre antiguo. El id es un UUID generado
 * aquí, nunca provisto por el cliente, así que no hay riesgo de path traversal.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  private dir = process.env.MEDIA_DIR ?? process.env.STORAGE_DIR ?? join(process.cwd(), "storage");
  private ready: Promise<void> | null = null;
  /** Algo que la consola debe enseñar aunque el disco funcione (un almacén externo mal configurado). */
  notice: string | null = null;

  /** El mismo almacén sobre otra carpeta: para las pruebas. En la app la carpeta sale de MEDIA_DIR. */
  static at(dir: string): LocalStorageProvider {
    const provider = new LocalStorageProvider();
    provider.dir = dir;
    return provider;
  }

  private ensureDir(): Promise<void> {
    if (!this.ready) this.ready = mkdir(this.dir, { recursive: true }).then(() => undefined);
    return this.ready;
  }

  private binPath(id: string): string {
    return join(this.dir, `${id}.bin`);
  }

  private metaPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async save(buffer: Buffer, mimeType: string, originalName: string): Promise<StoredFile> {
    await this.ensureDir();
    const id = randomUUID();
    const meta: Metadata = { mimeType, size: buffer.length, originalName };
    await writeFile(this.binPath(id), buffer);
    await writeFile(this.metaPath(id), JSON.stringify(meta));
    return { id, mimeType, size: buffer.length };
  }

  async read(id: string): Promise<ReadFile | null> {
    if (!UUID_RE.test(id)) return null;
    await this.ensureDir();
    try {
      const [buffer, rawMeta] = await Promise.all([
        readFile(this.binPath(id)),
        readFile(this.metaPath(id), "utf8"),
      ]);
      const meta = JSON.parse(rawMeta) as Metadata;
      return {
        buffer,
        mimeType: meta.mimeType,
        size: meta.size,
        fileName: meta.originalName,
      };
    } catch {
      return null;
    }
  }

  /** Borra el fichero y sus metadatos (retención por plan). Si no existe, no pasa nada. */
  async remove(id: string): Promise<void> {
    if (!UUID_RE.test(id)) return;
    await Promise.all([unlink(this.binPath(id)).catch(() => undefined), unlink(this.metaPath(id)).catch(() => undefined)]);
  }

  /** Los ids de todos los ficheros que hay en el disco (los que tienen sus metadatos). */
  async ids(): Promise<string[]> {
    await this.ensureDir();
    const names = await readdir(this.dir);
    return names.filter((n) => n.endsWith(".json") && UUID_RE.test(n.slice(0, -5))).map((n) => n.slice(0, -5));
  }

  async health(): Promise<StorageHealth> {
    try {
      return { kind: "local", target: "El disco del servidor", ok: !this.notice, detail: this.notice, onDisk: (await this.ids()).length };
    } catch (e) {
      return { kind: "local", target: "El disco del servidor", ok: false, detail: `No se puede leer la carpeta de archivos: ${(e as Error).message}`, onDisk: null };
    }
  }
}
