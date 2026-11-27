import type { LocalStorageProvider } from "./providers/local-storage.provider";
import { explainStoreError } from "./providers/s3-object-store";
import type { S3StorageProvider } from "./providers/s3-storage.provider";

export interface MigrateResult {
  /** Ficheros que había en el disco. */
  total: number;
  /** Subidos ahora. */
  copied: number;
  /** Ya estaban en el almacén con el mismo tamaño. */
  already: number;
  /** Borrados del disco (solo con `deleteLocal`, y solo los que están comprobados en el almacén). */
  deleted: number;
  /** Bytes subidos ahora. */
  bytes: number;
  failed: { id: string; error: string }[];
}

export interface MigrateOptions {
  /** Borra del disco cada fichero después de comprobar que está en el almacén. */
  deleteLocal?: boolean;
  /** Cuántos a la vez. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Sube al almacén lo que hay en el disco del servidor. Se puede repetir las
 * veces que haga falta: lo que ya está (mismo tamaño) no se vuelve a subir, y
 * un fichero que falla no detiene a los demás. No borra nada del disco salvo
 * que se pida, y entonces solo lo que se comprobó que está arriba.
 */
export async function migrateToBucket(local: LocalStorageProvider, target: S3StorageProvider, opts: MigrateOptions = {}): Promise<MigrateResult> {
  const ids = await local.ids();
  const result: MigrateResult = { total: ids.length, copied: 0, already: 0, deleted: 0, bytes: 0, failed: [] };
  let next = 0;
  let done = 0;

  const one = async (id: string): Promise<void> => {
    try {
      const file = await local.read(id);
      if (!file) throw new Error("no se pudo leer del disco (falta el archivo o sus datos)");
      if ((await target.sizeOf(id)) === file.buffer.length) result.already++;
      else {
        await target.put(id, file);
        // Se comprueba antes de darlo por subido: de eso depende poder borrarlo del disco.
        if ((await target.sizeOf(id)) !== file.buffer.length) throw new Error("se subió, pero el almacén no lo devuelve con el mismo tamaño");
        result.copied++;
        result.bytes += file.buffer.length;
      }
      if (opts.deleteLocal) {
        await local.remove(id);
        result.deleted++;
      }
    } catch (e) {
      result.failed.push({ id, error: e instanceof Error && !("$metadata" in e) && !("code" in e) ? e.message : explainStoreError(e) });
    } finally {
      opts.onProgress?.(++done, ids.length);
    }
  };

  const worker = async (): Promise<void> => {
    while (next < ids.length) await one(ids[next++]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 6, 16)) }, worker));
  return result;
}

/** 1536 → «1,5 KB». */
export function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(1).replace(".", ",")} ${units[i]}`;
}
