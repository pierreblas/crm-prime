import type { AiFeature } from "@crm/shared";
// Tipos del adaptador de LLM — provider-agnósticos.
// La lógica del agente (AgentService) depende solo de esto, nunca del SDK.

export interface LlmTextBlock {
  type: "text";
  text: string;
}
export interface LlmToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface LlmToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock;
export type LlmAnyBlock = LlmContentBlock | LlmToolResultBlock;

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmAnyBlock[];
}

export interface LlmTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  /** Parte FIJA del prompt (instrucciones, reglas): igual en cada llamada del mismo agente, cacheable. */
  system: string;
  /** Parte VARIABLE (este contacto, su memoria): va después, fuera de la caché. */
  systemDynamic?: string;
  /** Clave de caché del prompt (un agente): mejora el acierto de la caché en OpenAI. */
  cacheKey?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  knowledge?: string[]; // fragmentos recuperados del RAG para fundamentar la respuesta
  effort?: string; // low | medium | high | xhigh | max
  maxTokens?: number;
  model?: string; // modelo elegido por el bot; el proveedor lo usa si le corresponde
  /** Para qué es la llamada: la usa el informe de consumo de la empresa. */
  feature?: AiFeature;
  conversationId?: string;
}

export type LlmStopReason =
  | "end_turn"
  | "tool_use"
  | "refusal"
  | "max_tokens"
  | string;

export interface LlmResponse {
  stopReason: LlmStopReason;
  content: LlmContentBlock[]; // bloques de salida (text + tool_use)
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}
