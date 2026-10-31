import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
  TemplateButton,
  TemplateCategory,
  TemplateHeader,
  TemplateStatusValue,
  TemplateVariable,
} from "@crm/shared";
import { IntegrationSettingsService } from "../integrations/integration-settings.service";
import { WhatsappConnectionService } from "../whatsapp/whatsapp-connection.service";
import { i18n } from "../../i18n/i18n";

// Gestión de plantillas en Meta (Business Management API):
//   POST   /{waba-id}/message_templates   crear
//   GET    /{waba-id}/message_templates   listar
//   DELETE /{waba-id}/message_templates   borrar (por nombre)
// El estado real (aprobada/rechazada) lo decide Meta y llega por webhook.

export interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown> | string;
  buttons?: Record<string, unknown>[];
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  category?: string;
  status?: string;
  rejected_reason?: string;
  components?: MetaTemplateComponent[];
}

export interface TemplateDefinition {
  name: string;
  language: string;
  category: TemplateCategory;
  header: TemplateHeader | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  variables: TemplateVariable[];
}

@Injectable()
export class MetaTemplateClient {
  private readonly logger = new Logger("MetaTemplates");

  constructor(
    private readonly connection: WhatsappConnectionService,
    private readonly settings: IntegrationSettingsService,
  ) {}

  /** true si hay una cuenta de WhatsApp Business conectada para gestionar plantillas. */
  async isAvailable(): Promise<boolean> {
    return (await this.connection.resolveWabaCreds()) !== null;
  }

  // ── Componentes que entiende Meta ──────────────────────────
  buildComponents(def: TemplateDefinition, headerHandle?: string): MetaTemplateComponent[] {
    const components: MetaTemplateComponent[] = [];

    if (def.header) {
      if (def.header.format === "TEXT") {
        const vars = countVariables(def.header.text);
        components.push({
          type: "HEADER",
          format: "TEXT",
          text: def.header.text,
          ...(vars > 0
            ? { example: { header_text: [def.header.example ?? "ejemplo"] } }
            : {}),
        });
      } else if (def.header.format === "LOCATION") {
        components.push({ type: "HEADER", format: "LOCATION" });
      } else if (headerHandle) {
        // IMAGE / VIDEO / DOCUMENT: Meta exige un archivo de ejemplo subido.
        components.push({
          type: "HEADER",
          format: def.header.format,
          example: { header_handle: [headerHandle] },
        });
      }
    }

    const bodyVars = countVariables(def.body);
    components.push({
      type: "BODY",
      text: def.body,
      ...(bodyVars > 0
        ? {
            example: {
              body_text: [
                Array.from(
                  { length: bodyVars },
                  (_, i) =>
                    def.variables.find((v) => v.index === i + 1)?.label || "ejemplo",
                ),
              ],
            },
          }
        : {}),
    });

    if (def.footer) components.push({ type: "FOOTER", text: def.footer });

    if (def.buttons.length) {
      components.push({
        type: "BUTTONS",
        buttons: def.buttons.map((b) => {
          switch (b.type) {
            case "QUICK_REPLY":
              return { type: "QUICK_REPLY", text: b.text };
            case "URL":
              return {
                type: "URL",
                text: b.text,
                url: b.url,
                ...(countVariables(b.url) > 0
                  ? { example: [b.example ?? "ejemplo"] }
                  : {}),
              };
            case "PHONE_NUMBER":
              return {
                type: "PHONE_NUMBER",
                text: b.text,
                phone_number: b.phoneNumber,
              };
            case "COPY_CODE":
              return { type: "COPY_CODE", example: b.example };
          }
        }),
      });
    }

    return components;
  }

