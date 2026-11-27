/**
 * Dónde se guardan los archivos (fotos, audios y documentos de los chats,
 * archivos de productos, grabaciones): en el disco del servidor, o en un
 * almacén compatible con S3 (Cloudflare R2, Amazon S3, MinIO…).
 *
 *   STORAGE_DRIVER=s3
 *   S3_ENDPOINT=https://<cuenta>.r2.cloudflarestorage.com
 *   S3_BUCKET=driony-media
 *   S3_ACCESS_KEY_ID=…
 *   S3_SECRET_ACCESS_KEY=…
 *
 * Aquí solo se lee y se comprueba la configuración (sin red), para poder
 * probarlo y para que el comando `storage check` diga qué falta.
 */

export interface S3Config {
  driver: "s3";
  /** Sin barra final. null = Amazon S3 (la dirección sale de la región). */
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Carpeta dentro del bucket, con su barra final, o "". */
  prefix: string;
  forcePathStyle: boolean;
  /** Cómo se le dice a una persona: «Cloudflare R2», «Amazon S3» o el servidor. */
  label: string;
}

export type StorageConfig = { driver: "local" } | S3Config;

/** La configuración no sirve; `problems` dice todo lo que falta, de una vez. */
export class StorageConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`La configuración del almacén de archivos no sirve:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "StorageConfigError";
  }
}

const val = (v: string | undefined) => (v ?? "").trim().replace(/^"(.*)"$/, "$1").trim();

/** ¿Es un servidor de la propia máquina o de la red de Docker (sin puntos)? Solo ahí vale http. */
const isLocalHost = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || !host.includes(".");

export function storageConfig(env: Record<string, string | undefined> = process.env): StorageConfig {
  const driver = val(env.STORAGE_DRIVER).toLowerCase();
  if (!driver || driver === "local" || driver === "disk" || driver === "disco") return { driver: "local" };
  if (driver !== "s3" && driver !== "r2") throw new StorageConfigError([`STORAGE_DRIVER: «${driver}» no existe. Pon «s3» (Cloudflare R2, Amazon S3…) o «local» (el disco del servidor)`]);

  const problems: string[] = [];
  const bucket = val(env.S3_BUCKET);
  const accessKeyId = val(env.S3_ACCESS_KEY_ID);
  const secretAccessKey = val(env.S3_SECRET_ACCESS_KEY);
  if (!bucket) problems.push("falta S3_BUCKET: el nombre del bucket");
  else if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) problems.push(`S3_BUCKET: «${bucket}» no es un nombre de bucket (minúsculas, números y guiones)`);
  if (!accessKeyId) problems.push("falta S3_ACCESS_KEY_ID: el «Access Key ID» del token");
  if (!secretAccessKey) problems.push("falta S3_SECRET_ACCESS_KEY: el «Secret Access Key» del token");

  let region = val(env.S3_REGION);
  let endpoint: string | null = null;
  let host = "";
  const rawEndpoint = val(env.S3_ENDPOINT);
  if (rawEndpoint) {
    let url: URL | null = null;
    try {
      url = new URL(/^https?:\/\//i.test(rawEndpoint) ? rawEndpoint : `https://${rawEndpoint}`);
    } catch {
      problems.push(`S3_ENDPOINT: «${rawEndpoint}» no es una dirección. En R2 es https://<cuenta>.r2.cloudflarestorage.com`);
    }
    if (url) {
      host = url.hostname;
      // Cloudflare enseña la dirección con el bucket al final: se acepta y se quita.
      const path = url.pathname.replace(/\/+$/, "");
      if (path && path !== `/${bucket}`) problems.push(`S3_ENDPOINT: sobra «${path}». Va solo el servidor, como https://<cuenta>.r2.cloudflarestorage.com`);
      if (url.protocol === "http:" && !isLocalHost(host)) problems.push("S3_ENDPOINT: tiene que ser https (las claves viajan en cada petición)");
      if (host.includes("<") || host.includes("%3c") || /cuenta|account_id/i.test(host)) problems.push("S3_ENDPOINT: cambia <cuenta> por el identificador de tu cuenta de Cloudflare");
      endpoint = `${url.protocol}//${url.host}`;
    }
    if (!region) region = "auto";
  } else if (!region || region === "auto") {
    problems.push("falta S3_ENDPOINT: en R2 es https://<cuenta>.r2.cloudflarestorage.com (en Amazon S3 se deja vacío y se pone S3_REGION)");
  }

  let prefix = val(env.S3_PREFIX).replace(/^\/+/, "").replace(/\/+$/, "");
  if (prefix && !/^[A-Za-z0-9._/-]+$/.test(prefix)) problems.push("S3_PREFIX: solo letras, números, puntos, guiones y barras");
  if (prefix) prefix += "/";

  const style = val(env.S3_FORCE_PATH_STYLE).toLowerCase();
  // Con una dirección propia (R2, MinIO) el bucket va en la ruta: no pide un DNS por bucket.
  const forcePathStyle = style ? style === "true" || style === "1" : !!endpoint;

  if (problems.length) throw new StorageConfigError(problems);
  const label = !endpoint || /amazonaws\.com$/.test(host) ? "Amazon S3" : /r2\.cloudflarestorage\.com$/.test(host) ? "Cloudflare R2" : host;
  return { driver: "s3", endpoint, region: region || "auto", bucket, accessKeyId, secretAccessKey, prefix, forcePathStyle, label };
}

/** La configuración para enseñarla: nunca la clave secreta, y del identificador solo el final. */
export function describeConfig(config: StorageConfig): string[] {
  if (config.driver === "local") return ["Almacén: el disco del servidor (STORAGE_DRIVER no está en «s3»)"];
  const id = config.accessKeyId;
  return [
    `Almacén: ${config.label}`,
    `Bucket: ${config.bucket}${config.prefix ? ` (carpeta ${config.prefix})` : ""}`,
    `Servidor: ${config.endpoint ?? `Amazon S3, región ${config.region}`}`,
    `Access Key ID: ${"•".repeat(Math.max(0, Math.min(8, id.length - 4)))}${id.slice(-4)}`,
  ];
}
