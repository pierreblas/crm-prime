import { Inject, Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { env } from "../../common/utils/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import {
  STORAGE_PROVIDER,
  parseStorageRef,
  type ReadFile,
  type StorageProvider,
} from "../../infra/storage/storage.provider";
import { AiSettingsService } from "./ai-settings.service";
import { AiUsageService } from "./ai-usage.service";

/** Tipos de mensaje que la IA puede «leer» además del texto. */
const MEDIA_TYPES = ["AUDIO", "IMAGE", "STICKER"] as const;
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 25_000;

const LABEL: Record<string, string> = {
  AUDIO: "audio transcrito",
  IMAGE: "imagen",
  STICKER: "sticker",
  VIDEO: "video",
  DOCUMENT: "documento",
  LOCATION: "ubicación",
};

const IMAGE_PROMPT =
  "Un cliente envió esta imagen por WhatsApp a un negocio. Describe en español, en una o dos frases, qué muestra. " +
  "Si tiene texto legible (comprobante de pago, pedido, dirección, captura de pantalla), transcribe los datos importantes: importes, nombres, números, fechas. Sin preámbulos.";
const STICKER_PROMPT =
  "Es un sticker de WhatsApp que envió un cliente. Di en español, en pocas palabras, qué expresa (una emoción, un gesto, un mensaje). Sin preámbulos.";

/**
 * Lo que la IA entiende de audios, imágenes y stickers. Hasta ahora el modelo
 * solo veía «[audio]» o «[image]» y no podía responder. Ahora, al llegar uno:
 *
 *  - un audio se transcribe (OpenAI, con la clave de la empresa);
 *  - una imagen o un sticker se describen con el modelo con visión del
 *    proveedor activo (OpenAI o Anthropic);
 *
 * y el resultado se guarda en `Message.transcript`: lo ve el equipo en la
 * bandeja y lo lee el agente como parte del historial. Cada llamada se
 * registra en el consumo de IA (función «media»).
 */
