import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { resolveFieldKeys, type ImportContactsInput, type ImportContactsResult } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { PlansService } from "../plans/plans.service";

const CHUNK = 500;

/**
 * Importación de contactos desde un archivo (leído en el navegador: aquí
 * llegan filas ya validadas). Crea los campos nuevos, completa o salta los
 * contactos que ya existen y respeta el límite de contactos del plan.
 *
 * No dispara los flujos de «lead nuevo»: importar una base antigua no debe
 * escribir a cientos de personas de golpe. Para eso están las difusiones.
 */
@Injectable()
export class ContactImportService {
  private readonly logger = new Logger("Importación");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly plans: PlansService,
  ) {}

  async import(input: ImportContactsInput): Promise<ImportContactsResult> {
    const orgId = this.tenant.orgId();
    const result: ImportContactsResult = { created: 0, updated: 0, skipped: 0, fieldsCreated: 0, errors: [] };

    // ── Campos nuevos (si la clave ya existe, se reutiliza) ──
    const existingFields = await this.prisma.customField.findMany({ select: { key: true, label: true } });
    const have = new Set(existingFields.map((f) => f.key));
    let order = existingFields.length;
    for (const f of input.newFields) {
      if (have.has(f.key)) continue;
      await this.prisma.customField.create({ data: { orgId, key: f.key, label: f.label, type: f.type, options: [], order: order++ } });
      have.add(f.key);
      result.fieldsCreated++;
    }
    const defs = await this.prisma.customField.findMany({ select: { key: true, label: true } });

    // ── Teléfonos repetidos en el propio archivo: vale el primero ──
    const seen = new Set<string>();
    const rows = input.rows.filter((r) => {
      if (seen.has(r.phone)) {
        result.skipped++;
        result.errors.push({ row: r.line, message: `El teléfono ${r.phone} está repetido en el archivo` });
        return false;
      }
      seen.add(r.phone);
      return true;
    });

    const existing = new Map<string, { id: string; metadata: unknown; sourceId: string | null }>();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const found = await this.prisma.contact.findMany({
        where: { phone: { in: rows.slice(i, i + CHUNK).map((r) => r.phone) } },
        select: { id: true, phone: true, metadata: true, sourceId: true },
      });
      for (const c of found) existing.set(c.phone, c);
    }

    // ── Límite del plan: solo cuentan los contactos nuevos ──
    const plan = await this.plans.current();
    const limit = plan.limits.contacts;
    let room = limit === null ? Infinity : Math.max(0, limit - (await this.plans.usage()).contacts);

    // ── Fuentes y etiquetas: se crean si no existen ──
    const sourceIds = new Map<string, string>();
    for (const name of new Set(rows.map((r) => r.source).filter((s): s is string => !!s))) {
      const s = await this.prisma.source.upsert({ where: { orgId_name: { orgId, name } }, create: { orgId, name }, update: {} });
      sourceIds.set(name, s.id);
    }
    const tagIds = new Map<string, string>();
    for (const name of new Set(rows.flatMap((r) => r.tags))) {
      const t = await this.prisma.tag.upsert({ where: { orgId_name: { orgId, name } }, create: { orgId, name }, update: {} });
      tagIds.set(name, t.id);
    }

    // ── Nuevos: en bloque ──
    const toCreate: Prisma.ContactCreateManyInput[] = [];
    const tagsByPhone = new Map<string, string[]>();
    for (const r of rows) {
      if (existing.has(r.phone)) continue;
      if (room <= 0) {
        result.skipped++;
        result.errors.push({ row: r.line, message: `Límite de contactos del plan ${plan.name} alcanzado` });
        continue;
      }
      room--;
      toCreate.push({
        orgId,
        phone: r.phone,
        name: r.name,
        optIn: input.optIn,
        sourceId: r.source ? sourceIds.get(r.source) : undefined,
        metadata: resolveFieldKeys(r.fields, defs) as Prisma.InputJsonObject,
        origin: "import",
        originDetail: input.fileName,
      });
      if (r.tags.length) tagsByPhone.set(r.phone, r.tags);
    }
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const batch = toCreate.slice(i, i + CHUNK);
      const { count } = await this.prisma.contact.createMany({ data: batch, skipDuplicates: true });
      result.created += count;
    }
    if (tagsByPhone.size) {
      const phones = [...tagsByPhone.keys()];
      for (let i = 0; i < phones.length; i += CHUNK) {
        const created = await this.prisma.contact.findMany({ where: { phone: { in: phones.slice(i, i + CHUNK) } }, select: { id: true, phone: true } });
        const links = created.flatMap((c) => (tagsByPhone.get(c.phone) ?? []).map((t) => ({ contactId: c.id, tagId: tagIds.get(t)! })));
        if (links.length) await this.prisma.contactTag.createMany({ data: links, skipDuplicates: true });
      }
    }

    // ── Existentes: se completan (o se saltan) ──
    for (const r of rows) {
      const c = existing.get(r.phone);
      if (!c) continue;
      if (!input.updateExisting) {
        result.skipped++;
        continue;
      }
      try {
        const meta = c.metadata && typeof c.metadata === "object" ? (c.metadata as Record<string, unknown>) : {};
        await this.prisma.contact.update({
          where: { id: c.id },
          data: {
            ...(r.name ? { name: r.name } : {}),
            // La fuente original se respeta: solo se pone si no tenía.
            ...(r.source && !c.sourceId ? { sourceId: sourceIds.get(r.source) } : {}),
            // El consentimiento de los que ya existían no se toca.
            metadata: { ...meta, ...resolveFieldKeys(r.fields, defs) } as Prisma.InputJsonObject,
          },
        });
        if (r.tags.length) {
          await this.prisma.contactTag.createMany({ data: r.tags.map((t) => ({ contactId: c.id, tagId: tagIds.get(t)! })), skipDuplicates: true });
        }
        result.updated++;
      } catch (e) {
        result.skipped++;
        result.errors.push({ row: r.line, message: (e as Error).message.slice(0, 160) });
      }
    }

    this.logger.log(`Importación ${input.fileName ?? ""}: ${result.created} nuevos, ${result.updated} actualizados, ${result.skipped} saltados`);
    return result;
  }
}
