import { BOOKING_STATUS_LABEL, type BookingStatus } from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";

const ICON: Record<BookingStatus, IconName> = {
  CONFIRMED: "calendar",
  COMPLETED: "check",
  NO_SHOW: "alert",
  CANCELLED: "x",
};

/** Estado de una cita: color e icono a la vez (La Regla del Estado Doble). */
export function BookingStatusChip({ status }: { status: BookingStatus }) {
  return (
    <span className={`agenda-status agenda-status--${status.toLowerCase()}`}>
      <NavIcon name={ICON[status]} size={11} />
      {BOOKING_STATUS_LABEL[status]}
    </span>
  );
}
