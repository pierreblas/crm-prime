"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KnowledgeHit, KnowledgeSuggestionDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import {
  acceptKnowledgeSuggestion,
  analyzeKnowledge,
  deleteKnowledge,
  dismissKnowledgeSuggestion,
  fetchKnowledge,
  fetchKnowledgeStatus,
  fetchKnowledgeSuggestions,
  importKnowledgeUrl,
  ingestKnowledge,
  reindexKnowledge,
  searchKnowledge,
} from "@/lib/bff";
import { useAiStatus } from "@/features/copilot/useAiStatus";

type Tab = "docs" | "gaps" | "web";

const EMBEDDER_LABEL: Record<string, string> = {
  voyage: "Voyage",
  openai: "tu clave de OpenAI",
  fake: "modo de prueba (sin clave)",
};

/**
 * Conocimiento: lo que el agente sabe del negocio. Tres formas de llenarlo:
 * escribirlo, importarlo de una web, y aprobar las preguntas que la IA detecta
 * en las conversaciones y que todavía no tienen respuesta.
 */
export function KnowledgeManager() {
  const [tab, setTab] = useState<Tab>("docs");
  const { data: gaps = [] } = useQuery({ queryKey: ["knowledge-suggestions"], queryFn: fetchKnowledgeSuggestions });

  return (
    <div className="kb">
      <IndexBanner />
      <div className="kb-tabs">
        <div className="seg" role="tablist" aria-label="Conocimiento">
          <button role="tab" aria-selected={tab === "docs"} onClick={() => setTab("docs")}>
            Documentos
          </button>
          <button role="tab" aria-selected={tab === "gaps"} onClick={() => setTab("gaps")}>
            Preguntas sin respuesta
            {gaps.length > 0 && <span className="kb-count">{gaps.length}</span>}
          </button>
          <button role="tab" aria-selected={tab === "web"} onClick={() => setTab("web")}>
            Importar web
          </button>
        </div>
      </div>
      {tab === "docs" && <DocsTab />}
      {tab === "gaps" && <GapsTab gaps={gaps} />}
      {tab === "web" && <WebTab onDone={() => setTab("docs")} />}
    </div>
  );
}

/** Con qué se indexa, y aviso si hay documentos indexados con otro proveedor. */
function IndexBanner() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["knowledge-status"], queryFn: fetchKnowledgeStatus });
  const { data: ai } = useAiStatus();
  // Sin clave propia de OpenAI, se indexa con la IA incluida en el plan.
  const viaDriony = !!ai?.included && ai.source !== "own" && data?.embedder === "openai";
  const reindex = useMutation({
    mutationFn: reindexKnowledge,
    onSuccess: (r) => {
      toast.success(`Reindexados ${r.docs} documentos`);
      void queryClient.invalidateQueries({ queryKey: ["knowledge-status"] });
    },
  });
  if (!data) return null;
  const fake = data.embedder === "fake";
  return (
    <div className={`kb-banner${fake || data.stale ? " is-warn" : ""}`}>
      <NavIcon name={fake ? "alert" : "book"} size={16} />
      <span className="kb-banner__text">
        {fake ? (
          <>
            La búsqueda funciona en modo de prueba. Pon tu clave de OpenAI en{" "}
            <Link href="/settings?tab=ai">Ajustes › Inteligencia Artificial</Link> para que el agente
            encuentre de verdad lo que subes.
          </>
        ) : data.stale > 0 ? (
          <>
            {data.stale === 1 ? "1 documento está indexado" : `${data.stale} documentos están indexados`} con
            otro proveedor. Reindexa para que la búsqueda los encuentre.
          </>
        ) : (
          viaDriony ? (
            <>Indexado con la IA incluida en tu plan. Buscar en el conocimiento no gasta conversaciones de tu cupo.</>
          ) : (
            <>Indexado con {EMBEDDER_LABEL[data.embedder] ?? data.embedder}. Sin créditos: cada búsqueda va con tu clave.</>
          )
        )}
      </span>
      {!fake && data.stale > 0 && (
        <button type="button" className="btn btn-primary btn-sm" disabled={reindex.isPending} onClick={() => reindex.mutate()}>
          {reindex.isPending ? "Reindexando…" : "Reindexar"}
        </button>
      )}
    </div>
  );
}

