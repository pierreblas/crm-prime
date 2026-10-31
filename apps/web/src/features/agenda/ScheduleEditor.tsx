"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WEEKDAYS, WEEKDAY_LABEL, type DateRange, type StaffScheduleDto, type WeeklyHours } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { saveStaffSchedule } from "@/lib/bff";

const MAX_RANGES = 4;

/**
 * Horario de una persona: tramos de cada día (con pausa para comer, si hace
 * falta, como dos tramos), días cerrados y si acepta citas. Las horas son las
 * del negocio, en su zona.
 */
export function ScheduleEditor({ schedule, onSaved }: { schedule: StaffScheduleDto; onSaved?: () => void }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState<WeeklyHours>(schedule.hours);
  const [blackouts, setBlackouts] = useState<DateRange[]>(schedule.blackouts);
  const [accepts, setAccepts] = useState(schedule.acceptsBookings);

  // Otra persona (o lo guardado): se empieza de su horario.
  useEffect(() => {
    setHours(schedule.hours);
    setBlackouts(schedule.blackouts);
    setAccepts(schedule.acceptsBookings);
  }, [schedule]);

  const save = useMutation({
    mutationFn: () => saveStaffSchedule(schedule.userId, { hours, blackouts, acceptsBookings: accepts }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success("Horario guardado");
      onSaved?.();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const setDay = (d: keyof WeeklyHours, ranges: WeeklyHours[typeof d]) => setHours((h) => ({ ...h, [d]: ranges }));

  return (
    <div className="agenda-schedule">
      <label className="agenda-switch">
        <input type="checkbox" checked={accepts} onChange={(e) => setAccepts(e.target.checked)} />
        <span>
          <strong>Acepta citas</strong>
          <span className="agenda-muted"> · Apágalo si está de vacaciones largas o ya no atiende: nadie le podrá reservar.</span>
        </span>
      </label>

      <div className="agenda-week" aria-disabled={!accepts}>
        {WEEKDAYS.map((d) => {
          const ranges = hours[d] ?? [];
          const open = ranges.length > 0;
          return (
            <div key={d} className={`agenda-week__row${open ? "" : " is-closed"}`}>
              <label className="agenda-week__day">
                <input
                  type="checkbox"
                  checked={open}
                  onChange={(e) => setDay(d, e.target.checked ? [{ from: "09:00", to: "18:00" }] : [])}
                />
                {WEEKDAY_LABEL[d]}
              </label>
              <div className="agenda-week__ranges">
                {!open && <span className="agenda-muted">Cerrado</span>}
                {ranges.map((r, i) => (
                  <span key={i} className="agenda-range">
                    <input
                      type="time"
                      className="field field-sm"
                      value={r.from}
                      step={300}
                      aria-label={`${WEEKDAY_LABEL[d]}: desde`}
                      onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                    />
                    <span aria-hidden>–</span>
                    <input
                      type="time"
                      className="field field-sm"
                      value={r.to}
                      step={300}
                      aria-label={`${WEEKDAY_LABEL[d]}: hasta`}
                      onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                    />
                    <button
                      type="button"
                      className="icon-btn agenda-range__x"
                      aria-label="Quitar este tramo"
                      onClick={() => setDay(d, ranges.filter((_, j) => j !== i))}
                    >
                      <NavIcon name="x" size={13} />
                    </button>
                  </span>
                ))}
                {open && ranges.length < MAX_RANGES && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const last = ranges[ranges.length - 1];
                      setDay(d, [...ranges, { from: last?.to ?? "15:00", to: last && last.to < "20:00" ? "20:00" : "23:00" }]);
                    }}
                  >
                    <NavIcon name="plus" size={13} />
                    Tramo
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="agenda-field">
        <span className="label">Días que no atiende (vacaciones, permisos)</span>
        <DateRangesEditor value={blackouts} onChange={setBlackouts} addLabel="Añadir días libres" />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando…" : "Guardar horario"}
        </button>
      </div>
    </div>
  );
}

/** Lista de rangos de días cerrados, «del 24 al 26 de diciembre». */
export function DateRangesEditor({ value, onChange, addLabel }: { value: DateRange[]; onChange: (v: DateRange[]) => void; addLabel: string }) {
  return (
    <div className="agenda-ranges">
      {value.length === 0 && <span className="agenda-muted">Ninguno.</span>}
      {value.map((r, i) => (
        <span key={i} className="agenda-range">
          <input
            type="date"
            className="field field-sm"
            value={r.from}
            aria-label="Desde"
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { from: e.target.value, to: x.to < e.target.value ? e.target.value : x.to } : x)))}
          />
          <span aria-hidden>al</span>
          <input
            type="date"
            className="field field-sm"
            value={r.to}
            min={r.from}
            aria-label="Hasta"
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
          />
          <button type="button" className="icon-btn agenda-range__x" aria-label="Quitar" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <NavIcon name="x" size={13} />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          const d = new Date().toISOString().slice(0, 10);
          onChange([...value, { from: d, to: d }]);
        }}
      >
        <NavIcon name="plus" size={13} />
        {addLabel}
      </button>
    </div>
  );
}
