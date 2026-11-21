# «Atiende» dice la verdad — plan

> Ejecución en la misma sesión (sin subagentes), con TDD.

**Objetivo:** que el selector «Atiende» y la lista de agentes digan quién contesta en WhatsApp, y que elegir «Todos los números sin agente propio» convierta al agente en principal.

**Spec:** `docs/superpowers/specs/2026-11-21-agente-principal-design.md`

## Restricciones

- Sin migración. La resolución de quién contesta (`resolveForConversation`) no cambia.
- Un solo principal por empresa (índice único parcial `agent_configs(orgId) WHERE isDefault`): primero se quita al anterior y después se pone al nuevo, en una transacción.
- Textos en español y sin jerga.

## Riesgos a vigilar

- Que la transacción choque con el índice único bajo RLS (rol restringido): lo cubre una prueba RLS.
- Que guardar el principal sin tocar «Atiende» mande `isDefault` y lo rompa: el editor solo envía `isDefault: true` cuando se elige «Todos los números» en un agente que no es el principal.
- Que el principal pueda quedarse sin «Todos los números» desde la API: `isDefault: false` sobre él → 400.

## Tarea 1 — API: hacer principal

- Esquemas: `isDefault: z.boolean().optional()` en `createBotSchema` y `updateBotSchema` (`packages/shared/src/schemas/agent-config.schema.ts`).
- `BotService.create` / `update`: con `isDefault: true`, transacción `updateMany({ isDefault: true, id ≠ este } → false)` + `update(este → true)`. Con `false` sobre el principal → `BadRequestException` («Para que deje de ser el agente principal, elige «Todos los números sin agente propio» en otro agente.»). `remove` del principal: mensaje con la misma salida.
- Pruebas (`apps/api/test/bot-principal.test.ts`, `npm run test:botprincipal -w @crm/api`):
  - hacer principal a otro agente lo quita del anterior y deja uno solo
  - crear un agente con `isDefault: true` lo deja de principal y quita al anterior
  - `isDefault: false` sobre el principal → 400 y sigue siendo principal
  - `isDefault: false` sobre otro agente → no cambia nada
  - guardar el principal con `isDefault: true` → sigue siendo el único
- Prueba RLS: cambiar el principal con el rol restringido deja uno por empresa y no toca la otra.

## Tarea 2 — Web: selector, lista y aviso

- `BotEditor`: el formulario guarda `makeDefault`. Valor del selector: el número, `__all` (principal o a punto de serlo) o `""` (ningún número). Opciones: «Todos los números sin agente propio» (en uno que no es principal: «… (pasa a ser el principal)»), cada número y «Ningún número (solo embudos y pruebas)» (no para el principal). Aviso según el caso, con el nombre del principal (prop `principalName` desde `BotsManager`).
- `BotsManager`: insignia «Todos los números» solo para el principal sin número; «Sin número» para los demás sin número.
- Copiloto del administrador: `numero` = «sin número (no contesta en WhatsApp…)» para uno que no es principal.
- Documentación: `apps/web/content/docs/agentes.md`, el párrafo de «Atiende».
- Verificación en el navegador (1440 y 390 px): cambiar el principal desde el selector, aviso de «Ningún número», insignias de la lista.
