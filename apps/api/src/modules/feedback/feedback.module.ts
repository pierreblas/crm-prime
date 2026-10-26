import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { createFeedbackSchema, type AccessTokenClaims, type CreateFeedbackInput, type FeedbackCreated } from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";

/** Envíos por persona y hora: de sobra para contar algo, corto para no inundar la consola. */
const MAX_PER_HOUR = 15;

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async create(userId: string, input: CreateFeedbackInput, userAgent: string | null): Promise<FeedbackCreated> {
    const recent = await this.prisma.feedback.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= MAX_PER_HOUR) {
      throw new HttpException("Ya nos enviaste muchos mensajes en la última hora. Gracias: vuelve a intentarlo un poco más tarde.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const row = await this.prisma.feedback.create({
      data: {
        orgId: this.tenant.orgId(),
        userId,
        kind: input.kind,
        message: input.message,
        rating: input.kind === "opinion" ? input.rating : null,
        pagePath: input.pagePath,
        userAgent: userAgent?.slice(0, 300) ?? null,
      },
      select: { id: true },
    });
    return { id: row.id };
  }
}

@Controller("feedback")
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** Cualquier persona del equipo puede escribirnos. */
  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createFeedbackSchema)) body: CreateFeedbackInput,
    @Req() req: Request,
  ): Promise<FeedbackCreated> {
    return this.feedback.create(user.sub, body, req.headers["user-agent"] ?? null);
  }
}

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
