import { Inject, Injectable } from "@nestjs/common";
import {
  cleanTemplateParam,
  fillTemplateText,
  namedTemplateVars,
  templateVarCount,
  type TemplateButton,
  type TemplateFill,
  type TemplateHeader,
  type VariableValue,
} from "@crm/shared";
import {
  STORAGE_PROVIDER,
  parseStorageRef,
  type StorageProvider,
} from "../../infra/storage/storage.provider";
import {
  WHATSAPP_PROVIDER,
  type MediaRef,
  type TemplateSendSpec,
  type WhatsAppProvider,
} from "../whatsapp/whatsapp-provider.interface";

export interface FillableTemplate {
  name: string;
  language: string;
  header: TemplateHeader | null;
  buttons: TemplateButton[];
  body: string;
}

export interface FillContact {
  name: string | null;
  phone: string;
}

/**
 * Prepara una plantilla para enviarla: resuelve los valores de cada hueco
 * (fijos o tomados del contacto) y deja el archivo del encabezado listo.
 */
@Injectable()
export class TemplateFillService {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly wa: WhatsAppProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async build(
    template: FillableTemplate,
    fill: TemplateFill,
    contact: FillContact,
    fromPhoneNumberId?: string,
  ): Promise<TemplateSendSpec> {
    const values = [...fill.body].sort((a, b) => a.index - b.index);
    // Meta rechaza el envío si la plantilla tiene más variables de las que
    // llegan: mejor decirlo claro que dejar que falle con un código.
    const names = namedTemplateVars(template.body);
    const expected = templateVarCount(template.body);
    if (values.length < expected) {
      throw new Error(
        `La plantilla tiene ${expected} variable${expected === 1 ? "" : "s"} y el envío trae ${values.length}. ` +
          "Sincroniza las plantillas con Meta y vuelve a elegir los valores.",
      );
    }
    const bodyParams = values.map((v) => cleanTemplateParam(resolveValue(v, contact), fallbackFor(v)));
    const headerName =
      template.header?.format === "TEXT" ? namedTemplateVars(template.header.text)[0] : undefined;

    return {
      name: template.name,
      language: template.language,
      header: template.header,
      buttons: template.buttons,
      bodyParams,
      ...(names.length ? { bodyParamNames: values.map((v) => names[v.index - 1] ?? "") } : {}),
      ...(fill.headerText
        ? {
            headerTextParam: cleanTemplateParam(resolveValue(fill.headerText, contact), fallbackFor(fill.headerText)),
            ...(headerName ? { headerParamName: headerName } : {}),
          }
        : {}),
      ...(fill.headerLocation ? { headerLocation: fill.headerLocation } : {}),
      ...(fill.headerMediaUrl
        ? {
            headerMedia: await this.resolveMedia(
              fill.headerMediaUrl,
              fromPhoneNumberId,
            ),
          }
        : {}),
      urlButtonParams: fill.urlButtons,
    };
  }

  /** Texto del cuerpo con los huecos ya sustituidos (para guardar y mostrar). */
  preview(body: string, spec: TemplateSendSpec): string {
    return fillTemplateText(body, spec.bodyParams, spec.bodyParamNames);
  }

  /**
   * Un archivo del CRM no es accesible desde internet, así que se sube a Meta
   * y se manda por media id. Una URL externa se pasa tal cual.
   */
  private async resolveMedia(
    mediaUrl: string,
    fromPhoneNumberId?: string,
  ): Promise<MediaRef> {
    const storageId = parseStorageRef(mediaUrl);
    if (!storageId) return { link: mediaUrl };

    const file = await this.storage.read(storageId);
    if (!file) {
      throw new Error("El archivo del encabezado ya no está disponible");
    }
    const id = await this.wa.uploadMedia(
      file.buffer,
      file.mimeType,
      storageId,
      fromPhoneNumberId,
    );
    return { id, filename: file.fileName ?? storageId };
  }
}

/**
 * Las campañas anteriores guardaban solo el array de variables del cuerpo.
 * Se leen igual que las nuevas, que guardan el relleno completo.
 */
export function normalizeFill(stored: unknown): TemplateFill {
  if (Array.isArray(stored)) {
    return { body: stored as VariableValue[], urlButtons: [] };
  }
  const fill = (stored ?? {}) as Partial<TemplateFill>;
  return {
    body: fill.body ?? [],
    urlButtons: fill.urlButtons ?? [],
    ...(fill.headerText ? { headerText: fill.headerText } : {}),
    ...(fill.headerMediaUrl ? { headerMediaUrl: fill.headerMediaUrl } : {}),
    ...(fill.headerLocation ? { headerLocation: fill.headerLocation } : {}),
  };
}

/**
 * Lo que va si el valor queda vacío (un contacto sin nombre): un parámetro
 * vacío hace que Meta rechace el mensaje entero.
 */
function fallbackFor(v: VariableValue): string {
  return v.source === "contact_name" ? "cliente" : "-";
}

function resolveValue(v: VariableValue, contact: FillContact): string {
  switch (v.source) {
    case "contact_name":
      return contact.name ?? "";
    case "contact_phone":
      return contact.phone;
    default:
      return v.value ?? "";
  }
}
