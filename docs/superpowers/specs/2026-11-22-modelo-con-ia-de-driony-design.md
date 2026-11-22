# «Modelo y gasto» con la IA de Driony: no se elige lo que no se aplica

Diseño corto, aprobado por el dueño el 22-11-2026 (opción «A»).

## Por qué

Una empresa sin clave propia responde con la IA de Driony: el modelo lo fija la
plataforma (`AI_INCLUDED_MODEL`, hoy `gpt-5-mini`) y el esfuerzo es siempre
«Rápido» (`openai-llm.provider.ts`: con `included`, `cfg.model` y `"low"`). En
el editor del agente, «Modelo y gasto» ya lo avisaba, pero las tarjetas de
modelo y «Cuánto piensa» se podían pulsar: parecía que se elegía algo que no
se aplica.

## Qué cambia (solo web)

- Con la IA de Driony, las tarjetas de modelo y las opciones de «Cuánto piensa» salen **desactivadas**. Se sigue viendo lo guardado, que se usará cuando la empresa conecte su clave.
- El aviso dice con qué responde («Responde con gpt-5-mini, el modelo de la IA de Driony…, siempre en «Rápido»») y lleva un botón **Conectar mi clave** a Ajustes › Inteligencia Artificial.
- El subtítulo de «Qué IA usa» lo dice: con la IA de Driony no se elige.
- Con clave propia, todo sigue igual.

## Enfoques descartados

- B, elegir entre varios modelos dentro de la IA de Driony: cambia cómo se cuenta el cupo y afecta al margen.
- C, elegir el modelo de la IA de Driony desde la consola: puede hacerse aparte.

## Verificación

No hay pruebas de componentes en la web. Se comprueba en el navegador, simulando el estado «IA de Driony» con la respuesta de `/api/bff/ai/status` interceptada, y con clave propia, a 1440 y 390 px.
