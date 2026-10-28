"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DealEventDto, StageDto } from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { fetchAgents, fetchDealEvents, fetchFlows } from "@/lib/bff";

// ── Barra de acciones en bloque ─────────────────────────────
export type BulkRequest =
  | { action: "move"; stageId: string }
  | { action: "owner"; ownerId: string | null }
  | { action: "tag"; tag: string }
  | { action: "discard" }
  | { action: "flow"; flowId: string; flowName: string }
  | { action: "broadcast" };

/**
 * Aparece abajo con las tarjetas seleccionadas: mover, vendedor, etiqueta,
 * lanzar un flujo o descartar. Cada acción pide su dato en el propio botón.
 */
export function BulkBar({
  count,
  visibleCount,
  stages,
  busy,
  onSelectAll,
  onClear,
  onExit,
  onRun,
}: {
  count: number;
  visibleCount: number;
  stages: StageDto[];
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onExit: () => void;
  onRun: (r: BulkRequest) => void;
}) {
  const [open, setOpen] = useState<"move" | "owner" | "tag" | "flow" | null>(null);
  const [tag, setTag] = useState("");
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents, enabled: open === "owner" });
  const { data: flows } = useQuery({ queryKey: ["flows"], queryFn: fetchFlows, enabled: open === "flow" });
  const activeFlows = (flows?.flows ?? []).filter((f) => f.isActive);
  const run = (r: BulkRequest) => {
    setOpen(null);
    onRun(r);
  };
  const disabled = busy || count === 0;
  const toggle = (k: NonNullable<typeof open>) => setOpen((o) => (o === k ? null : k));

  return (
    <div className="kb-bulk" role="toolbar" aria-label="Acciones con las seleccionadas" data-bulk-bar>
      <div className="kb-bulk__count">
        <strong>{count}</strong> {count === 1 ? "seleccionada" : "seleccionadas"}
        {count < visibleCount ? (
          <button type="button" className="kb-bulk__link" onClick={onSelectAll}>
            Seleccionar las {visibleCount} visibles
          </button>
        ) : (
          count > 0 && (
            <button type="button" className="kb-bulk__link" onClick={onClear}>
              Quitar selección
            </button>
          )
        )}
      </div>

      <div className="kb-bulk__actions">
        <div className="kb-bulk__item">
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => toggle("move")} aria-expanded={open === "move"} data-bulk="move">
            <NavIcon name="pipeline" size={13} /> Mover a…
          </button>
          {open === "move" && (
            <div className="kb-bulk__pop" role="menu">
              {stages.map((s) => (
                <button key={s.id} type="button" role="menuitem" onClick={() => run({ action: "move", stageId: s.id })}>
                  {s.isWon && <NavIcon name="trophy" size={12} />}
                  {s.isLost && <NavIcon name="x" size={12} />}
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="kb-bulk__item">
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => toggle("owner")} aria-expanded={open === "owner"} data-bulk="owner">
            <NavIcon name="user" size={13} /> Vendedor…
          </button>
          {open === "owner" && (
            <div className="kb-bulk__pop" role="menu">
              {agents.map((a) => (
                <button key={a.id} type="button" role="menuitem" onClick={() => run({ action: "owner", ownerId: a.id })}>
                  {a.name ?? a.email}
                </button>
              ))}
              <button type="button" role="menuitem" className="is-muted" onClick={() => run({ action: "owner", ownerId: null })}>
                Sin vendedor
              </button>
            </div>
          )}
        </div>

        <div className="kb-bulk__item">
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => toggle("tag")} aria-expanded={open === "tag"} data-bulk="tag">
            <NavIcon name="tag" size={13} /> Etiquetar…
          </button>
          {open === "tag" && (
            <form
              className="kb-bulk__pop kb-bulk__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (tag.trim()) {
                  run({ action: "tag", tag: tag.trim() });
                  setTag("");
                }
              }}
            >
              <input className="field field-sm" autoFocus value={tag} maxLength={60} onChange={(e) => setTag(e.target.value)} placeholder="Nombre de la etiqueta" aria-label="Etiqueta" />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!tag.trim()}>
                Añadir
              </button>
            </form>
          )}
        </div>

        <div className="kb-bulk__item">
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => toggle("flow")} aria-expanded={open === "flow"} data-bulk="flow">
            <NavIcon name="flow" size={13} /> Lanzar flujo…
          </button>
          {open === "flow" && (
            <div className="kb-bulk__pop" role="menu">
              {activeFlows.length === 0 && <span className="kb-bulk__empty">No hay flujos activos.</span>}
              {activeFlows.map((f) => (
                <button key={f.id} type="button" role="menuitem" onClick={() => run({ action: "flow", flowId: f.id, flowName: f.name })}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => run({ action: "broadcast" })} data-bulk="broadcast" title="Enviar una plantilla de WhatsApp a sus contactos">
          <NavIcon name="megaphone" size={13} /> Difusión
        </button>

        <button type="button" className="btn btn-ghost btn-sm kb-bulk__danger" disabled={disabled} onClick={() => run({ action: "discard" })} data-bulk="discard">
          <NavIcon name="x" size={13} /> Descartar
        </button>
      </div>

      <button type="button" className="btn btn-ghost btn-sm" onClick={onExit} title="Salir de la selección (Esc)">
        Listo
      </button>
    </div>
  );
}

// ── Zonas al arrastrar ──────────────────────────────────────
export type DropTarget = "won" | "lost" | "discard";

/** Abajo, mientras se arrastra una tarjeta: cerrar como ganada, perdida o descartarla. */
export function DropZones({ hasWon, hasLost, onDrop }: { hasWon: boolean; hasLost: boolean; onDrop: (t: DropTarget, dealId: string) => void }) {
  const [over, setOver] = useState<DropTarget | null>(null);
  const zone = (t: DropTarget, label: string, icon: IconName) => (
    <div
      key={t}
      className={`kb-drop is-${t}${over === t ? " is-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (over !== t) setOver(t);
      }}
      onDragLeave={() => setOver((o) => (o === t ? null : o))}
      onDrop={(e) => {
        e.preventDefault();
        setOver(null);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDrop(t, id);
      }}
      data-drop={t}
    >
      <NavIcon name={icon} size={18} />
      {label}
    </div>
  );
  return (
    <div className="kb-drops" aria-hidden="false">
      {hasWon && zone("won", "Ganada", "trophy")}
      {hasLost && zone("lost", "Perdida", "x")}
      {zone("discard", "Descartar", "inbox")}
    </div>
  );
}

// ── Historial en la ficha ───────────────────────────────────
const EVENT_ICON: Record<DealEventDto["kind"], IconName> = {
  created: "plus",
  stage: "pipeline",
  owner: "user",
  discarded: "inbox",
  restored: "jump",
  lost_reason: "x",
  value: "chart",
};

function describe(e: DealEventDto): string {
  switch (e.kind) {
    case "created":
      return `Creada en ${e.toStage ?? "una etapa"}`;
    case "stage":
      return `${e.fromStage ?? "?"} → ${e.toStage ?? "?"}`;
    case "owner":
      return `Vendedor: ${e.detail ?? ""}`;
    case "discarded":
      return e.detail ? `Descartada · ${e.detail}` : "Descartada";
    case "restored":
      return "Restaurada";
    case "lost_reason":
      return `Motivo de pérdida: ${e.detail ?? ""}`;
    case "value":
      return `Valor: ${e.detail ?? ""}`;
  }
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

export function DealHistory({ dealId }: { dealId: string }) {
  const { data = [], isPending, isError } = useQuery({ queryKey: ["deal-events", dealId], queryFn: () => fetchDealEvents(dealId) });
  if (isPending) return <div className="skeleton" style={{ height: 60, borderRadius: 8 }} />;
  if (isError) return <p className="kb-hist__empty">No se pudo cargar el historial.</p>;
  if (!data.length) return <p className="kb-hist__empty">Sin movimientos registrados todavía.</p>;
  return (
    <ol className="kb-hist" data-deal-history>
      {data.map((e) => (
        <li key={e.id} className={`kb-hist__item is-${e.kind}`}>
          <span className="kb-hist__icon"><NavIcon name={EVENT_ICON[e.kind]} size={12} /></span>
          <span className="kb-hist__body">
            <span className="kb-hist__what">{describe(e)}</span>
            <span className="kb-hist__meta">
              <span className={`kb-hist__who is-${e.actor.kind}`}>{e.actor.label}</span> · <time dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString("es")}>{ago(e.createdAt)}</time>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Días en la etapa, para la tarjeta. null si aún no llega a un día. */
export function daysInStage(iso: string): number | null {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d >= 1 ? d : null;
}
