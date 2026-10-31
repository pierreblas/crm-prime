import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_WEEKLY_HOURS,
  addDays,
  bookingSettingsSchema,
  computeSlots,
  contactCurrency,
  formatBookingAt,
  formatBookingDay,
  isFreeSlot,
  parseDateRanges,
  parseLocalDateTime,
  parseWeeklyHours,
  utcToZoned,
  zonedToUtc,
  type BookingDto,
  type BookingServiceDto,
  type BookingServiceInput,
  type BookingSettingsDto,
  type BookingSource,
  type BookingsQuery,
  type BusyRange,
  type CreateBookingInput,
  type DateRange,
  type SlotDto,
  type SlotInput,
  type SlotsQuery,
  type StaffScheduleDto,
  type StaffScheduleInput,
  type UpdateBookingInput,
  type UpdateBookingServiceInput,
  type UpdateBookingSettingsInput,
  type WeeklyHours,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { currentActor } from "../../infra/tenant/actor";

const BOOKING_INCLUDE = {
  service: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
  contact: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.BookingInclude;
type BookingRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

/** Una persona que atiende un servicio, con su horario ya leído. */
interface Staff {
  id: string;
  name: string;
  hours: WeeklyHours;
  blackouts: DateRange[];
}

/**
 * Con qué reglas se valida una hora. El cliente (y el agente de IA, que habla
 * por él) respeta la antelación mínima, el límite de días y el intervalo de
 * las franjas. El equipo, desde el panel, puede apuntar una cita para dentro
 * de media hora o a las 10:15: solo tiene que caer en el horario y estar libre.
 */
type Rules = "client" | "team";

const ACTION_LABEL = { created: "Cita reservada", rescheduled: "Cita movida", cancelled: "Cita cancelada" } as const;
type BookingAction = keyof typeof ACTION_LABEL;

/** La base rechazó la cita porque pisa otra de la misma persona (bookings_no_overlap). */
function isOverlap(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("bookings_no_overlap") || msg.includes("23P01");
}

const SLOT_TAKEN = "Esa hora se acaba de ocupar. Elige otra.";

/**
 * Reservas: reglas de la empresa, servicios, horario de cada persona, franjas
 * libres y citas. Las franjas salen del motor puro de @crm/shared; aquí se
 * cargan los datos, se valida y se escribe. Que dos citas no se pisen lo
 * garantiza además la base con una restricción de exclusión, así que dos
 * reservas simultáneas a la misma hora no pasan aunque las dos validen bien.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Reglas de la empresa ────────────────────────────────────
  async settings(): Promise<BookingSettingsDto> {
    const row = await this.prisma.bookingSettings.findUnique({ where: { orgId: this.tenant.orgId() } });
    return bookingSettingsSchema.parse({
      ...(row
        ? {
            timezone: row.timezone,
            slotIntervalMin: row.slotIntervalMin,
            minNoticeMin: row.minNoticeMin,
            maxDays: row.maxDays,
            bookedStageId: row.bookedStageId,
            blackouts: parseDateRanges(row.blackouts),
          }
        : {}),
    });
  }

  async updateSettings(input: UpdateBookingSettingsInput): Promise<BookingSettingsDto> {
    if (input.bookedStageId) {
      const stage = await this.prisma.pipelineStage.findUnique({ where: { id: input.bookedStageId }, select: { id: true } });
      if (!stage) throw new BadRequestException("Esa etapa no existe");
    }
    const next = { ...(await this.settings()), ...input };
    const data = {
      timezone: next.timezone,
      slotIntervalMin: next.slotIntervalMin,
      minNoticeMin: next.minNoticeMin,
      maxDays: next.maxDays,
      bookedStageId: next.bookedStageId,
      blackouts: next.blackouts as Prisma.InputJsonValue,
    };
    const orgId = this.tenant.orgId();
    await this.prisma.bookingSettings.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
    return this.settings();
  }

  // ── Servicios ───────────────────────────────────────────────
  async listServices(): Promise<BookingServiceDto[]> {
    const rows = await this.prisma.bookingService.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: { staff: { include: { user: { select: { id: true, name: true, email: true, isActive: true } } } } },
    });
    const upcoming = await this.prisma.booking.groupBy({
      by: ["serviceId"],
      where: { serviceId: { in: rows.map((r) => r.id) }, status: "CONFIRMED", startAt: { gte: new Date() } },
      _count: { _all: true },
    });
    const count = new Map(upcoming.map((u) => [u.serviceId, u._count._all]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      durationMin: r.durationMin,
      bufferAfterMin: r.bufferAfterMin,
      isActive: r.isActive,
      staff: r.staff
        .filter((s) => s.user.isActive)
        .map((s) => ({ id: s.user.id, name: s.user.name ?? s.user.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      upcoming: count.get(r.id) ?? 0,
    }));
  }

  async createService(input: BookingServiceInput): Promise<BookingServiceDto> {
    await this.assertServiceName(input.name);
    const staffIds = await this.assertStaff(input.staffIds);
    const orgId = this.tenant.orgId();
    const last = await this.prisma.bookingService.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
    const created = await this.prisma.bookingService.create({
      data: {
        orgId,
        name: input.name,
        description: input.description || null,
        durationMin: input.durationMin,
        bufferAfterMin: input.bufferAfterMin,
        isActive: input.isActive,
        order: (last?.order ?? -1) + 1,
        staff: { create: staffIds.map((userId) => ({ orgId, userId })) },
      },
    });
    return this.serviceDto(created.id);
  }

  async updateService(id: string, input: UpdateBookingServiceInput): Promise<BookingServiceDto> {
    const current = await this.prisma.bookingService.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new NotFoundException("Servicio no encontrado");
    if (input.name !== undefined) await this.assertServiceName(input.name, id);
    await this.prisma.bookingService.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
        ...(input.bufferAfterMin !== undefined ? { bufferAfterMin: input.bufferAfterMin } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    if (input.staffIds) {
      const staffIds = await this.assertStaff(input.staffIds);
      await this.prisma.bookingServiceStaff.deleteMany({ where: { serviceId: id, userId: { notIn: staffIds } } });
      await this.prisma.bookingServiceStaff.createMany({
        data: staffIds.map((userId) => ({ orgId: this.tenant.orgId(), serviceId: id, userId })),
        skipDuplicates: true,
      });
    }
    // Las citas ya hechas no cambian de duración: se reservaron con la de entonces.
    this.changed();
    return this.serviceDto(id);
  }

  /** Con citas hechas, se desactiva (el historial sigue diciendo qué se reservó); sin ellas, se borra. */
  async removeService(id: string): Promise<{ deleted: boolean; archived: boolean }> {
    const service = await this.prisma.bookingService.findUnique({ where: { id }, select: { id: true } });
    if (!service) throw new NotFoundException("Servicio no encontrado");
    const used = await this.prisma.booking.count({ where: { serviceId: id } });
    if (used > 0) {
      await this.prisma.bookingService.update({ where: { id }, data: { isActive: false } });
      return { deleted: false, archived: true };
    }
    await this.prisma.bookingService.delete({ where: { id } });
    return { deleted: true, archived: false };
  }

  private async serviceDto(id: string): Promise<BookingServiceDto> {
    const all = await this.listServices();
    const found = all.find((s) => s.id === id);
    if (!found) throw new NotFoundException("Servicio no encontrado");
    return found;
  }

  private async assertServiceName(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.bookingService.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" }, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    // El agente elige el servicio por su nombre: dos iguales serían ambiguos.
    if (clash) throw new BadRequestException("Ya hay un servicio con ese nombre");
  }

  private async assertStaff(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const found = await this.prisma.user.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true } });
    if (found.length !== unique.length) throw new BadRequestException("Alguna de esas personas no existe o está desactivada");
    return unique;
  }

  // ── Horario de cada persona ─────────────────────────────────
  async schedules(): Promise<StaffScheduleDto[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, staffSchedule: true },
      orderBy: { name: "asc" },
    });
    return users.map((u) => ({
      userId: u.id,
      name: u.name ?? u.email,
      hours: u.staffSchedule ? parseWeeklyHours(u.staffSchedule.hours) : DEFAULT_WEEKLY_HOURS,
      blackouts: parseDateRanges(u.staffSchedule?.blackouts),
      acceptsBookings: u.staffSchedule?.acceptsBookings ?? true,
      isDefault: !u.staffSchedule,
    }));
  }

  async saveSchedule(userId: string, input: StaffScheduleInput): Promise<StaffScheduleDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
    if (!user?.isActive) throw new NotFoundException("Persona no encontrada");
    const data = {
      hours: input.hours as Prisma.InputJsonValue,
      blackouts: input.blackouts as Prisma.InputJsonValue,
      acceptsBookings: input.acceptsBookings,
    };
    await this.prisma.staffSchedule.upsert({
      where: { userId },
      create: { orgId: this.tenant.orgId(), userId, ...data },
      update: data,
    });
    this.changed();
    const all = await this.schedules();
    return all.find((s) => s.userId === userId)!;
  }

  // ── Franjas libres ──────────────────────────────────────────
  /** Las horas libres de un servicio, de una persona o de cualquiera que lo atienda. */
  async slots(q: SlotsQuery): Promise<SlotDto[]> {
    const service = await this.activeService(q.serviceId);
    const settings = await this.settings();
    const staff = await this.staffFor(service.id, q.userId);
    const from = q.from ?? utcToZoned(new Date(), settings.timezone).date;
    return this.freeSlots(settings, service, staff, from, q.days, "team", q.excludeBookingId);
  }

  private async freeSlots(
    settings: BookingSettingsDto,
    service: { durationMin: number; bufferAfterMin: number },
    staff: Staff[],
    from: string,
    days: number,
    rules: Rules,
    excludeBookingId?: string,
  ): Promise<SlotDto[]> {
    if (!staff.length) return [];
    const windowFrom = new Date(zonedToUtc(from, "00:00", settings.timezone).getTime() - 86_400_000);
    const windowTo = new Date(zonedToUtc(addDays(from, days), "00:00", settings.timezone).getTime() + 86_400_000);
    const busy = await this.busyFor(staff.map((s) => s.id), windowFrom, windowTo, excludeBookingId);
    // «Cualquiera»: a igual hora gana quien tiene menos citas, para repartir.
    const ordered = [...staff].sort((a, b) => (busy.get(a.id)?.length ?? 0) - (busy.get(b.id)?.length ?? 0) || a.name.localeCompare(b.name));
    const byStart = new Map<number, SlotDto>();
    for (const person of ordered) {
      const input = this.slotInput(settings, service, person, busy.get(person.id) ?? [], rules);
      for (const s of computeSlots({ ...input, intervalMin: settings.slotIntervalMin, fromDate: from, days })) {
        const key = s.start.getTime();
        if (byStart.has(key)) continue;
        byStart.set(key, {
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          date: s.date,
          time: s.time,
          staff: { id: person.id, name: person.name },
        });
      }
    }
    return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  private slotInput(
    settings: BookingSettingsDto,
    service: { durationMin: number; bufferAfterMin: number },
    staff: Staff,
    busy: BusyRange[],
    rules: Rules,
  ): Omit<SlotInput, "fromDate" | "days" | "limit"> {
    return {
      timezone: settings.timezone,
      hours: staff.hours,
      blackouts: [...settings.blackouts, ...staff.blackouts],
      busy,
      durationMin: service.durationMin,
      bufferAfterMin: service.bufferAfterMin,
      // El equipo puede apuntar a cualquier múltiplo de 5 minutos.
      intervalMin: rules === "client" ? settings.slotIntervalMin : 5,
      minNoticeMin: rules === "client" ? settings.minNoticeMin : 0,
      maxDays: rules === "client" ? settings.maxDays : 365,
      now: new Date(),
    };
  }

  /** Quién atiende el servicio (o solo esa persona), activo y aceptando citas. */
  private async staffFor(serviceId: string, userId?: string | null): Promise<Staff[]> {
    const rows = await this.prisma.bookingServiceStaff.findMany({
      where: { serviceId, ...(userId ? { userId } : {}), user: { isActive: true } },
      include: { user: { select: { id: true, name: true, email: true, staffSchedule: true } } },
    });
    return rows
      .filter((r) => r.user.staffSchedule?.acceptsBookings ?? true)
      .map((r) => ({
        id: r.user.id,
        name: r.user.name ?? r.user.email,
        hours: r.user.staffSchedule ? parseWeeklyHours(r.user.staffSchedule.hours) : DEFAULT_WEEKLY_HOURS,
        blackouts: parseDateRanges(r.user.staffSchedule?.blackouts),
      }));
  }

  private async busyFor(userIds: string[], from: Date, to: Date, excludeId?: string): Promise<Map<string, BusyRange[]>> {
    const rows = await this.prisma.booking.findMany({
      where: {
        userId: { in: userIds },
        status: "CONFIRMED",
        startAt: { lt: to },
        blockEndAt: { gt: from },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { userId: true, startAt: true, blockEndAt: true },
    });
    const out = new Map<string, BusyRange[]>();
    for (const r of rows) {
      if (!r.userId) continue;
      const list = out.get(r.userId) ?? [];
      list.push({ start: r.startAt, end: r.blockEndAt });
      out.set(r.userId, list);
    }
    return out;
  }

  private async activeService(id: string) {
    const service = await this.prisma.bookingService.findUnique({ where: { id } });
    if (!service || !service.isActive) throw new NotFoundException("Servicio no encontrado o desactivado");
    return service;
  }

  /** La primera persona (de las candidatas) que tiene libre esa hora exacta. */
  private async pickFree(
    settings: BookingSettingsDto,
    service: { durationMin: number; bufferAfterMin: number },
    staff: Staff[],
    start: Date,
    rules: Rules,
    excludeBookingId?: string,
  ): Promise<Staff | null> {
    if (!staff.length) return null;
    const window = { from: new Date(start.getTime() - 86_400_000), to: new Date(start.getTime() + 2 * 86_400_000) };
    const busy = await this.busyFor(staff.map((s) => s.id), window.from, window.to, excludeBookingId);
    const ordered = [...staff].sort((a, b) => (busy.get(a.id)?.length ?? 0) - (busy.get(b.id)?.length ?? 0));
    return ordered.find((p) => isFreeSlot(this.slotInput(settings, service, p, busy.get(p.id) ?? [], rules), start)) ?? null;
  }

  // ── Citas ───────────────────────────────────────────────────
  async list(q: BookingsQuery): Promise<BookingDto[]> {
    const rows = await this.prisma.booking.findMany({
      where: {
        startAt: { gte: new Date(q.from), lt: new Date(q.to) },
        ...(q.userId ? { userId: q.userId } : {}),
      },
      include: BOOKING_INCLUDE,
      orderBy: { startAt: "asc" },
      take: 1000,
    });
    return rows.map((r) => this.toDto(r));
  }

  /** Las de un contacto: las próximas primero y luego las últimas pasadas. */
  async forContact(contactId: string): Promise<BookingDto[]> {
    const now = new Date();
    const [next, past] = await Promise.all([
      this.prisma.booking.findMany({ where: { contactId, startAt: { gte: now } }, include: BOOKING_INCLUDE, orderBy: { startAt: "asc" }, take: 10 }),
      this.prisma.booking.findMany({ where: { contactId, startAt: { lt: now } }, include: BOOKING_INCLUDE, orderBy: { startAt: "desc" }, take: 5 }),
    ]);
    return [...next, ...past].map((r) => this.toDto(r));
  }

  async create(input: CreateBookingInput, source: BookingSource, createdById: string | null, rules: Rules = "team"): Promise<BookingDto> {
    const start = new Date(input.startAt);
    const service = await this.activeService(input.serviceId);
    const contact = await this.prisma.contact.findUnique({
      where: { id: input.contactId },
      select: { id: true, orgId: true, name: true, phone: true, currency: true },
    });
    if (!contact) throw new NotFoundException("Contacto no encontrado");
    if (input.conversationId) {
      const conv = await this.prisma.conversation.findUnique({ where: { id: input.conversationId }, select: { contactId: true } });
      if (conv?.contactId !== contact.id) throw new BadRequestException("Esa conversación no es de este contacto");
    }
    const settings = await this.settings();
    const staff = await this.staffFor(service.id, input.userId);
    if (!staff.length) {
      throw new BadRequestException(
        input.userId ? "Esa persona no atiende este servicio o no acepta citas" : "Nadie atiende este servicio todavía",
      );
    }
    const person = await this.pickFree(settings, service, staff, start, rules);
    if (!person) throw new ConflictException(input.userId ? "Esa persona no tiene libre esa hora" : "Esa hora no está libre");

    const end = new Date(start.getTime() + service.durationMin * 60_000);
    const blockEnd = new Date(end.getTime() + service.bufferAfterMin * 60_000);
    const dealId = await this.attachDeal(contact, settings.bookedStageId);
    const row = await this.prisma.booking
      .create({
        data: {
          orgId: contact.orgId,
          serviceId: service.id,
          serviceName: service.name,
          userId: person.id,
          contactId: contact.id,
          dealId,
          conversationId: input.conversationId ?? null,
          startAt: start,
          endAt: end,
          blockEndAt: blockEnd,
          source,
          note: input.note || null,
          createdById,
        },
        include: BOOKING_INCLUDE,
      })
      .catch((e: unknown) => {
        if (isOverlap(e)) throw new ConflictException(SLOT_TAKEN);
        throw e;
      });
    await this.logOnDeal(row, "created", settings.timezone);
    this.emit("booking.created", row);
    return this.toDto(row);
  }

  async update(id: string, input: UpdateBookingInput, rules: Rules = "team"): Promise<BookingDto> {
    const current = await this.prisma.booking.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Cita no encontrada");
    if (current.status === "CANCELLED" && input.status && input.status !== "CONFIRMED") {
      throw new BadRequestException("Una cita cancelada solo puede volver a confirmarse");
    }
    const moving =
      (input.startAt !== undefined && new Date(input.startAt).getTime() !== current.startAt.getTime()) ||
      (input.userId !== undefined && input.userId !== current.userId);

    let timing: { startAt: Date; endAt: Date; blockEndAt: Date; userId: string } | null = null;
    if (moving) {
      if (current.status !== "CONFIRMED") throw new BadRequestException("Solo se puede mover una cita confirmada");
      if (!current.serviceId) throw new BadRequestException("El servicio de esta cita ya no existe: cancélala y reserva otra");
      const service = await this.activeService(current.serviceId);
      const settings = await this.settings();
      const start = input.startAt ? new Date(input.startAt) : current.startAt;
      const staff = await this.staffFor(service.id, input.userId ?? current.userId);
      const person = await this.pickFree(settings, service, staff, start, rules, id);
      if (!person) throw new ConflictException("Esa hora no está libre");
      const endAt = new Date(start.getTime() + service.durationMin * 60_000);
      timing = { startAt: start, endAt, blockEndAt: new Date(endAt.getTime() + service.bufferAfterMin * 60_000), userId: person.id };
    }

    const row = await this.prisma.booking
      .update({
        where: { id },
        data: {
          ...(timing ?? {}),
          ...(input.status !== undefined ? { status: input.status, ...(input.status === "CONFIRMED" ? { cancelledAt: null, cancelReason: null } : {}) } : {}),
          ...(input.note !== undefined ? { note: input.note || null } : {}),
        },
        include: BOOKING_INCLUDE,
      })
      .catch((e: unknown) => {
        if (isOverlap(e)) throw new ConflictException(SLOT_TAKEN);
        throw e;
      });
    if (timing) {
      await this.logOnDeal(row, "rescheduled", (await this.settings()).timezone);
      this.emit("booking.rescheduled", row, { previousStartAt: current.startAt.toISOString() });
    } else {
      this.changed(row.id);
    }
    return this.toDto(row);
  }

  async cancel(id: string, reason: string | null | undefined): Promise<BookingDto> {
    const current = await this.prisma.booking.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException("Cita no encontrada");
    if (current.status === "CANCELLED") throw new BadRequestException("Esa cita ya estaba cancelada");
    const row = await this.prisma.booking.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason?.trim() || null },
      include: BOOKING_INCLUDE,
    });
    await this.logOnDeal(row, "cancelled", (await this.settings()).timezone);
    this.emit("booking.cancelled", row);
    return this.toDto(row);
  }

  // ── Para el agente de IA ────────────────────────────────────
  /** Servicios que se pueden reservar ya (activos y con alguien que los atienda) y quién atiende. */
  async agentCatalog(): Promise<{ services: string[]; staff: string[] }> {
    const services = await this.prisma.bookingService.findMany({
      where: { isActive: true, staff: { some: { user: { isActive: true } } } },
      select: { name: true, staff: { where: { user: { isActive: true } }, select: { user: { select: { name: true, email: true } } } } },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    const staff = new Set<string>();
    for (const s of services) for (const p of s.staff) staff.add(p.user.name ?? p.user.email);
    return { services: services.map((s) => s.name), staff: [...staff].sort((a, b) => a.localeCompare(b)) };
  }

  /** Lo que ve el agente al consultar horas: días con hueco y sus horas, en la zona del negocio. */
  async agentAvailability(input: { service?: unknown; date?: unknown; staff?: unknown }): Promise<string> {
    const service = await this.serviceByName(String(input.service ?? ""));
    const settings = await this.settings();
    const staffName = String(input.staff ?? "").trim();
    const staff = (await this.staffFor(service.id)).filter((p) => !staffName || p.name === staffName);
    if (!staff.length) throw new Error(staffName ? `${staffName} no atiende «${service.name}»` : `Nadie atiende «${service.name}» todavía`);
    const today = utcToZoned(new Date(), settings.timezone).date;
    const asked = String(input.date ?? "").trim();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked > today ? asked : today;
    const slots = await this.freeSlots(settings, service, staff, from, 14, "client");
    const days = new Map<string, string[]>();
    for (const s of slots) {
      if (!days.has(s.date) && days.size >= 5) break;
      const list = days.get(s.date) ?? [];
      if (list.length < 24) list.push(s.time);
      days.set(s.date, list);
    }
    return JSON.stringify({
      service: service.name,
      durationMin: service.durationMin,
      timezone: settings.timezone,
      today: `${today} (${formatBookingDay(today)})`,
      days: [...days.entries()].map(([date, times]) => ({ date, day: formatBookingDay(date), times })),
      note: days.size
        ? "Horas en la zona del negocio. Para reservar, usa book_appointment con la fecha y hora exactas de esta lista (AAAA-MM-DDTHH:mm)."
        : `No hay horas libres en los próximos días${staffName ? ` con ${staffName}` : ""}. Ofrece pasar con una persona del equipo.`,
    });
  }

  async agentBook(contactId: string, conversationId: string | null, input: Record<string, unknown>): Promise<string> {
    const service = await this.serviceByName(String(input.service ?? ""));
    const settings = await this.settings();
    const start = this.localStart(input.start, settings.timezone);
    const existing = await this.nextBooking(contactId, service.name);
    if (existing) {
      throw new Error(
        `El cliente ya tiene «${service.name}» el ${formatBookingAt(existing.startAt, settings.timezone)}. Si quiere cambiarla, usa reschedule_appointment.`,
      );
    }
    const staffName = String(input.staff ?? "").trim();
    const userId = staffName ? await this.staffIdByName(staffName) : null;
    const row = await this.create(
      {
        contactId,
        serviceId: service.id,
        userId,
        startAt: start.toISOString(),
        note: String(input.note ?? "").trim() || null,
        conversationId,
      },
      "ai",
      null,
      "client",
    ).catch((e: unknown) => {
      throw new Error(this.agentError(e, "Esa hora ya no está libre: vuelve a consultar con check_availability y ofrece otra."));
    });
    return `Cita reservada: ${row.serviceName}, ${formatBookingAt(new Date(row.startAt), settings.timezone)}${row.staff ? ` con ${row.staff.name}` : ""}.`;
  }

  async agentReschedule(contactId: string, input: Record<string, unknown>): Promise<string> {
    const settings = await this.settings();
    const booking = await this.nextBooking(contactId, String(input.service ?? "").trim() || undefined);
    if (!booking) throw new Error("El cliente no tiene ninguna cita próxima que mover");
    const start = this.localStart(input.start, settings.timezone);
    const row = await this.update(booking.id, { startAt: start.toISOString() }, "client").catch((e: unknown) => {
      throw new Error(this.agentError(e, "Esa hora no está libre: consulta check_availability y ofrece otra."));
    });
    return `Cita movida: ${row.serviceName}, ahora el ${formatBookingAt(new Date(row.startAt), settings.timezone)}${row.staff ? ` con ${row.staff.name}` : ""}.`;
  }

  async agentCancel(contactId: string, input: Record<string, unknown>): Promise<string> {
    const settings = await this.settings();
    const booking = await this.nextBooking(contactId, String(input.service ?? "").trim() || undefined);
    if (!booking) throw new Error("El cliente no tiene ninguna cita próxima que cancelar");
    const row = await this.cancel(booking.id, String(input.reason ?? "").trim() || "El cliente la canceló por WhatsApp");
    return `Cita cancelada: ${row.serviceName} del ${formatBookingAt(new Date(row.startAt), settings.timezone)}.`;
  }

  /** Para las instrucciones del agente: la fecha de hoy y las citas próximas del contacto (sin contacto, en el playground, solo la fecha). */
  async agentContextText(contactId: string | null): Promise<string> {
    const settings = await this.settings();
    const now = utcToZoned(new Date(), settings.timezone);
    const rows = contactId
      ? await this.prisma.booking.findMany({
          where: { contactId, status: "CONFIRMED", startAt: { gte: new Date() } },
          include: BOOKING_INCLUDE,
          orderBy: { startAt: "asc" },
          take: 5,
        })
      : [];
    const list = rows.map(
      (r) => `- ${r.serviceName}: ${formatBookingAt(r.startAt, settings.timezone)}${r.user ? ` con ${r.user.name ?? r.user.email}` : ""}`,
    );
    return [
      `\n\n## Fecha y citas\nHoy es ${formatBookingDay(now.date)} de ${now.date.slice(0, 4)}, ${now.time} (hora del negocio, ${settings.timezone}).`,
      list.length ? `\nCitas próximas de este contacto:\n${list.join("\n")}` : "\nEste contacto no tiene citas próximas.",
    ].join("");
  }

  private async serviceByName(name: string) {
    const service = await this.prisma.bookingService.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" }, isActive: true },
    });
    if (!service) throw new Error(`El servicio «${name}» no existe o está desactivado`);
    return service;
  }

  private async staffIdByName(name: string): Promise<string> {
    const user = await this.prisma.user.findFirst({ where: { isActive: true, OR: [{ name }, { email: name }] }, select: { id: true } });
    if (!user) throw new Error(`«${name}» no es del equipo`);
    return user.id;
  }

  private async nextBooking(contactId: string, serviceName?: string) {
    return this.prisma.booking.findFirst({
      where: {
        contactId,
        status: "CONFIRMED",
        startAt: { gte: new Date() },
        ...(serviceName ? { serviceName: { equals: serviceName, mode: "insensitive" } } : {}),
      },
      orderBy: { startAt: "asc" },
    });
  }

  private localStart(value: unknown, tz: string): Date {
    const parsed = parseLocalDateTime(String(value ?? ""));
    if (!parsed) throw new Error("La hora tiene que ir como AAAA-MM-DDTHH:mm (p. ej. 2026-11-03T10:30)");
    return zonedToUtc(parsed.date, parsed.time, tz);
  }

  /** Un error de HTTP (409, 400) dicho como lo tiene que leer el agente. */
  private agentError(e: unknown, onConflict: string): string {
    if (e instanceof ConflictException) return onConflict;
    return e instanceof Error ? e.message : String(e);
  }

  // ── Oportunidad e historial ─────────────────────────────────
  /**
   * La oportunidad a la que se cuelga la cita. Si la empresa eligió una etapa
   * «cita reservada», la oportunidad avanza a ella (o se crea ahí), pero nunca
   * retrocede: una oportunidad ya ganada no vuelve a «cita reservada».
   */
  private async attachDeal(
    contact: { id: string; orgId: string; name: string | null; phone: string; currency: string | null },
    bookedStageId: string | null,
  ): Promise<string | null> {
    const deal = await this.prisma.deal.findFirst({
      where: { contactId: contact.id, discardedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, stageId: true, stage: { select: { pipelineId: true, order: true } } },
    });
    if (!bookedStageId) return deal?.id ?? null;
    const stage = await this.prisma.pipelineStage.findUnique({ where: { id: bookedStageId }, select: { id: true, pipelineId: true, order: true } });
    if (!stage) return deal?.id ?? null;
    const orgId = this.tenant.orgId();
    if (deal) {
      if (deal.stage.pipelineId === stage.pipelineId && stage.order > deal.stage.order) {
        await this.prisma.deal.update({ where: { id: deal.id }, data: { stageId: stage.id } });
        this.events.emit("deal.stage_changed", { orgId, dealId: deal.id, contactId: contact.id, stageId: stage.id });
        this.events.emit("pipeline.changed", { orgId, dealId: deal.id });
      }
      return deal.id;
    }
    const created = await this.prisma.deal.create({
      data: {
        orgId: contact.orgId,
        contactId: contact.id,
        stageId: stage.id,
        title: contact.name ?? contact.phone,
        currency: contactCurrency(contact) ?? "USD",
      },
    });
    this.events.emit("deal.stage_changed", { orgId, dealId: created.id, contactId: contact.id, stageId: stage.id });
    this.events.emit("pipeline.changed", { orgId, dealId: created.id });
    return created.id;
  }

  /** Deja la cita en el historial de la oportunidad (el disparador solo ve los cambios de la oportunidad). */
  private async logOnDeal(row: BookingRow, action: BookingAction, tz: string): Promise<void> {
    if (!row.dealId) return;
    await this.prisma.dealEvent.create({
      data: {
        orgId: row.orgId,
        dealId: row.dealId,
        kind: "booking",
        actor: currentActor(),
        meta: {
          action,
          label: ACTION_LABEL[action],
          service: row.serviceName,
          when: formatBookingAt(row.startAt, tz),
          ...(action === "cancelled" && row.cancelReason ? { reason: row.cancelReason } : {}),
        },
      },
    });
  }

  private emit(event: "booking.created" | "booking.rescheduled" | "booking.cancelled", row: BookingRow, extra: Record<string, unknown> = {}): void {
    const orgId = this.tenant.orgId();
    this.events.emit(event, {
      orgId,
      bookingId: row.id,
      contactId: row.contactId,
      dealId: row.dealId,
      conversationId: row.conversationId,
      serviceId: row.serviceId,
      startAt: row.startAt.toISOString(),
      ...extra,
    });
    this.changed(row.id);
  }

  private changed(bookingId = ""): void {
    this.events.emit("bookings.changed", { orgId: this.tenant.orgId(), bookingId });
  }

  private toDto(r: BookingRow): BookingDto {
    return {
      id: r.id,
      service: r.service,
      serviceName: r.serviceName,
      staff: r.user ? { id: r.user.id, name: r.user.name ?? r.user.email } : null,
      contact: r.contact,
      dealId: r.dealId,
      conversationId: r.conversationId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status as BookingDto["status"],
      source: r.source as BookingDto["source"],
      note: r.note,
      cancelReason: r.cancelReason,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
