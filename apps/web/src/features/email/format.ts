"use client";

import { useRef } from "react";
import { emailHtmlToText, emailTextToHtml, type EmailFormat } from "@crm/shared";

/** El HTML de un texto, con un párrafo por línea para poder retocarlo a mano. */
export function textToHtmlSource(text: string): string {
  if (!text.trim()) return "";
  return emailTextToHtml(text)
    .replace(/^(<div[^>]*>)/, "$1\n")
    .replace(/<\/p>/g, "</p>\n");
}

/**
 * Cambiar un cuerpo de texto a HTML y al revés. Volver a texto pierde el
 * diseño, así que se recuerda el HTML: si el texto no se tocó, al regresar a
 * HTML vuelve el mismo en vez de uno rehecho a partir del texto.
 */
export function useEmailFormatSwitch(format: EmailFormat, body: string, apply: (format: EmailFormat, body: string) => void) {
  const kept = useRef<{ html: string; text: string } | null>(null);
  return (next: EmailFormat) => {
    if (next === format) return;
    if (next === "text") {
      const text = emailHtmlToText(body);
      kept.current = { html: body, text };
      apply("text", text);
    } else {
      apply("html", kept.current && kept.current.text === body ? kept.current.html : textToHtmlSource(body));
    }
  };
}
