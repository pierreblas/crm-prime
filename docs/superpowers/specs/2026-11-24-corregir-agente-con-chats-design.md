# Corregir al agente con los chats revisados

Aprobado el 24-11-2026.

## Qué y por qué

La revisión de chats marca qué salió mal en conversaciones reales, pero para
corregir hay que ir a «Mejorar», que simula clientes y propone cambios a partir
de esas simulaciones. El dueño quiere corregir al agente **de acuerdo a cada
conversación que analizó** y poder decirle con sus palabras qué debió hacer.

## Qué hace

- Botón **Corregir al agente** en cada chat revisado, con un texto opcional
  («¿Qué debió hacer?»). En un chat que salió bien, el texto es obligatorio.
- Se pueden marcar hasta 8 chats del mismo agente: sale un solo cambio.
- Repite el **momento exacto** del chat real: con las instrucciones de hoy y con
  las corregidas, y enseña lo que respondió, lo que respondería hoy y lo que
  respondería con el cambio.
- Dice cuándo no hace falta («hoy ya respondería bien») y cuándo no es de las
  instrucciones («falta este dato en el catálogo»).
- **Nada cambia sin «Aplicar»**; la versión anterior queda guardada.
- Al aplicar: los chats quedan vistos y su situación se guarda como caso de
  prueba (sin datos personales).
- Antes de aplicar ofrece medir con los casos marcados del agente (opcional).

## No hace

- No corrige solo (ni de noche ni al revisar).
- No cambia mensajes ya enviados.
- No añade datos del negocio que no estén en las instrucciones o en lo que
  escribió el dueño.

## Caminos

1. **Repetir el momento real** (elegido): fiel al chat y barato, unos 35 mil
   tokens por chat.
2. Llevar el chat a un caso y simularlo antes y después: unos 150 mil por chat y
   no es el chat real. Queda como comprobación opcional.
3. Corregir solo cada noche: descartado, un mal cambio costaría ventas sin que
   nadie se entere.

## Piezas

- `packages/shared/src/schemas/agent-correction.schema.ts`
- `apps/api/src/modules/ai/agent-correction.{logic,service,controller}.ts`,
  tablas `agent_corrections` y `agent_correction_chats` (con aislamiento).
- `AgentImproveService.start` admite una propuesta ya hecha, para medirla.
- `apps/web/src/features/bots/CorrectAgent.tsx` y `ChatReviewPanel.tsx`.

Lo demás (forma de los avisos, textos, orden interno) queda a criterio de quien
construye.