@Injectable()
export class MediaUnderstandingService {
  private readonly logger = new Logger("Medios");

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly usage: AiUsageService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly events: EventEmitter2,
  ) {}

  /** El texto que representa a un mensaje para la IA: lo escrito, o lo entendido del medio. */
  static textOf(m: { type: string; content: string | null; transcript?: string | null }): string {
    const label = LABEL[m.type] ?? m.type.toLowerCase();
    if (m.transcript) {
      return m.content ? `[${label}: ${m.transcript}] ${m.content}` : `[${label}: ${m.transcript}]`;
    }
    if (m.content) return m.content;
    return m.type === "TEXT" ? "" : `[${label}]`;
  }

  /**
   * El último entrante con un medio aún sin entender: lo transcribe o lo
   * describe y lo guarda. Se llama antes de que la IA responda, así la
   * respuesta ya lo tiene en cuenta.
   */
  async enrichLatest(conversationId: string): Promise<void> {
    const m = await this.prisma.message.findFirst({
      where: {
        conversationId,
        direction: "INBOUND",
        type: { in: [...MEDIA_TYPES] },
        transcript: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, type: true, mediaUrl: true, orgId: true },
    });
    if (!m) return;

    let result: string | null = null;
    try {
      result = await withTimeout(this.understand(m, conversationId), TIMEOUT_MS);
    } catch (e) {
      // Fallo transitorio (red, cuota): se vuelve a intentar con el siguiente mensaje.
      this.logger.warn(`No se pudo entender el ${m.type} ${m.id}: ${(e as Error).message}`);
      return;
    }
    if (result === null) return;
    // "" = no se puede (sin clave, formato no admitido): se guarda para no reintentar.
    await this.prisma.message.update({ where: { id: m.id }, data: { transcript: result } });
    if (result) {
      this.logger.log(`${m.type} entendido en ${conversationId}: "${result.slice(0, 80)}"`);
      this.events.emit("inbox.changed", { conversationId, orgId: m.orgId });
    }
  }

  private async understand(
    m: { id: string; type: string; mediaUrl: string | null },
    conversationId: string,
  ): Promise<string | null> {
    const storageId = parseStorageRef(m.mediaUrl);
    if (!storageId) return "";
    const file = await this.storage.read(storageId);
    if (!file || file.size > MAX_BYTES) return "";
    if (m.type === "AUDIO") return this.transcribe(file, conversationId);
    return this.describe(file, m.type === "STICKER", conversationId);
  }

  /** Transcribe un audio cualquiera (grabación de una llamada). Null si falla. */
  async transcribeAudio(file: ReadFile, conversationId: string): Promise<string | null> {
    const text = await this.transcribe(file, conversationId);
    return text || null;
  }

  // ── Audio → texto (OpenAI) ──────────────────────────────────
  private async transcribe(file: ReadFile, conversationId: string): Promise<string | null> {
    const creds = await this.settings.resolveFor("openai");
    if (!creds.apiKey) {
      this.logger.log("Sin clave de OpenAI: los audios no se transcriben");
      return "";
    }
    const base = (creds.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    // Una API compatible (Groq, etc.) suele exponer whisper; OpenAI tiene el modelo pequeño nuevo.
    const model = env("AI_TRANSCRIBE_MODEL") ?? (creds.baseUrl ? "whisper-1" : "gpt-4o-mini-transcribe");
    const mime = mimeOf(file.mimeType);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file.buffer)], { type: mime }), fileNameFor(mime));
    form.append("model", model);
    form.append("response_format", "json");

    const res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}` },
      body: form,
    });
    if (!res.ok) return this.fail("transcripción", res);
    const data = (await res.json()) as {
      text?: string;
      usage?: { input_tokens?: number; output_tokens?: number; seconds?: number };
    };
    this.usage.record({
      feature: "media",
      model,
      inputTokens: data.usage?.input_tokens ?? Math.round((data.usage?.seconds ?? 0) * 50),
      outputTokens: data.usage?.output_tokens ?? 0,
      conversationId,
    });
    const text = (data.text ?? "").trim();
    return text || "(audio sin voz reconocible)";
  }

  // ── Imagen o sticker → descripción (proveedor activo) ───────
  private async describe(file: ReadFile, sticker: boolean, conversationId: string): Promise<string | null> {
    const mime = mimeOf(file.mimeType);
    if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return "";
    const active = await this.settings.resolve();
    const prompt = sticker ? STICKER_PROMPT : IMAGE_PROMPT;
    const b64 = file.buffer.toString("base64");

    if (active.provider === "openai" && active.apiKey) {
      const base = (active.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
      const model =
        env("AI_VISION_MODEL") ?? (/^(gpt-4o|gpt-4\.1|gpt-5)/.test(active.model) ? active.model : "gpt-4o-mini");
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${active.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "low" } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return this.fail("visión", res);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      this.usage.record({
        feature: "media",
        model,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        conversationId,
      });
      return (data.choices?.[0]?.message?.content ?? "").trim();
    }

    if (active.provider === "anthropic" && active.apiKey) {
      const model = env("AI_VISION_MODEL") ?? (/^claude/.test(active.model) ? active.model : "claude-haiku-4-5");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": active.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return this.fail("visión", res);
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      this.usage.record({
        feature: "media",
        model,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        conversationId,
      });
      return (data.content ?? [])
        .map((c) => c.text ?? "")
        .join("")
        .trim();
    }

    this.logger.log("Sin proveedor de IA con visión: las imágenes no se describen");
    return "";
  }

  /** Un rechazo del proveedor (formato, tamaño) no se reintenta; un fallo suyo, sí. */
  private async fail(what: string, res: Response): Promise<string | null> {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    this.logger.warn(`${what} ${res.status}: ${detail}`);
    if (permanent) return "";
    throw new Error(`${what} ${res.status}`);
  }
}

function mimeOf(raw: string): string {
  return (raw.split(";")[0] ?? "").trim().toLowerCase() || "application/octet-stream";
}

function fileNameFor(mime: string): string {
  const ext: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "audio/wav": "wav",
    "audio/webm": "webm",
  };
  return `audio.${ext[mime] ?? "ogg"}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tiempo agotado (${ms} ms)`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
