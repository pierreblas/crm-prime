import { Module, type OnModuleInit } from "@nestjs/common";
import { MessagingModule } from "../messaging/messaging.module";
import { TikTokAccountService } from "./tiktok-account.service";
import { TikTokMessagingService } from "./tiktok-messaging.service";
import { TikTokProcessor } from "./tiktok.processor";
import { TikTokController, TikTokPublicController } from "./tiktok.controller";

@Module({
  imports: [MessagingModule],
  controllers: [TikTokController, TikTokPublicController],
  providers: [TikTokAccountService, TikTokMessagingService, TikTokProcessor],
})
export class TikTokModule implements OnModuleInit {
  constructor(private readonly accounts: TikTokAccountService) {}

  /** Comprueba (sin bloquear el arranque) que TikTok tenga registrada nuestra URL de webhook. */
  onModuleInit(): void {
    void this.accounts.ensureWebhook();
  }
}
