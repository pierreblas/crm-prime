import { MessageType } from "@crm/shared";
import type { Translator } from "@/i18n/translate";

/**
 * Qué mostrar de un mensaje sin texto, sin nota y sin el archivo a la vista: su
 * tipo con palabras. Un texto vacío es de antes de leer todos los formatos de
 * WhatsApp: lo que traía no se guardó, y hay que mirarlo en el celular.
 */
export function emptyMessageLabel(type: MessageType, t: Translator): string {
  switch (type) {
    case MessageType.TEXT:
      return t("inbox.noContent");
    case MessageType.IMAGE:
      return t("inbox.previewImage");
    case MessageType.VIDEO:
      return t("inbox.previewVideo");
    case MessageType.AUDIO:
      return t("inbox.previewAudio");
    case MessageType.DOCUMENT:
      return t("inbox.previewDocument");
    case MessageType.LOCATION:
      return t("inbox.previewLocation");
    case MessageType.STICKER:
      return t("inbox.previewSticker");
    default:
      return t("inbox.previewOther");
  }
}
