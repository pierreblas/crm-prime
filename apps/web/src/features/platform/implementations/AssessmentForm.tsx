"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COMPLEXITY_LEVELS,
  COMPLEXITY_POINTS,
  DEFAULT_COMPLEXITY,
  RISK_FLAGS,
  complexityScore,
  type AssessmentScope,
  type ComplexityFactor,
  type CreateAssessmentInput,
  type ImplementationAssessment,
  type RiskFlag,
} from "@crm/shared";
import { toast } from "@/lib/toast";
import { createImplementation, fetchPlatformOrgs, updateImplementation } from "@/lib/bff";
import { ACCESS_LABEL, BAND_LABEL, BAND_TONE, FACTOR_LABEL, LEVEL_LABEL, RISK_LABEL } from "./labels";

type Form = CreateAssessmentInput;

const emptyScope = (): AssessmentScope => ({
  businessSummary: "",
  currentProcess: "",
  monthlyLeads: null,
  agentsCount: null,
  schedule: "",
  country: "Perú",
  systems: [],
  aiShould: "",
  aiNever: "",
  escalation: "",
  paymentVerification: false,
  complexity: { ...DEFAULT_COMPLEXITY },
  notes: "",
});

const emptyForm = (): Form => ({
  title: "",
  clientName: "",
  clientContact: "",
  orgId: null,
  sector: "",
  objective: "",
  scope: emptyScope(),
  riskFlags: [],
});

const fromAssessment = (a: ImplementationAssessment): Form => ({
  title: a.title,
  clientName: a.clientName,
  clientContact: a.clientContact,
  orgId: a.orgId,
  sector: a.sector,
  objective: a.objective,
  scope: a.scope,
  riskFlags: a.riskFlags,
});

/**
 * Pasos 1 y 2 del cotizador: cliente y objetivo, y alcance con los cinco
 * factores de complejidad y las señales de riesgo. Sirve para crear y para
 * editar. La puntuación se enseña en vivo, pero la que vale la calcula la API.
 */
