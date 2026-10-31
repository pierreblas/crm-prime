import { Module } from "@nestjs/common";
import { LlmModule } from "./llm.module";
import { AgentService } from "./agent.service";
import { AgentActionsService } from "./agent-actions.service";
import { AutopilotService } from "./autopilot.service";
import { AutomationService } from "./automation.service";
import { BotService } from "./bot.service";
import { FlowService } from "./flow.service";
import { FlowAssistantService } from "./flow-assistant.service";
import { PromptAssistantService } from "./prompt-assistant.service";
import { FlowEngineService } from "./flow-engine.service";
import { FlowTriggersService } from "./flow-triggers.service";
import { AiReplyProcessor } from "./ai-reply.processor";
import { MediaUnderstandingService } from "./media-understanding.service";
import { FlowProcessor } from "./flow.processor";
import { StageAutomationsService } from "./stage-automations.service";
import { StageAutomationOpsController } from "./stage-automation-ops.controller";
import { BulkFlowController } from "./bulk-flow.controller";
import { FollowUpService } from "./follow-up.service";
import { StageWebhookController } from "./stage-webhook.controller";
import { AiController } from "./ai.controller";
import { BotsController } from "./bots.controller";
import { FlowsController } from "./flows.controller";
import { AiSettingsController } from "./ai-settings.controller";
import { CopilotController } from "./copilot.controller";
import { AiUsageController } from "./ai-usage.controller";
import { CopilotService } from "./copilot.service";
import { BusinessSetupController } from "./business-setup.controller";
import { BusinessSetupService } from "./business-setup.service";
import { MessagingModule } from "../messaging/messaging.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { OnboardingModule } from "../onboarding/onboarding.module";

@Module({
  imports: [LlmModule, MessagingModule, KnowledgeModule, OnboardingModule],
  controllers: [
    AiController,
    BotsController,
    FlowsController,
    AiSettingsController,
    CopilotController,
    AiUsageController,
    StageWebhookController,
    StageAutomationOpsController,
    BulkFlowController,
    BusinessSetupController,
  ],
  providers: [
    AgentService,
    AgentActionsService,
    AutopilotService,
    AutomationService,
    BotService,
    FlowService,
    FlowAssistantService,
    PromptAssistantService,
    FlowEngineService,
    FlowTriggersService,
    StageAutomationsService,
    FollowUpService,
    FlowProcessor,
    AiReplyProcessor,
    MediaUnderstandingService,
    CopilotService,
    BusinessSetupService,
  ],
  exports: [MediaUnderstandingService],
})
export class AiModule {}
