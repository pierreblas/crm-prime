"use client";

import { useQuery } from "@tanstack/react-query";
import {
  FOLLOW_UP_BEFORE_CLOSE_MAX,
  FOLLOW_UP_BEFORE_CLOSE_MIN,
  FOLLOW_UP_MAX_STAGE_TEMPLATES,
  FOLLOW_UP_MAX_STEPS,
  FOLLOW_UP_QUIET_OFF,
  WHATSAPP_WINDOW_MINUTES,
  fillTemplateText,
  followUpTemplateVars,
  followUpTimeline,
  followUpVarSources,
  namedTemplateVars,
  templateVarCount,
  type FollowUpKind,
  type FollowUpMoment,
  type FollowUpQuiet,
  type FollowUpStageTemplate,
  type FollowUpStep,
  type FollowUpVar,
  type FollowUpVarSource,
  type TemplateDto,
  type FollowUpTiming,
  type FollowUps,
} from "@crm/shared";
import { fetchStages, fetchTemplates } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { field, label as lbl, ghostBtn } from "./styles";
import { VarTextarea } from "./VarTextarea";
import { BUILTIN_VARS, type PromptVar } from "./promptMarks";
import { TIMEZONES } from "./agentCopy";

const KIND_LABEL: Record<FollowUpKind, string> = {
  ai: "Lo redacta la IA",
  text: "Un texto fijo",
  template: "Una plantilla aprobada",
};

const TIMING_LABEL: Record<FollowUpTiming, string> = {
  after: "Tras un tiempo sin respuesta",
  before_close: "Antes del cierre de la ventana",
};

const VAR_SOURCE_LABEL: Record<FollowUpVarSource, string> = {
  contact_name: "El nombre del cliente",
  product: "Lo que consultó en el catálogo",
  static: "Un texto fijo",
};

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "marketing",
  UTILITY: "utilidad",
  AUTHENTICATION: "autenticación",
};

const META_PRICING_URL = "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing";

type Unit = "min" | "h" | "d";
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 };

/** Minutos guardados → la unidad más natural para mostrarlos. */
function splitMinutes(minutes: number): { value: number; unit: Unit } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "d" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "h" };
  return { value: minutes, unit: "min" };
}

/** «2 h», «23 h 30 min», «3 días»: un rato, en corto. */
function span(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const m = minutes % 60;
    return `${Math.floor(minutes / 60)} h${m ? ` ${m} min` : ""}`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return `${d} ${d === 1 ? "día" : "días"}${h ? ` ${h} h` : ""}`;
}

/** «a las 2 h», «a los 30 min», «a 2 días»: cuándo cae un toque desde el último mensaje del cliente. */
function at(minutes: number): string {
  return `${minutes < 60 ? "a los" : minutes < 1440 ? "a las" : "a"} ${span(minutes)}`;
}

/**
 * Un toque nuevo con una cadencia razonable según su posición: a las 2 h la
 * IA retoma la charla; después, plantillas (ya fuera de la ventana de 24 h).
 */
export function defaultFollowUpStep(index: number): FollowUpStep {
  const base = { timing: "after" as const, beforeCloseMinutes: 60, text: "", templateId: null, vars: [], byStage: [] };
  const presets: FollowUpStep[] = [
    { ...base, afterMinutes: 120, kind: "ai" },
    { ...base, afterMinutes: 1440, kind: "template" },
    { ...base, afterMinutes: 2880, kind: "template" },
    { ...base, afterMinutes: 4320, kind: "template" },
  ];
  return presets[Math.min(index, presets.length - 1)]!;
}

/** Parte del ancho de la franja que ocupa la ventana de 24 h. */
const WINDOW_SHARE = 68;
/** Separación mínima entre dos marcas, en % del ancho, para que no se pisen. */
const MARK_GAP = 9;

/**
 * Dónde va cada marca en la franja, en %. Dentro de la ventana, a escala;
 * fuera, repartidas en orden (pueden ser días y no cabrían a escala).
 */
