-- Avisos de cita: confirmación al crear/mover y recordatorio X horas antes.
--
-- Los ajustes guardan qué plantilla aprobada se usa y con qué datos de la cita
-- se llena cada hueco. La cita lleva cuándo toca su recordatorio y cuándo
-- salió, y si el cliente la confirmó desde el botón del recordatorio.

ALTER TABLE "booking_settings"
  ADD COLUMN "confirmOnCreate"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "confirmTemplateId"    TEXT,
  ADD COLUMN "confirmTemplateVars"  JSONB,
  ADD COLUMN "reminderHoursBefore"  INTEGER DEFAULT 24,
  ADD COLUMN "reminderTemplateId"   TEXT,
  ADD COLUMN "reminderTemplateVars" JSONB;

ALTER TABLE "booking_settings"
  ADD CONSTRAINT "booking_settings_confirmTemplateId_fkey"
    FOREIGN KEY ("confirmTemplateId") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_settings_reminderTemplateId_fkey"
    FOREIGN KEY ("reminderTemplateId") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings"
  ADD COLUMN "reminderAt"           TIMESTAMP(3),
  ADD COLUMN "reminderSentAt"       TIMESTAMP(3),
  ADD COLUMN "confirmedByContactAt" TIMESTAMP(3);

CREATE INDEX "bookings_reminderAt_idx" ON "bookings"("reminderAt");

-- Las citas futuras ya confirmadas entran al recordatorio por defecto (24 h).
UPDATE "bookings"
   SET "reminderAt" = "startAt" - interval '24 hours'
 WHERE "status" = 'CONFIRMED' AND "startAt" > now();
