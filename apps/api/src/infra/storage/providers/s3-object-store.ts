import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { S3Config } from "../storage.config";

/** Un objeto guardado: sus bytes y lo que se anotó al guardarlo. */
export interface StoredObject {
  body: Buffer;
  contentType: string | null;
  metadata: Record<string, string>;
}

/**
 * Lo mínimo que hace falta de un almacén de objetos. El proveedor depende de
 * esto y no del SDK, para poder probarlo con uno en memoria.
 */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string, metadata: Record<string, string>): Promise<void>;
  /** null = ese objeto no existe. Cualquier otro fallo (red, permisos) se lanza. */
  get(key: string): Promise<StoredObject | null>;
  /** El tamaño del objeto, o null si no existe. (Una petición HEAD no distingue «no existe el bucket».) */
  head(key: string): Promise<{ size: number } | null>;
  /** Si no existe, no pasa nada. */
  delete(key: string): Promise<void>;
}

/** ¿El fallo es «ese objeto no existe»? Que no exista el bucket es otra cosa, aunque también sea un 404. */
function isMissing(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (err?.name === "NoSuchBucket") return false;
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

/** Un fallo del almacén dicho para una persona: qué revisar, sin el volcado del SDK. */
export function explainStoreError(e: unknown): string {
  const err = e as { name?: string; message?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  const status = err?.$metadata?.httpStatusCode;
  const name = err?.name ?? "";
  if (name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch" || status === 401) return "Las claves no sirven: revisa S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY (cópialas de nuevo, sin espacios)";
  if (name === "AccessDenied" || status === 403) return "El token no tiene permiso sobre ese bucket: tiene que ser «Object Read & Write» y estar aplicado a ese bucket";
  if (name === "NoSuchBucket") return "Ese bucket no existe en la cuenta: revisa S3_BUCKET y S3_ENDPOINT";
  if (err?.code === "ENOTFOUND" || err?.code === "EAI_AGAIN") return "No se encuentra el servidor: revisa S3_ENDPOINT";
  if (err?.code === "ECONNREFUSED" || err?.code === "ETIMEDOUT" || name === "TimeoutError") return "El servidor del almacén no responde";
  return `${name || "Error"}${status ? ` (${status})` : ""}: ${err?.message ?? String(e)}`.slice(0, 300);
}

/** El almacén de objetos de verdad: cualquier servicio que hable S3 (Cloudflare R2, Amazon S3, MinIO…). */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Las sumas de comprobación nuevas del SDK no las admiten todos los servicios compatibles: solo donde se exigen.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 3,
      // Que una red colgada no deje esperando a quien abre un chat.
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    });
  }

  async put(key: string, body: Buffer, contentType: string, metadata: Record<string, string>): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length, Metadata: metadata }));
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return { body: Buffer.from(await res.Body.transformToByteArray()), contentType: res.ContentType ?? null, metadata: res.Metadata ?? {} };
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
