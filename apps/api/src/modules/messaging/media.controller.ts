import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import {
  STORAGE_PROVIDER,
  toStorageRef,
  type StorageProvider,
} from "../../infra/storage/storage.provider";
import { i18n } from "../../i18n/i18n";

// Lo que WhatsApp acepta como imagen, video, audio o documento, acotado a lo
// razonable. Límites de Meta: imagen 5 MB; video y audio 16 MB.
const MAX_BYTES = 16 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/3gpp"];
const AUDIO_TYPES = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg", "audio/opus"];
const DOC_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];

interface UploadedMedia {
  /** Referencia interna ("storage://…") que se manda luego en sendMessage. */
  mediaUrl: string;
  /** URL para previsualizarlo en el CRM. */
  previewUrl: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
  mimeType: string;
  size: number;
  fileName: string;
}

/**
 * Subida y descarga de medios del inbox.
 *
 * El fichero se guarda en nuestro almacenamiento y se envía a WhatsApp
 * subiéndolo a Meta en el momento del envío (por media id), no por URL
 * pública: así no hace falta exponer nada a internet.
 */
@Controller("media")
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES } }))
  async upload(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UploadedMedia> {
    if (!file) throw new BadRequestException("No se recibió ningún archivo");

    const mimeType = file.mimetype;
    const kind = IMAGE_TYPES.includes(mimeType)
      ? "IMAGE"
      : VIDEO_TYPES.includes(mimeType)
        ? "VIDEO"
        : AUDIO_TYPES.includes(mimeType)
          ? "AUDIO"
          : DOC_TYPES.includes(mimeType)
            ? "DOCUMENT"
            : null;
    if (!kind) {
      throw new BadRequestException(
        i18n("media.unsupportedType", { mimeType }),
      );
    }
    if (kind === "IMAGE" && file.size > 5 * 1024 * 1024) {
      throw new BadRequestException("La imagen pasa de 5 MB, el máximo de WhatsApp");
    }

    const stored = await this.storage.save(
      file.buffer,
      mimeType,
      file.originalname,
    );
    return {
      mediaUrl: toStorageRef(stored.id),
      previewUrl: `/api/v1/media/${stored.id}`,
      kind,
      mimeType,
      size: stored.size,
      fileName: file.originalname,
    };
  }

  // Sirve el fichero con autenticación: nunca como estático público.
  @Get(":id")
  async serve(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const file = await this.storage.read(id);
    if (!file) throw new NotFoundException("Archivo no encontrado");
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.size));
    // Inmutable: el id es único por fichero, nunca se reescribe.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.end(file.buffer);
  }
}
