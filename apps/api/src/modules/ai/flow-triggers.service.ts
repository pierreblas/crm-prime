import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { runInOrg } from "../../infra/tenant/tenant.context";
import { FlowEngineService } from "./flow-engine.service";

/** Un lead nuevo, venga de donde venga. Lo emite LeadService.ingestLead. */
export interface LeadCreatedEvent {
  orgId: string;
  contactId: string;
  /** false si el contacto ya existía y solo se actualizó. */
  created: boolean;
  via: "meta" | "webhook" | "api";
  formName?: string | null;
  formId?: string | null;
}

export interface ContactTaggedEvent {
  orgId: string;
  contactId: string;
  tag: string;
}

export interface DealStageChangedEvent {
  orgId: string;
  dealId: string;
  contactId: string;
  stageId: string;
}

export interface MessageOutboundEvent {
  orgId: string;
  conversationId: string;
  messageId: string;
  author: string;
}

/**
 * Enlaza los eventos del CRM con los disparadores de flujos que no nacen de
 * un mensaje entrante: leads, etiquetas, etapas del embudo, cierres y
 * silencios del cliente. Los de mensaje (al iniciar, palabra clave, anuncio)
 * los atiende AutomationService, que ya está en ese camino.
 *
 * Cada evento trae su empresa y aquí se abre su contexto: los listeners
 * corren fuera de la petición que los originó.
 */
@Injectable()
export class FlowTriggersService {
  private readonly logger = new Logger("FlowTriggers");

  constructor(private readonly engine: FlowEngineService) {}

  @OnEvent("lead.created", { async: true })
  async onLead(e: LeadCreatedEvent): Promise<void> {
    await this.safe("lead.created", e.orgId, () =>
      this.engine.onLead(e.contactId, e.via, { formName: e.formName ?? null, formId: e.formId ?? null }),
    );
  }

  @OnEvent("contact.tagged", { async: true })
  async onTagged(e: ContactTaggedEvent): Promise<void> {
    await this.safe("contact.tagged", e.orgId, () => this.engine.onTagAdded(e.contactId, e.tag));
  }

  @OnEvent("deal.stage_changed", { async: true })
  async onStage(e: DealStageChangedEvent): Promise<void> {
    await this.safe("deal.stage_changed", e.orgId, () => this.engine.onDealStage(e.contactId, e.stageId));
  }

  @OnEvent("call.missed", { async: true })
  async onMissedCall(e: { orgId: string; contactId: string }): Promise<void> {
    await this.safe("call.missed", e.orgId, () => this.engine.onMissedCall(e.contactId));
  }

  @OnEvent("conversation.closed", { async: true })
  async onClosed(e: { conversationId: string; orgId: string }): Promise<void> {
    await this.safe("conversation.closed", e.orgId, () => this.engine.onClosed(e.conversationId));
  }

  @OnEvent("message.outbound", { async: true })
  async onOutbound(e: MessageOutboundEvent): Promise<void> {
    await this.safe("message.outbound", e.orgId, () =>
      this.engine.onOutbound(e.conversationId, e.messageId, e.author),
    );
  }

  private async safe(evento: string, orgId: string | undefined, fn: () => Promise<void>): Promise<void> {
    if (!orgId) {
      this.logger.warn(`${evento} sin empresa: no dispara flujos`);
      return;
    }
    try {
      await runInOrg(orgId, fn);
    } catch (e) {
      this.logger.error(`Disparador ${evento} falló: ${(e as Error).message}`);
    }
  }
}
