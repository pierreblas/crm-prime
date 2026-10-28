"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavIcon } from "@/components/NavIcons";
import { fetchLossReasons, saveLossReasons } from "@/lib/bff";
import { toast } from "@/lib/toast";

/**
 * «¿Por qué se perdió?» al marcar una o varias oportunidades como perdidas.
 * Un clic en un motivo confirma; «Otro» deja escribirlo; «Sin motivo» también
 * cierra la venta como perdida. Esc o fuera cancela (no se mueve nada).
 */
export function LostReasonDialog({
  count = 1,
  onPick,
  onCancel,
}: {
  count?: number;
  onPick: (reason: string | null) => void;
  onCancel: () => void;
}) {
  const { data: reasons = [], isPending } = useQuery({ queryKey: ["loss-reasons"], queryFn: fetchLossReasons });
  const [other, setOther] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="confirm-backdrop confirm-backdrop--top" onClick={onCancel}>
      <div className="confirm-dialog lr-dialog" role="dialog" aria-label="Motivo de pérdida" onClick={(e) => e.stopPropagation()} data-lost-dialog>
        <header className="lr-dialog__head">
          <span className="lr-dialog__icon"><NavIcon name="x" size={16} /></span>
          <div>
            <h3>{count === 1 ? "¿Por qué se perdió?" : `¿Por qué se perdieron estas ${count}?`}</h3>
            <p>Te ayuda a ver en el panel dónde se te escapan las ventas.</p>
          </div>
        </header>
        <div className="lr-options" role="list">
          {isPending && <div className="skeleton" style={{ height: 120, borderRadius: 10 }} />}
          {reasons.map((r) => (
            <button key={r.id} type="button" role="listitem" className="lr-option" onClick={() => onPick(r.name)}>
              {r.name}
            </button>
          ))}
          {!otherOpen ? (
            <button type="button" role="listitem" className="lr-option is-ghost" onClick={() => setOtherOpen(true)}>
              <NavIcon name="plus" size={13} /> Otro motivo…
            </button>
          ) : (
            <form
              className="lr-other"
              onSubmit={(e) => {
                e.preventDefault();
                if (other.trim()) onPick(other.trim());
              }}
            >
              <input className="field" autoFocus maxLength={120} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Escribe el motivo" aria-label="Otro motivo" />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!other.trim()}>
                Usar
              </button>
            </form>
          )}
        </div>
        <footer className="lr-dialog__foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(null)} data-lost-none>
            Marcar perdida sin motivo
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** La lista de motivos que se ofrecen (se edita en la etapa de perdido). */
export function LossReasonsEditor() {
  const qc = useQueryClient();
  const { data: reasons = [] } = useQuery({ queryKey: ["loss-reasons"], queryFn: fetchLossReasons });
  const [draft, setDraft] = useState<string[] | null>(null);
  const [adding, setAdding] = useState("");
  const list = draft ?? reasons.map((r) => r.name);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(reasons.map((r) => r.name));
  const save = useMutation({
    mutationFn: () => saveLossReasons(list),
    onSuccess: (rows) => {
      qc.setQueryData(["loss-reasons"], rows);
      setDraft(null);
      toast.success("Motivos guardados");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const add = () => {
    const v = adding.trim();
    if (!v || list.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setDraft([...list, v]);
    setAdding("");
  };

  return (
    <div className="lr-editor" data-loss-reasons>
      <div className="lr-chips">
        {list.map((name, i) => (
          <span key={name} className="lr-chip">
            {name}
            <button
              type="button"
              aria-label={`Quitar ${name}`}
              onClick={() => setDraft(list.filter((_, j) => j !== i))}
              disabled={list.length === 1}
              title={list.length === 1 ? "Deja al menos un motivo" : "Quitar"}
            >
              <NavIcon name="x" size={11} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="field field-sm"
          style={{ maxWidth: 260 }}
          value={adding}
          maxLength={80}
          placeholder="Nuevo motivo (p. ej. Sin stock)"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-label="Nuevo motivo"
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={add} disabled={!adding.trim()}>
          Añadir
        </button>
        {dirty && (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.isPending}>
              Guardar motivos
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              Descartar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
