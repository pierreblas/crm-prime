import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import type {
  ImportUrlInput,
  ImportUrlResult,
  IngestKnowledgeInput,
  KnowledgeDocDto,
  KnowledgeHit,
  KnowledgeIndexStatus,
} from "@crm/shared";
import { Prisma } from "@prisma/client";
import { fetchPublicPage, htmlToText, sameSiteLinks, UnsafeUrlError } from "./url-import";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from "./embeddings/embedding.provider";

const CHUNK_SIZE = 600;

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger("Knowledge");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
  ) {}

  // Asegura el índice vectorial (Prisma no lo expresa en el schema).
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
         ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)`,
      );
    } catch (e) {
      this.logger.warn(`No se pudo crear el índice HNSW: ${(e as Error).message}`);
    }
  }

  // ── Ingesta: trocear + embeber + almacenar ──────────────────
  async ingest(input: IngestKnowledgeInput): Promise<KnowledgeDocDto> {
    const doc = await this.prisma.knowledgeDoc.create({
      data: {
        orgId: this.tenant.orgId(),
        title: input.title,
        source: input.source ?? null,
        content: input.content,
      },
    });

    const chunks = this.chunk(input.content);
    const vectors = await this.embedder.embed(chunks);
    // Con qué se indexó: si luego cambia el proveedor, hay que reindexar.
    await this.prisma.knowledgeDoc.update({
      where: { id: doc.id },
      data: { metadata: { embedder: this.embedder.name } as Prisma.InputJsonValue },
    });

    for (let i = 0; i < chunks.length; i++) {
      const created = await this.prisma.knowledgeChunk.create({
        data: {
          docId: doc.id,
          content: chunks[i]!,
          tokenCount: Math.ceil(chunks[i]!.length / 4),
        },
      });
      await this.prisma.$executeRawUnsafe(
        `UPDATE knowledge_chunks SET embedding = '${this.toVector(vectors[i]!)}'::vector WHERE id = $1`,
        created.id,
      );
    }

    this.logger.log(`Ingesta "${doc.title}": ${chunks.length} chunks`);
    return { id: doc.id, title: doc.title, source: doc.source, chunks: chunks.length, createdAt: doc.createdAt.toISOString() };
  }

  // ── Búsqueda semántica ──────────────────────────────────────
  async search(query: string, topK = 4): Promise<KnowledgeHit[]> {
    if (!query.trim()) return [];
    const [vec] = await this.embedder.embed([query]);
    const lit = this.toVector(vec!);
    // El filtro por empresa va explícito aunque RLS también lo imponga. Son
    // dos defensas distintas: RLS solo actúa si la aplicación se conecta con el
    // rol restringido, y esta consulta tiene que ser correcta también sin él.
    // Sin esto, el agente de una empresa citaría los documentos internos de
    // otra en una respuesta a un cliente.
    const orgId = this.tenant.orgId();
    const rows = await this.prisma.$queryRawUnsafe<
      { content: string; docTitle: string; score: number }[]
    >(
      `SELECT kc.content, kd.title AS "docTitle",
              1 - (kc.embedding <=> '${lit}'::vector) AS score
       FROM knowledge_chunks kc
       JOIN knowledge_docs kd ON kd.id = kc."docId"
       WHERE kc.embedding IS NOT NULL
         AND kd."isActive" = true
         AND kd."orgId" = $1
       ORDER BY kc.embedding <=> '${lit}'::vector
       LIMIT ${topK}`,
      orgId,
    );
    return rows.map((r) => ({
      content: r.content,
      docTitle: r.docTitle,
      score: Number(r.score),
    }));
  }

  /** Devuelve fragmentos relevantes (texto) para inyectar en el contexto del agente. */
  async retrieve(query: string, topK = 3): Promise<string[]> {
    const hits = await this.search(query, topK);
    // Filtra ruido: solo fragmentos con cierta similitud.
    return hits.filter((h) => h.score > 0.15).map((h) => h.content);
  }

  // ── Estado del índice y reindexado ──────────────────────────
  async indexStatus(): Promise<KnowledgeIndexStatus> {
    const embedder = (await this.embedder.current?.()) ?? this.embedder.name;
    const docs = await this.prisma.knowledgeDoc.findMany({ select: { metadata: true } });
    const stale = docs.filter((d) => {
      const used = (d.metadata as { embedder?: string } | null)?.embedder;
      return used !== embedder;
    }).length;
    return { embedder, docs: docs.length, stale };
  }

  /**
   * Vuelve a calcular los vectores de todos los documentos con el proveedor
   * actual. Hace falta al cambiar de proveedor: los vectores de uno no se
   * pueden comparar con los de otro.
   */
  async reindex(): Promise<{ docs: number; chunks: number }> {
    const docs = await this.prisma.knowledgeDoc.findMany({
      select: { id: true, metadata: true, chunks: { select: { id: true, content: true } } },
    });
    let total = 0;
    for (const doc of docs) {
      if (!doc.chunks.length) continue;
      const vectors = await this.embedder.embed(doc.chunks.map((c) => c.content));
      for (let i = 0; i < doc.chunks.length; i++) {
        await this.prisma.$executeRawUnsafe(
          `UPDATE knowledge_chunks SET embedding = '${this.toVector(vectors[i]!)}'::vector WHERE id = $1`,
          doc.chunks[i]!.id,
        );
      }
      total += doc.chunks.length;
      await this.prisma.knowledgeDoc.update({
        where: { id: doc.id },
        data: {
          metadata: {
            ...((doc.metadata as Record<string, unknown> | null) ?? {}),
            embedder: this.embedder.name,
          } as Prisma.InputJsonValue,
        },
      });
    }
    this.logger.log(`Reindexado: ${docs.length} documentos, ${total} fragmentos con ${this.embedder.name}`);
    return { docs: docs.length, chunks: total };
  }

  // ── Importar desde una web ──────────────────────────────────
  /**
   * Descarga la página (y, si se pide, las del mismo sitio que enlaza, hasta
   * 15) y guarda cada una como documento. Volver a importar la misma URL
   * sustituye el documento anterior en vez de duplicarlo. `maxPages` acota
   * el rastreo (el asistente de bienvenida lee menos para no hacer esperar).
   */
  async importUrl(input: ImportUrlInput, maxPages = 15): Promise<ImportUrlResult> {
    const MAX_PAGES = input.crawl ? maxPages : 1;
    const result: ImportUrlResult = { imported: [], skipped: [] };
    const queue = [input.url];
    const seen = new Set<string>();

    while (queue.length && result.imported.length + result.skipped.length < MAX_PAGES) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const page = await fetchPublicPage(url);
        seen.add(page.url);
        const { title, text } = htmlToText(page.html);
        if (input.crawl && result.imported.length + result.skipped.length === 0) {
          for (const l of sameSiteLinks(page.html, page.url)) if (!seen.has(l)) queue.push(l);
        }
        if (text.length < 200) {
          result.skipped.push({ url: page.url, reason: "Casi no tiene texto" });
          continue;
        }
        const old = await this.prisma.knowledgeDoc.findMany({ where: { source: page.url }, select: { id: true } });
        if (old.length) await this.prisma.knowledgeDoc.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
        const doc = await this.ingest({
          title: (title || new URL(page.url).pathname || page.url).slice(0, 200),
          content: text.slice(0, 200_000),
          source: page.url,
        });
        result.imported.push({ title: doc.title, url: page.url, chunks: doc.chunks });
      } catch (e) {
        if (e instanceof UnsafeUrlError && result.imported.length + result.skipped.length === 0) {
          throw new BadRequestException(e.message);
        }
        result.skipped.push({ url, reason: (e as Error).message.slice(0, 160) });
      }
    }
    if (!result.imported.length && result.skipped.length === 1 && !input.crawl) {
      throw new BadRequestException(`No se pudo importar: ${result.skipped[0]!.reason}`);
    }
    return result;
  }

  // ── CRUD de documentos ──────────────────────────────────────
  async listDocs(): Promise<KnowledgeDocDto[]> {
    const docs = await this.prisma.knowledgeDoc.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } },
    });
    return docs.map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
      chunks: d._count.chunks,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  async deleteDoc(id: string): Promise<void> {
    const doc = await this.prisma.knowledgeDoc.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException("Documento no encontrado");
    await this.prisma.knowledgeDoc.delete({ where: { id } });
  }

  // ── Helpers ─────────────────────────────────────────────────
  private toVector(arr: number[]): string {
    return `[${arr.map((x) => x.toFixed(6)).join(",")}]`;
  }

  private chunk(text: string, size = CHUNK_SIZE): string[] {
    const paras = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    let cur = "";
    for (const p of paras) {
      if (cur && (cur + "\n\n" + p).length > size) {
        chunks.push(cur);
        cur = p;
      } else {
        cur = cur ? cur + "\n\n" + p : p;
      }
    }
    if (cur) chunks.push(cur);
    // Partir párrafos muy largos.
    return chunks.flatMap((c) =>
      c.length > size * 2 ? this.hardSplit(c, size) : [c],
    );
  }

  private hardSplit(text: string, size: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) {
      out.push(text.slice(i, i + size));
    }
    return out;
  }
}
