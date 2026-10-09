import { Prisma } from "@prisma/client";
import { currentOrgId, isUnscoped, tenancyMode } from "./tenant.context";

/**
 * Las 27 tablas que llevan `orgId`. El resto lo hereda por su padre y queda
 * cubierto por la clave foránea (y, en la capa 2, por RLS).
 */
const TENANT_MODELS = new Set<string>([
  "User",
  "Contact",
  "Call",
  "CustomField",
  "Product",
  "Source",
  "Tag",
  "Conversation",
  "Message",
  "Template",
  "Pipeline",
  "PipelineStage",
  "Deal",
  "KnowledgeDoc",
  "WhatsappConnection",
  "ApiKey",
  "WebhookSubscription",
  "AiSetting",
  "IntegrationSetting",
  "AgentConfig",
  "Flow",
  "StageAutomation",
  "StageAutomationRun",
  "MetaPage",
  "QuickReply",
  "ProductPrice",
  "OnboardingState",
  "KnowledgeSuggestion",
  "AiUsage",
  "ProductField",
]);

/**
 * Operaciones a las que se les añade `where: { orgId }`.
 *
 * `findUnique`, `update`, `delete` y `upsert` también entran: desde Prisma 5 el
 * `where` de una operación única admite filtros adicionales, así que pedir un
 * id de otra empresa devuelve null en vez del registro. Eso convierte un
 * "GET /contactos/:id" con un id adivinado en un 404 y no en una fuga.
 */
const SCOPED: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

/**
 * Capa 1 del aislamiento: inyecta el filtro por organización en toda consulta.
 *
 * Un desarrollador que olvide filtrar sigue filtrando. No sustituye a RLS
 * (capa 2): esto no alcanza a `$queryRaw` ni a las relaciones anidadas, y por
 * eso la base tiene la última palabra.
 *
 * Las escrituras (`create`, `createMany`) **no** se tocan a propósito: el
 * `orgId` es obligatorio en el esquema, así que el compilador ya obliga a
 * ponerlo en cada sitio. Inyectarlo aquí lo volvería opcional y el día que el
 * contexto faltara la fila se escribiría igual, sin dueño correcto.
 */
export const tenantScopeExtension = Prisma.defineExtension({
  name: "tenant-scope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model) || !SCOPED.has(operation)) {
          return query(args);
        }
        if (isUnscoped()) return query(args);

        const orgId = currentOrgId();
        if (!orgId) {
          if (tenancyMode === "multi") {
            // En SaaS, seguir sin filtro sería servir datos de cualquiera.
            throw new Error(
              `Consulta a ${model}.${operation} sin organización en contexto. ` +
                "Si es deliberado, envuélvela en runUnscoped().",
            );
          }
          // Modo de una sola empresa: no hay nada de lo que aislarse.
          return query(args);
        }

        const a = args as { where?: Record<string, unknown> };
        a.where = { ...(a.where ?? {}), orgId };
        return query(args);
      },
    },
  },
});
