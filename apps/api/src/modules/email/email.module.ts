import { Module } from "@nestjs/common";
import { EmailAccountsService } from "./email-accounts.service";
import { EmailPublicController } from "./email-public.controller";
import { EmailTemplatesService } from "./email-templates.service";
import { EmailController } from "./email.controller";
import { EmailProcessor } from "./email.processor";
import { EmailService } from "./email.service";
import { EMAIL_TRANSPORT, SmtpEmailTransport } from "./email.transport";

/** Correo saliente desde los buzones de la empresa. Lo usan también los flujos (bloque «Enviar correo»). */
@Module({
  controllers: [EmailController, EmailPublicController],
  providers: [
    EmailAccountsService,
    EmailTemplatesService,
    EmailService,
    EmailProcessor,
    SmtpEmailTransport,
    { provide: EMAIL_TRANSPORT, useExisting: SmtpEmailTransport },
  ],
  exports: [EmailService],
})
export class EmailModule {}
