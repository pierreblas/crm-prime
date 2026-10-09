import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module";
import { AiModule } from "../ai/ai.module";
import { CallsController } from "./calls.controller";
import { CallsService } from "./calls.service";
import { TwilioWebhooksController } from "./twilio-webhooks.controller";

@Module({
  imports: [IntegrationsModule, AiModule],
  controllers: [CallsController, TwilioWebhooksController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
