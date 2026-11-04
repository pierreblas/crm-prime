import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_PRICING_SETTINGS,
  PLANS,
  QUOTE_TRANSITIONS,
  assessmentScopeSchema,
  canTransition,
  complexityScore,
  computePricing,
  effectiveQuoteStatus,
  pricingSettingsSchema,
  PricingInputError,
  type ActualsSummary,
  type AssessmentStage,
  type CreateAssessmentInput,
  type ImplementationActual,
  type ImplementationActualInput,
  type ImplementationAssessment,
  type ImplementationAssessmentRow,
  type ImplementationQuote,
  type PlanKey,
  type PricingResultDto,
  type PricingSettings,
  type PricingSettingsDto,
  type QuoteAction,
  type QuoteActionBody,
  type QuoteItemCategory,
  type QuotePublicView,
  type QuoteStatus,
  type QuoteSummary,
  type RiskFlag,
  type UpdateAssessmentInput,
  type UpdateQuoteInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";

const QUOTE_INCLUDE = {
  items: { orderBy: { sortOrder: "asc" } },
  actuals: { orderBy: { workedOn: "asc" } },
  assessment: { include: { org: { select: { name: true, slug: true } } } },
} satisfies Prisma.ImplementationQuoteInclude;

/** Una sola fila de ajustes. */
const SETTINGS_ID = "default";
type QuoteRow = Prisma.ImplementationQuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;

const ASSESSMENT_INCLUDE = {
  org: { select: { name: true, slug: true } },
  quotes: { orderBy: { version: "desc" } },
} satisfies Prisma.ImplementationAssessmentInclude;
type AssessmentRow = Prisma.ImplementationAssessmentGetPayload<{ include: typeof ASSESSMENT_INCLUDE }>;
type QuoteStub = AssessmentRow["quotes"][number];

const QUOTE_ACTIONS = Object.keys(QUOTE_TRANSITIONS) as QuoteAction[];

/**
 * Cotizador interno de implementaciones.
 *
 * Vive en la consola de plataforma y solo ahí: sus tablas no son de ninguna
 * empresa (ver el esquema), ningún endpoint de empresa las sirve, y nada de lo
 * que hace toca planes, cobros, IA ni oportunidades de los clientes. El único
 * enlace con una empresa es opcional y se queda en null si esta se borra.
 *
 * Reglas que cuida este servicio y no la pantalla:
 *  - la complejidad y los números se calculan aquí, nunca se aceptan del cliente;
 *  - solo se edita en DRAFT; para cambiar algo aprobado se crea una versión;
 *  - aprobar por debajo del mínimo exige un motivo y queda en el diario;
 *  - al aprobar se congela todo en approvedSnapshot.
 */
@Injectable()
export class ImplementationsService {
  private readonly log = new Logger("Cotizador");

  constructor(private readonly prisma: PrismaService) {}

  // ── Ajustes (tarifas, plantillas, referencias) ──────────────

  async settings(): Promise<PricingSettingsDto> {
    return runUnscoped("cotizador: ajustes", async () => {
      const row = await this.prisma.implementationPricingSettings.findUnique({ where: { id: SETTINGS_ID } });
      return { settings: this.parseSettings(row?.settings), updatedBy: row?.updatedBy ?? null, updatedAt: row?.updatedAt?.toISOString() ?? null };
    });
  }