  // ── Operaciones contra Meta ────────────────────────────────
  async create(
    def: TemplateDefinition,
    headerHandle?: string,
  ): Promise<{ id: string; status: TemplateStatusValue }> {
    const creds = await this.requireWaba();
    const res = await fetch(
      `https://graph.facebook.com/${creds.version}/${creds.wabaId}/message_templates`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: def.name,
          language: def.language,
          category: def.category,
          parameter_format: "POSITIONAL",
          components: this.buildComponents(def, headerHandle),
        }),
      },
    );
    const data = (await res.json()) as {
      id?: string;
      status?: string;
      error?: { message?: string; error_user_msg?: string };
    };
    if (!res.ok || !data.id) {
      const msg =
        data.error?.error_user_msg ?? data.error?.message ?? `HTTP ${res.status}`;
      this.logger.error(`Crear plantilla falló: ${msg}`);
      throw new BadRequestException(i18n("template.metaRejected", { reason: msg }));
    }
    return { id: data.id, status: normalizeStatus(data.status) };
  }

  async list(): Promise<MetaTemplate[]> {
    const creds = await this.requireWaba();
    const templates: MetaTemplate[] = [];
    let url =
      `https://graph.facebook.com/${creds.version}/${creds.wabaId}/message_templates` +
      `?fields=id,name,language,category,status,components,rejected_reason,parameter_format&limit=100`;

    // Paginación por cursor: una cuenta puede tener cientos de plantillas.
    for (let page = 0; page < 20 && url; page++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      const data = (await res.json()) as {
        data?: MetaTemplate[];
        paging?: { next?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new BadRequestException(
          i18n("template.listFailed", { reason: data.error?.message ?? res.status }),
        );
      }
      templates.push(...(data.data ?? []));
      url = data.paging?.next ?? "";
    }
    return templates;
  }

  async remove(name: string, waTemplateId: string | null): Promise<void> {
    const creds = await this.requireWaba();
    const qs = new URLSearchParams({ name });
    if (waTemplateId) qs.set("hsm_id", waTemplateId);
    const res = await fetch(
      `https://graph.facebook.com/${creds.version}/${creds.wabaId}/message_templates?${qs}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${creds.token}` } },
    );
    if (!res.ok) {
      const body = await res.text();
      // Que ya no exista en Meta no debe impedir borrarla en el CRM.
      this.logger.warn(`Borrar plantilla en Meta falló: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Sube el archivo de ejemplo del encabezado (Resumable Upload API) y
   * devuelve el "handle" que Meta pide al crear la plantilla.
   */
  async uploadHeaderExample(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    // La app que emitió el token del número: la propia de la empresa si la
    // tiene, si no la de la plataforma. El handle que devuelve Meta solo vale
    // con un token de esa misma app.
    const { appId, appSecret, graphVersion } = await this.settings.whatsappAppForOrg();
    if (!appId || !appSecret) {
      throw new BadRequestException(
        "Faltan el App ID o el App secret de Meta (Ajustes › Integraciones) para subir el archivo de ejemplo.",
      );
    }
    const appToken = `${appId}|${appSecret}`;

    const startUrl =
      `https://graph.facebook.com/${graphVersion}/${appId}/uploads` +
      `?file_name=${encodeURIComponent(fileName)}&file_length=${buffer.length}` +
      `&file_type=${encodeURIComponent(mimeType)}&access_token=${encodeURIComponent(appToken)}`;
    const startRes = await fetch(startUrl, { method: "POST" });
    const started = (await startRes.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!startRes.ok || !started.id) {
      throw new BadRequestException(
        i18n("meta.uploadStartFailed", { reason: started.error?.message ?? startRes.status }),
      );
    }

    const uploadRes = await fetch(
      `https://graph.facebook.com/${graphVersion}/${started.id}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${appToken}`,
          file_offset: "0",
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(buffer),
      },
    );
    const uploaded = (await uploadRes.json()) as {
      h?: string;
      error?: { message?: string };
    };
    if (!uploadRes.ok || !uploaded.h) {
      throw new BadRequestException(
        i18n("meta.uploadFailed", { reason: uploaded.error?.message ?? uploadRes.status }),
      );
    }
    return uploaded.h;
  }

  private async requireWaba() {
    const creds = await this.connection.resolveWabaCreds();
    if (!creds) {
      throw new BadRequestException(
        "No hay una cuenta de WhatsApp Business conectada. Conecta un número en Ajustes › WhatsApp.",
      );
    }
    return creds;
  }
}

/** Cuenta los huecos {{1}}, {{2}}… de un texto. */
export function countVariables(text: string): number {
  const indexes = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

export function normalizeStatus(status?: string): TemplateStatusValue {
  const value = (status ?? "PENDING").toUpperCase();
  const known: TemplateStatusValue[] = [
    "PENDING",
    "APPROVED",
    "REJECTED",
    "PAUSED",
    "DISABLED",
    "IN_APPEAL",
    "PENDING_DELETION",
  ];
  return known.includes(value as TemplateStatusValue)
    ? (value as TemplateStatusValue)
    : "PENDING";
}
