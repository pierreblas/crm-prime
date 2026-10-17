// Contrato del proveedor de almacenamiento (patrón Adapter).
// La lógica de negocio depende SOLO de esta interfaz, nunca del disco directamente.

export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");

const STORAGE_REF_PREFIX = "storage://";

export interface StoredFile {
  id: string;
  mimeType: string;
  size: number;
}

export interface ReadFile {
  buffer: Buffer;
  mimeType: string;
  size: number;
  fileName: string;
}

export interface StorageProvider {
  /** Nombre legible para logs/diagnóstico ("local"). */
  readonly name: string;

  save(buffer: Buffer, mimeType: string, originalName: string): Promise<StoredFile>;

  read(id: string): Promise<ReadFile | null>;

  /** Borra el fichero; si no existe, no pasa nada. */
  remove(id: string): Promise<void>;
}

/** Referencia interna que se guarda en `Message.mediaUrl` para ficheros propios. */
export function toStorageRef(id: string): string {
  return `${STORAGE_REF_PREFIX}${id}`;
}

/** Extrae el id de una referencia "storage://…"; null si es una URL externa o vacía. */
export function parseStorageRef(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith(STORAGE_REF_PREFIX)) return null;
  return ref.slice(STORAGE_REF_PREFIX.length);
}
