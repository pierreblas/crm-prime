"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { BookingDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { fetchBookingServices, fetchBookingSettings, fetchBookings, fetchMe, fetchStaffSchedules } from "@/lib/bff";
import { BookingFormDialog } from "./BookingFormDialog";
import { BookingDetailDialog } from "./BookingDetailDialog";
import { BookingStatusChip } from "./BookingStatusChip";
import { ScheduleEditor } from "./ScheduleEditor";
import { addDays, dateIn, dayChip, dayLabel, rangeIso, timeIn, todayIn, weekLabel, weekStart } from "./time";

/**
 * La agenda del equipo: una semana, día por día, con las citas de cada uno
 * (también las que reservó la IA por WhatsApp). Desde aquí se reserva, se
 * mueve, se cancela y se marca si el cliente vino.
 */
export function AgendaView() {
  const { data: settings } = useQuery({ queryKey: ["bookings", "settings"], queryFn: fetchBookingSettings });
  const { data: services } = useQuery({ queryKey: ["bookings", "services"], queryFn: fetchBookingServices });
  const { data: schedules } = useQuery({ queryKey: ["bookings", "schedules"], queryFn: fetchStaffSchedules });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const tz = settings?.timezone ?? "America/Lima";
  const today = todayIn(tz);

  const [monday, setMonday] = useState(() => weekStart(today));
  const [person, setPerson] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<BookingDto | null>(null);
  const [open, setOpen] = useState<BookingDto | null>(null);
  const [mySchedule, setMySchedule] = useState(false);

  // La semana de hoy en la zona del negocio, en cuanto llegan sus reglas.
  const zone = settings?.timezone;
  useEffect(() => {
    if (zone) setMonday(weekStart(todayIn(zone)));
  }, [zone]);

  const range = rangeIso(monday, addDays(monday, 7), tz);
  const { data: bookings, isPending } = useQuery({
    queryKey: ["bookings", "week", range.from, range.to, person],
    queryFn: () => fetchBookings({ ...range, userId: person || undefined }),
    enabled: !!settings,
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const byDay = useMemo(() => {
    const m = new Map<string, BookingDto[]>();
    for (const b of bookings ?? []) {
      if (b.status === "CANCELLED" && !showCancelled) continue;
      const d = dateIn(b.startAt, tz);
      m.set(d, [...(m.get(d) ?? []), b]);
    }
    return m;
  }, [bookings, showCancelled, tz]);
  const cancelledCount = (bookings ?? []).filter((b) => b.status === "CANCELLED").length;

  // Quien atiende algún servicio (o tiene horario propio), para el filtro.
  const staff = useMemo(() => {
    const ids = new Set((services ?? []).flatMap((s) => s.staff.map((p) => p.id)));
    return (schedules ?? []).filter((s) => ids.has(s.userId));
  }, [services, schedules]);
  const mine = schedules?.find((s) => s.userId === me?.id) ?? null;
  const noServices = services && services.filter((s) => s.isActive).length === 0;
  const isAdmin = me?.role === "ADMIN";

  const jump = (d: string) => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`agenda-${d}`)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="agenda">
      <div className="agenda-toolbar">
        <div className="agenda-weeknav">
          <button type="button" className="icon-btn" onClick={() => setMonday((m) => addDays(m, -7))} aria-label="Semana anterior">
            <NavIcon name="chevron-left" size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonday(weekStart(today))} disabled={monday === weekStart(today)}>
            Hoy
          </button>
          <button type="button" className="icon-btn" onClick={() => setMonday((m) => addDays(m, 7))} aria-label="Semana siguiente">
            <NavIcon name="chevron-right" size={16} />
          </button>
          <h2 className="agenda-weeklabel">{weekLabel(monday)}</h2>
        </div>
        <div className="agenda-toolbar__right">
          {staff.length > 1 && (
            <select className="field field-sm agenda-person" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Persona">
              <option value="">Todo el equipo</option>
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {cancelledCount > 0 && (
            <label className="agenda-check">
              <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
              Canceladas ({cancelledCount})
            </label>
          )}
          {mine && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMySchedule(true)}>
              <NavIcon name="clock" size={14} />
              Mi horario
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)} disabled={!!noServices}>
            <NavIcon name="plus" size={14} />
            Nueva cita
          </button>
        </div>
      </div>

      {noServices && (
        <div className="agenda-setup">
          <span className="agenda-setup__icon">
            <NavIcon name="calendar" size={20} />
          </span>
          <div>
            <strong>Prepara la agenda para empezar a reservar</strong>
            <p className="agenda-muted">
              Crea los servicios que se reservan (qué es, cuánto dura, quién lo atiende) y el horario de cada persona. Después, activa
              «Reservar citas» en tu agente y la IA ofrecerá horas libres y reservará por WhatsApp.
            </p>
          </div>
          {isAdmin ? (
            <Link href="/settings?tab=agenda" className="btn btn-primary btn-sm">
              Configurar la agenda
            </Link>
          ) : (
            <span className="agenda-muted">Pídeselo a un administrador.</span>
          )}
        </div>
      )}

      <nav className="agenda-strip" aria-label="Días de la semana">
        {days.map((d) => {
          const c = dayChip(d);
          const n = byDay.get(d)?.length ?? 0;
          return (
            <button
              key={d}
              type="button"
              className={`agenda-strip__day${d === today ? " is-today" : ""}${d < today ? " is-past" : ""}`}
              onClick={() => jump(d)}
              aria-label={`${dayLabel(d, today)}: ${n === 1 ? "1 cita" : `${n} citas`}`}
            >
              <span className="agenda-strip__wd">{c.weekday}</span>
              <span className="agenda-strip__n">{c.day}</span>
              <span className="agenda-strip__count">{n ? n : "·"}</span>
            </button>
          );
        })}
      </nav>

      <div className="agenda-list" aria-busy={isPending}>
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const label = dayLabel(d, today);
          // «Hoy», «Mañana» y «Ayer» no dicen la fecha: va al lado.
          const relative = !label.includes(" ");
          return (
            <section key={d} id={`agenda-${d}`} className={`agenda-day${d === today ? " is-today" : ""}`} aria-labelledby={`agenda-h-${d}`}>
              <header className="agenda-day__head">
                <h3 id={`agenda-h-${d}`}>{label}</h3>
                {relative && (
                  <span className="agenda-muted">
                    {dayChip(d).weekday} {dayChip(d).day} {dayChip(d).month}
                  </span>
                )}
                <span className="agenda-day__count">{list.length ? (list.length === 1 ? "1 cita" : `${list.length} citas`) : ""}</span>
              </header>
              {list.length === 0 ? (
                <p className="agenda-day__empty">{isPending ? "…" : "Sin citas"}</p>
              ) : (
                <ul className="agenda-items">
                  {list.map((b) => (
                    <li key={b.id}>
                      <button type="button" className={`agenda-item agenda-item--${b.status.toLowerCase()}`} onClick={() => setOpen(b)}>
                        <span className="agenda-item__time">
                          {timeIn(b.startAt, tz)}
                          <span>{timeIn(b.endAt, tz)}</span>
                        </span>
                        <span className="agenda-item__main">
                          <span className="agenda-item__who">{b.contact.name ?? b.contact.phone}</span>
                          <span className="agenda-item__what">
                            {b.serviceName}
                            {b.staff && !person ? ` · ${b.staff.name}` : ""}
                          </span>
                        </span>
                        <span className="agenda-item__tags">
                          {b.source === "ai" && (
                            <span className="agenda-ai" title="La reservó el agente de IA">
                              <NavIcon name="sparkles" size={11} />
                              IA
                            </span>
                          )}
                          {b.status !== "CONFIRMED" && <BookingStatusChip status={b.status} />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {creating && <BookingFormDialog mode="create" onClose={() => setCreating(false)} />}
      {moving && <BookingFormDialog mode="move" booking={moving} onClose={() => setMoving(null)} />}
      {open && (
        <BookingDetailDialog
          booking={open}
          tz={tz}
          onClose={() => setOpen(null)}
          onMove={(b) => {
            setOpen(null);
            setMoving(b);
          }}
        />
      )}
      {mySchedule && mine && <MyScheduleDialog schedule={mine} onClose={() => setMySchedule(false)} />}
    </div>
  );
}

function MyScheduleDialog({ schedule, onClose }: { schedule: NonNullable<Awaited<ReturnType<typeof fetchStaffSchedules>>[number]>; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog agenda-dialog agenda-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="my-schedule-title" onClick={(e) => e.stopPropagation()}>
        <header className="agenda-dialog__head">
          <h2 id="my-schedule-title" className="agenda-dialog__title">
            Mi horario
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <NavIcon name="x" size={15} />
          </button>
        </header>
        <div className="agenda-dialog__body">
          <p className="agenda-muted" style={{ margin: 0 }}>
            Las horas en que te pueden reservar citas. Lo que ya está reservado no se mueve.
          </p>
          <ScheduleEditor schedule={schedule} onSaved={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
