import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import {
  QUEUE_AI_REPLY,
  QUEUE_CAMPAIGN,
  QUEUE_FLOW,
  QUEUE_INBOUND,
  QUEUE_META_LEADS,
  QUEUE_META_MESSAGING,
  QUEUE_TIKTOK,
  QUEUE_OUTBOUND,
  QUEUE_PRODUCT_SYNC,
  QUEUE_WEBHOOK,
} from "./queue.constants";

/**
 * Configura la conexión a Redis y registra las colas de WhatsApp.
 * Reintentos con backoff exponencial por defecto en cada job.
 */
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    BullModule.registerQueue(
      {
        name: QUEUE_INBOUND,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      },
      {
        name: QUEUE_OUTBOUND,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      },
      {
        // Envío masivo de campañas (un job por destinatario, con throttling
        // en el worker para respetar los rate limits de Meta).
        name: QUEUE_CAMPAIGN,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 5000,
          removeOnFail: 10000,
        },
      },
      {
        // Reanudación de flujos tras un bloque "Esperar" (jobs retrasados).
        name: QUEUE_FLOW,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      },
      {
        // Leads de formularios de Meta: el webhook solo avisa, y el worker
        // descarga las respuestas y crea el contacto.
        name: QUEUE_META_LEADS,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      },
      {
        // Mensajes de Messenger e Instagram: el webhook los deja aquí y el
        // worker resuelve la página, descarga adjuntos y los mete en la bandeja.
        name: QUEUE_META_MESSAGING,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 3000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      },
      {
        // Mensajes directos de TikTok (webhook de la app): el worker resuelve la
        // cuenta, descarga imágenes y los mete en la bandeja.
        name: QUEUE_TIKTOK,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 3000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      },
      {
        // Respuesta del autopilot con unos segundos de espera (varios mensajes
        // seguidos → una sola respuesta). Un turno perdido no se reintenta
        // mucho: el siguiente mensaje del cliente trae el suyo.
        name: QUEUE_AI_REPLY,
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: "fixed", delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      },
      {
        // Lectura de un catálogo conectado. Es idempotente y puede tardar: no
        // se reintenta (la siguiente pasada programada lo vuelve a intentar) y
        // los terminados se limpian pronto para que el mismo id pueda volver.
        name: QUEUE_PRODUCT_SYNC,
        defaultJobOptions: {
          attempts: 1,
          // Terminados fuera al momento: el id (conexión + minuto) junta los avisos
          // repetidos solo mientras uno espera o corre, no después.
          removeOnComplete: true,
          removeOnFail: 500,
        },
      },
      {
        name: QUEUE_WEBHOOK,
        defaultJobOptions: {
          // Reintentos espaciados: el sistema del otro lado puede estar caído
          // un rato y no queremos martillearlo.
          attempts: 5,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
