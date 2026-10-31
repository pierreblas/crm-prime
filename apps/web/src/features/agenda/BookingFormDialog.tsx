"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BookingDto, ContactDto, SlotDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import {
  createBooking,
  fetchBookingServices,
  fetchBookingSettings,
  fetchBookingSlots,
  fetchContacts,
  updateBooking,
} from "@/lib/bff";
import { addDays, dayChip, dayLabel, durationLabel, todayIn } from "./time";

type ContactRef = { id: string; name: string | null; phone: string };

type Props =
  | {
      mode: "create";
      /** Desde el chat: el contacto ya viene puesto. */
      contact?: ContactRef;
      conversationId?: string | null;
      onClose: () => void;
      onDone?: (b: BookingDto) => void;
    }
  | { mode: "move"; booking: BookingDto; onClose: () => void; onDone?: (b: BookingDto) => void };

const WINDOW = 14;

/**
 * Reservar o mover una cita: servicio, persona, día y hora. Solo se ofrecen
 * horas libres (las calcula la API con el horario de cada persona y sus
 * citas), así que no hay forma de pisar otra cita desde aquí; si alguien
 * reserva esa misma hora un segundo antes, la API responde 409 y se avisa.
 */
export function BookingFormDialog(props: Props) {
  const { onClose } = props;
  const moving = props.mode === "move" ? props.booking : null;
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["bookings", "settings"], queryFn: fetchBookingSettings });
  const { data: services } = useQuery({ queryKey: ["bookings", "services"], queryFn: fetchBookingServices });
  const active = useMemo(() => (services ?? []).filter((s) => s.isActive && s.staff.length > 0), [services]);
  const tz = settings?.timezone ?? "America/Lima";
  const today = todayIn(tz);

  const [contact, setContact] = useState<ContactRef | null>(
    props.mode === "create" ? (props.contact ?? null) : moving!.contact,
  );
  const [serviceId, setServiceId] = useState<string>(moving?.service?.id ?? "");
  const [userId, setUserId] = useState<string>(moving?.staff?.id ?? "");
  const [windowStart, setWindowStart] = useState(today);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [note, setNote] = useState("");

  // «Hoy» es el del negocio: cuando llegan sus reglas, la tira empieza ahí.
  const zone = settings?.timezone;
  useEffect(() => {
    if (zone) setWindowStart(todayIn(zone));
  }, [zone]);

  // Un único servicio: elegido de entrada.
  useEffect(() => {
    if (!serviceId && active.length === 1) setServiceId(active[0]!.id);
  }, [active, serviceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const service = active.find((s) => s.id === serviceId) ?? null;
  const slotsQ = useQuery({
    queryKey: ["bookings", "slots", serviceId, userId, windowStart, moving?.id ?? ""],
    queryFn: () =>
      fetchBookingSlots({ serviceId, userId: userId || undefined, from: windowStart, days: WINDOW, excludeBookingId: moving?.id }),
    enabled: !!serviceId,
  });
  const byDay = useMemo(() => {
    const m = new Map<string, SlotDto[]>();
    for (const s of slotsQ.data ?? []) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return m;
  }, [slotsQ.data]);
  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDays(windowStart, i)), [windowStart]);

  // Al cambiar de servicio, persona o ventana: el primer día con hueco.
  useEffect(() => {
    if (!slotsQ.data) return;
    setSlot(null);
    setDay((d) => (d && byDay.has(d) ? d : (days.find((x) => byDay.has(x)) ?? null)));
  }, [slotsQ.data, byDay, days]);

  const save = useMutation({
    mutationFn: () => {
      if (!slot || !service) throw new Error("Elige una hora");
      if (moving) return updateBooking(moving.id, { startAt: slot.start, userId: slot.staff.id });
      if (!contact) throw new Error("Elige el contacto");
      return createBooking({
        contactId: contact.id,
        serviceId: service.id,
        userId: slot.staff.id,
        startAt: slot.start,
        note: note.trim() || null,
        conversationId: props.mode === "create" ? (props.conversationId ?? null) : null,
      });
    },
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(moving ? "Cita movida" : "Cita reservada");
      props.onDone?.(b);
      onClose();
    },
    onError: (e) => {
      toast.error((e as Error).message);
      // Probablemente alguien la ocupó: horas al día.
      void slotsQ.refetch();
    },
  });

  const daySlots = day ? (byDay.get(day) ?? []) : [];
  const multiStaff = (service?.staff.length ?? 0) > 1;

  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog agenda-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="agenda-dialog__head">
          <h2 id="booking-form-title" className="agenda-dialog__title">
            {moving ? "Mover la cita" : "Nueva cita"}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <NavIcon name="x" size={15} />
          </button>
        </header>

        {services && active.length === 0 ? (
          <div className="agenda-dialog__body">
            <p className="agenda-muted">
              Aún no hay servicios que reservar. Crea uno en Ajustes › Agenda (qué es, cuánto dura y quién lo atiende).
            </p>
            <Link href="/settings?tab=agenda" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }}>
              Configurar la agenda
            </Link>
          </div>
        ) : (
          <div className="agenda-dialog__body">
            {moving ? (
              <p className="agenda-muted" style={{ margin: 0 }}>
                {moving.serviceName} con {moving.contact.name ?? moving.contact.phone}. Elige la nueva hora.
              </p>
            ) : (
              <ContactPicker value={contact} onChange={setContact} locked={props.mode === "create" && !!props.contact} />
            )}

            <div className="agenda-form-row">
              <label className="agenda-field">
                <span className="label">Servicio</span>
                <select
                  className="field field-sm"
                  value={serviceId}
                  disabled={!!moving}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    setUserId("");
                  }}
                >
                  {!serviceId && <option value="">Elige un servicio</option>}
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {durationLabel(s.durationMin)}
                    </option>
                  ))}
                </select>
              </label>
              {service && multiStaff && (
                <label className="agenda-field">
                  <span className="label">Con</span>
                  <select className="field field-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
                    <option value="">Quien esté libre</option>
                    {service.staff.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {moving && services && !service && (
              <p className="agenda-muted">El servicio de esta cita ya no está activo: cancélala y reserva otra.</p>
            )}

            {service && (
              <>
                <div className="agenda-days" role="group" aria-label="Día">
                  <button
                    type="button"
                    className="icon-btn agenda-days__nav"
                    onClick={() => setWindowStart((w) => (addDays(w, -7) < today ? today : addDays(w, -7)))}
                    disabled={windowStart <= today}
                    aria-label="Días anteriores"
                  >
                    <NavIcon name="chevron-left" size={15} />
                  </button>
                  <div className="agenda-days__strip">
                    {days.map((d) => {
                      const c = dayChip(d);
                      const free = byDay.get(d)?.length ?? 0;
                      return (
                        <button
                          key={d}
                          type="button"
                          className={`agenda-daychip${d === day ? " is-on" : ""}${free ? "" : " is-empty"}`}
                          aria-pressed={d === day}
                          disabled={!free}
                          onClick={() => {
                            setDay(d);
                            setSlot(null);
                          }}
                          title={free ? `${free} horas libres` : "Sin horas libres"}
                        >
                          <span className="agenda-daychip__wd">{d === today ? "hoy" : c.weekday}</span>
                          <span className="agenda-daychip__n">{c.day}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="icon-btn agenda-days__nav"
                    onClick={() => setWindowStart((w) => addDays(w, 7))}
                    aria-label="Días siguientes"
                  >
                    <NavIcon name="chevron-right" size={15} />
                  </button>
                </div>

                <div className="agenda-slots" aria-live="polite">
                  {slotsQ.isPending ? (
                    <p className="agenda-muted">Buscando horas libres…</p>
                  ) : !day ? (
                    <p className="agenda-muted">No hay horas libres en estos días. Prueba con los siguientes{multiStaff && userId ? " o con otra persona" : ""}.</p>
                  ) : (
                    <>
                      <div className="agenda-slots__day">{dayLabel(day, today)}</div>
                      <div className="agenda-slots__grid">
                        {daySlots.map((s) => (
                          <button
                            key={s.start}
                            type="button"
                            className={`agenda-slot${slot?.start === s.start ? " is-on" : ""}`}
                            aria-pressed={slot?.start === s.start}
                            onClick={() => setSlot(s)}
                            title={multiStaff ? `Con ${s.staff.name}` : undefined}
                          >
                            {s.time}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {!moving && service && (
              <label className="agenda-field">
                <span className="label">Nota para quien atiende (opcional)</span>
                <textarea className="field field-sm" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            )}
          </div>
        )}

        <footer className="agenda-dialog__foot">
          {slot && multiStaff && <span className="agenda-muted agenda-dialog__who">Con {slot.staff.name}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!slot || (!moving && !contact) || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? "Guardando…"
              : slot
                ? `${moving ? "Mover a" : "Reservar"} ${dayLabel(slot.date, today).toLowerCase()}, ${slot.time}`
                : moving
                  ? "Mover"
                  : "Reservar"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Buscar un contacto por nombre o teléfono. */
function ContactPicker({ value, onChange, locked }: { value: ContactRef | null; onChange: (c: ContactRef | null) => void; locked: boolean }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["contacts", "pick", debounced],
    queryFn: () => fetchContacts(debounced),
    enabled: debounced.length >= 2,
  });

  if (value) {
    return (
      <div className="agenda-field">
        <span className="label">Cliente</span>
        <div className="agenda-picked">
          <span className="agenda-picked__name">{value.name ?? value.phone}</span>
          {value.name && <span className="agenda-muted">{value.phone}</span>}
          {!locked && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => onChange(null)}>
              Cambiar
            </button>
          )}
        </div>
      </div>
    );
  }
  const results = (data ?? []).slice(0, 6) as ContactDto[];
  return (
    <label className="agenda-field">
      <span className="label">Cliente</span>
      <input
        className="field field-sm"
        placeholder="Busca por nombre o teléfono"
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
      />
      {debounced.length >= 2 && (
        <ul className="agenda-results" role="listbox">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => onChange({ id: c.id, name: c.name, phone: c.phone })}>
                <span>{c.name ?? c.phone}</span>
                {c.name && <span className="agenda-muted">{c.phone}</span>}
              </button>
            </li>
          ))}
          {!isFetching && results.length === 0 && <li className="agenda-muted agenda-results__none">Nadie con ese nombre o teléfono.</li>}
        </ul>
      )}
    </label>
  );
}
