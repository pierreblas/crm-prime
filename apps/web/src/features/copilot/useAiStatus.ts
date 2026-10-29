"use client";

import { useQuery } from "@tanstack/react-query";
import type { AiIncluded } from "@crm/shared";
import { fetchAiStatus } from "@/lib/bff";

/**
 * ¿Hay IA en esta empresa, y de quién? Con su clave, o con la IA incluida en
 * su plan (cupo de conversaciones al mes). El copiloto se ofrece si la hay.
 */
export function useAiStatus() {
  return useQuery({ queryKey: ["ai-status"], queryFn: fetchAiStatus, staleTime: 60_000 });
}

/** "el 1 de noviembre": cuándo vuelve a empezar el cupo de la IA incluida. */
export function resetLabel(included: Pick<AiIncluded, "resetsAt">): string {
  // El cupo cambia a las 00:00 UTC del día 1; se enseña ese día, sin la hora.
  return `el ${new Date(included.resetsAt).toLocaleDateString("es", { day: "numeric", month: "long", timeZone: "UTC" })}`;
}

export const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  fake: "IA simulada",
};
