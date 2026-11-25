import type { CustomFieldDto } from "@crm/shared";

/** Los campos de la persona: los que van en fichas de contacto, importaciones, flujos y correos. */
export const contactFieldsOnly = (fields: CustomFieldDto[]): CustomFieldDto[] => fields.filter((f) => f.entity !== "deal");

/** Los campos del lead (la oportunidad): lo que respondió en un formulario sobre ese interés. */
export const leadFieldsOnly = (fields: CustomFieldDto[]): CustomFieldDto[] => fields.filter((f) => f.entity === "deal");
