import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { StorageModule } from "./infra/storage/storage.module";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { TenantModule } from "./infra/tenant/tenant.module";
import { TicketsModule } from "./infra/tickets/tickets.module";
import { QueueModule } from "./infra/queue/queue.module";
import { AuthModule } from "./modules/auth/auth.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { WhatsappModule } from "./modules/whatsapp/whatsapp.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { PipelineModule } from "./modules/pipeline/pipeline.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { UsersModule } from "./modules/users/users.module";
import { AiModule } from "./modules/ai/ai.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { CampaignsModule } from "./modules/campaigns/campaigns.module";
import { QuickRepliesModule } from "./modules/quick-replies/quick-replies.module";
import { MetaLeadsModule } from "./modules/meta-leads/meta-leads.module";
import { SourcesModule } from "./modules/sources/sources.module";
import { TagsModule } from "./modules/tags/tags.module";
import { ProductsModule } from "./modules/products/products.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { ApiKeysModule } from "./modules/api-keys/api-keys.module";
import { PublicApiModule } from "./modules/public-api/public-api.module";
import { WebhooksOutModule } from "./modules/webhooks-out/webhooks-out.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { CallsModule } from "./modules/calls/calls.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { PlansModule } from "./modules/plans/plans.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    // Carga el .env de la raíz del monorepo.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    TenantModule,
    TicketsModule,
    StorageModule,
    QueueModule,
    AuthModule,
    MessagingModule,
    WhatsappModule,
    RealtimeModule,
    PipelineModule,
    ContactsModule,
    UsersModule,
    KnowledgeModule,
    AiModule,
    CampaignsModule,
    QuickRepliesModule,
    OnboardingModule,
    PlansModule,
    PlatformModule,
    DashboardModule,
    MetaLeadsModule,
    SourcesModule,
    TagsModule,
    ProductsModule,
    LeadsModule,
    ApiKeysModule,
    PublicApiModule,
    WebhooksOutModule,
    IntegrationsModule,
    CallsModule,
    OrganizationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
