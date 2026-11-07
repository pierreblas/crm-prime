"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BOOKING_TEMPLATE_VAR_LABEL,
  REMINDER_HOURS_OPTIONS,
  bookingTemplateVarSources,
  templateVarCount,
  type BookingServiceDto,
  type BookingSettingsDto,
  type BookingTemplateVarSource,
  type DateRange,
  type TemplateDto,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import {
  createBookingService,
  deleteBookingService,
  fetchBookingServices,
  fetchBookingSettings,
  fetchStaffSchedules,
  fetchStages,
  fetchTemplates,
  saveBookingSettings,
  updateBookingService,
} from "@/lib/bff";
import { DateRangesEditor, ScheduleEditor } from "./ScheduleEditor";
import { durationLabel } from "./time";

/** Zonas más usadas por los clientes; el resto, en la lista completa del navegador. */
const COMMON_ZONES = [
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Caracas",
  "America/Guayaquil",
  "America/La_Paz",
  "America/Asuncion",
  "America/Montevideo",
  "America/Panama",
  "America/Costa_Rica",
  "America/Guatemala",
  "America/El_Salvador",
  "America/Tegucigalpa",
  "America/Managua",
  "America/Santo_Domingo",
  "America/Puerto_Rico",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
];
const INTERVALS = [5, 10, 15, 20, 30, 45, 60];
const NOTICES: { min: number; label: string }[] = [
  { min: 0, label: "Sin antelación" },
  { min: 30, label: "30 minutos" },
  { min: 60, label: "1 hora" },
  { min: 120, label: "2 horas" },
  { min: 240, label: "4 horas" },
  { min: 720, label: "12 horas" },
  { min: 1440, label: "1 día" },
  { min: 2880, label: "2 días" },
];
const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 120, 180, 240];

/**
 * Ajustes › Agenda: las reglas de la empresa, los servicios que se reservan
 * (y quién los atiende) y el horario de cada persona. Con esto la agenda y el
 * agente de IA saben qué horas ofrecer.
 */
export function AgendaSettings() {
  const { data: settings } = useQuery({ queryKey: ["bookings", "settings"], queryFn: fetchBookingSettings });
  const { data: services } = useQuery({ queryKey: ["bookings", "services"], queryFn: fetchBookingServices });

  return (
    <div className="agenda-settings">
      <p className="agenda-muted" style={{ margin: 0, maxWidth: 620 }}>
        Qué se reserva, quién lo atiende y en qué horario. La agenda solo ofrece horas que caben en el horario de la persona y no
        pisan otra cita. Para que la IA reserve por WhatsApp, activa «Ver horas libres» y «Reservar citas» en tu{" "}
        <Link href="/agentes" className="cp-link">
          agente
        </Link>
        .
      </p>
      <ServicesSection services={services} />
      <SchedulesSection />
      {settings && <RulesSection settings={settings} />}
      {settings && <NoticesSection settings={settings} />}
    </div>
  );
}

