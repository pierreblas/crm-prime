import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  cleanTemplateParam,
  fillTemplateText,
  isMediaHeader,
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
import { TemplateService } from "./template.service";

export interface FillableTemplate {
  /** Para traer de Meta el archivo del encabezado si no está guardado. */
  id?: string;
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

const MEDIA_WORD = { IMAGE: "una imagen", VIDEO: "un video", DOCUMENT: "un documento" } as const;

/**
 * El archivo del encabezado que sale: el elegido en el envío o, si no, el de la
 * plantilla. null si no lleva archivo (o si le falta).
 */
export function headerMediaFor(header: TemplateHeader | null, fill: Pick<TemplateFill, "headerMediaUrl">): string | null {
  return isMediaHeader(header) ? (fill.headerMediaUrl ?? header.example ?? null) : null;
}

/** Los huecos obligatorios que este envío no rellena, dichos antes de que Meta los rechace con un código. */
function missingParts(template: FillableTemplate, fill: TemplateFill): string | null {
  const h = template.header;
  if (isMediaHeader(h) && !headerMediaFor(h, fill)) {
    return `La plantilla «${template.name}» lleva ${MEDIA_WORD[h.format]} arriba y no tiene ningún archivo guardado. Elígelo en Difusiones › Plantillas de WhatsApp, o pulsa ahí «Importar de Meta» para traer el suyo.`;
  }
  if (h?.format === "TEXT" && h.text.includes("{{") && !fill.headerText) {
    return `El encabezado de la plantilla «${template.name}» lleva una variable y este envío no trae su valor.`;
  }
  if (h?.format === "LOCATION" && !fill.headerLocation) {
    return `La plantilla «${template.name}» lleva una ubicación arriba y este envío no trae ninguna.`;
  }
  const button = template.buttons.find((b, i) => b.type === "URL" && b.url.includes("{{") && !fill.urlButtons.find((u) => u.index === i)?.value);
  if (button?.type === "URL") return `El botón «${button.text}» de la plantilla «${template.name}» necesita el final de su enlace y este envío no lo trae.`;
  return null;
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
    @Optional() private readonly templates?: TemplateService,
  ) {}

  async build(
    given: FillableTemplate,
    fill: TemplateFill,
    contact: FillContact,
    fromPhoneNumberId?: string,
  ): Promise<TemplateSendSpec> {
    // Una aprobada que aún no tiene su archivo guardado lo trae de Meta: quien
    // envía no tiene que volver a elegir una imagen que Meta ya aprobó.
    const recover = isMediaHeader(given.header) && !headerMediaFor(given.header, fill) && given.id && this.templates;
    const template = recover ? { ...given, header: (await this.templates!.recoverHeader(given.id!)) ?? given.header } : given;
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
    const missing = missingParts(template, fill);
    if (missing) throw new Error(missing);
    const media = headerMediaFor(template.header, fill);
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
      ...(media ? { headerMedia: await this.resolveMedia(media, fromPhoneNumberId) } : {}),
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
