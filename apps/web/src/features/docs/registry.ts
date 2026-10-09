import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Índice de la documentación pública (`/docs`). Cada entrada es un archivo
 * Markdown en `apps/web/content/docs/`; las páginas se prerenderizan en el
 * build, así que en producción no hace falta el sistema de archivos.
 */
export interface DocEntry {
  slug: string;
  title: string;
  group: string;
  file: string;
  summary: string;
}

export const DOCS: DocEntry[] = [
  { group: "Primeros pasos", slug: "empezar", file: "empezar.md", title: "Empezar", summary: "Crear tu empresa, tu subdominio y tu equipo." },
  { group: "Primeros pasos", slug: "whatsapp", file: "whatsapp.md", title: "Conectar WhatsApp", summary: "Con el botón de la plataforma o con tu propia app de Meta." },
  { group: "Primeros pasos", slug: "planes", file: "planes.md", title: "Planes y límites", summary: "Qué incluye cada plan en la nube y cómo cambiarlo." },
  { group: "Uso diario", slug: "bandeja", file: "bandeja.md", title: "Bandeja", summary: "Conversaciones, asignación, etiquetas y los dos modos de la IA." },
  { group: "Uso diario", slug: "embudos", file: "embudos.md", title: "Embudos", summary: "Varios embudos, entrada automática desde WhatsApp y descarte." },
  { group: "Uso diario", slug: "llamadas", file: "llamadas.md", title: "Llamadas", summary: "Llamar y recibir desde el CRM con Twilio, registro y grabaciones." },
  { group: "Uso diario", slug: "difusiones", file: "difusiones.md", title: "Difusiones y plantillas", summary: "Envíos masivos con plantillas aprobadas por Meta." },
  { group: "Automatización", slug: "agentes", file: "agentes.md", title: "Agentes de IA", summary: "Modelos, claves, herramientas, escalado y límite de gasto." },
  { group: "Automatización", slug: "flujos", file: "flujos.md", title: "Flujos", summary: "El constructor visual: bloques, variables y disparadores." },
  { group: "Automatización", slug: "meta-ads", file: "meta-ads.md", title: "Anuncios y leads de Meta", summary: "Lead Ads, click-to-WhatsApp y atribución." },
  { group: "Integrar", slug: "api", file: "api.md", title: "API pública", summary: "Claves, endpoints, errores y la dirección de tu empresa." },
  { group: "Integrar", slug: "webhooks", file: "webhooks.md", title: "Webhooks salientes", summary: "Avisos a tu sistema, firma, reintentos y n8n." },
  { group: "Integrar", slug: "autoalojado", file: "autoalojado.md", title: "Versión open source", summary: "Instalar Driony en tu propio servidor." },
];

export function findDoc(slug: string): DocEntry | undefined {
  return DOCS.find((d) => d.slug === slug);
}

/** Lee el Markdown de una entrada (solo en build / servidor). */
export function readDoc(entry: DocEntry): string {
  return readFileSync(path.join(process.cwd(), "content", "docs", entry.file), "utf8");
}

export function docGroups(): { group: string; items: DocEntry[] }[] {
  const out: { group: string; items: DocEntry[] }[] = [];
  for (const d of DOCS) {
    const g = out.find((x) => x.group === d.group);
    if (g) g.items.push(d);
    else out.push({ group: d.group, items: [d] });
  }
  return out;
}
