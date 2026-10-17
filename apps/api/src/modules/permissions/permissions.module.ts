import { Global, Module } from "@nestjs/common";
import { ConversationAccessGuard } from "./conversation-access.guard";
import { PermissionsService } from "./permissions.service";

// Global: los permisos se consultan desde mensajería, contactos, embudo y panel.
@Global()
@Module({
  providers: [PermissionsService, ConversationAccessGuard],
  exports: [PermissionsService, ConversationAccessGuard],
})
export class PermissionsModule {}
