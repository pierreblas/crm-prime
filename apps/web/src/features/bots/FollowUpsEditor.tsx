"use client";

import { useQuery } from "@tanstack/react-query";
import {
  FOLLOW_UP_BEFORE_CLOSE_MAX,
  FOLLOW_UP_BEFORE_CLOSE_MIN,
  FOLLOW_UP_MAX_STEPS,
  WHATSAPP_WINDOW_MINUTES,
  followUpTimeline,
  type FollowUpKind,
  type FollowUpMoment,
  type FollowUpStep,
  type FollowUpTiming,
  type FollowUps,
} from "@crm/shared";
import { fetchTemplates } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { field, label as lbl, ghostBtn } from "./styles";

const KIND_LABEL: Record<FollowUpKind, string> = {
  ai: "Lo redacta la IA",
  text: "Un texto fijo",
  template: "Una plantilla aprobada",
};

const TIMING_LABEL: Record<FollowUpTiming, string> = {
  after: "Tras un tiempo sin respuesta",
  before_close: "Antes del cierre de la ventana",
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
  const base = { timing: "after" as const, beforeCloseMinutes: 60, text: "", templateId: null };
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
export function FollowUpsEditor({ value, onChange }: { value: FollowUps; onChange: (v: FollowUps) => void }) {
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });
  const approved = templates.filter((t) => t.status === "APPROVED");
  const update = (i: number, patch: Partial<FollowUpStep>) =>
    onChange({ ...value, steps: value.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });

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
                Es el último momento para escribirle texto libre: si contesta, se abren otras 24 h. Si a esa hora estás fuera de tu horario de atención, sale al final del último tramo en que atiendes.
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
                <textarea
                  className="field"
                  style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                  value={s.text}
                  maxLength={2000}
                  placeholder="Ej. ¡Hola! ¿Pudiste ver la información que te envié? Cualquier duda, aquí estoy."
                  aria-label={`Toque ${i + 1}: mensaje`}
                  onChange={(e) => update(i, { text: e.target.value })}
                />
              </div>
            )}

            {s.kind === "template" && (
              <div style={field}>
                <span style={lbl}>Plantilla</span>
                <select
                  className="field"
                  value={s.templateId ?? ""}
                  aria-label={`Toque ${i + 1}: plantilla`}
                  onChange={(e) => update(i, { templateId: e.target.value || null })}
                >
                  <option value="">Elige una plantilla aprobada…</option>
                  {approved.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.language}
                    </option>
                  ))}
                </select>
                <span style={hint}>
                  {approved.length
                    ? "Si la plantilla tiene {{1}}, va el nombre del contacto."
                    : "No tienes plantillas aprobadas. Se crean en Difusiones › Plantillas; Meta tarda unas horas en aprobarlas."}
                </span>
              </div>
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
            Pasa cuando un toque espera a tu horario de atención y, al abrir, las 24 h ya vencieron. Con esto sale antes del cierre, dentro de tu horario, en vez de perderse. Las plantillas no cambian.
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
        Se detiene solo en cuanto el cliente responde, la oportunidad se gana o cierras el chat. En la bandeja puedes cancelar el siguiente toque de un chat concreto. Si tienes horario de atención, los toques esperan a que abra. Cuando un toque no puede salir, queda una nota interna en el chat con el motivo.
      </p>
    </div>
  );
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
