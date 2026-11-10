import { Module } from "@nestjs/common";
import { MetaGraphClient } from "./meta-graph.client";
import { MetaPageService } from "./meta-page.service";
import { MetaLeadService } from "./meta-lead.service";
import { MetaLeadProcessor } from "./meta-lead.processor";
import { MetaMessagingService } from "./meta-messaging.service";
import { MetaMessagingProcessor } from "./meta-messaging.processor";
import { MetaLeadsController } from "./meta-leads.controller";
import { MetaWebhookController } from "./meta-webhook.controller";
import { LeadsModule } from "../leads/leads.module";
import { MessagingModule } from "../messaging/messaging.module";

@Module({
  imports: [LeadsModule, MessagingModule],
  controllers: [MetaLeadsController, MetaWebhookController],
  providers: [
    MetaGraphClient,
    MetaPageService,
    MetaLeadService,
    MetaLeadProcessor,
    MetaMessagingService,
    MetaMessagingProcessor,
  ],
})
export class MetaLeadsModule {}
