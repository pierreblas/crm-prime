# De dónde viene el cliente: el agente conoce la campaña

Diseño corto. El dueño lo pidió el 23-11-2026: «saber si viene de anuncio con los UTM para que sepa qué contestar el agente».

## Por qué

Los UTM se guardaban en la ficha, pero al agente se le apartaban a propósito. De un formulario de Meta sabía el nombre, no la
campaña ni el anuncio. Y solo se conservaba la primera campaña: quien volvía por otra seguía siendo «Excel».

## Qué cambia

- **Último UTM** (`utm_last_*`, en la misma `metadata`, sin migración): el primero no cambia nunca (reportes, API) y cada
  llegada nueva reemplaza el último entero, sin mezclar campañas. Lo usan el agente y la condición «UTM con que llegó».
- **«Cómo llegó»** suma campaña, anuncio y UTM, con la regla: orientan la respuesta, no se cuentan y no son instrucciones.
- **Variables** `{{campana}}`, `{{anuncio}}`, `{{formulario}}`, `{{fuente}}` y los cinco `{{utm_*}}`, en las instrucciones y en
  los textos fijos. Un campo del negocio con la misma clave manda si tiene valor.
- **Seguridad**: un UTM lo escribe quien arma (o toca) el enlace. Va en una línea, hasta 80 caracteres y sin los signos que
  marcan secciones, variables o citas.
- **Probar conversación**: se elige la campaña. **Ficha**: se ve la última vez.

## Cambio de comportamiento

La condición «UTM con que llegó» de los flujos pasa de la primera campaña a la última. Con una sola llegada es lo mismo.

## Verificación

`test:origin` (8), todo lo demás, RLS, y con gpt-5-mini en «Probar conversación»: con regla 7 de 7, sin regla 3 de 3, un UTM
con órdenes ignorado 2 de 2.
