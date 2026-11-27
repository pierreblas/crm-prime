/**
 * El video de una entrada: un enlace de YouTube (se incrusta) o la dirección de
 * un archivo de video (se reproduce con el reproductor del navegador). Los
 * videos no se guardan en el repositorio: pesan y el repositorio es público.
 */
export type PostVideo = { type: "youtube"; id: string } | { type: "file"; src: string };

const YT_ID = /^[\w-]{11}$/;

/** El identificador de un enlace de YouTube en cualquiera de sus formas, o null. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = u.pathname.split("/");
    if (first === "watch") id = u.searchParams.get("v");
    else if (first === "embed" || first === "shorts" || first === "live" || first === "v") id = second ?? null;
  }
  return id && YT_ID.test(id) ? id : null;
}

/** Qué video es, o null si no es ni YouTube ni un archivo de video. */
export function parseVideo(value: string | null | undefined): PostVideo | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const id = youtubeId(v);
  if (id) return { type: "youtube", id };
  const isPath = v.startsWith("/") && !v.startsWith("//");
  if ((isPath || /^https:\/\//i.test(v)) && /\.(mp4|webm|m4v)(\?[^#]*)?$/i.test(v)) return { type: "file", src: v };
  return null;
}

/** 64 → «1:04»; 3725 → «1:02:05». */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 64 → «PT1M4S», como lo piden los datos estructurados. */
export function isoDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s % 60 || (!h && !m) ? `${s % 60}S` : ""}`;
}
