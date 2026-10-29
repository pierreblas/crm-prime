import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  connectWhatsappSchema,
  disconnectWhatsappSchema,
  testChannelSchema,
  updateChannelSchema,
  Role,
  type ChannelTestResult,
  type ConnectWhatsappInput,
  type DisconnectWhatsappInput,
  type TestChannelInput,
  type UpdateChannelInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { WhatsappConnectionService } from "./whatsapp-connection.service";

@Controller("whatsapp/connection")
@UseGuards(JwtAuthGuard)
export class ConnectionController {
  constructor(private readonly connection: WhatsappConnectionService) {}

  // Lista de números (canales) conectados.
  @Get()
  async list() {
    const channels = await this.connection.listChannels();
    return { channels };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async connect(
    @Body(new ZodValidationPipe(connectWhatsappSchema))
    body: ConnectWhatsappInput,
  ) {
    const channels = await this.connection.connect(body);
    return { channels };
  }

  // El número del .env pasa a la base (editable). Solo con una empresa.
  @Post("import-env")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async importEnv() {
    const channels = await this.connection.importEnv();
    return { channels };
  }

  // Borra un número ya desconectado.
  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async remove(@Param("id") id: string) {
    const channels = await this.connection.remove(id);
    return { channels };
  }

  // Alias, embudo de entrada y agente de IA del número.
  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateChannelSchema)) body: UpdateChannelInput,
  ) {
    const channels = await this.connection.updateChannel(id, body);
    return { channels };
  }

  // Comprueba contra Meta que el token del canal sigue valiendo.
  @Post("test")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async test(
    @Body(new ZodValidationPipe(testChannelSchema)) body: TestChannelInput,
  ): Promise<ChannelTestResult> {
    return this.connection.testChannel(body.phoneNumberId);
  }

  @Post("disconnect")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async disconnect(
    @Body(new ZodValidationPipe(disconnectWhatsappSchema))
    body: DisconnectWhatsappInput,
  ) {
    const channels = await this.connection.disconnect(body.phoneNumberId);
    return { channels };
  }
}