// ── Servicios ─────────────────────────────────────────────────
function ServicesSection({ services }: { services: BookingServiceDto[] | undefined }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BookingServiceDto | "new" | null>(null);
  const remove = useMutation({
    mutationFn: deleteBookingService,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(r.archived ? "Servicio desactivado (tiene citas en su historial)" : "Servicio eliminado");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="agenda-card" aria-labelledby="agenda-services">
      <header className="agenda-card__head">
        <h3 id="agenda-services">Servicios</h3>
        {editing === null && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing("new")}>
            <NavIcon name="plus" size={14} />
            Nuevo servicio
          </button>
        )}
      </header>

      {editing === "new" && <ServiceForm onDone={() => setEditing(null)} />}

      {services && services.length === 0 && editing === null && (
        <p className="agenda-muted">Aún no hay servicios. Empieza por el que más te reservan: «Consulta», «Corte», «Clase de prueba»…</p>
      )}

      <ul className="agenda-services">
        {(services ?? []).map((s) =>
          editing !== "new" && editing?.id === s.id ? (
            <li key={s.id}>
              <ServiceForm service={s} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={s.id} className={`agenda-service${s.isActive ? "" : " is-off"}`}>
              <div className="agenda-service__main">
                <div className="agenda-service__name">
                  {s.name}
                  {!s.isActive && <span className="agenda-status agenda-status--cancelled">Desactivado</span>}
                </div>
                <div className="agenda-muted">
                  {durationLabel(s.durationMin)}
                  {s.bufferAfterMin ? ` + ${durationLabel(s.bufferAfterMin)} de margen` : ""} ·{" "}
                  {s.staff.length ? s.staff.map((p) => p.name).join(", ") : "nadie lo atiende"}
                  {s.upcoming ? ` · ${s.upcoming === 1 ? "1 cita próxima" : `${s.upcoming} citas próximas`}` : ""}
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>
                Editar
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={remove.isPending}
                onClick={() =>
                  void confirmDialog({
                    title: `¿Eliminar «${s.name}»?`,
                    message: s.upcoming
                      ? `Tiene ${s.upcoming} citas por delante: se mantienen, pero ya no se podrá reservar. Quedará desactivado.`
                      : "Ya no se podrá reservar. Si tiene citas pasadas, quedará desactivado para conservar el historial.",
                    confirmLabel: "Eliminar",
                    danger: true,
                  }).then((ok) => ok && remove.mutate(s.id))
                }
              >
                Eliminar
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function ServiceForm({ service, onDone }: { service?: BookingServiceDto; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: people } = useQuery({ queryKey: ["bookings", "schedules"], queryFn: fetchStaffSchedules });
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [duration, setDuration] = useState(service?.durationMin ?? 30);
  const [buffer, setBuffer] = useState(service?.bufferAfterMin ?? 0);
  const [staffIds, setStaffIds] = useState<string[]>(service?.staff.map((p) => p.id) ?? []);
  const [isActive, setIsActive] = useState(service?.isActive ?? true);

  // Con una sola persona en el equipo, ella atiende.
  useEffect(() => {
    if (!service && people?.length === 1 && staffIds.length === 0) setStaffIds([people[0]!.userId]);
  }, [people, service, staffIds.length]);

  const save = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), description: description.trim() || null, durationMin: duration, bufferAfterMin: buffer, staffIds, isActive };
      return service ? updateBookingService(service.id, input) : createBookingService(input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(service ? "Servicio guardado" : "Servicio creado");
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);

  return (
    <form
      className="agenda-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="agenda-form-row">
        <label className="agenda-field" style={{ flex: 2 }}>
          <span className="label">Nombre</span>
          <input className="field field-sm" value={name} maxLength={80} required autoFocus placeholder="Ej.: Corte de cabello" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="agenda-field">
          <span className="label">Duración</span>
          <select className="field field-sm" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {durations.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="agenda-field">
          <span className="label">Margen después</span>
          <select className="field field-sm" value={buffer} onChange={(e) => setBuffer(Number(e.target.value))}>
            {[0, 5, 10, 15, 20, 30, 45, 60].map((d) => (
              <option key={d} value={d}>
                {d ? durationLabel(d) : "Sin margen"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="agenda-field">
        <span className="label">Descripción (opcional; la IA la usa para explicar el servicio)</span>
        <textarea className="field field-sm" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <fieldset className="agenda-field agenda-staffpick">
        <legend className="label">Quién lo atiende</legend>
        <div className="agenda-staffpick__list">
          {(people ?? []).map((p) => {
            const on = staffIds.includes(p.userId);
            return (
              <label key={p.userId} className={`agenda-pill${on ? " is-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setStaffIds((ids) => (on ? ids.filter((x) => x !== p.userId) : [...ids, p.userId]))}
                />
                {on && <NavIcon name="check" size={12} />}
                {p.name}
              </label>
            );
          })}
        </div>
      </fieldset>
      {service && (
        <label className="agenda-check">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Se puede reservar
        </label>
      )}
      <div className="agenda-form__foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending || !name.trim() || staffIds.length === 0}>
          {save.isPending ? "Guardando…" : service ? "Guardar" : "Crear servicio"}
        </button>
      </div>
    </form>
  );
}

// ── Horarios ──────────────────────────────────────────────────
function SchedulesSection() {
  const { data: schedules } = useQuery({ queryKey: ["bookings", "schedules"], queryFn: fetchStaffSchedules });
  const [userId, setUserId] = useState("");
  const current = schedules?.find((s) => s.userId === userId) ?? schedules?.[0] ?? null;

  return (
    <section className="agenda-card" aria-labelledby="agenda-schedules">
      <header className="agenda-card__head">
        <h3 id="agenda-schedules">Horario de cada persona</h3>
        {schedules && schedules.length > 1 && (
          <select className="field field-sm agenda-person" value={current?.userId ?? ""} onChange={(e) => setUserId(e.target.value)} aria-label="Persona">
            {schedules.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
                {s.isDefault ? " (sin configurar)" : ""}
              </option>
            ))}
          </select>
        )}
      </header>
      {current?.isDefault && (
        <p className="agenda-muted" style={{ margin: 0 }}>
          {current.name} aún tiene el horario de partida: de lunes a viernes, de 09:00 a 18:00. Cámbialo y guárdalo.
        </p>
      )}
      {current && <ScheduleEditor schedule={current} />}
    </section>
  );
}

// ── Reglas ────────────────────────────────────────────────────
function RulesSection({ settings }: { settings: BookingSettingsDto }) {
  const qc = useQueryClient();
  const { data: stages } = useQuery({ queryKey: ["stages"], queryFn: fetchStages });
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  const set = <K extends keyof BookingSettingsDto>(k: K, v: BookingSettingsDto[K]) => setForm((f) => ({ ...f, [k]: v }));

  const zones = useMemo(() => {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    const common = COMMON_ZONES.includes(form.timezone) ? COMMON_ZONES : [form.timezone, ...COMMON_ZONES];
    return { common, rest: all.filter((z) => !common.includes(z)) };
  }, [form.timezone]);

  const save = useMutation({
    mutationFn: () => saveBookingSettings(form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success("Reglas guardadas");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const s of stages ?? []) m.set(s.pipelineName, [...(m.get(s.pipelineName) ?? []), { id: s.id, name: s.name }]);
    return [...m.entries()];
  }, [stages]);

  return (
    <section className="agenda-card" aria-labelledby="agenda-rules">
      <header className="agenda-card__head">
        <h3 id="agenda-rules">Reglas de reserva</h3>
      </header>
      <div className="agenda-form-row">
        <label className="agenda-field" style={{ flex: 2 }}>
          <span className="label">Zona horaria del negocio</span>
          <select className="field field-sm" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
            <optgroup label="Frecuentes">
              {zones.common.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
            {zones.rest.length > 0 && (
              <optgroup label="Todas">
                {zones.rest.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="agenda-field">
          <span className="label">Las horas empiezan cada</span>
          <select className="field field-sm" value={form.slotIntervalMin} onChange={(e) => set("slotIntervalMin", Number(e.target.value))}>
            {INTERVALS.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="agenda-form-row">
        <label className="agenda-field">
          <span className="label">Antelación mínima</span>
          <select className="field field-sm" value={form.minNoticeMin} onChange={(e) => set("minNoticeMin", Number(e.target.value))}>
            {(NOTICES.some((n) => n.min === form.minNoticeMin) ? NOTICES : [...NOTICES, { min: form.minNoticeMin, label: durationLabel(form.minNoticeMin) }]).map((n) => (
              <option key={n.min} value={n.min}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label className="agenda-field">
          <span className="label">Se reserva hasta con</span>
          <span className="agenda-inline">
            <input
              type="number"
              className="field field-sm"
              min={1}
              max={365}
              value={form.maxDays}
              onChange={(e) => set("maxDays", Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
            />
            <span className="agenda-muted">días</span>
          </span>
        </label>
        <label className="agenda-field" style={{ flex: 2 }}>
          <span className="label">Al reservar, la oportunidad pasa a</span>
          <select className="field field-sm" value={form.bookedStageId ?? ""} onChange={(e) => set("bookedStageId", e.target.value || null)}>
            <option value="">No moverla</option>
            {groups.map(([pipeline, list]) => (
              <optgroup key={pipeline} label={pipeline}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <p className="agenda-muted agenda-hint">
        La antelación y el límite de días son para el cliente y la IA; el equipo, desde la agenda, puede reservar para dentro de un rato.
        Una oportunidad nunca retrocede: si ya está más adelante en el embudo, se queda donde está.
      </p>
      <div className="agenda-field">
        <span className="label">Días cerrados de toda la empresa (feriados)</span>
        <DateRangesEditor value={form.blackouts} onChange={(v: DateRange[]) => set("blackouts", v)} addLabel="Añadir días cerrados" />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando…" : "Guardar reglas"}
        </button>
      </div>
    </section>
  );
}

// ── Avisos al cliente ─────────────────────────────────────────
/** Con qué se llena cada hueco si la empresa no lo cambia: lo que suele ir en un aviso de cita. */
const DEFAULT_VARS: BookingTemplateVarSource[] = ["contact_name", "service", "datetime", "staff", "business"];

function hoursLabel(h: number): string {
  if (h % 24 === 0) return h === 24 ? "1 día" : `${h / 24} días`;
  return h === 1 ? "1 hora" : `${h} horas`;
}

/**
 * Confirmación y recordatorio por WhatsApp. Dentro de las 24 h desde el último
 * mensaje del cliente va en texto (y el recordatorio con botones); fuera, con
 * una plantilla aprobada por Meta llenada con datos de la cita.
 */
function NoticesSection({ settings }: { settings: BookingSettingsDto }) {
  const qc = useQueryClient();
  const { data: templates } = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  const set = <K extends keyof BookingSettingsDto>(k: K, v: BookingSettingsDto[K]) => setForm((f) => ({ ...f, [k]: v }));
  const approved = useMemo(() => (templates ?? []).filter((t) => t.status === "APPROVED"), [templates]);

  const save = useMutation({
    mutationFn: () =>
      saveBookingSettings({
        confirmOnCreate: form.confirmOnCreate,
        confirmTemplateId: form.confirmTemplateId,
        confirmTemplateVars: form.confirmTemplateVars,
        reminderHoursBefore: form.reminderHoursBefore,
        reminderTemplateId: form.reminderTemplateId,
        reminderTemplateVars: form.reminderTemplateVars,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success("Avisos guardados");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="agenda-card" aria-labelledby="agenda-notices">
      <header className="agenda-card__head">
        <h3 id="agenda-notices">Avisos al cliente por WhatsApp</h3>
      </header>
      <p className="agenda-muted agenda-hint" style={{ marginTop: 0 }}>
        Si el cliente escribió en las últimas 24 horas, el aviso va como texto, sin costo, y el recordatorio lleva botones
        «Confirmar» y «Cancelar» que actúan sobre la cita. Pasadas las 24 horas hace falta una plantilla aprobada por Meta, que
        Meta cobra según su tarifa. Cuando reserva el agente de IA, la confirmación ya va en el chat.
      </p>

      <label className="agenda-check">
        <input type="checkbox" checked={form.confirmOnCreate} onChange={(e) => set("confirmOnCreate", e.target.checked)} />
        <span>Confirmar por WhatsApp cuando el equipo crea o mueve una cita</span>
      </label>
      {form.confirmOnCreate && (
        <TemplatePicker
          label="Plantilla de confirmación (fuera de las 24 h)"
          templates={approved}
          templateId={form.confirmTemplateId}
          vars={form.confirmTemplateVars}
          onChange={(id, vars) => setForm((f) => ({ ...f, confirmTemplateId: id, confirmTemplateVars: vars }))}
        />
      )}

      <div className="agenda-form-row">
        <label className="agenda-field">
          <span className="label">Recordatorio</span>
          <select
            className="field field-sm"
            value={form.reminderHoursBefore ?? 0}
            onChange={(e) => set("reminderHoursBefore", Number(e.target.value) || null)}
          >
            <option value={0}>Sin recordatorio</option>
            {(REMINDER_HOURS_OPTIONS as readonly number[]).map((h) => (
              <option key={h} value={h}>
                {hoursLabel(h)} antes
              </option>
            ))}
          </select>
        </label>
      </div>
      {form.reminderHoursBefore && (
        <TemplatePicker
          label="Plantilla del recordatorio (fuera de las 24 h)"
          templates={approved}
          templateId={form.reminderTemplateId}
          vars={form.reminderTemplateVars}
          onChange={(id, vars) => setForm((f) => ({ ...f, reminderTemplateId: id, reminderTemplateVars: vars }))}
        />
      )}
      {approved.length === 0 && (
        <p className="agenda-muted agenda-hint">
          Todavía no tienes plantillas aprobadas. Créalas en{" "}
          <Link href="/difusiones" className="cp-link">
            Difusiones › Plantillas
          </Link>
          : una de categoría «Utilidad» con el texto del aviso y, si quieres, los botones «Confirmar» y «Cancelar».
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando…" : "Guardar avisos"}
        </button>
      </div>
    </section>
  );
}

/** Elegir una plantilla aprobada y decir con qué dato de la cita se llena cada hueco. */
function TemplatePicker({
  label,
  templates,
  templateId,
  vars,
  onChange,
}: {
  label: string;
  templates: TemplateDto[];
  templateId: string | null;
  vars: BookingTemplateVarSource[];
  onChange: (templateId: string | null, vars: BookingTemplateVarSource[]) => void;
}) {
  const template = templates.find((t) => t.id === templateId) ?? null;
  const count = template ? templateVarCount(template.body) : 0;
  const pick = (id: string | null) => {
    const next = templates.find((t) => t.id === id) ?? null;
    const n = next ? templateVarCount(next.body) : 0;
    onChange(id, Array.from({ length: n }, (_, i) => vars[i] ?? DEFAULT_VARS[i] ?? "datetime"));
  };
  const setVar = (i: number, value: BookingTemplateVarSource) =>
    onChange(templateId, Array.from({ length: count }, (_, j) => (j === i ? value : (vars[j] ?? "datetime"))));
  return (
    <div className="agenda-notice">
      <label className="agenda-field">
        <span className="label">{label}</span>
        <select className="field field-sm" value={templateId ?? ""} onChange={(e) => pick(e.target.value || null)}>
          <option value="">Sin plantilla: solo dentro de las 24 h</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.language}
            </option>
          ))}
        </select>
      </label>
      {template && (
        <div className="agenda-notice__vars">
          <p className="agenda-muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {template.body}
          </p>
          {count === 0 ? (
            <p className="agenda-muted agenda-hint">Sin variables: se envía tal cual.</p>
          ) : (
            <div className="agenda-form-row">
              {Array.from({ length: count }, (_, i) => (
                <label key={i} className="agenda-field">
                  <span className="label">{`{{${i + 1}}}`}</span>
                  <select className="field field-sm" value={vars[i] ?? "datetime"} onChange={(e) => setVar(i, e.target.value as BookingTemplateVarSource)}>
                    {bookingTemplateVarSources.map((s) => (
                      <option key={s} value={s}>
                        {BOOKING_TEMPLATE_VAR_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