export function AssessmentForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: ImplementationAssessment;
  onSaved: (a: ImplementationAssessment) => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<Form>(() => (initial ? fromAssessment(initial) : emptyForm()));
  const orgs = useQuery({ queryKey: ["platform", "orgs", ""], queryFn: () => fetchPlatformOrgs("") });

  const save = useMutation({
    mutationFn: () => (initial ? updateImplementation(initial.id, form) : createImplementation(form)),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ["platform", "impl"] });
      toast.success(initial ? "Diagnóstico guardado" : "Diagnóstico creado");
      onSaved(a);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const cx = useMemo(() => complexityScore(form.scope.complexity), [form.scope.complexity]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setScope = <K extends keyof AssessmentScope>(k: K, v: AssessmentScope[K]) => setForm((f) => ({ ...f, scope: { ...f.scope, [k]: v } }));
  const toggleRisk = (r: RiskFlag) => set("riskFlags", form.riskFlags.includes(r) ? form.riskFlags.filter((x) => x !== r) : [...form.riskFlags, r]);

  const step1Ok = form.title.trim().length > 0 && form.clientName.trim().length > 0;

  // Señales que el alcance sugiere y aún no están marcadas: se añaden con un clic, nunca solas.
  const suggested = useMemo(() => {
    const s: RiskFlag[] = [];
    const c = form.scope.complexity;
    if (c.integrations === "custom") s.push("undocumented_api");
    if (c.data === "scattered" || c.data === "migration") s.push("messy_data");
    if (form.scope.paymentVerification) s.push("payment_verification");
    if (form.scope.systems.some((x) => /meta|facebook|business manager/i.test(x.name) && x.access !== "full")) s.push("no_meta_access");
    return s.filter((r) => !form.riskFlags.includes(r));
  }, [form.scope, form.riskFlags]);

  const orgList = useMemo(() => [...(orgs.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "es")), [orgs.data]);

  return (
    <section className="pc-panel" data-assessment-form>
      <div className="pc-steps" style={{ marginBottom: 14 }}>
        <div className="seg" role="tablist" aria-label="Pasos del diagnóstico">
          <button type="button" role="tab" aria-selected={step === 1} onClick={() => setStep(1)}>
            1 · Cliente y objetivo
          </button>
          <button type="button" role="tab" aria-selected={step === 2} onClick={() => setStep(2)} disabled={!initial && !step1Ok} title={!initial && !step1Ok ? "Primero el título y el cliente" : undefined}>
            2 · Alcance y complejidad
          </button>
        </div>
        <span className="pc-muted" style={{ fontSize: 12.5 }}>
          {initial ? "Los cambios no tocan las versiones ya aprobadas de la cotización." : "Se guarda como borrador; la cotización se abre después."}
        </span>
      </div>

      {step === 1 && (
        <div className="pc-form">
          <label className="full">
            Título del proyecto *
            <input className="pc-input" value={form.title} maxLength={160} onChange={(e) => set("title", e.target.value)} placeholder="Clínica Sonrisa · WhatsApp con agente y agenda" aria-label="Título" />
          </label>
          <label>
            Cliente *
            <input className="pc-input" value={form.clientName} maxLength={160} onChange={(e) => set("clientName", e.target.value)} placeholder="Razón social o nombre comercial" aria-label="Cliente" />
          </label>
          <label>
            Contacto
            <input className="pc-input" value={form.clientContact} maxLength={300} onChange={(e) => set("clientContact", e.target.value)} placeholder="Nombre · correo · teléfono" aria-label="Contacto" />
          </label>
          <label>
            Empresa en Driony
            <select className="pc-input" value={form.orgId ?? ""} onChange={(e) => set("orgId", e.target.value || null)} aria-label="Empresa en Driony">
              <option value="">Todavía sin cuenta (prospecto)</option>
              {orgList.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.slug}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sector
            <input className="pc-input" value={form.sector} maxLength={120} onChange={(e) => set("sector", e.target.value)} placeholder="Salud, inmobiliaria, educación…" aria-label="Sector" />
          </label>
          <label>
            País / moneda del cliente
            <input className="pc-input" value={form.scope.country} maxLength={80} onChange={(e) => setScope("country", e.target.value)} aria-label="País" />
          </label>
          <label>
            Consultas o leads al mes (aprox.)
            <input className="pc-input" type="number" min={0} value={form.scope.monthlyLeads ?? ""} onChange={(e) => setScope("monthlyLeads", e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))))} aria-label="Leads al mes" />
          </label>
          <label>
            Asesores que atienden
            <input className="pc-input" type="number" min={0} value={form.scope.agentsCount ?? ""} onChange={(e) => setScope("agentsCount", e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))))} aria-label="Asesores" />
          </label>
          <label>
            Horarios de atención
            <input className="pc-input" value={form.scope.schedule} maxLength={300} onChange={(e) => setScope("schedule", e.target.value)} placeholder="L–V 9–18, sábados hasta 13" aria-label="Horarios" />
          </label>
          <label className="full">
            Objetivo comercial
            <textarea className="pc-notes" value={form.objective} maxLength={2000} onChange={(e) => set("objective", e.target.value)} placeholder="Qué quiere conseguir el cliente con la implementación: más citas, menos tiempo de respuesta, vender fuera de horario…" aria-label="Objetivo" />
          </label>
          <label className="full">
            Qué vende y cuál es el problema hoy
            <textarea className="pc-notes" value={form.scope.businessSummary} maxLength={4000} onChange={(e) => setScope("businessSummary", e.target.value)} aria-label="Resumen del negocio" />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="pc-form">
          <label className="full">
            Proceso actual de atención
            <textarea className="pc-notes" value={form.scope.currentProcess} maxLength={4000} onChange={(e) => setScope("currentProcess", e.target.value)} placeholder="Quién contesta, por dónde, cómo se agenda o se cobra hoy" aria-label="Proceso actual" />
          </label>

          <div className="pc-field full">
            Sistemas actuales y nivel de acceso del cliente
            <SystemsEditor value={form.scope.systems} onChange={(v) => setScope("systems", v)} />
          </div>

          <label>
            Qué debe hacer la IA
            <textarea className="pc-notes" value={form.scope.aiShould} maxLength={4000} onChange={(e) => setScope("aiShould", e.target.value)} placeholder="Responder preguntas frecuentes, calificar, agendar…" aria-label="Qué debe hacer la IA" />
          </label>
          <label>
            Qué nunca debe hacer sin una persona
            <textarea className="pc-notes" value={form.scope.aiNever} maxLength={4000} onChange={(e) => setScope("aiNever", e.target.value)} placeholder="Confirmar pagos, prometer descuentos, dar diagnósticos médicos…" aria-label="Qué nunca debe hacer la IA" />
          </label>
          <label className="full">
            Escalamiento y verificación
            <textarea className="pc-notes" value={form.scope.escalation} maxLength={4000} onChange={(e) => setScope("escalation", e.target.value)} placeholder="Cuándo pasa a un asesor, quién verifica los pagos, horarios de guardia" aria-label="Escalamiento" />
          </label>
          <label className="pc-check full">
            <input type="checkbox" checked={form.scope.paymentVerification} onChange={(e) => setScope("paymentVerification", e.target.checked)} />
            El proceso incluye verificar pagos (Yape, transferencias, pasarela)
          </label>

          <div className="pc-field full">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>Complejidad orientativa</span>
              <span className={`pc-badge is-${BAND_TONE[cx.band]}`} data-complexity>
                {cx.score} puntos · {BAND_LABEL[cx.band]}
              </span>
              <span className="pc-muted" style={{ fontSize: 12 }}>0–3 baja · 4–9 media · 10+ alta. Orienta, no fija el precio.</span>
            </div>
            <div className="pc-form" style={{ marginTop: 6 }}>
              {(Object.keys(COMPLEXITY_LEVELS) as ComplexityFactor[]).map((factor) => (
                <label key={factor}>
                  {FACTOR_LABEL[factor]}
                  <select
                    className="pc-input"
                    value={form.scope.complexity[factor]}
                    aria-label={FACTOR_LABEL[factor]}
                    onChange={(e) => setScope("complexity", { ...form.scope.complexity, [factor]: e.target.value } as AssessmentScope["complexity"])}
                  >
                    {COMPLEXITY_LEVELS[factor].map((level) => {
                      const pts = (COMPLEXITY_POINTS[factor] as Record<string, number>)[level] ?? 0;
                      return (
                        <option key={level} value={level}>
                          {LEVEL_LABEL[factor][level]} {pts > 0 ? `· +${pts}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="pc-field full">
            Señales de riesgo
            <div className="pc-checks">
              {RISK_FLAGS.map((r) => (
                <label key={r} className="pc-check">
                  <input type="checkbox" checked={form.riskFlags.includes(r)} onChange={() => toggleRisk(r)} />
                  {RISK_LABEL[r]}
                </label>
              ))}
            </div>
            {suggested.length > 0 && (
              <div className="pc-ref" style={{ marginTop: 4 }}>
                <span className="pc-muted" style={{ fontSize: 12 }}>Por lo que marcaste arriba, revisa:</span>
                {suggested.map((r) => (
                  <button key={r} type="button" className="pc-chip" onClick={() => toggleRisk(r)} title="Añadir esta señal">
                    + {RISK_LABEL[r]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="full">
            Notas internas
            <textarea className="pc-notes" value={form.scope.notes} maxLength={8000} onChange={(e) => setScope("notes", e.target.value)} placeholder="Lo que no va en la propuesta. Nunca claves ni contraseñas." aria-label="Notas internas" />
          </label>
        </div>
      )}

      <div className="pc-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={save.isPending}>
            {initial ? "Cerrar" : "Cancelar"}
          </button>
        )}
        {step === 1 && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={!step1Ok} onClick={() => setStep(2)} data-next-step>
            Siguiente: alcance
          </button>
        )}
        {(step === 2 || initial) && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!step1Ok || save.isPending} onClick={() => save.mutate()} data-save-assessment>
            {save.isPending ? "Guardando…" : initial ? "Guardar diagnóstico" : "Crear diagnóstico"}
          </button>
        )}
      </div>
    </section>
  );
}

function SystemsEditor({ value, onChange }: { value: AssessmentScope["systems"]; onChange: (v: AssessmentScope["systems"]) => void }) {
  const update = (i: number, patch: Partial<AssessmentScope["systems"][number]>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {value.map((s, i) => (
        <div key={i} className="pc-actions">
          <input className="pc-input" style={{ flex: 1, minWidth: 180 }} value={s.name} maxLength={120} onChange={(e) => update(i, { name: e.target.value })} placeholder="WhatsApp Business, Meta Business Manager, ERP, pasarela…" aria-label={`Sistema ${i + 1}`} />
          <select className="pc-select" value={s.access} onChange={(e) => update(i, { access: e.target.value as AssessmentScope["systems"][number]["access"] })} aria-label={`Acceso al sistema ${i + 1}`}>
            {(Object.keys(ACCESS_LABEL) as Array<keyof typeof ACCESS_LABEL>).map((k) => (
              <option key={k} value={k}>
                {ACCESS_LABEL[k]}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Quitar sistema">
            Quitar
          </button>
        </div>
      ))}
      {value.length < 30 && (
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...value, { name: "", access: "unknown" }])} data-add-system>
            + Añadir sistema
          </button>
        </div>
      )}
    </div>
  );
}
