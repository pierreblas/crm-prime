import { Controller, Headers, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { ProductSourceService } from "./product-source.service";

/**
 * Lo que llama la tienda (o un Apps Script, un Zapier…) cuando cambia el
 * catálogo. Sin sesión: autentica el token de la URL, único por conexión, y la
 * firma de la tienda cuando la hay. Responde 200 enseguida; la lectura va a
 * la cola.
 */
@Controller("products/sources")
export class ProductSourceHooksController {
  constructor(private readonly sources: ProductSourceService) {}

  @Post("hook/:token")
  @HttpCode(200)
  async hook(
    @Param("token") token: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    await this.sources.receiveHook(token, headers, req.rawBody ?? Buffer.alloc(0));
    return { received: true };
  }
}