function DocsTab() {
  const queryClient = useQueryClient();
  const { data: docs = [], isPending } = useQuery({ queryKey: ["knowledge"], queryFn: fetchKnowledge });
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    void queryClient.invalidateQueries({ queryKey: ["knowledge-status"] });
  };

  const add = useMutation({
    mutationFn: () => ingestKnowledge({ title: title.trim(), content: content.trim(), source: source.trim() || undefined }),
    onSuccess: () => {
      setTitle("");
      setSource("");
      setContent("");
      toast.success("Documento indexado");
      refresh();
    },
  });
  const del = useMutation({ mutationFn: (id: string) => deleteKnowledge(id), onSuccess: refresh });

  return (
    <>
      <div className="kb-grid">
        <section className="card-lift kb-card">
          <h3>Nuevo documento</h3>
          <p className="kb-muted">Precios, envíos, garantías, horarios: lo que hoy respondes a mano.</p>
          <input className="field" placeholder="Título (ej. Envíos y devoluciones)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="field" placeholder="Fuente (opcional)" value={source} onChange={(e) => setSource(e.target.value)} />
          <textarea
            className="field"
            style={{ minHeight: 170, resize: "vertical", fontFamily: "inherit" }}
            placeholder="Pega aquí el contenido…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => title.trim() && content.trim() && add.mutate()}
            disabled={add.isPending || !title.trim() || !content.trim()}
          >
            {add.isPending ? "Indexando…" : "Indexar documento"}
          </button>
        </section>
        <SearchPreview />
      </div>

      <section className="card-lift kb-card" style={{ marginTop: 16 }}>
        <h3>Documentos indexados</h3>
        {isPending && <div className="skeleton" style={{ height: 60 }} />}
        {!isPending && docs.length === 0 && (
          <p className="kb-muted">Sin documentos todavía. Escribe uno, importa tu web o aprueba preguntas detectadas.</p>
        )}
        <div className="kb-docs">
          {docs.map((d) => (
            <div key={d.id} className="kb-doc">
              <div style={{ minWidth: 0 }}>
                <strong>{d.title}</strong>
                <div className="kb-muted kb-small">
                  {d.chunks} fragmentos{d.source ? ` · ${d.source}` : ""} · {new Date(d.createdAt).toLocaleDateString("es")}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={del.isPending}
                onClick={() =>
                  void confirmDialog({ message: `¿Eliminar "${d.title}" del conocimiento?`, danger: true }).then(
                    (ok) => ok && del.mutate(d.id),
                  )
                }
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SearchPreview() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const search = useMutation({ mutationFn: () => searchKnowledge(q.trim()), onSuccess: setHits });
  return (
    <section className="card-lift kb-card">
      <h3>Probar la búsqueda</h3>
      <p className="kb-muted">Escribe lo que preguntaría un cliente y mira qué encontraría el agente.</p>
      <form
        style={{ display: "flex", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) search.mutate();
        }}
      >
        <input className="field" style={{ flex: 1 }} placeholder="¿Hacen envíos a provincia?" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-ghost" disabled={search.isPending || !q.trim()}>
          Buscar
        </button>
      </form>
      {hits && hits.length === 0 && <p className="kb-muted">Nada relevante. Esa respuesta falta en tu conocimiento.</p>}
      <div className="kb-hits">
        {hits?.map((h, i) => (
          <div key={i} className="kb-hit">
            <div className="kb-small kb-muted">
              {h.docTitle} · {(h.score * 100).toFixed(0)} %
            </div>
            <div className="kb-hit__text">{h.content}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GapsTab({ gaps }: { gaps: KnowledgeSuggestionDto[] }) {
  const queryClient = useQueryClient();
  const { data: ai } = useAiStatus();
  const analyze = useMutation({
    mutationFn: analyzeKnowledge,
    onSuccess: (r) => {
      toast.success(
        r.analyzed === 0
          ? "No hay conversaciones de los últimos 30 días para analizar"
          : r.created === 0
            ? `Analizadas ${r.analyzed} conversaciones: nada nuevo que añadir`
            : `Analizadas ${r.analyzed} conversaciones: ${r.created} preguntas nuevas`,
      );
      void queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions"] });
    },
  });

  return (
    <section className="card-lift kb-card">
      <div className="kb-gaps__head">
        <div>
          <h3>Preguntas sin respuesta</h3>
          <p className="kb-muted">
            La IA lee las conversaciones de los últimos 30 días y detecta lo que tus clientes preguntan y tu
            conocimiento no cubre. Revisa la respuesta propuesta y apruébala: el agente la usará desde ese momento.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={analyze.isPending || (ai && !ai.ready)}
          onClick={() => analyze.mutate()}
          title={ai && !ai.ready ? (ai.included?.exhausted ? "La IA incluida llegó a su límite este mes: conecta tu clave en Ajustes › Inteligencia Artificial" : "Configura tu clave de IA en Ajustes › Inteligencia Artificial") : undefined}
        >
          <NavIcon name="sparkles" size={14} />
          {analyze.isPending ? "Analizando…" : "Analizar conversaciones"}
        </button>
      </div>
      {gaps.length === 0 ? (
        <div className="kb-empty">
          <NavIcon name="check" size={22} />
          <strong>Nada pendiente</strong>
          <span className="kb-muted">Analiza de vez en cuando: las preguntas que ya descartaste no vuelven a salir.</span>
        </div>
      ) : (
        <div className="kb-gaps">
          {gaps.map((g) => (
            <GapCard key={g.id} gap={g} />
          ))}
        </div>
      )}
    </section>
  );
}

function GapCard({ gap }: { gap: KnowledgeSuggestionDto }) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState(gap.question);
  const [answer, setAnswer] = useState(gap.answer);
  useEffect(() => {
    setQuestion(gap.question);
    setAnswer(gap.answer);
  }, [gap.id, gap.question, gap.answer]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions"] });
    void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    void queryClient.invalidateQueries({ queryKey: ["knowledge-status"] });
  };
  const accept = useMutation({
    mutationFn: () => acceptKnowledgeSuggestion(gap.id, { question: question.trim(), answer: answer.trim() }),
    onSuccess: () => {
      toast.success("Añadida al conocimiento");
      refresh();
    },
  });
  const dismiss = useMutation({ mutationFn: () => dismissKnowledgeSuggestion(gap.id), onSuccess: refresh });

  return (
    <article className="kb-gap">
      <div className="kb-gap__meta">
        <span className="kb-pill">
          {gap.occurrences} {gap.occurrences === 1 ? "conversación" : "conversaciones"}
        </span>
      </div>
      <label className="label">Pregunta</label>
      <input className="field" value={question} onChange={(e) => setQuestion(e.target.value)} />
      <label className="label" style={{ marginTop: 8 }}>
        Respuesta
      </label>
      <textarea
        className="field"
        style={{ minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
        value={answer}
        placeholder="Nadie la respondió bien todavía: escribe la respuesta correcta."
        onChange={(e) => setAnswer(e.target.value)}
      />
      <div className="kb-gap__actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
          Descartar
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={accept.isPending || question.trim().length < 3 || answer.trim().length < 3}
          onClick={() => accept.mutate()}
        >
          {accept.isPending ? "Guardando…" : "Aprobar y añadir"}
        </button>
      </div>
    </article>
  );
}

function WebTab({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [crawl, setCrawl] = useState(false);
  const run = useMutation({
    mutationFn: () => importKnowledgeUrl({ url: url.trim(), crawl }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-status"] });
      if (r.imported.length) {
        toast.success(
          r.imported.length === 1 ? `Importada: ${r.imported[0]!.title}` : `Importadas ${r.imported.length} páginas`,
        );
        setUrl("");
        onDone();
      } else {
        toast.error("No se importó ninguna página");
      }
    },
  });

  return (
    <section className="card-lift kb-card" style={{ maxWidth: 680 }}>
      <h3>Importar desde tu web</h3>
      <p className="kb-muted">
        Pega la dirección de tu página de preguntas frecuentes, envíos o precios. Driony guarda el texto (sin menús
        ni publicidad) y el agente lo usa para responder. Volver a importar la misma dirección la actualiza.
      </p>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) run.mutate();
        }}
      >
        <input
          className="field"
          type="url"
          inputMode="url"
          placeholder="https://tutienda.com/preguntas-frecuentes"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} />
          <span>
            Incluir las páginas del mismo sitio que enlaza (hasta 15)
            <span className="kb-muted kb-small" style={{ display: "block" }}>
              Útil para un centro de ayuda. Tarda un poco más.
            </span>
          </span>
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={run.isPending || !url.trim()}>
            <NavIcon name="globe" size={14} />
            {run.isPending ? "Importando…" : "Importar"}
          </button>
        </div>
      </form>
      {run.data && run.data.skipped.length > 0 && (
        <div className="kb-skipped">
          <strong className="kb-small">No se importaron:</strong>
          {run.data.skipped.map((s) => (
            <div key={s.url} className="kb-small kb-muted">
              {s.url} — {s.reason}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