  /** Reemplazo completo, validado. Queda en el diario qué apartados cambiaron. */
  async updateSettings(input: PricingSettings, actor: string): Promise<PricingSettingsDto> {
    const keys = new Set<string>();
    for (const r of input.rates) {
      if (keys.has(r.key)) throw new BadRequestException(`Tarifa repetida: ${r.key}`);
      keys.add(r.key);
    }
    const tKeys = new Set<string>();
    for (const t of input.templates) {
      if (tKeys.has(t.key)) throw new BadRequestException(`Plantilla repetida: ${t.key}`);
      tKeys.add(t.key);
      for (const it of t.items) {
        if (it.rateKey && !keys.has(it.rateKey)) throw new BadRequestException(`La plantilla «${t.name}» usa una tarifa que no existe: ${it.rateKey}`);
      }
    }
    return runUnscoped("cotizador: guardar ajustes", async () => {
      const before = (await this.settings()).settings;
      await this.prisma.implementationPricingSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, settings: input as Prisma.InputJsonValue, updatedBy: actor },
        update: { settings: input as Prisma.InputJsonValue, updatedBy: actor },
      });
      const changed = (Object.keys(input) as (keyof PricingSettings)[]).filter((k) => JSON.stringify(input[k]) !== JSON.stringify(before[k]));
      const scalars = ["hourlyCostCents", "contingencyBp", "targetMarginBp", "roundingCents", "validityDays", "diagnosisFeeCents", "currency"] as const;
      await this.audit(actor, "pricing_settings_changed", null, {
        changed,
        from: Object.fromEntries(scalars.filter((k) => changed.includes(k)).map((k) => [k, before[k]])),
        to: Object.fromEntries(scalars.filter((k) => changed.includes(k)).map((k) => [k, input[k]])),
      });
      return this.settings();
    });
  }

  private parseSettings(raw: unknown): PricingSettings {
    if (!raw) return DEFAULT_PRICING_SETTINGS;
    const r = pricingSettingsSchema.safeParse(raw);
    if (!r.success) {
      this.log.warn("Los ajustes guardados ya no validan; se usan los de código");
      return DEFAULT_PRICING_SETTINGS;
    }
    return r.data;
  }

  // ── Diagnósticos ────────────────────────────────────────────

  async list(search = "", archived = false): Promise<ImplementationAssessmentRow[]> {
    return runUnscoped("cotizador: listado", async () => {
      const q = search.trim();
      const rows = await this.prisma.implementationAssessment.findMany({
        where: {
          archivedAt: archived ? { not: null } : null,
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: "insensitive" } },
                  { clientName: { contains: q, mode: "insensitive" } },
                  { sector: { contains: q, mode: "insensitive" } },
                  { quoteNumber: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
        include: ASSESSMENT_INCLUDE,
      });
      return rows.map((r) => this.assessmentRow(r));
    });
  }

  async create(input: CreateAssessmentInput, actor: string): Promise<ImplementationAssessment> {
    return runUnscoped("cotizador: nuevo diagnóstico", async () => {
      await this.assertOrg(input.orgId);
      const cx = complexityScore(input.scope.complexity);
      const row = await this.prisma.implementationAssessment.create({
        data: {
          title: input.title,
          clientName: input.clientName,
          clientContact: input.clientContact,
          orgId: input.orgId,
          sector: input.sector,
          objective: input.objective,
          ownerEmail: actor,
          scope: input.scope as Prisma.InputJsonValue,
          riskFlags: input.riskFlags,
          complexityScore: cx.score,
          complexityBand: cx.band,
        },
        include: ASSESSMENT_INCLUDE,
      });
      await this.audit(actor, "assessment_created", row.orgId, { assessmentId: row.id, title: row.title, clientName: row.clientName });
      return this.assessmentDto(row);
    });
  }

  async get(id: string): Promise<ImplementationAssessment> {
    return runUnscoped("cotizador: diagnóstico", async () => this.assessmentDto(await this.assessmentOrThrow(id)));
  }

  async update(id: string, input: UpdateAssessmentInput, actor: string): Promise<ImplementationAssessment> {
    return runUnscoped("cotizador: editar diagnóstico", async () => {
      const current = await this.assessmentOrThrow(id);
      if (input.orgId !== undefined) await this.assertOrg(input.orgId);
      const scope = input.scope ?? assessmentScopeSchema.parse(current.scope);
      const cx = complexityScore(scope.complexity);
      const row = await this.prisma.implementationAssessment.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
          ...(input.clientContact !== undefined ? { clientContact: input.clientContact } : {}),
          ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
          ...(input.sector !== undefined ? { sector: input.sector } : {}),
          ...(input.objective !== undefined ? { objective: input.objective } : {}),
          ...(input.scope !== undefined ? { scope: input.scope as Prisma.InputJsonValue } : {}),
          ...(input.riskFlags !== undefined ? { riskFlags: input.riskFlags } : {}),
          complexityScore: cx.score,
          complexityBand: cx.band,
        },
        include: ASSESSMENT_INCLUDE,
      });
      return this.assessmentDto(row);
    });
  }

  /** Archivar saca el diagnóstico del listado; no borra nada y se puede restaurar. */
  async archive(id: string, archived: boolean, actor: string): Promise<ImplementationAssessment> {
    return runUnscoped("cotizador: archivar", async () => {
      const current = await this.assessmentOrThrow(id);
      if (!!current.archivedAt === archived) return this.assessmentDto(current);
      const row = await this.prisma.implementationAssessment.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        include: ASSESSMENT_INCLUDE,
      });
      await this.audit(actor, archived ? "assessment_archived" : "assessment_restored", row.orgId, { assessmentId: id, title: row.title, number: row.quoteNumber });
      return this.assessmentDto(row);
    });
  }

  // ── Cotizaciones ────────────────────────────────────────────

  /** Primera versión. Las siguientes salen de `act(id, "revise")` sobre la anterior. */
  async createQuote(assessmentId: string, actor: string): Promise<ImplementationQuote> {
    return runUnscoped("cotizador: nueva cotización", async () => {
      const a = await this.assessmentOrThrow(assessmentId);
      if (a.quotes.length > 0) {
        throw new BadRequestException("Este diagnóstico ya tiene cotización: crea una versión nueva desde la última");
      }
      const s = (await this.settings()).settings;
      const validUntil = new Date();
      validUntil.setUTCDate(validUntil.getUTCDate() + s.validityDays);

      const created = await this.prisma.$transaction(async (tx) => {
        let number = a.quoteNumber;
        if (!number) {
          const [{ n }] = await tx.$queryRaw<[{ n: bigint }]>`SELECT nextval('implementation_quote_number_seq') AS n`;
          number = `COT-${new Date().getUTCFullYear()}-${String(Number(n)).padStart(4, "0")}`;
          await tx.implementationAssessment.update({ where: { id: a.id }, data: { quoteNumber: number } });
        }
        return tx.implementationQuote.create({
          data: {
            assessmentId: a.id,
            version: 1,
            currency: s.currency,
            contingencyBp: s.contingencyBp,
            targetMarginBp: s.targetMarginBp,
            roundingCents: s.roundingCents,
            paymentTerms: s.paymentTerms,
            diagnosisFeeCents: s.diagnosisFeeCents,
            validUntil,
            createdBy: actor,
          },
          include: QUOTE_INCLUDE,
        });
      });
      await this.audit(actor, "quote_created", a.orgId, { assessmentId: a.id, quoteId: created.id, number: created.assessment.quoteNumber, version: 1 });
      return this.quoteDto(created);
    });
  }

  async getQuote(id: string): Promise<ImplementationQuote> {
    return runUnscoped("cotizador: cotización", async () => this.quoteDto(await this.quoteOrThrow(id)));
  }

  /** Solo en borrador. Recalcula siempre en el servidor; la pantalla solo previsualiza. */
  async updateQuote(id: string, input: UpdateQuoteInput, actor: string): Promise<ImplementationQuote> {
    return runUnscoped("cotizador: editar cotización", async () => {
      const q = await this.quoteOrThrow(id);
      if (q.status !== "DRAFT") {
        throw new BadRequestException("Esta versión ya no se edita. Crea una versión nueva para cambiarla.");
      }

      const planKey = input.planKey === undefined ? q.planKey : input.planKey;
      const planSnapshot =
        input.planKey === undefined
          ? q.planPriceCentsSnapshot
          : input.planKey === null
            ? null
            : Math.round((PLANS[input.planKey as PlanKey]?.priceUsd ?? 0) * 100);

      const items = (input.items ?? q.items.map((it) => ({
        category: it.category as QuoteItemCategory,
        description: it.description,
        hours: Number(it.hours),
        hourlyCostCents: it.hourlyCostCents,
        thirdPartyCents: it.thirdPartyCents,
        otherCents: it.otherCents,
      }))).map((it) => ({ ...it, hours: Math.round(it.hours * 100) / 100 }));

      const pricing = this.price({
        items,
        overheadsCents: input.overheadsCents ?? q.overheadsCents,
        contingencyBp: input.contingencyBp ?? q.contingencyBp,
        targetMarginBp: input.targetMarginBp ?? q.targetMarginBp,
        roundingCents: input.roundingCents ?? q.roundingCents,
        proposedPriceCents: input.proposedPriceCents === undefined ? q.proposedPriceCents : input.proposedPriceCents,
      });

      const { items: _items, planKey: _pk, validUntil, ...fields } = input;
      void _items;
      void _pk;
      const updated = await this.prisma.$transaction(async (tx) => {
        if (input.items) {
          await tx.implementationQuoteItem.deleteMany({ where: { quoteId: q.id } });
          if (input.items.length > 0) {
            await tx.implementationQuoteItem.createMany({
              data: items.map((it, i) => ({ ...it, quoteId: q.id, sortOrder: i })),
            });
          }
        }
        return tx.implementationQuote.update({
          where: { id: q.id },
          data: {
            ...fields,
            planKey,
            planPriceCentsSnapshot: planSnapshot,
            ...(validUntil !== undefined ? { validUntil: validUntil === null ? null : new Date(validUntil) } : {}),
            ...this.pricingColumns(pricing),
          },
          include: QUOTE_INCLUDE,
        });
      });
      await this.touch(q.assessmentId);
      return this.quoteDto(updated);
    });
  }

  /** Cambios de estado y versión nueva. Todos quedan en el diario del operador. */
  async act(id: string, action: QuoteAction, body: QuoteActionBody, actor: string): Promise<ImplementationQuote> {
    return runUnscoped(`cotizador: ${action}`, async () => {
      const q = await this.quoteOrThrow(id);
      const status = effectiveQuoteStatus(q.status as QuoteStatus, q.validUntil);
      if (!canTransition(status, action)) {
        throw new BadRequestException(`No se puede «${action}» una cotización en estado ${status}`);
      }
      const reason = body.reason?.trim() || null;
      const note = body.note?.trim() || null;
      const base = { assessmentId: q.assessmentId, quoteId: q.id, number: q.assessment.quoteNumber, version: q.version, from: status };
      const now = new Date();

      switch (action) {
        case "submit": {
          const pricing = this.priceOf(q);
          if (q.items.length === 0) throw new BadRequestException("Añade al menos una partida antes de enviar a revisión");
          if (!q.proposedPriceCents || q.proposedPriceCents <= 0) throw new BadRequestException("Fija el precio propuesto antes de enviar a revisión");
          const row = await this.setStatus(q.id, "READY_FOR_REVIEW", {});
          await this.audit(actor, "quote_submitted", q.assessment.orgId, { ...base, to: "READY_FOR_REVIEW", belowMinimum: pricing.belowMinimum });
          return this.quoteDto(row);
        }
        case "reopen": {
          const row = await this.setStatus(q.id, "DRAFT", {});
          await this.audit(actor, "quote_reopened", q.assessment.orgId, { ...base, to: "DRAFT", reason });
          return this.quoteDto(row);
        }
        case "approve": {
          const pricing = this.priceOf(q);
          if (!q.proposedPriceCents || q.proposedPriceCents <= 0) throw new BadRequestException("No hay precio propuesto");
          if (q.validUntil && q.validUntil.getTime() < now.getTime()) {
            throw new BadRequestException("La vigencia ya pasó: vuelve a borrador y pon una fecha futura");
          }
          if (pricing.belowMinimum && !reason) {
            throw new BadRequestException("El precio está por debajo del mínimo recomendado: indica el motivo de la excepción");
          }
          // Lo que se aprueba se congela tal cual, por si alguien edita la fila a mano después.
          const snapshot = this.quoteDto({ ...q, status: "APPROVED", approvedBy: actor, approvedAt: now });
          const row = await this.setStatus(q.id, "APPROVED", {
            approvedBy: actor,
            approvedAt: now,
            approvedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            ...(pricing.belowMinimum ? { exceptionReason: reason, exceptionBy: actor } : {}),
          });
          await this.audit(actor, pricing.belowMinimum ? "quote_exception_approved" : "quote_approved", q.assessment.orgId, {
            ...base,
            to: "APPROVED",
            proposedCents: q.proposedPriceCents,
            minimumCents: pricing.minimumPriceCents,
            marginBp: pricing.expectedMarginBp,
            currency: q.currency,
            reason,
          });
          if (pricing.belowMinimum) this.log.warn(`${actor} aprobó ${base.number} v${q.version} por debajo del mínimo: ${reason}`);
          return this.quoteDto(row);
        }
        case "send": {
          const row = await this.setStatus(q.id, "SENT", { sentAt: now, sentNote: note });
          await this.audit(actor, "quote_sent", q.assessment.orgId, { ...base, to: "SENT", note });
          return this.quoteDto(row);
        }
        case "accept": {
          const row = await this.setStatus(q.id, "ACCEPTED", { acceptedAt: now });
          await this.audit(actor, "quote_accepted", q.assessment.orgId, { ...base, to: "ACCEPTED", note, proposedCents: q.proposedPriceCents, currency: q.currency });
          return this.quoteDto(row);
        }
        case "reject": {
          if (!reason) throw new BadRequestException("Indica el motivo del rechazo: sirve para ajustar las próximas estimaciones");
          const row = await this.setStatus(q.id, "REJECTED", { rejectedAt: now, rejectedReason: reason });
          await this.audit(actor, "quote_rejected", q.assessment.orgId, { ...base, to: "REJECTED", reason });
          return this.quoteDto(row);
        }
        case "cancel": {
          const row = await this.setStatus(q.id, "CANCELLED", { cancelledAt: now });
          await this.audit(actor, "quote_cancelled", q.assessment.orgId, { ...base, to: "CANCELLED", reason });
          return this.quoteDto(row);
        }
        case "revise":
          return this.revise(q, status, actor, reason);
      }
    });
  }

  /**
   * Versión siguiente: copia de la actual, en borrador. La actual pasa a
   * SUPERSEDED, salvo que esté ACCEPTED (es el contrato: se queda, y la nueva
   * versión es un cambio de alcance).
   */
  private async revise(q: QuoteRow, from: QuoteStatus, actor: string, reason: string | null): Promise<ImplementationQuote> {
    const s = (await this.settings()).settings;
    const validUntil = new Date();
    validUntil.setUTCDate(validUntil.getUTCDate() + s.validityDays);
    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.implementationQuote.aggregate({ where: { assessmentId: q.assessmentId }, _max: { version: true } });
      const version = (last._max.version ?? q.version) + 1;
      const next = await tx.implementationQuote.create({
        data: {
          assessmentId: q.assessmentId,
          version,
          status: "DRAFT",
          currency: q.currency,
          planKey: q.planKey,
          planPriceCentsSnapshot: q.planKey ? Math.round((PLANS[q.planKey as PlanKey]?.priceUsd ?? 0) * 100) : null,
          aiBillingMode: q.aiBillingMode,
          overheadsCents: q.overheadsCents,
          contingencyBp: q.contingencyBp,
          targetMarginBp: q.targetMarginBp,
          roundingCents: q.roundingCents,
          proposedPriceCents: q.proposedPriceCents,
          diagnosisFeeCents: q.diagnosisFeeCents,
          diagnosisCredited: q.diagnosisCredited,
          deliverables: q.deliverables,
          assumptions: q.assumptions,
          exclusions: q.exclusions,
          clientRequirements: q.clientRequirements,
          timelineNote: q.timelineNote,
          paymentTerms: q.paymentTerms,
          externalCostsNote: q.externalCostsNote,
          taxNote: q.taxNote,
          supportNote: q.supportNote,
          validUntil,
          createdBy: actor,
          ...this.pricingColumns(this.priceOf(q)),
          items: {
            create: q.items.map((it, i) => ({
              category: it.category,
              description: it.description,
              hours: it.hours,
              hourlyCostCents: it.hourlyCostCents,
              thirdPartyCents: it.thirdPartyCents,
              otherCents: it.otherCents,
              sortOrder: i,
            })),
          },
        },
        include: QUOTE_INCLUDE,
      });
      if (q.status !== "ACCEPTED") {
        await tx.implementationQuote.update({ where: { id: q.id }, data: { status: "SUPERSEDED", supersededById: next.id } });
      } else {
        await tx.implementationQuote.update({ where: { id: q.id }, data: { supersededById: next.id } });
      }
      return next;
    });
    await this.audit(actor, "quote_revised", q.assessment.orgId, {
      assessmentId: q.assessmentId,
      quoteId: created.id,
      fromQuoteId: q.id,
      number: q.assessment.quoteNumber,
      version: created.version,
      from,
      reason,
    });
    return this.quoteDto(created);
  }

  // ── Horas y costos reales ───────────────────────────────────

  /** Solo sobre una versión aceptada: es el proyecto que se ejecuta. */
  async addActual(quoteId: string, input: ImplementationActualInput, actor: string): Promise<ImplementationQuote> {
    return runUnscoped("cotizador: registrar horas reales", async () => {
      const q = await this.quoteOrThrow(quoteId);
      if (q.status !== "ACCEPTED") throw new BadRequestException("Las horas y costos reales se registran sobre la versión aceptada");
      const workedOn = new Date(`${input.workedOn}T00:00:00Z`);
      if (Number.isNaN(workedOn.getTime())) throw new BadRequestException("Fecha no válida");
      await this.prisma.implementationActual.create({
        data: {
          quoteId: q.id,
          category: input.category,
          description: input.description,
          hours: Math.round(input.hours * 100) / 100,
          hourlyCostCents: input.hourlyCostCents,
          costCents: input.costCents,
          workedOn,
          note: input.note,
          createdBy: actor,
        },
      });
      await this.audit(actor, "quote_actual_added", q.assessment.orgId, {
        assessmentId: q.assessmentId,
        quoteId: q.id,
        number: q.assessment.quoteNumber,
        version: q.version,
        hours: input.hours,
        costCents: input.costCents,
        category: input.category,
      });
      await this.touch(q.assessmentId);
      return this.quoteDto(await this.quoteOrThrow(quoteId));
    });
  }

  async removeActual(quoteId: string, actualId: string, actor: string): Promise<ImplementationQuote> {
    return runUnscoped("cotizador: quitar horas reales", async () => {
      const q = await this.quoteOrThrow(quoteId);
      const row = q.actuals.find((a) => a.id === actualId);
      if (!row) throw new NotFoundException("Registro no encontrado");
      await this.prisma.implementationActual.delete({ where: { id: actualId } });
      await this.audit(actor, "quote_actual_removed", q.assessment.orgId, {
        assessmentId: q.assessmentId,
        quoteId: q.id,
        number: q.assessment.quoteNumber,
        version: q.version,
        hours: Number(row.hours),
        costCents: row.costCents,
      });
      return this.quoteDto(await this.quoteOrThrow(quoteId));
    });
  }

  // ── Ayudas ──────────────────────────────────────────────────

  private async assertOrg(orgId: string | null | undefined): Promise<void> {
    if (!orgId) return;
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) throw new BadRequestException("Esa empresa no existe");
  }

  private async assessmentOrThrow(id: string): Promise<AssessmentRow> {
    const row = await this.prisma.implementationAssessment.findUnique({ where: { id }, include: ASSESSMENT_INCLUDE });
    if (!row) throw new NotFoundException("Diagnóstico no encontrado");
    return row;
  }

  private async quoteOrThrow(id: string): Promise<QuoteRow> {
    const row = await this.prisma.implementationQuote.findUnique({ where: { id }, include: QUOTE_INCLUDE });
    if (!row) throw new NotFoundException("Cotización no encontrada");
    return row;
  }

  private async setStatus(id: string, status: QuoteStatus, data: Prisma.ImplementationQuoteUpdateInput): Promise<QuoteRow> {
    const row = await this.prisma.implementationQuote.update({ where: { id }, data: { ...data, status }, include: QUOTE_INCLUDE });
    await this.touch(row.assessmentId);
    return row;
  }

  /** Que el diagnóstico suba en el listado cuando se mueve una de sus versiones. */
  private async touch(assessmentId: string): Promise<void> {
    await this.prisma.implementationAssessment.update({ where: { id: assessmentId }, data: { updatedAt: new Date() } });
  }

  private price(input: Parameters<typeof computePricing>[0]): PricingResultDto {
    try {
      return computePricing(input);
    } catch (e) {
      if (e instanceof PricingInputError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private priceOf(q: QuoteRow): PricingResultDto {
    return this.price({
      items: q.items.map((it) => ({
        hours: Number(it.hours),
        hourlyCostCents: it.hourlyCostCents,
        thirdPartyCents: it.thirdPartyCents,
        otherCents: it.otherCents,
      })),
      overheadsCents: q.overheadsCents,
      contingencyBp: q.contingencyBp,
      targetMarginBp: q.targetMarginBp,
      roundingCents: q.roundingCents,
      proposedPriceCents: q.proposedPriceCents,
    });
  }

  private pricingColumns(p: PricingResultDto) {
    return {
      laborCents: p.laborCents,
      externalCents: p.externalCents,
      baseCostCents: p.baseCostCents,
      contingencyCents: p.contingencyCents,
      budgetedCostCents: p.budgetedCostCents,
      minimumPriceCents: p.minimumPriceCents,
      expectedMarginBp: p.expectedMarginBp,
      belowMinimum: p.belowMinimum,
    };
  }

  private async audit(actor: string, action: string, orgId: string | null, details: unknown): Promise<void> {
    await this.prisma.platformAuditLog.create({
      data: { actorEmail: actor, action, orgId, details: details === null || details === undefined ? undefined : (details as object) },
    });
  }

  // ── DTO ─────────────────────────────────────────────────────

  private summary(q: QuoteStub, now = new Date()): QuoteSummary {
    return {
      id: q.id,
      version: q.version,
      status: effectiveQuoteStatus(q.status as QuoteStatus, q.validUntil, now),
      currency: q.currency as QuoteSummary["currency"],
      proposedPriceCents: q.proposedPriceCents,
      minimumPriceCents: q.minimumPriceCents,
      belowMinimum: q.belowMinimum,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
      approvedAt: q.approvedAt?.toISOString() ?? null,
      sentAt: q.sentAt?.toISOString() ?? null,
      acceptedAt: q.acceptedAt?.toISOString() ?? null,
      validUntil: q.validUntil?.toISOString() ?? null,
    };
  }

  private stageOf(latest: QuoteSummary | null): AssessmentStage {
    if (!latest) return "diagnosis";
    const map: Record<QuoteStatus, AssessmentStage> = {
      DRAFT: "quoting",
      READY_FOR_REVIEW: "review",
      APPROVED: "approved",
      SENT: "sent",
      ACCEPTED: "accepted",
      REJECTED: "rejected",
      EXPIRED: "expired",
      SUPERSEDED: "quoting",
      CANCELLED: "cancelled",
    };
    return map[latest.status];
  }

  private assessmentRow(a: AssessmentRow): ImplementationAssessmentRow {
    const now = new Date();
    const latest = a.quotes[0] ? this.summary(a.quotes[0], now) : null;
    return {
      id: a.id,
      quoteNumber: a.quoteNumber,
      title: a.title,
      clientName: a.clientName,
      clientContact: a.clientContact,
      orgId: a.orgId,
      orgName: a.org?.name ?? null,
      orgSlug: a.org?.slug ?? null,
      sector: a.sector,
      objective: a.objective,
      ownerEmail: a.ownerEmail,
      riskFlags: a.riskFlags as RiskFlag[],
      complexityScore: a.complexityScore,
      complexityBand: a.complexityBand as ImplementationAssessmentRow["complexityBand"],
      stage: this.stageOf(latest),
      latestQuote: latest,
      archivedAt: a.archivedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  private actualsOf(q: QuoteRow, pricing: PricingResultDto): { actuals: ImplementationActual[]; actualsSummary: ActualsSummary } {
    const actuals = q.actuals.map((r) => ({
      id: r.id,
      category: r.category as QuoteItemCategory,
      description: r.description,
      hours: Number(r.hours),
      hourlyCostCents: r.hourlyCostCents,
      costCents: r.costCents,
      workedOn: r.workedOn.toISOString().slice(0, 10),
      note: r.note,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    }));
    let hours = 0;
    let laborCents = 0;
    let externalCents = 0;
    for (const a of actuals) {
      hours += a.hours;
      laborCents += Math.round(a.hours * a.hourlyCostCents);
      externalCents += a.costCents;
    }
    hours = Math.round(hours * 100) / 100;
    const totalCents = laborCents + externalCents;
    const price = q.proposedPriceCents;
    const realMarginBp = actuals.length > 0 && price ? Math.round(((price - totalCents) * 10000) / price) : null;
    return {
      actuals,
      actualsSummary: { hours, laborCents, externalCents, totalCents, budgetedHours: pricing.totalHours, budgetedCents: pricing.budgetedCostCents, realMarginBp },
    };
  }

  private assessmentDto(a: AssessmentRow): ImplementationAssessment {
    const now = new Date();
    return {
      ...this.assessmentRow(a),
      scope: assessmentScopeSchema.parse(a.scope),
      quotes: a.quotes.map((q) => this.summary(q, now)),
    };
  }

  private quoteDto(q: QuoteRow): ImplementationQuote {
    const now = new Date();
    const status = effectiveQuoteStatus(q.status as QuoteStatus, q.validUntil, now);
    const pricing = this.priceOf(q);
    const items = q.items.map((it) => ({
      id: it.id,
      category: it.category as QuoteItemCategory,
      description: it.description,
      hours: Number(it.hours),
      hourlyCostCents: it.hourlyCostCents,
      thirdPartyCents: it.thirdPartyCents,
      otherCents: it.otherCents,
      sortOrder: it.sortOrder,
    }));
    const number = q.assessment.quoteNumber ?? "COT-?";
    const credit = q.diagnosisCredited && q.diagnosisFeeCents ? q.diagnosisFeeCents : null;
    const plan = q.planKey
      ? {
          key: q.planKey,
          name: PLANS[q.planKey as PlanKey]?.name ?? q.planKey,
          monthlyCents: q.planPriceCentsSnapshot ?? Math.round((PLANS[q.planKey as PlanKey]?.priceUsd ?? 0) * 100),
        }
      : null;
    const publicView: QuotePublicView = {
      number,
      version: q.version,
      status,
      currency: q.currency as QuotePublicView["currency"],
      clientName: q.assessment.clientName,
      title: q.assessment.title,
      objective: q.assessment.objective,
      deliverables: q.deliverables,
      lines: items.map((it) => ({ category: it.category, description: it.description })),
      assumptions: q.assumptions,
      exclusions: q.exclusions,
      clientRequirements: q.clientRequirements,
      timelineNote: q.timelineNote,
      implementationPriceCents: q.proposedPriceCents,
      diagnosisCreditCents: credit,
      totalDueCents: q.proposedPriceCents === null ? null : Math.max(0, q.proposedPriceCents - (credit ?? 0)),
      plan,
      aiBillingMode: q.aiBillingMode as QuotePublicView["aiBillingMode"],
      externalCostsNote: q.externalCostsNote,
      taxNote: q.taxNote,
      supportNote: q.supportNote,
      paymentTerms: q.paymentTerms,
      validUntil: q.validUntil?.toISOString() ?? null,
    };
    return {
      ...this.summary(q, now),
      status,
      assessmentId: q.assessmentId,
      number,
      storedStatus: q.status as QuoteStatus,
      planKey: q.planKey,
      planPriceCentsSnapshot: q.planPriceCentsSnapshot,
      aiBillingMode: q.aiBillingMode as ImplementationQuote["aiBillingMode"],
      overheadsCents: q.overheadsCents,
      contingencyBp: q.contingencyBp,
      targetMarginBp: q.targetMarginBp,
      roundingCents: q.roundingCents,
      diagnosisFeeCents: q.diagnosisFeeCents,
      diagnosisCredited: q.diagnosisCredited,
      deliverables: q.deliverables,
      assumptions: q.assumptions,
      exclusions: q.exclusions,
      clientRequirements: q.clientRequirements,
      timelineNote: q.timelineNote,
      paymentTerms: q.paymentTerms,
      externalCostsNote: q.externalCostsNote,
      taxNote: q.taxNote,
      supportNote: q.supportNote,
      exceptionReason: q.exceptionReason,
      exceptionBy: q.exceptionBy,
      approvedBy: q.approvedBy,
      sentNote: q.sentNote,
      rejectedAt: q.rejectedAt?.toISOString() ?? null,
      rejectedReason: q.rejectedReason,
      cancelledAt: q.cancelledAt?.toISOString() ?? null,
      supersededById: q.supersededById,
      hasApprovedSnapshot: q.approvedSnapshot !== null && q.approvedSnapshot !== undefined,
      createdBy: q.createdBy,
      items,
      pricing,
      ...this.actualsOf(q, pricing),
      editable: q.status === "DRAFT",
      actions: QUOTE_ACTIONS.filter((a) => canTransition(status, a)),
      publicView,
    };
  }
}
