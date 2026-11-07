import { Global, Module } from "@nestjs/common";
import { MessagingModule } from "../messaging/messaging.module";
import { BookingNotificationsService } from "./booking-notifications.service";
import { BookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";

// Global: el agente de IA consulta horas y reserva desde el módulo de IA, y
// las automatizaciones le pasan los «Confirmar / Cancelar» del recordatorio.
@Global()
@Module({
  imports: [MessagingModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingNotificationsService],
  exports: [BookingsService, BookingNotificationsService],
})
export class BookingsModule {}
