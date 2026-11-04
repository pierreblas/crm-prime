import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * La documentación pública de Driony (`apps/web/content/docs/*.md`) como
 * fuente del copiloto del administrador. Es la misma que se publica en /docs:
 * lo que el copiloto explica coincide con lo que el cliente puede leer.
 *
 * La API corre con `apps/api` como directorio de trabajo, en desarrollo y en
 * la imagen de Docker (que copia la carpeta al mismo sitio). DOCS_DIR la
 * cambia si hiciera falta.
 */
export function docsDir(): string {
  return process.env.DOCS_DIR || path.resolve(process.cwd(), "..", "web", "content", "docs");
}

export interface CopilotDoc {
  slug: string;
  title: string;
  /** Títulos de sus secciones (##), para el índice del prompt. */
  sections: string[];
  markdown: string;
}

/** Slug válido de un documento: evita que una ruta salga de la carpeta. */
const SLUG = /^[a-z0-9-]{1,60}$/;

export function parseDoc(slug: string, markdown: string): CopilotDoc {
  const lines = markdown.split(/\r?\n/);
  const title = lines.find((l) => l.startsWith("# "))?.slice(2).trim() || slug;
  const sections = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
  return { slug, title, sections, markdown };
}

export function loadDocs(dir: string): CopilotDoc[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((slug) => SLUG.test(slug))
    .sort()
    .map((slug) => parseDoc(slug, readFileSync(path.join(dir, `${slug}.md`), "utf8")));
}

/** Índice para el prompt: una línea por documento con sus secciones. */
export function docsIndex(docs: CopilotDoc[]): string {
  return docs
    .map((d) => `- ${d.slug}: ${d.title}${d.sections.length ? ` (${d.sections.join(" · ")})` : ""}`)
    .join("\n");
}
