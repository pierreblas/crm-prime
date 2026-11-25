import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { I18nExceptionFilter } from "./common/filters/i18n-exception.filter";
import { PublicApiModule } from "./modules/public-api/public-api.module";
import { corsOrigin } from "./common/utils/cors-origin";
import { GLOBAL_PREFIX, GLOBAL_PREFIX_OPTIONS } from "./common/global-prefix";

async function bootstrap() {
  // rawBody: true expone req.rawBody para validar la firma del webhook de Meta.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Un correo HTML llega a 100.000 caracteres: no cabe en los 100 KB que trae
  // el servidor por defecto. Se sigue leyendo el cuerpo en bruto (rawBody).
  app.useBodyParser("json", { limit: "512kb" });

  // Versionado de API: todo cuelga de /api/v1, salvo la API pública
  // (/api/public/v1), que lleva su propia versión. Ver common/global-prefix.ts.
  app.setGlobalPrefix(GLOBAL_PREFIX, GLOBAL_PREFIX_OPTIONS);

  // Traduce los mensajes de error según el idioma del cliente.
  app.useGlobalFilters(new I18nExceptionFilter());

  // CORS para la app móvil (la web pasa por su propio BFF en Next).
  app.enableCors({
    origin: corsOrigin(),
    credentials: true,
  });

  // Documentación interactiva SOLO de la API pública: lo interno cambia con
  // el producto y no es un contrato con nadie de fuera.
  const doc = new DocumentBuilder()
    .setTitle("Driony · API pública")
    .setDescription(
      "API para integrar sistemas externos (n8n, Zapier, un ERP) con el CRM. " +
        "Autentícate con una clave creada en **Ajustes › Claves de API** y " +
        "envíala como `Authorization: Bearer crm_…`. Cada endpoint exige un " +
        "ámbito concreto; si a la clave le falta, responde 403 diciendo cuál.",
    )
    .setVersion("1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", description: "Clave de API (crm_…)" },
      "apiKey",
    )
    .build();
  const document = SwaggerModule.createDocument(app, doc, {
    include: [PublicApiModule],
  });
  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "Driony · API",
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  Logger.log(`API escuchando en http://localhost:${port}/api/v1`, "Bootstrap");
  Logger.log(`Documentación de la API pública en http://localhost:${port}/api/docs`, "Bootstrap");
}

void bootstrap();