function markPositions(moments: FollowUpMoment[]): number[] {
  const outside = moments.filter((m) => m.outside).length;
  let k = 0;
  const xs = moments.map((m) =>
    m.outside ? WINDOW_SHARE + (++k / (outside + 1)) * (100 - WINDOW_SHARE) : (m.minutes / WHATSAPP_WINDOW_MINUTES) * WINDOW_SHARE,
  );
  // Las de dentro no se pisan ni cruzan el cierre: primero se abren hacia la
  // derecha y, si la última se pasa, se recogen hacia la izquierda.
  const inside = moments.map((m, i) => (m.outside ? -1 : i)).filter((i) => i >= 0);
  inside.forEach((i, n) => {
    xs[i] = Math.max(xs[i]!, n ? xs[inside[n - 1]!]! + MARK_GAP : 4);
  });
  for (let n = inside.length - 1; n >= 0; n--) {
    const limit = n === inside.length - 1 ? WINDOW_SHARE - 4 : xs[inside[n + 1]!]! - MARK_GAP;
    xs[inside[n]!] = Math.min(xs[inside[n]!]!, limit);
  }
  return xs;
}

/** La secuencia de seguimientos de un agente: hasta cuatro toques, cada uno con su momento y su contenido. */
export function FollowUpsEditor({ value, onChange, vars = BUILTIN_VARS }: { value: FollowUps; onChange: (v: FollowUps) => void; vars?: PromptVar[] }) {
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });
  const approved = templates.filter((t) => t.status === "APPROVED");
  // Las etapas del embudo, para elegir otra plantilla según dónde está el cliente. En una ganada no hay seguimientos.
  const { data: allStages = [] } = useQuery({ queryKey: ["stages-ref"], queryFn: fetchStages });
  const stages = allStages.filter((st) => !st.isWon);
  const manyPipelines = new Set(stages.map((st) => st.pipelineName)).size > 1;
  const update = (i: number, patch: Partial<FollowUpStep>) =>
    onChange({ ...value, steps: value.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });

  // Lo guardado antes de existir el horario de descanso puede llegar sin él.
  const quiet = value.quiet ?? FOLLOW_UP_QUIET_OFF;
  const setQuiet = (patch: Partial<FollowUpQuiet>) => onChange({ ...value, quiet: { ...quiet, ...patch } });
  const knownZone = TIMEZONES.some((t) => t.value === quiet.timezone);

  const moments = followUpTimeline(value.steps);
  const xs = markPositions(moments);
  /** Cómo se ve la marca de un toque: dentro, fuera con plantilla, o con un problema. */
  const tone = (i: number): "in" | "out" | "bad" => {
    const m = moments[i]!;
    if (m.late || (m.outside && value.steps[i]!.kind !== "template")) return "bad";
    return m.outside ? "out" : "in";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {value.steps.length > 0 && (
        <div className="fu-range">
          <p className="fu-range__lead">
            WhatsApp deja escribir texto libre durante 24 h desde el último mensaje del cliente. Pasado ese plazo, solo plantillas. Cada número es un toque, puesto donde cae.
          </p>
          <div className="fu-range__zones" aria-hidden="true">
            <span>Texto, IA o plantilla</span>
            <span>Solo plantilla</span>
          </div>
          <div className="fu-range__track" role="img" aria-label={trackSummary(value.steps, moments)}>
            <span className="fu-range__window" />
            {value.steps.map((_, i) => (
              <span key={i} className={`fu-mark fu-mark--${tone(i)} fu-range__mark`} style={{ left: `${xs[i]}%` }}>
                {i + 1}
              </span>
            ))}
          </div>
          <div className="fu-range__axis" aria-hidden="true">
            <span>0 h</span>
            <span>24 h · cierre</span>
          </div>
        </div>
      )}

      {value.steps.map((s, i) => {
        const m = moments[i]!;
        const beforeClose = s.timing === "before_close";
        const outOfRange = beforeClose && (s.beforeCloseMinutes < FOLLOW_UP_BEFORE_CLOSE_MIN || s.beforeCloseMinutes > FOLLOW_UP_BEFORE_CLOSE_MAX);
        const late = m.late && !outOfRange;
        const needsTemplate = !m.late && !outOfRange && m.outside && s.kind !== "template";
        const minutes = beforeClose ? s.beforeCloseMinutes : s.afterMinutes;
        const { value: n, unit } = splitMinutes(minutes);
        const setMinutes = (total: number) =>
          update(i, beforeClose ? { beforeCloseMinutes: total } : { afterMinutes: total });
        const template = s.templateId ? approved.find((t) => t.id === s.templateId) : undefined;
        return (
          <div key={i} className="agent-trigger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="fu-step__head">
              <span className={`fu-mark fu-mark--${tone(i)}`} aria-hidden="true">
                {i + 1}
              </span>
              <strong>Toque {i + 1}</strong>
              <span className="fu-step__when">
                {outOfRange ? "" : late ? "no llega a salir" : `${at(m.minutes)} del último mensaje del cliente`}
              </span>
              <button
                type="button"
                onClick={() => onChange({ ...value, steps: value.steps.filter((_, idx) => idx !== i) })}
                style={{ ...ghostBtn, color: "var(--danger)", borderColor: "var(--danger-border)", marginLeft: "auto" }}
                title="Quitar este toque"
                aria-label={`Quitar el toque ${i + 1}`}
              >
                <NavIcon name="x" size={14} />
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ ...field, flex: "2 1 240px" }}>
                <span style={lbl}>Cuándo sale</span>
                <select
                  className="field"
                  value={s.timing}
                  aria-label={`Toque ${i + 1}: cuándo sale`}
                  onChange={(e) => update(i, { timing: e.target.value as FollowUpTiming })}
                >
                  {(Object.keys(TIMING_LABEL) as FollowUpTiming[]).map((t) => (
                    <option key={t} value={t}>
                      {TIMING_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ ...field, flex: "1 1 180px" }}>
                <span style={lbl}>
                  {beforeClose ? "Cuánto antes del cierre" : i === 0 ? "Si el cliente no responde en" : "Si sigue sin responder, otros"}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="field"
                    type="number"
                    min={1}
                    value={n}
                    style={{ width: 84 }}
                    aria-label={`Toque ${i + 1}: ${beforeClose ? "cuánto antes del cierre" : "cuánto esperar"}`}
                    onChange={(e) => setMinutes(Math.max(1, Math.floor(Number(e.target.value) || 1)) * UNIT_MINUTES[unit])}
                  />
                  <select className="field" value={unit} aria-label={`Toque ${i + 1}: unidad`} onChange={(e) => setMinutes(n * UNIT_MINUTES[e.target.value as Unit])}>
                    <option value="min">minutos</option>
                    <option value="h">horas</option>
                    {!beforeClose && <option value="d">días</option>}
                  </select>
                </div>
              </div>
              <div style={{ ...field, flex: "1 1 200px" }}>
                <span style={lbl}>Le envía</span>
                <select
                  className="field"
                  value={s.kind}
                  aria-label={`Toque ${i + 1}: qué envía`}
                  onChange={(e) => update(i, { kind: e.target.value as FollowUpKind })}
                >
                  {(Object.keys(KIND_LABEL) as FollowUpKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {beforeClose && !late && !outOfRange && (
              <span style={hint}>
                Es el último momento para escribirle texto libre: si contesta, se abren otras 24 h. Si a esa hora estás fuera de tu horario de atención o es horario de descanso, sale en el último momento anterior en que se puede.
              </span>
            )}

            {outOfRange && (
              <p role="alert" style={warn}>
                Pon entre {span(FOLLOW_UP_BEFORE_CLOSE_MIN)} y {span(FOLLOW_UP_BEFORE_CLOSE_MAX)} antes del cierre.
              </p>
            )}

            {late && (
              <p role="alert" style={warn}>
                Cuando le toca a este toque ya queda menos de {span(s.beforeCloseMinutes)} para el cierre de la ventana, así que no llegaría a salir. Súbelo en la secuencia o acorta las esperas de los toques anteriores.
              </p>
            )}

            {needsTemplate && (
              <p role="alert" style={warn}>
                A estas alturas han pasado 24 h o más desde el último mensaje del cliente, y WhatsApp solo permite plantillas aprobadas. Elige «Una plantilla», acorta las esperas o usa «Antes del cierre de la ventana».
              </p>
            )}

            {!late && !outOfRange && !needsTemplate && <p className="fu-step__cost">{costLine(s, m, template?.category)}</p>}

            {s.kind === "ai" && (
              <div style={field}>
                <span style={lbl}>Qué debe conseguir (opcional)</span>
                <input
                  className="field"
                  value={s.text}
                  maxLength={300}
                  placeholder="Ej. Recordarle la cotización y preguntar si le quedó alguna duda"
                  aria-label={`Toque ${i + 1}: objetivo`}
                  onChange={(e) => update(i, { text: e.target.value })}
                />
                <span style={hint}>La IA escribe una o dos frases retomando lo último que hablaban. Una llamada breve al modelo por toque.</span>
              </div>
            )}

            {s.kind === "text" && (
              <div style={field}>
                <span style={lbl}>Mensaje</span>
                <VarTextarea
                  value={s.text}
                  onChange={(text) => update(i, { text })}
                  vars={vars}
                  maxLength={2000}
                  placeholder="Ej. ¡Hola {{nombre}}! ¿Pudiste ver la información que te envié? Cualquier duda, aquí estoy."
                  ariaLabel={`Toque ${i + 1}: mensaje`}
                />
              </div>
            )}

            {s.kind === "template" && (
              <>
                <div style={field}>
                  <span style={lbl}>{(s.byStage ?? []).length ? "Plantilla para los demás clientes" : "Plantilla"}</span>
                  <select
                    className="field"
                    value={s.templateId ?? ""}
                    aria-label={`Toque ${i + 1}: plantilla`}
                    onChange={(e) => update(i, { templateId: e.target.value || null, vars: startVars(approved.find((t) => t.id === e.target.value)) })}
                  >
                    <option value="">Elige una plantilla aprobada…</option>
                    {approved.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.language}
                      </option>
                    ))}
                  </select>
                  {!approved.length && (
                    <span style={hint}>No tienes plantillas aprobadas. Se crean en Difusiones › Plantillas; Meta tarda unas horas en aprobarlas.</span>
                  )}
                  <TemplateVars name={`Toque ${i + 1}`} template={template} vars={s.vars ?? []} onChange={(vars) => update(i, { vars })} />
                </div>

                {approved.length > 0 && stages.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(s.byStage ?? []).map((row, k) => {
                      const setRow = (patch: Partial<FollowUpStageTemplate>) =>
                        update(i, { byStage: s.byStage.map((b, idx) => (idx === k ? { ...b, ...patch } : b)) });
                      const repeated = s.byStage.findIndex((b) => b.stageId === row.stageId) !== k;
                      return (
                        <div key={k} className="fu-stage">
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <div style={{ ...field, flex: "1 1 190px" }}>
                              <span style={lbl}>Si el cliente está en la etapa</span>
                              <select
                                className="field"
                                value={row.stageId}
                                aria-label={`Toque ${i + 1}, plantilla por etapa ${k + 1}: etapa`}
                                onChange={(e) => setRow({ stageId: e.target.value })}
                              >
                                {!stages.some((st) => st.id === row.stageId) && <option value={row.stageId}>Una etapa que ya no existe</option>}
                                {stages.map((st) => (
                                  <option key={st.id} value={st.id}>
                                    {manyPipelines ? `${st.pipelineName} › ${st.name}` : st.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ ...field, flex: "2 1 230px" }}>
                              <span style={lbl}>Le envía esta plantilla</span>
                              <select
                                className="field"
                                value={row.templateId ?? ""}
                                aria-label={`Toque ${i + 1}, plantilla por etapa ${k + 1}: plantilla`}
                                onChange={(e) => setRow({ templateId: e.target.value || null, vars: startVars(approved.find((t) => t.id === e.target.value)) })}
                              >
                                <option value="">Elige una plantilla aprobada…</option>
                                {approved.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name} · {t.language}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              type="button"
                              onClick={() => update(i, { byStage: s.byStage.filter((_, idx) => idx !== k) })}
                              style={{ ...ghostBtn, color: "var(--danger)", borderColor: "var(--danger-border)" }}
                              title="Quitar esta plantilla por etapa"
                              aria-label={`Toque ${i + 1}: quitar la plantilla por etapa ${k + 1}`}
                            >
                              <NavIcon name="x" size={14} />
                            </button>
                          </div>
                          {repeated && (
                            <p role="alert" style={warn}>
                              Esa etapa ya tiene su plantilla en este toque. Elige otra etapa o quita esta fila.
                            </p>
                          )}
                          <TemplateVars
                            name={`Toque ${i + 1}, plantilla por etapa ${k + 1}`}
                            template={approved.find((t) => t.id === row.templateId)}
                            vars={row.vars}
                            onChange={(vars) => setRow({ vars })}
                          />
                        </div>
                      );
                    })}
                    {(s.byStage ?? []).length < FOLLOW_UP_MAX_STAGE_TEMPLATES && stages.some((st) => !(s.byStage ?? []).some((b) => b.stageId === st.id)) && (
                      <button
                        type="button"
                        onClick={() =>
                          update(i, {
                            byStage: [
                              ...(s.byStage ?? []),
                              { stageId: stages.find((st) => !(s.byStage ?? []).some((b) => b.stageId === st.id))!.id, templateId: null, vars: [] },
                            ],
                          })
                        }
                        style={{ ...ghostBtn, alignSelf: "flex-start" }}
                      >
                        <NavIcon name="plus" size={14} /> Otra plantilla según la etapa del cliente
                      </button>
                    )}
                    <span style={hint}>
                      {(s.byStage ?? []).length
                        ? "Cuando toca el seguimiento se mira en qué etapa del embudo está el cliente: si es una de estas, va su plantilla; si no, la de arriba."
                        : "Por ejemplo: a quien ya recibió los métodos de pago, una plantilla que le recuerde el pago; a los demás, una que retome su consulta."}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {value.steps.length < FOLLOW_UP_MAX_STEPS && (
        <button
          type="button"
          onClick={() => onChange({ ...value, steps: [...value.steps, defaultFollowUpStep(value.steps.length)] })}
          style={{ ...ghostBtn, alignSelf: "flex-start" }}
        >
          <NavIcon name="plus" size={14} /> {value.steps.length ? "Añadir otro toque" : "Añadir el primer toque"}
        </button>
      )}

      <div className="agent-trigger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={quiet.enabled} onChange={(e) => setQuiet({ enabled: e.target.checked })} style={{ marginTop: 3 }} />
          <span>
            <strong>Horario de descanso:</strong> no enviar seguimientos de noche
            <br />
            <span style={hint}>
              {quiet.enabled
                ? "En esa franja no sale ningún toque, tampoco las plantillas: el que cae ahí espera a que termine. No cambia cuándo responde el agente; eso es su horario de atención."
                : "Ahora un toque puede salir a cualquier hora, también de madrugada: a las 3 a. m., por ejemplo, si el cliente dejó de responder a las 9 p. m. y el toque va a las 6 horas. Márcalo para elegir la franja en la que no se le escribe."}
            </span>
          </span>
        </label>
        {quiet.enabled && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ ...field, flex: "0 1 130px" }}>
                <span style={lbl}>No enviar desde las</span>
                <input
                  className="field"
                  type="time"
                  value={quiet.from}
                  aria-label="Horario de descanso: desde"
                  onChange={(e) => setQuiet({ from: e.target.value || quiet.from })}
                />
              </div>
              <div style={{ ...field, flex: "0 1 130px" }}>
                <span style={lbl}>Hasta las</span>
                <input
                  className="field"
                  type="time"
                  value={quiet.to}
                  aria-label="Horario de descanso: hasta"
                  onChange={(e) => setQuiet({ to: e.target.value || quiet.to })}
                />
              </div>
              <div style={{ ...field, flex: "1 1 230px" }}>
                <span style={lbl}>Con qué hora</span>
                <select
                  className="field"
                  value={quiet.clock}
                  aria-label="Horario de descanso: con qué hora"
                  onChange={(e) => setQuiet({ clock: e.target.value as FollowUpQuiet["clock"] })}
                >
                  <option value="contact">La del cliente, según el país de su número</option>
                  <option value="business">La de tu negocio</option>
                </select>
              </div>
              <div style={{ ...field, flex: "1 1 230px" }}>
                <span style={lbl}>{quiet.clock === "contact" ? "Si no se reconoce su país, la hora de" : "Zona horaria de tu negocio"}</span>
                <select
                  className="field"
                  value={quiet.timezone}
                  aria-label="Horario de descanso: zona horaria"
                  onChange={(e) => setQuiet({ timezone: e.target.value })}
                >
                  {!knownZone && <option value={quiet.timezone}>{quiet.timezone}</option>}
                  {TIMEZONES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {quiet.from === quiet.to ? (
              <p role="alert" style={warn}>
                Pon una hora de fin distinta de la de inicio.
              </p>
            ) : (
              <span style={hint}>{quietSummary(quiet)}</span>
            )}
          </>
        )}
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={value.keepInWindow}
          onChange={(e) => onChange({ ...value, keepInWindow: e.target.checked })}
          style={{ marginTop: 3 }}
        />
        <span>
          Adelantar los toques de texto o de IA que saldrían con la ventana ya cerrada
          <br />
          <span style={hint}>
            Pasa cuando un toque espera a tu horario de atención o a que termine el descanso y, para entonces, las 24 h ya vencieron. Con esto sale antes, dentro de tu horario y fuera del descanso, en vez de perderse. Las plantillas no cambian.
          </span>
        </span>
      </label>

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={value.includeHuman}
          onChange={(e) => onChange({ ...value, includeHuman: e.target.checked })}
          style={{ marginTop: 3 }}
        />
        <span>
          También en los chats que lleva una persona del equipo
          <br />
          <span style={hint}>Por defecto solo hace seguimiento en los chats que atiende la IA. Con esto, también cuando un vendedor escribió y el cliente no contestó.</span>
        </span>
      </label>

      <details className="fu-meta">
        <summary>Qué cobra Meta por estos mensajes en WhatsApp</summary>
        <ul>
          <li>
            <strong>Texto o IA, dentro de la ventana.</strong> Cuenta como mensaje de servicio. Cada número tiene 1.000 gratis al mes; pasado ese cupo, Meta cobra cada uno.
          </li>
          <li>
            <strong>Plantilla.</strong> Meta la cobra según su categoría (marketing o utilidad), también cuando sale dentro de la ventana.
          </li>
          <li>
            <strong>Chats que llegan por un anuncio de clic a WhatsApp.</strong> Si respondes dentro de las 24 h, Meta deja de cobrar mensajes y plantillas durante unos días (hasta 7, según su página de precios). Para escribir pasadas las 24 h sigue haciendo falta plantilla.
          </li>
        </ul>
        <p>
          Reglas de Meta vigentes desde el 1 de octubre de 2026; el precio de cada mensaje depende del país del cliente.{" "}
          <a href={META_PRICING_URL} target="_blank" rel="noreferrer">
            Ver la página de precios de Meta
          </a>
          . En Messenger e Instagram la ventana también es de 24 h y no existen plantillas: ahí solo salen los toques de texto o de IA.
        </p>
      </details>

      <p style={{ ...hint, margin: 0 }}>
        Se detiene solo en cuanto el cliente responde, la oportunidad se gana o cierras el chat. En la bandeja puedes cancelar el siguiente toque de un chat concreto. Si tienes horario de atención, los toques esperan a que abra; en horario de descanso, a que termine. Cuando un toque no puede salir, queda una nota interna en el chat con el motivo.
      </p>
    </div>
  );
}

/** Los huecos de una plantilla recién elegida: el primero con el nombre del cliente; los demás, por decidir. */
function startVars(template: TemplateDto | undefined): FollowUpVar[] {
  const count = template ? templateVarCount(template.body) : 0;
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? { index: 1, source: "contact_name" as const, value: "" } : { index: i + 1, source: "static" as const, value: "" },
  );
}

/** Lo que un seguimiento no sabe rellenar de una plantilla; null si puede enviarla. */
function templateBlocker(t: TemplateDto): string | null {
  if (t.header?.format === "TEXT" && t.header.text.includes("{{")) return "su encabezado lleva una variable";
  if (t.header?.format === "LOCATION") return "lleva una ubicación arriba";
  if (t.buttons.some((b) => b.type === "URL" && b.url.includes("{{"))) return "tiene un botón cuyo enlace cambia en cada envío";
  return null;
}

/**
 * Qué va en cada hueco de la plantilla elegida ({{1}}, {{2}}…) y cómo le
 * queda al cliente. El texto de la plantilla lo aprobó Meta y no se cambia:
 * el contexto entra por aquí.
 */
function TemplateVars({ name, template, vars, onChange }: { name: string; template: TemplateDto | undefined; vars: FollowUpVar[]; onChange: (v: FollowUpVar[]) => void }) {
  if (!template) return null;
  const blocker = templateBlocker(template);
  const count = templateVarCount(template.body);
  const names = namedTemplateVars(template.body);
  const slots = followUpTemplateVars(count, vars);
  const set = (index: number, patch: Partial<FollowUpVar>) => {
    const current = slots[index - 1] ?? { index, source: "static" as const, value: "" };
    onChange([...vars.filter((v) => v.index !== index && v.index <= count), { ...current, ...patch, index }].sort((a, b) => a.index - b.index));
  };
  // Cómo queda con un cliente de ejemplo. Un hueco sin valor se deja a la vista.
  const sample = slots.map((s) => (!s ? undefined : s.source === "contact_name" ? "Ana" : s.value.trim() || undefined));
  const productFallback = slots.find((s) => s?.source === "product")?.value.trim();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
      {blocker && (
        <p role="alert" style={warn}>
          Esta plantilla no va a salir en un seguimiento: {blocker}, y eso aquí no se puede rellenar. Elige otra.
        </p>
      )}
      {slots.map((s, i) => {
        const token = `{{${names[i] ?? i + 1}}}`;
        return (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <code className="fu-var">{token}</code>
            <select
              className="field"
              style={{ flex: "1 1 200px" }}
              value={s?.source ?? ""}
              aria-label={`${name}: qué va en ${token}`}
              onChange={(e) => {
                const source = e.target.value as FollowUpVarSource;
                set(i + 1, { source, value: source === "product" ? "lo que consultaste" : source === "static" && s?.source === "static" ? s.value : "" });
              }}
            >
              {!s && <option value="">Elige qué va aquí…</option>}
              {followUpVarSources.map((src) => (
                <option key={src} value={src}>
                  {VAR_SOURCE_LABEL[src]}
                </option>
              ))}
            </select>
            {s && s.source !== "contact_name" && (
              <input
                className="field"
                style={{ flex: "2 1 220px" }}
                value={s.value}
                maxLength={200}
                placeholder={s.source === "product" ? "Si no consultó nada, pon…" : "Escribe el texto"}
                aria-label={`${name}: ${s.source === "product" ? `qué va en ${token} si no consultó nada` : `texto de ${token}`}`}
                onChange={(e) => set(i + 1, { value: e.target.value })}
              />
            )}
            {!s && (
              <span role="alert" style={warn}>
                Sin esto, el toque no sale.
              </span>
            )}
            {s && s.source !== "contact_name" && !s.value.trim() && (
              <span role="alert" style={warn}>
                {s.source === "product" ? "Pon qué va si no consultó nada." : "Escribe el texto."}
              </span>
            )}
          </div>
        );
      })}
      <span style={hint}>
        <strong style={{ color: "var(--text)", fontWeight: 600 }}>Así le llega:</strong> {fillTemplateText(template.body, sample as string[], names)}
        {productFallback
          ? ` Si el cliente consultó un producto con el agente en este chat, en lugar de «${productFallback}» va su nombre.`
          : ""}
      </span>
    </div>
  );
}

/** El horario de descanso dicho en una frase, con un ejemplo. */
function quietSummary(q: FollowUpQuiet): string {
  const range = `entre las ${q.from} y las ${q.to}`;
  if (q.clock === "business") return `Ningún seguimiento sale ${range} de tu zona horaria, sea de donde sea el cliente.`;
  return `Cada cliente deja de recibir seguimientos ${range} de su propia hora: uno de Perú, con la hora de Perú; uno de España, con la de España. En países con varias zonas horarias (México, Estados Unidos, Brasil) se respeta el descanso de todas. En Messenger, Instagram y TikTok no hay número: rige la zona elegida.`;
}

/** Lo que le espera a un toque según dónde cae: dentro o fuera, y qué cobra Meta por él. */
function costLine(step: FollowUpStep, moment: FollowUpMoment, category: string | undefined): string {
  if (step.kind !== "template") {
    return "Dentro de la ventana. Cuenta como mensaje de servicio: gasta uno de los 1.000 gratis al mes del número.";
  }
  const kind = category && CATEGORY_LABEL[category] ? ` de ${CATEGORY_LABEL[category]}` : "";
  return moment.outside
    ? `Fuera de la ventana. Plantilla${kind}: Meta la cobra.`
    : `Dentro de la ventana, pero es una plantilla${kind}: Meta la cobra igual.`;
}

/** La franja contada en una frase, para quien no la ve. */
function trackSummary(steps: FollowUpStep[], moments: FollowUpMoment[]): string {
  const parts = moments.map((m, i) => {
    if (m.late) return `toque ${i + 1} no llega a salir`;
    const where = m.outside ? "fuera de la ventana" : "dentro de la ventana";
    return `toque ${i + 1} ${at(m.minutes)}, ${where}${m.outside && steps[i]!.kind !== "template" ? " y no es plantilla" : ""}`;
  });
  return `Ventana de 24 h desde el último mensaje del cliente: ${parts.join("; ")}.`;
}

const hint: React.CSSProperties = { color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45 };
const warn: React.CSSProperties = { margin: 0, color: "var(--danger)", fontSize: 12.5, lineHeight: 1.45 };
