import { Controller, Header, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { runInOrg } from "../../infra/tenant/tenant.context";
import { CallsService } from "./calls.service";

/**
 * Webhooks de Twilio por empresa: `/calls/twilio/<slug>/…`. Son rutas
 * públicas (Twilio no tiene sesión); lo que autentica es la firma
 * X-Twilio-Signature con el auth token que esa empresa guardó. El slug solo
 * dice a quién mirar, como en los webhooks propios de WhatsApp.
 */
@Controller("calls/twilio")
export class TwilioWebhooksController {
  constructor(private readonly calls: CallsService) {}

  // El softphone marcó un número.
  @Post(":slug/outbound")
  @HttpCode(200)
  @Header("Content-Type", "text/xml")
  async outbound(@Param("slug") slug: string, @Req() req: Request): Promise<string> {
    const org = await this.calls.orgBySlug(slug);
    const creds = await this.calls.verify(req, org.id);
    return runInOrg(org.id, () => this.calls.outboundTwiml(creds, org.slug, req.body));
  }

  // Llaman al número de la empresa.
  @Post(":slug/inbound")
  @HttpCode(200)
  @Header("Content-Type", "text/xml")
  async inbound(@Param("slug") slug: string, @Req() req: Request): Promise<string> {
    const org = await this.calls.orgBySlug(slug);
    const creds = await this.calls.verify(req, org.id);
    return runInOrg(org.id, () => this.calls.inboundTwiml(creds, org.slug, req.body));
  }

  // Terminó de sonar al equipo: contestaron o no.
  @Post(":slug/dial-result")
  @HttpCode(200)
  @Header("Content-Type", "text/xml")
  async dialResult(@Param("slug") slug: string, @Req() req: Request): Promise<string> {
    const org = await this.calls.orgBySlug(slug);
    await this.calls.verify(req, org.id);
    return runInOrg(org.id, () => this.calls.dialResult(req.body));
  }

  // Cambios de estado de la llamada.
  @Post(":slug/status")
  @HttpCode(204)
  async status(@Param("slug") slug: string, @Req() req: Request): Promise<void> {
    const org = await this.calls.orgBySlug(slug);
    await this.calls.verify(req, org.id);
    await runInOrg(org.id, () => this.calls.status(req.body));
  }

  // La grabación está lista.
  @Post(":slug/recording")
  @HttpCode(204)
  async recording(@Param("slug") slug: string, @Req() req: Request): Promise<void> {
    const org = await this.calls.orgBySlug(slug);
    const creds = await this.calls.verify(req, org.id);
    // Descargar y transcribir tarda: Twilio recibe el 204 y el trabajo sigue detrás.
    void runInOrg(org.id, () => this.calls.recording(creds, req.body));
  }
}
