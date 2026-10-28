"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FlowRule, FlowSummary, StageAutomationDto, StageAutomationTrigger, StageConversionEvent, StageDto } from "@crm/shared";
import { metaStandardEvents, stageAutomationTriggers } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { dangerBtn, ghostBtn, input, smBtn } from "@/components/ui";
import {
  applyStageAutomationExisting,
  createStageAutomation,
  deleteStageAutomation,
  fetchAgents,
  fetchCustomFields,
  fetchFlows,
  fetchSources,
  fetchStages,
  fetchTags,
  fetchWhatsappChannels,
  previewStageAutomationExisting,
  updateStage,
  updateStageAutomation,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { RuleRow, newRule, type RuleLookups } from "@/features/flows/RuleRow";
import { LossReasonsEditor } from "./LossReasons";
import { toast } from "@/lib/toast";

/**
 * Configuración de una etapa, compartida por el tablero y por Ajustes:
 * su rol, las conversiones que manda a Meta y sus automatizaciones. Como en
 * Kommo, se abre desde la propia etapa (engranaje) y cada cambio se guarda
 * al momento.
 */

// ── Rol ─────────────────────────────────────────────────────
export type StageRole = "" | "qualified" | "won" | "lost";
export const ROLE_OF = (s: StageDto): StageRole => (s.isWon ? "won" : s.isLost ? "lost" : s.isQualified ? "qualified" : "");
export const ROLE_COLOR: Record<StageRole, string | undefined> = { "": undefined, qualified: "#ffd98a", won: "#7ee2a8", lost: "#e08a8a" };

// ── Automatizaciones ────────────────────────────────────────
export const TRIGGER_LABEL: Record<StageAutomationTrigger, string> = {
  enters_stage: "Entra a la etapa",
  inbound_message: "Mensaje del cliente",
  webhook: "Llega un webhook",
  no_reply: "Tiempo sin respuesta",
};
export const TRIGGER_ICON: Record<StageAutomationTrigger, "pipeline" | "message" | "plug" | "clock"> = {
  enters_stage: "pipeline",
  inbound_message: "message",
  webhook: "plug",
  no_reply: "clock",
};

// ── Conversiones de Meta ────────────────────────────────────
// Eventos estándar de la Conversions API de Meta para mensajería, con su nombre legible.
export const EVENT_LABEL: Record<string, string> = {
  LeadSubmitted: "Lead enviado (LeadSubmitted)",
  Purchase: "Compra (Purchase)",
  Contact: "Contacto (Contact)",
  Schedule: "Cita agendada (Schedule)",
  SubmitApplication: "Solicitud enviada (SubmitApplication)",
  CompleteRegistration: "Registro completado (CompleteRegistration)",
  StartTrial: "Prueba iniciada (StartTrial)",
  Subscribe: "Suscripción (Subscribe)",
  InitiateCheckout: "Inicio de pago (InitiateCheckout)",
  AddToCart: "Añadido al carrito (AddToCart)",
  AddPaymentInfo: "Datos de pago (AddPaymentInfo)",
  ViewContent: "Contenido visto (ViewContent)",
  Lead: "Cliente potencial (Lead)",
  Other: "Otro (Other)",
};
const CUSTOM = "__custom__";
const isStandard = (name: string) => (metaStandardEvents as readonly string[]).includes(name);

/**
 * El diálogo «Configurar etapa». Recibe la etapa ya fresca (quien lo pinta la
 * saca de su consulta, que se refresca con `onChanged`).
 */
export function StageConfigDialog({ stage, onClose, onChanged }: { stage: StageDto; onClose: () => void; onChanged: () => void }) {
  const { data: flowsRes } = useQuery({ queryKey: ["flows"], queryFn: fetchFlows });
  const flows = flowsRes?.flows ?? [];
  const role = useMutation({
    mutationFn: (r: StageRole) => updateStage(stage.id, { isWon: r === "won", isLost: r === "lost", isQualified: r === "qualified" }),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const r = ROLE_OF(stage);

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Configurar etapa ${stage.name}`}
        style={box}
        onClick={(e) => e.stopPropagation()}
        data-stage-config={stage.id}
      >
        <header style={head}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <NavIcon name="settings" size={15} />
            <span style={{ color: "var(--muted)", fontWeight: 500 }}>Etapa</span>
            <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stage.name}</strong>
          </span>
          <button onClick={onClose} style={closeBtn} title="Cerrar" aria-label="Cerrar">
            <NavIcon name="x" size={16} />
          </button>
        </header>

        <div style={body}>
          <section style={section}>
            <div style={sectionHead}>
              <h4 style={h4}>Rol en el embudo</h4>
              <select
                style={{ ...input, width: 170, ...(ROLE_COLOR[r] ? { color: ROLE_COLOR[r] } : {}) }}
                value={r}
                onChange={(e) => role.mutate(e.target.value as StageRole)}
                aria-label={`Rol de ${stage.name}`}
                disabled={role.isPending}
              >
                <option value="">Sin rol</option>
                <option value="qualified">Potencial</option>
                <option value="won">Ganada (compra)</option>
                <option value="lost">Perdida</option>
              </select>
            </div>
            <p style={hint}>
              A dónde manda el agente de IA (<code>mark_lead</code>) a los potenciales, las compras y los perdidos. Un rol por embudo.
            </p>
          </section>

          <section style={section}>
            <div style={sectionHead}>
              <h4 style={h4}>
                <NavIcon name="target" size={14} /> Conversiones de Meta
              </h4>
            </div>
            <p style={hint}>
              Eventos que se envían a Meta (Conversions API) cuando una oportunidad que vino de un anuncio de Click to WhatsApp
              llega a esta etapa. Varios por etapa; cada uno una sola vez por oportunidad.
            </p>
            <ConversionsEditor stage={stage} onChanged={onChanged} />
          </section>

          <section style={section}>
            <div style={sectionHead}>
              <h4 style={h4}>
                <NavIcon name="zap" size={14} /> Automatizaciones
              </h4>
            </div>
            <p style={hint}>«Cuando pase X, ejecuta el flujo Y». Tantas como quieras.</p>
            <AutomationsEditor stage={stage} flows={flows} onChanged={onChanged} />
          </section>
          {stage.isLost && (
            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h4 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <NavIcon name="x" size={15} /> Motivos de pérdida
              </h4>
              <p style={hint}>Se ofrecen al marcar una oportunidad como perdida. En el panel ves cuáles se repiten.</p>
              <LossReasonsEditor />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Conversiones de Meta de una etapa: la lista de eventos que se envían cuando
 * una oportunidad que vino de un anuncio llega aquí. Varios por etapa, como
 * en Kommo: «Potencial» manda LeadSubmitted, «Ganada» Purchase con el valor,
 * y cualquier etapa puede mandar Contact, Schedule o uno propio.
 */
export function ConversionsEditor({ stage, onChanged }: { stage: StageDto; onChanged: () => void }) {
  const save = useMutation({
    mutationFn: (conversionEvents: StageConversionEvent[]) => updateStage(stage.id, { conversionEvents }),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const list = stage.conversionEvents;
  const firstFree = metaStandardEvents.find((n) => !list.some((e) => e.eventName === n)) ?? "Other";
  const set = (i: number, patch: Partial<StageConversionEvent>) =>
    save.mutate(list.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <div className="ps-autos" style={autosBox} data-conversions-editor={stage.id}>
      {list.map((e, i) => (
        <ConversionRow
          key={`${i}-${e.eventName}`}
          e={e}
          taken={list.filter((_, j) => j !== i).map((x) => x.eventName)}
          onSave={(patch) => set(i, patch)}
          onDelete={() => save.mutate(list.filter((_, j) => j !== i))}
        />
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => save.mutate([...list, { eventName: firstFree, withValue: firstFree === "Purchase" }])}
          disabled={save.isPending || list.length >= 10}
          style={{ ...ghostBtn, ...smBtn }}
        >
          + Añadir evento
        </button>
        <span style={hint}>
          {list.length === 0 ? "Ejemplo: «Compra (Purchase)» en la etapa ganada, «Cita agendada» cuando se reserva. " : ""}
          Solo con las conversiones activadas en{" "}
          <a href="/settings?tab=integrations" style={{ color: "var(--accent-text)" }}>Integraciones</a>.
        </span>
      </div>
    </div>
  );
}

function ConversionRow({
  e,
  taken,
  onSave,
  onDelete,
}: {
  e: StageConversionEvent;
  taken: string[];
  onSave: (patch: Partial<StageConversionEvent>) => void;
  onDelete: () => void;
}) {
  const custom = !isStandard(e.eventName);
  const [name, setName] = useState(custom ? e.eventName : "");
  useEffect(() => setName(custom ? e.eventName : ""), [custom, e.eventName]);
  const commitName = () => {
    const v = name.trim();
    if (v && v !== e.eventName && !taken.includes(v)) onSave({ eventName: v });
  };
  const valueLocked = e.eventName === "Purchase";

  return (
    <div style={stageRow} data-conversion-event={e.eventName}>
      <span style={{ color: "var(--accent-text)", display: "inline-flex", width: 20, justifyContent: "center" }}>
        <NavIcon name="target" size={14} />
      </span>
      <select
        style={{ ...input, width: custom ? 200 : 250 }}
        value={custom ? CUSTOM : e.eventName}
        onChange={(ev) => {
          const v = ev.target.value;
          if (v === CUSTOM) {
            setName("");
            onSave({ eventName: "MiEvento", withValue: e.withValue });
          } else onSave({ eventName: v, withValue: v === "Purchase" ? true : e.withValue });
        }}
        aria-label="Evento"
      >
        {metaStandardEvents.map((n) => (
          <option key={n} value={n} disabled={n !== e.eventName && taken.includes(n)}>
            {EVENT_LABEL[n]}
          </option>
        ))}
        <option value={CUSTOM}>Nombre propio…</option>
      </select>
      {custom && (
        <input
          style={{ ...input, width: 150 }}
          value={name}
          placeholder="Ej. CotizacionEnviada"
          onChange={(ev) => setName(ev.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
          onBlur={commitName}
          onKeyDown={(ev) => ev.key === "Enter" && commitName()}
          aria-label="Nombre del evento"
          title="Letras, números y guion bajo, sin espacios"
        />
      )}
      <label
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)", cursor: valueLocked ? "default" : "pointer" }}
        title={valueLocked ? "Purchase lleva siempre el valor y la moneda de la oportunidad" : "Enviar también el valor y la moneda de la oportunidad"}
      >
        <input type="checkbox" checked={valueLocked || e.withValue} disabled={valueLocked} onChange={(ev) => onSave({ withValue: ev.target.checked })} aria-label="Con valor" />
        con valor
      </label>
      <button onClick={onDelete} style={{ ...dangerBtn, ...smBtn, padding: "6px 8px" }} title="Quitar evento">
        <NavIcon name="x" size={13} />
      </button>
    </div>
  );
}

/**
 * Lista libre de automatizaciones de una etapa: «cuando pase X, ejecuta el
 * flujo Y». Tantas como se quiera; cada cambio se guarda al momento.
 */
export function AutomationsEditor({
  stage,
  flows,
  onChanged,
}: {
  stage: StageDto;
  flows: FlowSummary[];
  onChanged: () => void;
}) {
  const add = useMutation({
    mutationFn: () => createStageAutomation(stage.id, { trigger: "enters_stage", flowId: flows[0]!.id, enabled: true }),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const save = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof updateStageAutomation>[1]) => updateStageAutomation(id, input),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({
    mutationFn: deleteStageAutomation,
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  // Catálogos para los filtros (etiquetas, fuentes, etapas…), los mismos que usan los flujos.
  const { data: tags = [] } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const { data: sources = [] } = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const { data: fields = [] } = useQuery({ queryKey: ["custom-fields"], queryFn: fetchCustomFields });
  const { data: stages = [] } = useQuery({ queryKey: ["stages-ref"], queryFn: fetchStages });
  const { data: channels = [] } = useQuery({ queryKey: ["wa-channels"], queryFn: fetchWhatsappChannels });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const lookups: RuleLookups = {
    variables: [],
    fields,
    tags,
    sources,
    stages: stages.map((s) => ({ id: s.id, name: `${s.pipelineName} › ${s.name}` })),
    channels: channels.map((c) => ({ id: c.id, label: c.label ?? null, displayPhoneNumber: c.displayPhoneNumber ?? null })),
    agents: agents.map((ag) => ({ id: ag.id, name: ag.name ?? null, email: ag.email })),
  };
  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(
      () => toast.success("URL copiada"),
      () => toast.error("No se pudo copiar"),
    );
  };

  return (
    <div className="ps-autos" style={autosBox}>
      {stage.automations.map((a) => (
        <AutomationRow key={a.id} a={a} flows={flows} lookups={lookups} onSave={(input) => save.mutate({ id: a.id, ...input })} onDelete={() => del.mutate(a.id)} onCopy={copy} />
      ))}
      {flows.length === 0 ? (
        <div style={hint}>
          Aún no hay flujos. Crea uno en <a href="/flows" style={{ color: "var(--accent-text)" }}>Flujos</a> con el disparador «Solo desde una etapa del embudo» y vuelve aquí para engancharlo.
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => add.mutate()} disabled={add.isPending} style={{ ...ghostBtn, ...smBtn }}>
            + Añadir automatización
          </button>
          {stage.automations.length === 0 && (
            <span style={hint}>Ejemplo: «Entra a la etapa, después de 1 día → Flujo de seguimiento», solo si «Etiqueta del contacto es VIP».</span>
          )}
        </div>
      )}
    </div>
  );
}

function AutomationRow({
  a,
  flows,
  lookups,
  onSave,
  onDelete,
  onCopy,
}: {
  a: StageAutomationDto;
  flows: FlowSummary[];
  lookups: RuleLookups;
  onSave: (input: Parameters<typeof updateStageAutomation>[1]) => void;
  onDelete: () => void;
  onCopy: (url: string) => void;
}) {
  // Minutos ↔ unidad legible (min / h / días) sin perder lo que el usuario escribe.
  const toParts = (m: number) => {
    const un: "min" | "h" | "d" = m % 1440 === 0 ? "d" : m % 60 === 0 ? "h" : "min";
    return { un, amt: String(un === "d" ? m / 1440 : un === "h" ? m / 60 : m) };
  };
  const initial = toParts(a.delayMinutes ?? (a.trigger === "no_reply" ? 1440 : 60));
  const [amount, setAmount] = useState(initial.amt);
  const [u, setU] = useState<"min" | "h" | "d">(initial.un);
  useEffect(() => {
    const p = toParts(a.delayMinutes ?? (a.trigger === "no_reply" ? 1440 : 60));
    setU(p.un);
    setAmount(p.amt);
  }, [a.delayMinutes, a.trigger]);
  const commitDelay = (amt: string, un: "min" | "h" | "d") => {
    const n = Math.max(1, Math.round(Number(amt) || 0));
    const m = Math.min(43200, un === "d" ? n * 1440 : un === "h" ? n * 60 : n);
    if (m !== a.delayMinutes) onSave({ delayMinutes: m });
  };
  const flowGone = !flows.some((f) => f.id === a.flowId);
  const waits = a.trigger === "no_reply" || (a.trigger === "enters_stage" && a.delayMinutes != null);

  // Filtros: borrador local; se guardan con un botón (no en cada tecla).
  const [rules, setRules] = useState<FlowRule[]>(a.conditions.rules);
  const [match, setMatch] = useState<"all" | "any">(a.conditions.match);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    setRules(a.conditions.rules);
    setMatch(a.conditions.match);
  }, [a.conditions]);
  const dirty = JSON.stringify({ match, rules }) !== JSON.stringify({ match: a.conditions.match, rules: a.conditions.rules });
  // Un filtro sin valor (salvo «vacío / no vacío») no deja pasar a nadie: no se guarda.
  const incomplete = rules.some((r) => !["empty", "not_empty"].includes(r.op) && !(r.value ?? "").trim());
  const nFilters = a.conditions.rules.length;

  // «Aplicar a los que ya están»: primero cuántos, luego confirmar.
  const apply = useMutation({
    mutationFn: async () => {
      const p = await previewStageAutomationExisting(a.id);
      if (p.toRun === 0) {
        toast.success(
          p.total === 0
            ? "No hay oportunidades en esta etapa."
            : p.matching === 0
              ? `Hay ${p.total} en la etapa, pero ninguna cumple los filtros.`
              : "Todas las que cumplen los filtros ya pasaron por esta automatización.",
        );
        return null;
      }
      const minutes = Math.ceil((p.toRun * p.gapSeconds) / 60);
      const ok = await confirmDialog({
        title: "Aplicar a los que ya están",
        message:
          `${p.toRun} de ${p.total} oportunidades de esta etapa recibirán «${a.flowName}»` +
          (nFilters ? " (las que cumplen los filtros)" : "") +
          (p.alreadyRan ? `. ${p.alreadyRan} ya pasaron por aquí y no se repiten` : "") +
          `. Se lanza una cada ${p.gapSeconds} s, así que tardará unos ${minutes} min.` +
          (p.matching > p.limit ? ` Como máximo ${p.limit} por vez.` : "") +
          " Si alguna lleva más de 24 h sin escribir, el flujo tiene que empezar con una plantilla.",
        confirmLabel: `Aplicar a ${p.toRun}`,
      });
      return ok ? applyStageAutomationExisting(a.id) : null;
    },
    onSuccess: (r) => r && toast.success(`En marcha: ${r.queued} en cola. Puedes cerrar esta ventana.`),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className={`sa-card${a.enabled ? "" : " is-off"}`} data-automation={a.id}>
      <div style={stageRow}>
        <span style={{ color: "var(--accent-text)", display: "inline-flex", width: 20, justifyContent: "center" }}>
          <NavIcon name={TRIGGER_ICON[a.trigger]} size={14} />
        </span>
        <select
          style={{ ...input, width: 190 }}
          value={a.trigger}
          onChange={(e) => onSave({ trigger: e.target.value as StageAutomationTrigger })}
          aria-label="Cuándo"
        >
          {stageAutomationTriggers.map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABEL[t]}
            </option>
          ))}
        </select>
        {a.trigger === "enters_stage" && (
          <select
            style={{ ...input, width: 130 }}
            value={a.delayMinutes == null ? "now" : "later"}
            onChange={(e) => onSave({ delayMinutes: e.target.value === "now" ? null : 60 })}
            aria-label="Cuándo actuar"
            data-delay-mode
          >
            <option value="now">al instante</option>
            <option value="later">después de…</option>
          </select>
        )}
        {waits && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              style={{ ...input, width: 56 }}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => commitDelay(amount, u)}
              onKeyDown={(e) => e.key === "Enter" && commitDelay(amount, u)}
              aria-label="Cuánto tiempo"
            />
            <select
              style={{ ...input, width: 78 }}
              value={u}
              onChange={(e) => {
                const un = e.target.value as "min" | "h" | "d";
                setU(un);
                commitDelay(amount, un);
              }}
              aria-label="Unidad"
            >
              <option value="min">min</option>
              <option value="h">horas</option>
              <option value="d">días</option>
            </select>
          </span>
        )}
        <span style={{ color: "var(--muted)", fontSize: 13 }}>→</span>
        <select
          style={{ ...input, flex: "1 1 140px", minWidth: 0, ...(flowGone ? { color: "#e08a8a" } : {}) }}
          value={a.flowId}
          onChange={(e) => onSave({ flowId: e.target.value })}
          aria-label="Flujo"
          title={a.flowActive ? "Flujo que se ejecuta" : "Este flujo está desactivado: actívalo en Flujos para que corra"}
        >
          {flowGone && <option value={a.flowId}>{a.flowName} (ya no existe)</option>}
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {!f.isActive ? " · desactivado" : ""}
            </option>
          ))}
        </select>
        {a.trigger === "webhook" && a.webhookUrl && (
          <button
            onClick={() => onCopy(a.webhookUrl!)}
            style={{ ...ghostBtn, ...smBtn, padding: "6px 9px" }}
            title={`Copiar la URL del webhook\n${a.webhookUrl}`}
            aria-label="Copiar URL del webhook"
          >
            <NavIcon name="copy" size={14} />
          </button>
        )}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }} title="Activa o pausa esta automatización">
          <input type="checkbox" checked={a.enabled} onChange={(e) => onSave({ enabled: e.target.checked })} aria-label="Activa" />
          activa
        </label>
        <button onClick={onDelete} style={{ ...dangerBtn, ...smBtn, padding: "6px 8px" }} title="Quitar automatización">
          <NavIcon name="x" size={13} />
        </button>
      </div>

      <div className="sa-card__foot">
        <button type="button" className={`sa-link${nFilters ? " is-on" : ""}`} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} data-filters-toggle>
          <NavIcon name="target" size={12} />
          {nFilters ? `Solo si cumple ${nFilters === 1 ? "1 filtro" : `${nFilters} filtros`}${nFilters > 1 ? (a.conditions.match === "all" ? " (todos)" : " (alguno)") : ""}` : "Con todos · añadir filtros"}
        </button>
        {a.trigger === "enters_stage" && (
          <button type="button" className="sa-link" onClick={() => apply.mutate()} disabled={apply.isPending || !a.enabled} title={a.enabled ? "Lanzar este flujo a las oportunidades que ya estaban en la etapa" : "Actívala primero"} data-apply-existing>
            <NavIcon name="play" size={12} />
            {apply.isPending ? "Consultando…" : "Aplicar a los que ya están"}
          </button>
        )}
      </div>

      {filtersOpen && (
        <div className="sa-filters" data-filters>
          {rules.length > 1 && (
            <label style={{ fontSize: 12.5, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              Actúa si cumple
              <select style={{ ...input, width: "auto", padding: "4px 8px", fontSize: 12.5 }} value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")}>
                <option value="all">todos los filtros</option>
                <option value="any">alguno de los filtros</option>
              </select>
            </label>
          )}
          {rules.map((r, i) => (
            <RuleRow
              key={r.id}
              rule={r}
              lookups={lookups}
              onChange={(p) => setRules(rules.map((x, j) => (j === i ? { ...x, ...p } : x)))}
              onRemove={() => setRules(rules.filter((_, j) => j !== i))}
            />
          ))}
          {rules.length === 0 && <span style={hint}>Sin filtros: actúa con todas las oportunidades. Por ejemplo, «Etiqueta del contacto es VIP» o «Valor de su oportunidad mayor que 500».</span>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {rules.length < 10 && (
              <button type="button" style={{ ...ghostBtn, ...smBtn }} onClick={() => setRules([...rules, newRule("tag", "is", "")])}>
                + Filtro
              </button>
            )}
            {dirty && (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onSave({ conditions: { match, rules } })}
                  disabled={incomplete}
                  title={incomplete ? "Completa el valor de cada filtro" : undefined}
                  data-filters-save
                >
                  Guardar filtros
                </button>
                <button
                  type="button"
                  style={{ ...ghostBtn, ...smBtn }}
                  onClick={() => {
                    setRules(a.conditions.rules);
                    setMatch(a.conditions.match);
                  }}
                >
                  Descartar
                </button>
                {incomplete && <span style={{ ...hint, marginTop: 0 }}>Completa el valor de cada filtro para guardar.</span>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Estilos ─────────────────────────────────────────────────
export const stageRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
};

export const hint: React.CSSProperties = { color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45, marginTop: 4 };

export const autosBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "color-mix(in oklab, var(--accent) 6%, transparent)",
};

/** Engranaje pequeño que abre «Configurar etapa» desde la propia etapa. */
export const gearBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  padding: 3,
  borderRadius: 6,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const box: React.CSSProperties = {
  width: 720,
  maxWidth: "100%",
  maxHeight: "min(86vh, 820px)",
  display: "flex",
  flexDirection: "column",
  borderRadius: 12,
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  boxShadow: "var(--shadow-card)",
  overflow: "hidden",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  background: "var(--panel)",
};

const closeBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  padding: 4,
  display: "inline-flex",
};

const body: React.CSSProperties = {
  padding: "6px 16px 16px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
};

const section: React.CSSProperties = {
  padding: "12px 0 14px",
  borderBottom: "1px solid var(--border)",
};

const sectionHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
};

const h4: React.CSSProperties = {
  margin: 0,
  fontSize: 13.5,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
