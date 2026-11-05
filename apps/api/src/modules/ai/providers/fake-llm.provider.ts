import { Injectable, Logger } from "@nestjs/common";
import type { Classification } from "@crm/shared";
import type { LLMProvider } from "../llm.provider";
import type { LlmRequest, LlmResponse } from "../llm.types";

/**
 * Proveedor simulado de LLM para desarrollo sin ANTHROPIC_API_KEY.
 * Genera una sugerencia de respuesta heurística según el último mensaje
 * del contacto. No llama a ningún modelo real.
 */
@Injectable()
export class FakeLLMProvider implements LLMProvider {
  readonly name = "fake";
  private readonly logger = new Logger("FakeLLM");

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const lastUser = [...req.messages]
      .reverse()
      .find((m) => m.role === "user");
    const text =
      typeof lastUser?.content === "string"
        ? lastUser.content
        : (lastUser?.content.find((b) => b.type === "text") as
            | { text: string }
            | undefined
          )?.text ?? "";

    // Si el RAG recuperó conocimiento, fundamentar la respuesta en él.
    const reply = req.knowledge?.length
      ? `${this.greeting(text.toLowerCase())} Según nuestra información: ${req.knowledge[0]}`
      : this.suggest(text.toLowerCase());

    return {
      stopReason: "end_turn",
      content: [{ type: "text", text: reply }],
      usage: { inputTokens: 120, outputTokens: 40 },
      model: "fake-llm",
      // Nadie paga el simulado; el registro de consumo lo descarta por el modelo.
      billingMode: "BYOK",
    };
  }

  private greeting(t: string): string {
    if (/(hola|buenas|buen d[ií]a)/.test(t)) return "¡Hola!";
    return "¡Gracias por tu mensaje!";
  }

  async classify(text: string): Promise<Classification> {
    const t = text.toLowerCase();
    const negative = /(molesto|enojad|p[eé]simo|terrible|reclamo|queja|no funciona|estafa|cancelar)/.test(t);
    const positive = /(gracias|excelente|genial|perfecto|me encanta|buen[ío])/.test(t);
    const wantsHuman = /(humano|persona|agente|representante|hablar con alguien)/.test(t);
    const urgent = /(urgente|ya|ahora|inmediato|emergencia)/.test(t);

    let intent = "general";
    if (/(precio|cuesta|cu[aá]nto|plan|tarifa)/.test(t)) intent = "consulta_precio";
    else if (/(agenda|cita|horario|reserva|disponib)/.test(t)) intent = "agendar";
    else if (/(ayuda|problema|error|soporte|no funciona)/.test(t)) intent = "soporte";
    else if (/(hola|buenas|informaci[oó]n)/.test(t)) intent = "saludo";

    return {
      intent,
      sentiment: negative ? "negative" : positive ? "positive" : "neutral",
      urgency: urgent || negative ? "high" : "low",
      requiresHuman: wantsHuman || negative,
    };
  }

  private suggest(t: string): string {
    if (/(precio|cuesta|cu[aá]nto|costo|tarifa|plan)/.test(t)) {
      return "¡Gracias por tu interés! Con gusto te comparto los precios de nuestros planes. ¿Para cuántas personas o qué uso lo necesitas, así te recomiendo la mejor opción?";
    }
    if (/(disponib|agenda|cita|horario|reserva)/.test(t)) {
      return "¡Claro! Tenemos disponibilidad esta semana. ¿Qué día y horario te quedan mejor para coordinar?";
    }
    if (/(ayuda|problema|error|no funciona|reclamo|queja)/.test(t)) {
      return "Lamento el inconveniente, estoy aquí para ayudarte. ¿Podrías contarme un poco más de lo que sucede para resolverlo cuanto antes?";
    }
    if (/(hola|buenas|buen d[ií]a|info|informaci[oó]n)/.test(t)) {
      return "¡Hola! 👋 Gracias por escribirnos. ¿En qué puedo ayudarte hoy?";
    }
    return "¡Gracias por tu mensaje! Cuéntame un poco más para poder ayudarte mejor. 😊";
  }
}
