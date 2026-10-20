"use client";

import { useQuery } from "@tanstack/react-query";
import {
  FOLLOW_UP_MAX_STEPS,
  WHATSAPP_WINDOW_MINUTES,
  type FollowUpKind,
  type FollowUpStep,
  type FollowUps,
} from "@crm/shared";
import { fetchTemplates } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { field, label as lbl, ghostBtn } from "./styles";

const KIND_LABEL: Record<FollowUpKind, string> = {
  ai: "Lo redacta la IA según la conversación",
  text: "Un texto fijo",
  template: "Una plantilla aprobada por Meta",
};

type Unit = "min" | "h" | "d";
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 };

/** Minutos guardados → la unidad más natural para mostrarlos. */
function splitMinutes(minutes: number): { value: number; unit: Unit } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "d" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "h" };
  return { value: minutes, unit: "min" };
}

/**
 * Un toque nuevo con una cadencia razonable según su posición: a las 2 h la
 * IA retoma la charla; después, plantillas (ya fuera de la ventana de 24 h).
 */
export function defaultFollowUpStep(index: number): FollowUpStep {
  const presets: FollowUpStep[] = [
    { afterMinutes: 120, kind: "ai", text: "", templateId: null },
    { afterMinutes: 1440, kind: "template", text: "", templateId: null },
    { afterMinutes: 2880, kind: "template", text: "", templateId: null },
    { afterMinutes: 4320, kind: "template", text: "", templateId: null },
  ];
  return presets[Math.min(index, presets.length - 1)]!;
}

/** La secuencia de seguimientos de un agente: hasta cuatro toques, cada uno con su espera y su contenido. */
export function FollowUpsEditor({ value, onChange }: { value: FollowUps; onChange: (v: FollowUps) => void }) {
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });
  const approved = templates.filter((t) => t.status === "APPROVED");
  const update = (i: number, patch: Partial<FollowUpStep>) =>
    onChange({ ...value, steps: value.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });

  let cumulative = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {value.steps.map((s, i) => {
        cumulative += s.afterMinutes;
        // Desde el último mensaje del cliente han pasado al menos estos minutos:
        // pasada la ventana, WhatsApp solo deja plantillas.
        const afterWindow = cumulative >= WHATSAPP_WINDOW_MINUTES;
        const needsTemplate = afterWindow && s.kind !== "template";
        const { value: n, unit } = splitMinutes(s.afterMinutes);
        return (
          <div key={i} className="agent-trigger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ ...field, flex: "1 1 170px" }}>
                <span style={lbl}>{i === 0 ? "Si el cliente no responde en" : "Si sigue sin responder, pasados otros"}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="field"
                    type="number"
                    min={1}
                    value={n}
                    style={{ width: 84 }}
                    aria-label={`Toque ${i + 1}: cuánto esperar`}
                    onChange={(e) => update(i, { afterMinutes: Math.max(1, Math.floor(Number(e.target.value) || 1)) * UNIT_MINUTES[unit] })}
                  />
                  <select
                    className="field"
                    value={unit}
                    aria-label={`Toque ${i + 1}: unidad`}
                    onChange={(e) => update(i, { afterMinutes: n * UNIT_MINUTES[e.target.value as Unit] })}
                  >
                    <option value="min">minutos</option>
                    <option value="h">horas</option>
                    <option value="d">días</option>
                  </select>
                </div>
              </div>
              <div style={{ ...field, flex: "2 1 220px" }}>
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
              <button
                type="button"
                onClick={() => onChange({ ...value, steps: value.steps.filter((_, idx) => idx !== i) })}
                style={{ ...ghostBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}
                title="Quitar este toque"
                aria-label={`Quitar el toque ${i + 1}`}
              >
                <NavIcon name="x" size={14} />
              </button>
            </div>

            {needsTemplate && (
              <p role="alert" style={warn}>
                A estas alturas han pasado 24 h o más desde el último mensaje del cliente, y WhatsApp solo permite plantillas aprobadas. Elige «Una plantilla» para este toque o acorta las esperas.
              </p>
            )}

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

      <p style={{ ...hint, margin: 0 }}>
        Se detiene solo en cuanto el cliente responde, la oportunidad se gana o cierras el chat. En la bandeja puedes cancelar el siguiente toque de un chat concreto. Si tienes horario de atención, los toques esperan a que abra.
      </p>
    </div>
  );
}

const hint: React.CSSProperties = { color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45 };
const warn: React.CSSProperties = { margin: 0, color: "#e08a8a", fontSize: 12.5, lineHeight: 1.45 };
