"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BookingDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { cancelBooking, updateBooking } from "@/lib/bff";
import { BookingStatusChip } from "./BookingStatusChip";
import { dateIn, dayLabel, timeIn, todayIn } from "./time";

const SOURCE_LABEL: Record<BookingDto["source"], string> = {
  ai: "La reservó el agente de IA por WhatsApp",
  manual: "La reservó el equipo",
  api: "Llegó por la API",
  link: "La reservó el cliente con el enlace",
};

/** Una cita: cuándo, con quién, de dónde vino, y lo que se puede hacer con ella. */
export function BookingDetailDialog({
  booking,
  tz,
  onClose,
  onMove,
}: {
  booking: BookingDto;
  tz: string;
  onClose: () => void;
  onMove: (b: BookingDto) => void;
}) {
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const today = todayIn(tz);
  const date = dateIn(booking.startAt, tz);
  const past = new Date(booking.endAt).getTime() < Date.now();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: ["bookings"] });
    toast.success(msg);
    onClose();
  };
  const status = useMutation({
    mutationFn: (s: "CONFIRMED" | "COMPLETED" | "NO_SHOW") => updateBooking(booking.id, { status: s }),
    onSuccess: (b) => done(b.status === "COMPLETED" ? "Marcada: asistió" : b.status === "NO_SHOW" ? "Marcada: no asistió" : "Cita confirmada de nuevo"),
    onError: (e) => toast.error((e as Error).message),
  });
  const cancel = useMutation({
    mutationFn: () => cancelBooking(booking.id, reason.trim() || null),
    onSuccess: () => done("Cita cancelada"),
    onError: (e) => toast.error((e as Error).message),
  });
  const busy = status.isPending || cancel.isPending;

  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog agenda-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-detail-title" onClick={(e) => e.stopPropagation()}>
        <header className="agenda-dialog__head">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <h2 id="booking-detail-title" className="agenda-dialog__title">
              {booking.serviceName}
            </h2>
            <BookingStatusChip status={booking.status} />
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <NavIcon name="x" size={15} />
          </button>
        </header>

        <div className="agenda-dialog__body">
          <dl className="agenda-facts">
            <dt>
              <NavIcon name="calendar" size={14} />
              Cuándo
            </dt>
            <dd className={booking.status === "CANCELLED" ? "agenda-struck" : undefined}>
              {dayLabel(date, today)}, {timeIn(booking.startAt, tz)}–{timeIn(booking.endAt, tz)}
            </dd>
            <dt>
              <NavIcon name="user" size={14} />
              Cliente
            </dt>
            <dd>
              {booking.contact.name ?? booking.contact.phone}
              {booking.contact.name && <span className="agenda-muted"> · {booking.contact.phone}</span>}
              {booking.conversationId && (
                <Link href={`/?c=${booking.conversationId}`} className="cp-link" style={{ marginLeft: 8 }}>
                  Abrir chat
                  <NavIcon name="arrow-right" size={11} />
                </Link>
              )}
            </dd>
            <dt>
              <NavIcon name="user" size={14} />
              Atiende
            </dt>
            <dd>{booking.staff?.name ?? "Sin asignar"}</dd>
            <dt>
              <NavIcon name={booking.source === "ai" ? "sparkles" : "pencil"} size={14} />
              Origen
            </dt>
            <dd>{SOURCE_LABEL[booking.source]}</dd>
            {booking.note && (
              <>
                <dt>
                  <NavIcon name="note" size={14} />
                  Nota
                </dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{booking.note}</dd>
              </>
            )}
            {booking.status === "CANCELLED" && booking.cancelReason && (
              <>
                <dt>
                  <NavIcon name="x" size={14} />
                  Motivo
                </dt>
                <dd>{booking.cancelReason}</dd>
              </>
            )}
          </dl>

          {booking.status === "CONFIRMED" && past && (
            <div className="agenda-ask" role="group" aria-label="¿Vino?">
              <span>Ya pasó la hora. ¿Vino?</span>
              <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => status.mutate("COMPLETED")}>
                <NavIcon name="check" size={14} />
                Asistió
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => status.mutate("NO_SHOW")}>
                No asistió
              </button>
            </div>
          )}

          {cancelling && (
            <label className="agenda-field">
              <span className="label">Motivo (opcional, queda en el historial)</span>
              <input
                className="field field-sm"
                autoFocus
                maxLength={300}
                value={reason}
                placeholder="Ej.: el cliente no puede ese día"
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && cancel.mutate()}
              />
            </label>
          )}
        </div>

        <footer className="agenda-dialog__foot">
          {booking.status === "CONFIRMED" && !cancelling && (
            <>
              <button type="button" className="btn btn-danger btn-sm" style={{ marginRight: "auto" }} disabled={busy} onClick={() => setCancelling(true)}>
                Cancelar cita
              </button>
              {!past && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => status.mutate("COMPLETED")}>
                    Asistió
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || !booking.service} onClick={() => onMove(booking)}>
                    Mover
                  </button>
                </>
              )}
            </>
          )}
          {cancelling && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setCancelling(false)}>
                Volver
              </button>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => cancel.mutate()}>
                {cancel.isPending ? "Cancelando…" : "Sí, cancelar la cita"}
              </button>
            </>
          )}
          {(booking.status === "COMPLETED" || booking.status === "NO_SHOW") && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => status.mutate("CONFIRMED")}>
              Deshacer: volver a confirmada
            </button>
          )}
          {booking.status === "CANCELLED" && !past && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => status.mutate("CONFIRMED")}>
              Reactivar la cita
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
