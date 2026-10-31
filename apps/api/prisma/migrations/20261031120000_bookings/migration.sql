-- Reservas (agenda): reglas de la empresa, servicios, quién los atiende, el
-- horario de cada persona y las citas. Todo con orgId y RLS como el resto.
-- btree_gist permite combinar «misma persona» (=) y «horas que se pisan» (&&)
-- en una sola restricción de exclusión.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS "booking_settings" (
    "orgId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Lima',
    "slotIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "minNoticeMin" INTEGER NOT NULL DEFAULT 120,
    "maxDays" INTEGER NOT NULL DEFAULT 30,
    "bookedStageId" TEXT,
    "blackouts" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("orgId")
);

CREATE TABLE IF NOT EXISTS "booking_services" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "bufferAfterMin" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "booking_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "booking_service_staff" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "booking_service_staff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "staff_schedules" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hours" JSONB NOT NULL,
    "blackouts" JSONB,
    "acceptsBookings" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "staff_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bookings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "serviceId" TEXT,
    "serviceName" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT NOT NULL,
    "dealId" TEXT,
    "conversationId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "blockEndAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "createdById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "booking_services_orgId_isActive_idx" ON "booking_services"("orgId", "isActive");
CREATE INDEX IF NOT EXISTS "booking_service_staff_userId_idx" ON "booking_service_staff"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "booking_service_staff_serviceId_userId_key" ON "booking_service_staff"("serviceId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_schedules_userId_key" ON "staff_schedules"("userId");
CREATE INDEX IF NOT EXISTS "bookings_orgId_startAt_idx" ON "bookings"("orgId", "startAt");
CREATE INDEX IF NOT EXISTS "bookings_userId_startAt_idx" ON "bookings"("userId", "startAt");
CREATE INDEX IF NOT EXISTS "bookings_contactId_startAt_idx" ON "bookings"("contactId", "startAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_settings_orgId_fkey') THEN
    ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_settings_bookedStageId_fkey') THEN
    ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_bookedStageId_fkey" FOREIGN KEY ("bookedStageId") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_services_orgId_fkey') THEN
    ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_service_staff_serviceId_fkey') THEN
    ALTER TABLE "booking_service_staff" ADD CONSTRAINT "booking_service_staff_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "booking_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_service_staff_userId_fkey') THEN
    ALTER TABLE "booking_service_staff" ADD CONSTRAINT "booking_service_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_service_staff_orgId_fkey') THEN
    ALTER TABLE "booking_service_staff" ADD CONSTRAINT "booking_service_staff_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_schedules_userId_fkey') THEN
    ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_schedules_orgId_fkey') THEN
    ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_serviceId_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "booking_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_userId_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_createdById_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_contactId_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_dealId_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_conversationId_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_orgId_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_status_check') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK ("status" IN ('CONFIRMED','CANCELLED','COMPLETED','NO_SHOW'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_source_check') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_source_check" CHECK ("source" IN ('ai','manual','api','link'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_times_check') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_times_check" CHECK ("endAt" > "startAt" AND "blockEndAt" >= "endAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_services_duration_check') THEN
    ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_duration_check" CHECK ("durationMin" > 0 AND "bufferAfterMin" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist ("userId" WITH =, tsrange("startAt", "blockEndAt") WITH &&) WHERE ("status" = 'CONFIRMED');
  END IF;
END $$;

ALTER TABLE "booking_settings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "booking_settings_tenant_isolation" ON "booking_settings";
CREATE POLICY "booking_settings_tenant_isolation" ON "booking_settings"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );

ALTER TABLE "booking_services" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "booking_services_tenant_isolation" ON "booking_services";
CREATE POLICY "booking_services_tenant_isolation" ON "booking_services"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );

ALTER TABLE "booking_service_staff" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "booking_service_staff_tenant_isolation" ON "booking_service_staff";
CREATE POLICY "booking_service_staff_tenant_isolation" ON "booking_service_staff"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );

ALTER TABLE "staff_schedules" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_schedules_tenant_isolation" ON "staff_schedules";
CREATE POLICY "staff_schedules_tenant_isolation" ON "staff_schedules"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bookings_tenant_isolation" ON "bookings";
CREATE POLICY "bookings_tenant_isolation" ON "bookings"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
