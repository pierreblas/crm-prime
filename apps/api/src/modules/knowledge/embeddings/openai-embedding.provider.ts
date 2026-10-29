import { Injectable } from "@nestjs/common";
import { AiSettingsService } from "../../ai/ai-settings.service";
import { EMBEDDING_DIM, type EmbeddingProvider } from "./embedding.provider";
import { AiUsageService } from "../../ai/ai-usage.service";

const MODEL = "text-embedding-3-small";
const BATCH = 96;

/**
 * Embeddings con la clave de OpenAI de la propia empresa (Ajustes ›
 * Inteligencia Artificial) o, sin clave, con la IA incluida de Driony. Para
 * indexar se pide la clave aunque la IA incluida haya llegado a su tope: cuesta
 * céntimos y cambiar de embedder dejaría el conocimiento sin encontrar.
 *
 * text-embedding-3-small admite fijar las dimensiones; se piden 1024 para que
 * encajen en la misma columna vector(1024) que usa Voyage.
 */
@Injectable()
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dim = EMBEDDING_DIM;

  constructor(
    private readonly settings: AiSettingsService,
    private readonly usage: AiUsageService,
  ) {}

  async available(): Promise<boolean> {
    const c = await this.settings.resolveFor("openai", { purpose: "embeddings" });
    return !!c.apiKey;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const { apiKey, baseUrl } = await this.settings.resolveFor("openai", { purpose: "embeddings" });
    if (!apiKey) throw new Error("No hay clave de OpenAI configurada");
    const url = `${(baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")}/embeddings`;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL, input: texts.slice(i, i + BATCH), dimensions: EMBEDDING_DIM }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        data: { index: number; embedding: number[] }[];
        usage?: { prompt_tokens?: number };
      };
      this.usage.record({ feature: "knowledge_index", model: MODEL, inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: 0 });
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      out.push(...sorted.map((d) => d.embedding));
    }
    return out;
  }
}
