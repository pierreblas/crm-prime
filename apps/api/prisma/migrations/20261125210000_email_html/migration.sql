-- Correos en HTML. Hasta ahora el cuerpo era siempre texto y Driony le daba un
-- HTML sencillo. Ahora una plantilla o un correo pueden llevar su propio HTML:
--
--   email_templates.format  "text" (como hasta ahora) o "html"
--   emails.format           lo mismo, para el historial
--   emails."bodyHtml"       el HTML que sale, ya con las variables puestas
--
-- emails."bodyText" sigue existiendo siempre: en un correo HTML guarda lo que
-- se lee en él y va como parte alternativa del envío.
--
-- Idempotente y solo añade: lo que ya había queda como texto.

ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "format" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "format" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "bodyHtml" TEXT;
