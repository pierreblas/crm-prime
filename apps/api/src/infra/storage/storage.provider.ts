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

/** Cómo está el almacén, para la consola de la plataforma. */
export interface StorageHealth {
  /** "local" = el disco del servidor; "s3" = un almacén externo (R2, S3…). */
  kind: "local" | "s3";
  /** Dónde se guarda, dicho para una persona: «Cloudflare R2 · driony-media». */
  target: string;
  ok: boolean;
  /** Si no está bien, por qué. */
  detail: string | null;
  /** Archivos que hay en el disco del servidor (con un almacén externo: los que faltan por trasladar). */
  onDisk: number | null;
}

export interface StorageProvider {
  /** Nombre legible para logs/diagnóstico ("local", "s3"). */
  readonly name: string;

  save(buffer: Buffer, mimeType: string, originalName: string): Promise<StoredFile>;

  read(id: string): Promise<ReadFile | null>;

  /** Borra el fichero; si no existe, no pasa nada. */
  remove(id: string): Promise<void>;

  health(): Promise<StorageHealth>;
}

/** Referencia interna que se guarda en `Message.mediaUrl` para ficheros propios. */
export function toStorageRef(id: string): string {
  return `${STORAGE_REF_PREFIX}${id}`;
}

/** Extrae el id de una referencia "storage://…"; null si es una URL externa o vacía. */
export function parseStorageRef(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith(STORAGE_REF_PREFIX)) return null;
  // Puede traer pegado el nombre del archivo («#nombre=Brochure.pdf»): no es parte del id.
  return ref.slice(STORAGE_REF_PREFIX.length).split("#")[0]!;
}
