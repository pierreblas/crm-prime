-- Correo: buzones propios de la empresa (SMTP), plantillas de correo, los
-- correos enviados a cada contacto y la lista de bajas. Idempotente.

CREATE TABLE IF NOT EXISTS "email_accounts" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT,
  "address" TEXT NOT NULL,
  "fromName" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'smtp',
  "smtpHost" TEXT NOT NULL,
  "smtpPort" INTEGER NOT NULL,
  "smtpUser" TEXT NOT NULL,
  "smtpPassEnc" TEXT NOT NULL,
  "signature" TEXT,
  "dailyLimit" INTEGER NOT NULL DEFAULT 300,
  "status" TEXT NOT NULL DEFAULT 'ok',
  "lastError" TEXT,
  "lastSentAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_accounts_orgId_address_key" ON "email_accounts"("orgId", "address");
CREATE INDEX IF NOT EXISTS "email_accounts_userId_idx" ON "email_accounts"("userId");

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "attachments" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_orgId_name_key" ON "email_templates"("orgId", "name");

CREATE TABLE IF NOT EXISTS "emails" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "accountId" TEXT,
  "templateId" TEXT,
  "userId" TEXT,
  "origin" TEXT,
  "fromAddress" TEXT NOT NULL,
  "fromName" TEXT,
  "toAddress" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "attachments" JSONB,
  "automated" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "errorReason" TEXT,
  "messageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "emails_orgId_contactId_createdAt_idx" ON "emails"("orgId", "contactId", "createdAt");
CREATE INDEX IF NOT EXISTS "emails_accountId_createdAt_idx" ON "emails"("accountId", "createdAt");

CREATE TABLE IF NOT EXISTS "email_unsubscribes" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_unsubscribes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_unsubscribes_orgId_address_key" ON "email_unsubscribes"("orgId", "address");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_accounts_orgId_fkey') THEN
    ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_accounts_userId_fkey') THEN
    ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_templates_orgId_fkey') THEN
    ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emails_orgId_fkey') THEN
    ALTER TABLE "emails" ADD CONSTRAINT "emails_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emails_contactId_fkey') THEN
    ALTER TABLE "emails" ADD CONSTRAINT "emails_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emails_accountId_fkey') THEN
    ALTER TABLE "emails" ADD CONSTRAINT "emails_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emails_templateId_fkey') THEN
    ALTER TABLE "emails" ADD CONSTRAINT "emails_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emails_userId_fkey') THEN
    ALTER TABLE "emails" ADD CONSTRAINT "emails_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_unsubscribes_orgId_fkey') THEN
    ALTER TABLE "email_unsubscribes" ADD CONSTRAINT "email_unsubscribes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_accounts', 'email_templates', 'emails', 'email_unsubscribes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (current_setting(''app.current_org'', true) = ''*'' OR "orgId" = current_setting(''app.current_org'', true)) WITH CHECK (current_setting(''app.current_org'', true) = ''*'' OR "orgId" = current_setting(''app.current_org'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
