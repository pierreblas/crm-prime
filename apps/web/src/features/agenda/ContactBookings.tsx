"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { BookingDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";
import { fetchBookingSettings, fetchContactBookings } from "@/lib/bff";
import { BookingFormDialog } from "./BookingFormDialog";
import { BookingDetailDialog } from "./BookingDetailDialog";
import { BookingStatusChip } from "./BookingStatusChip";
import { dateIn, dayLabel, timeIn, todayIn } from "./time";

/** En la ficha del chat: las citas del contacto y un botón para agendarle una. */
export function ContactBookings({
  contact,
  conversationId,
}: {
  contact: { id: string; name: string | null; phone: string };
  conversationId: string;
}) {
  const t = useT();
  const { data: settings } = useQuery({ queryKey: ["bookings", "settings"], queryFn: fetchBookingSettings });
  const { data: bookings } = useQuery({
    queryKey: ["bookings", "contact", contact.id],
    queryFn: () => fetchContactBookings(contact.id),
  });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<BookingDto | null>(null);
  const [moving, setMoving] = useState<BookingDto | null>(null);
  const tz = settings?.timezone ?? "America/Lima";
  const today = todayIn(tz);
  const now = Date.now();
  // Las próximas confirmadas y, como mucho, la última que ya pasó.
  const upcoming = (bookings ?? []).filter((b) => new Date(b.startAt).getTime() >= now && b.status !== "CANCELLED");
  const last = (bookings ?? []).find((b) => new Date(b.startAt).getTime() < now);
  const shown = [...upcoming, ...(last ? [last] : [])];

  return (
    <section className="cp-section">
      <div className="cp-section__title">
        <span>{t("inbox.bookingsSection")}</span>
        <button type="button" className="cp-link agenda-cp-add" onClick={() => setCreating(true)}>
          <NavIcon name="plus" size={11} />
          {t("inbox.bookAppointment")}
        </button>
      </div>
      {bookings && shown.length === 0 && <p className="cp-empty">{t("inbox.noBookings")}</p>}
      {shown.map((b) => (
        <button key={b.id} type="button" className="agenda-cp-item" onClick={() => setOpen(b)}>
          <NavIcon name="calendar" size={14} />
          <span className="agenda-cp-item__main">
            <span className="agenda-cp-item__when">
              {dayLabel(dateIn(b.startAt, tz), today)}, {timeIn(b.startAt, tz)}
            </span>
            <span className="agenda-muted">
              {b.serviceName}
              {b.staff ? ` · ${b.staff.name}` : ""}
            </span>
          </span>
          {b.status !== "CONFIRMED" && <BookingStatusChip status={b.status} />}
        </button>
      ))}
      {bookings && bookings.length > shown.length && (
        <Link href="/agenda" className="cp-link">
          {t("inbox.openAgenda")}
          <NavIcon name="arrow-right" size={11} />
        </Link>
      )}

      {creating && <BookingFormDialog mode="create" contact={contact} conversationId={conversationId} onClose={() => setCreating(false)} />}
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
    </section>
  );
}
