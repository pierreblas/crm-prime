import { directFileUrl, PRODUCT_FILE_MAX_BYTES } from "@crm/shared";
import { safeFetch } from "./connectors/http";

/**
 * El enlace de un archivo de producto, comprobado y descargado al enviarlo. Se
 * baja aquí y se sube a Meta en vez de pasarle la dirección: Google Drive sirve
 * los PDF como «octet-stream» y Meta los rechaza después, cuando ya se le dijo
 * al cliente que iba. La dirección pasa por la misma comprobación que las demás
 * que escribe una empresa (nada de redes internas), también en cada redirección.
 */

export type FileFetcher = (url: string) => Promise<Response>;
const fetchFile: FileFetcher = (url) => safeFetch(url, {}, { allowCrossHost: true, timeoutMs: 20_000 });

const TOO_BIG = "pesa más de 16 MB, el máximo que se puede enviar";
const NOT_A_FILE = "es una página web, no un archivo (¿está compartido como público?)";
const UNSUPPORTED = "no es un tipo de archivo que WhatsApp admita (PDF, Word, Excel, PowerPoint, imagen o video MP4)";

const DOCS = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
]);
const BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};

export type FileKind = "DOCUMENT" | "IMAGE" | "VIDEO";

/** Cómo sale por WhatsApp un archivo de ese tipo; null si no se puede enviar. */
export function fileKind(mimeType: string): FileKind | null {
  if (mimeType === "image/jpeg" || mimeType === "image/png") return "IMAGE";
  if (mimeType === "video/mp4") return "VIDEO";
  return DOCS.has(mimeType) || mimeType === "text/csv" ? "DOCUMENT" : null;
}

/** Qué es de verdad, por sus primeros bytes: hay servidores que dicen «PDF» y devuelven una página de acceso. */
function sniff(head: Buffer, declared: string, name: string): string | null {
  const text = head.subarray(0, 256).toString("latin1");
  if (/^\s*<(!doctype|html|head|\?xml|script)/i.test(text)) return "text/html";
  if (text.startsWith("%PDF")) return "application/pdf";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && text.slice(1, 4) === "PNG") return "image/png";
  if (text.slice(4, 8) === "ftyp") return "video/mp4";
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  // Los de Office son un ZIP (o el formato antiguo): cuál, por lo que dice el servidor o por la extensión.
  const zip = text.startsWith("PK") && head[2] === 3 && head[3] === 4;
  const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (zip || ole) return DOCS.has(declared) ? declared : (BY_EXT[ext] ?? null);
  return declared && declared !== "application/octet-stream" ? declared : null;
}

const declaredType = (res: Response) => (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();

/** El nombre que da el servidor (Drive) o, si no, el final del enlace. */
function nameOf(res: Response, url: string): string {
  const said = /filename="?([^";]+)/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
  return said ?? url.split(/[?#]/)[0]!;
}

async function openLink(url: string, fetcher: FileFetcher): Promise<Response> {
  const res = await fetcher(directFileUrl(url));
  const stop = async (why: string): Promise<never> => {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(why);
  };
  if (!res.ok) return stop(`el enlace no responde (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > PRODUCT_FILE_MAX_BYTES) return stop(TOO_BIG);
  return res;
}

export type FileLinkCheck = { ok: true; mimeType: string; kind: FileKind } | { ok: false; reason: string };

/** Si el enlace se puede enviar como archivo. Solo lee el principio. */
export async function checkFileLink(url: string, fetcher: FileFetcher = fetchFile): Promise<FileLinkCheck> {
  try {
    const res = await openLink(url, fetcher);
    const reader = res.body?.getReader();
    const first = reader ? await reader.read() : null;
    await reader?.cancel().catch(() => undefined);
    const mimeType = sniff(Buffer.from(first?.value ?? new Uint8Array()), declaredType(res), nameOf(res, url));
    if (mimeType === "text/html") return { ok: false, reason: NOT_A_FILE };
    const kind = mimeType ? fileKind(mimeType) : null;
    return mimeType && kind ? { ok: true, mimeType, kind } : { ok: false, reason: UNSUPPORTED };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** El archivo entero, con tope de tamaño aunque el servidor no diga cuánto pesa. */
export async function downloadFileLink(url: string, fetcher: FileFetcher = fetchFile): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await openLink(url, fetcher);
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PRODUCT_FILE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`El archivo ${TOO_BIG}`);
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  const mimeType = sniff(buffer.subarray(0, 512), declaredType(res), nameOf(res, url));
  if (mimeType === "text/html") throw new Error(`El enlace ${NOT_A_FILE}`);
  if (!mimeType || !fileKind(mimeType)) throw new Error(`El enlace ${UNSUPPORTED}`);
  return { buffer, mimeType };
}
