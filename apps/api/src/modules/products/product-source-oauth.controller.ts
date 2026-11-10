import { Body, Controller, Get, HttpCode, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { MercadoLibreConnectService } from "./mercadolibre-connect.service";

/**
 * Lo que llama Mercado Libre: la vuelta de la autorización (el navegador del
 * administrador, con nuestro pase en `state`) y las notificaciones de la app.
 * Sin sesión por necesidad; lo que autentica es el pase, y en los avisos la
 * app y el vendedor conocidos (los datos se releen siempre con el token).
 */
@Controller("products/sources/mercadolibre")
export class ProductSourceOAuthController {
  constructor(private readonly ml: MercadoLibreConnectService) {}

  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const url = await this.ml.complete({ code, state, error, errorDescription });
      res.redirect(302, url);
    } catch (e) {
      // Sin pase válido no se sabe ni de qué empresa es: se explica aquí mismo.
      res
        .status(400)
        .type("text/plain")
        .send(`No se pudo completar la conexión con Mercado Libre: ${(e as Error).message}. Vuelve a Productos › Tiendas e inténtalo de nuevo.`);
    }
  }

  /** Mercado Libre exige el 200 en menos de 500 ms: se responde ya y la relectura va a la cola. */
  @Post("notifications")
  @HttpCode(200)
  notifications(@Body() body: unknown): { received: true } {
    this.ml.notify(body);
    return { received: true };
  }
}
