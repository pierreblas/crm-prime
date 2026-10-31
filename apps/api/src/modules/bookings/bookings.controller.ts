import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  bookingServiceInputSchema,
  bookingsQuerySchema,
  cancelBookingSchema,
  createBookingSchema,
  Role,
  slotsQuerySchema,
  staffScheduleInputSchema,
  updateBookingSchema,
  updateBookingServiceSchema,
  updateBookingSettingsSchema,
  type AccessTokenClaims,
  type BookingServiceInput,
  type BookingsQuery,
  type CancelBookingInput,
  type CreateBookingInput,
  type SlotsQuery,
  type StaffScheduleInput,
  type UpdateBookingInput,
  type UpdateBookingServiceInput,
  type UpdateBookingSettingsInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { BookingsService } from "./bookings.service";

// La agenda la usa todo el equipo: ver, reservar, mover y cancelar citas. Las
// reglas de la empresa y los servicios, solo quien administra; el horario de
// cada persona, ella misma o un administrador.
@Controller("bookings")
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  // ── Reglas ─────────────────────────────────────────────────
  @Get("settings")
  settings() {
    return this.bookings.settings();
  }

  @Put("settings")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  updateSettings(@Body(new ZodValidationPipe(updateBookingSettingsSchema)) body: UpdateBookingSettingsInput) {
    return this.bookings.updateSettings(body);
  }

  // ── Servicios ──────────────────────────────────────────────
  @Get("services")
  services() {
    return this.bookings.listServices();
  }

  @Post("services")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  createService(@Body(new ZodValidationPipe(bookingServiceInputSchema)) body: BookingServiceInput) {
    return this.bookings.createService(body);
  }

  @Patch("services/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  updateService(@Param("id") id: string, @Body(new ZodValidationPipe(updateBookingServiceSchema)) body: UpdateBookingServiceInput) {
    return this.bookings.updateService(id, body);
  }

  @Delete("services/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  removeService(@Param("id") id: string) {
    return this.bookings.removeService(id);
  }

  // ── Horarios ───────────────────────────────────────────────
  @Get("schedules")
  schedules() {
    return this.bookings.schedules();
  }

  @Put("schedules/:userId")
  saveSchedule(
    @CurrentUser() user: AccessTokenClaims,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(staffScheduleInputSchema)) body: StaffScheduleInput,
  ) {
    if (user.role !== Role.ADMIN && user.sub !== userId) {
      throw new ForbiddenException("Solo puedes cambiar tu propio horario");
    }
    return this.bookings.saveSchedule(userId, body);
  }

  // ── Horas libres y citas ───────────────────────────────────
  @Get("slots")
  slots(@Query(new ZodValidationPipe(slotsQuerySchema)) query: SlotsQuery) {
    return this.bookings.slots(query);
  }

  @Get()
  list(@Query(new ZodValidationPipe(bookingsQuerySchema)) query: BookingsQuery) {
    return this.bookings.list(query);
  }

  @Get("contact/:contactId")
  forContact(@Param("contactId") contactId: string) {
    return this.bookings.forContact(contactId);
  }

  @Post()
  create(@CurrentUser() user: AccessTokenClaims, @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput) {
    return this.bookings.create(body, "manual", user.sub);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateBookingSchema)) body: UpdateBookingInput) {
    return this.bookings.update(id, body);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body(new ZodValidationPipe(cancelBookingSchema)) body: CancelBookingInput) {
    return this.bookings.cancel(id, body.reason);
  }
}
