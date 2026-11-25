import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Prisma } from "@prisma/client";
import { addUtmTouch, allUtmKeys, CONTACT_EMAIL_KEY, fieldKeyFromLabel, humanizeFieldKey, ORIGIN_FIELD_KEYS, phoneVariants, resolveFieldKeys, utmKeys } from "@crm/shared";
import type {
  UnmappedField,
  CreateCustomFieldInput,
  CustomFieldDto,
  CustomFieldType,
  FieldEntity,
  LeadWebhookInput,
  UpdateCustomFieldInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";

@Injectable()
export class LeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Campos personalizados (definiciones) ─────────────────────
  async listFields(): Promise<CustomFieldDto[]> {
    const rows = await this.prisma.customField.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((f) => this.toFieldDto(f));
  }

  async createField(input: CreateCustomFieldInput): Promise<CustomFieldDto> {
    // Clave elegida a mano: tiene que estar libre. Si no, sale del nombre.
    if (input.key && (await this.prisma.customField.findFirst({ where: { key: input.key } }))) {
      throw new ConflictException(`Ya hay un campo con la clave «${input.key}»`);
    }
    const key = input.key ?? (await this.uniqueKey(fieldKeyFromLabel(input.label)));
    const count = await this.prisma.customField.count();
    const f = await this.prisma.customField.create({
      data: {
        orgId: this.tenant.orgId(),
        key,
        label: input.label,
        type: input.type,
        options: input.type === "select" ? input.options : [],
        order: count,
        entity: input.entity ?? "contact",
      },
    });
    return this.toFieldDto(f);
  }

  /**
   * Un dato que llegó a los contactos pero es del lead (una respuesta de un
   * formulario): se crea como campo del lead y lo que ya había se pasa a la
   * oportunidad de cada contacto, la abierta o, si no tiene, la última. Quien
   * no tiene ninguna oportunidad conserva el dato en su ficha.
   */
  async moveFieldToLead(key: string): Promise<{ field: CustomFieldDto; moved: number; kept: number }> {
    const orgId = this.tenant.orgId();
    const existing = await this.prisma.customField.findFirst({ where: { key } });
    const field = existing
      ? await this.prisma.customField.update({ where: { id: existing.id }, data: { entity: "deal" } })
      : await this.prisma.customField.create({
          data: { orgId, key, label: humanizeFieldKey(key).slice(0, 80), type: "text", options: [], order: await this.prisma.customField.count(), entity: "deal" },
        });
    // Un solo paso: copia a la oportunidad y, solo de quien se copió, lo quita del contacto.
    const rows = await this.prisma.$queryRaw<{ moved: number }[]>`
      WITH target AS (
        SELECT DISTINCT ON (c.id) c.id AS contact_id, d.id AS deal_id, c.metadata->>${key} AS v
        FROM contacts c
        JOIN deals d ON d."contactId" = c.id
        JOIN pipeline_stages s ON s.id = d."stageId"
        WHERE c."orgId" = ${orgId} AND jsonb_typeof(c.metadata) = 'object' AND c.metadata ? ${key}
        ORDER BY c.id, (d."discardedAt" IS NULL AND NOT s."isWon" AND NOT s."isLost") DESC, d."createdAt" DESC
      ), copied AS (
        UPDATE deals d
        SET fields = jsonb_build_object(${key}::text, t.v) || coalesce(d.fields, '{}'::jsonb)
        FROM target t
        WHERE d.id = t.deal_id
        RETURNING t.contact_id
      ), cleaned AS (
        UPDATE contacts c SET metadata = c.metadata - ${key}::text
        WHERE c.id IN (SELECT contact_id FROM copied)
        RETURNING c.id
      )
      SELECT count(*)::int AS moved FROM cleaned`;
    const left = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM contacts c
      WHERE c."orgId" = ${orgId} AND jsonb_typeof(c.metadata) = 'object' AND c.metadata ? ${key}`;
    return { field: this.toFieldDto(field), moved: rows[0]?.moved ?? 0, kept: left[0]?.n ?? 0 };
  }

  async updateField(
    id: string,
    input: UpdateCustomFieldInput,
  ): Promise<CustomFieldDto> {
    const existing = await this.prisma.customField.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Campo no encontrado");
    const f = await this.prisma.customField.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.options !== undefined ? { options: input.options } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
      },
    });
    return this.toFieldDto(f);
  }

  async removeField(id: string): Promise<{ ok: true }> {
    const f = await this.prisma.customField.findUnique({ where: { id } });
    if (!f) throw new NotFoundException("Campo no encontrado");
    await this.prisma.customField.delete({ where: { id } });
    return { ok: true };
  }

  /** Traduce nombres o claves de fuera a las claves de los campos definidos. */
  async resolveFields(fields: Record<string, string>): Promise<Record<string, string>> {
    if (!Object.keys(fields).length) return fields;
    const defs = await this.prisma.customField.findMany({ select: { key: true, label: true } });
    return resolveFieldKeys(fields, defs);
  }

  /**
   * Datos que llegan en los contactos (API, webhooks, formularios de Meta,
   * importaciones) con una clave que no es de ningún campo: no se ven en la
   * ficha hasta que se crea el campo. Los UTM tienen su propio sitio.
   */
  async unmappedFields(): Promise<UnmappedField[]> {
    const orgId = this.tenant.orgId();
    const defined = new Set((await this.prisma.customField.findMany({ select: { key: true } })).map((f) => f.key));
    const rows = await this.prisma.$queryRaw<{ key: string; contacts: number; sample: string | null }[]>`
      SELECT k AS key, count(*)::int AS contacts, left(min(c.metadata->>k), 80) AS sample
      FROM contacts c
      CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(c.metadata) = 'object' THEN c.metadata ELSE '{}'::jsonb END) AS k
      WHERE c."orgId" = ${orgId}
      GROUP BY k
      ORDER BY count(*) DESC
      LIMIT 200`;
    // El correo tiene su sitio fijo en la ficha, y el formulario, la campaña y el
    // anuncio los pone Driony y se ven en «Origen»: no hace falta crearles un campo.
    const skip = new Set<string>([...allUtmKeys, CONTACT_EMAIL_KEY, ...ORIGIN_FIELD_KEYS]);
    // Lo mismo en los leads: respuestas guardadas en la oportunidad sin campo definido.
    const inDeals = await this.prisma.$queryRaw<{ key: string; contacts: number; sample: string | null }[]>`
      SELECT k AS key, count(*)::int AS contacts, left(min(d.fields->>k), 80) AS sample
      FROM deals d
      CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(d.fields) = 'object' THEN d.fields ELSE '{}'::jsonb END) AS k
      WHERE d."orgId" = ${orgId}
      GROUP BY k
      ORDER BY count(*) DESC
      LIMIT 200`;
    return [
      ...rows.filter((r) => !defined.has(r.key) && !skip.has(r.key)).map((r) => ({ ...r, entity: "contact" as const })),
      ...inDeals.filter((r) => !defined.has(r.key) && !skip.has(r.key)).map((r) => ({ ...r, entity: "deal" as const })),
    ].slice(0, 50);
  }

  // ── Webhook de lead entrante ─────────────────────────────────
  async ingestLead(
    input: LeadWebhookInput,
    // Nombre de la clave de API que autenticó la llamada, si la hubo.
    // Es la procedencia fiable: la verifica el servidor, no el que llama.
    viaApiKey: string | null = null,
    // Por dónde entró, para los flujos que arrancan con un lead nuevo.
    // `silent`: importación o reprocesado, no despierta flujos.
    // `hold`: quien llama avisa del lead (con `announce`) cuando termine lo suyo.
    opts: { via?: "meta" | "webhook" | "api"; formName?: string | null; formId?: string | null; silent?: boolean; hold?: boolean } = {},
  ): Promise<{ id: string; created: boolean; announce?: () => void }> {
    // Ya viene normalizado a E.164 por el esquema (phoneField). Si el contacto
    // ya existe con otra forma del mismo móvil (su WhatsApp de México «+521…»
    // o Argentina «+549…»), el lead se une a ese y conserva su número.
    const orgId = this.tenant.orgId();
    const variants = phoneVariants(input.phone);
    const existing =
      (await this.prisma.contact.findFirst({ where: { phone: input.phone } })) ??
      (await this.prisma.contact.findFirst({ where: { phone: { in: variants } } }));
    const phone = existing?.phone ?? input.phone;

    // Fuente: se crea si no existe.
    let sourceId: string | undefined;
    if (input.source?.trim()) {
      const source = await this.prisma.source.upsert({
        where: { orgId_name: { orgId, name: input.source.trim() } },
        create: { orgId, name: input.source.trim() },
        update: {},
      });
      sourceId = source.id;
    }

    // Campos personalizados → metadata (fusiona con lo existente). Se aceptan
    // la clave o el nombre del campo; lo desconocido se guarda con clave limpia.
    const current = (existing?.metadata as Record<string, unknown> | null) ?? {};
    const incoming = await this.resolveFields(input.fields ?? {});
    // Los utm_* de la primera vez se conservan (como en WhatsApp) y los de este
    // lead quedan como los últimos: es la campaña de la que habla ahora.
    const utms = Object.fromEntries(utmKeys.filter((k) => incoming[k]).map((k) => [k, incoming[k]!]));
    for (const k of allUtmKeys) delete incoming[k];
    const touched = addUtmTouch(current, utms) ?? current;
    const metadata = { ...touched, ...incoming } as Prisma.InputJsonValue;

    const contact = await this.prisma.contact.upsert({
      where: { orgId_phone: { orgId, phone } },
      create: {
        orgId,
        phone,
        name: input.name ?? null,
        optIn: input.optIn ?? true,
        ...(sourceId ? { sourceId } : {}),
        metadata,
        // Procedencia técnica: entró por el webhook, y de qué integración.
        origin: "webhook",
        originDetail:
          viaApiKey ?? input.integration?.trim() ?? input.source?.trim() ?? null,
      },
      update: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.optIn !== undefined ? { optIn: input.optIn } : {}),
        ...(sourceId ? { sourceId } : {}),
        metadata,
      },
    });

    // Etiquetas: crear y asociar.
    for (const tagName of input.tags ?? []) {
      const tag = await this.prisma.tag.upsert({
        where: { orgId_name: { orgId, name: tagName } },
        create: { orgId, name: tagName },
        update: {},
      });
      const added = await this.prisma.contactTag
        .create({ data: { contactId: contact.id, tagId: tag.id } })
        .then(() => true)
        .catch(() => false);
      if (added && !opts.silent) this.events.emit("contact.tagged", { orgId, contactId: contact.id, tag: tag.name });
    }

    const announce = (): void => {
      this.events.emit("lead.created", {
        orgId,
        contactId: contact.id,
        created: !existing,
        via: opts.via ?? (viaApiKey ? "api" : "webhook"),
        formName: opts.formName ?? null,
        formId: opts.formId ?? null,
        silent: !!opts.silent,
      });
    };
    if (!opts.hold) announce();

    return { id: contact.id, created: !existing, ...(opts.hold ? { announce } : {}) };
  }

  // ── Helpers ──────────────────────────────────────────────────
  private async uniqueKey(base: string): Promise<string> {
    let key = base;
    let i = 1;
    while (await this.prisma.customField.findFirst({ where: { key } })) {
      key = `${base}_${i++}`;
    }
    return key;
  }

  private toFieldDto(f: {
    id: string;
    key: string;
    label: string;
    type: string;
    options: string[];
    order: number;
    entity?: string | null;
  }): CustomFieldDto {
    return {
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type as CustomFieldType,
      options: f.options,
      order: f.order,
      entity: (f.entity === "deal" ? "deal" : "contact") as FieldEntity,
    };
  }
}
