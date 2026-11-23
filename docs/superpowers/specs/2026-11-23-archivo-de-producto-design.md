# Archivo de producto: la IA envía el brochure como archivo

Diseño corto, aprobado por el dueño el 23-11-2026 («sí, constrúyelo»).

## Por qué

Un cliente pide el brochure o el temario y hoy la IA solo puede mandar la **foto** del producto o escribir un **enlace**.
El PDF se manda a mano, con una respuesta rápida o con un flujo de archivo fijo.

## Qué cambia

1. **Campo «Archivo»** en Productos › Campos (`type: "file"`). Su valor es un archivo subido (`storage://<id>#nombre=…`) o un
   enlace `https://…`. La importación, las tiendas y la API solo admiten el enlace. Sin migración: los tipos son texto.
2. **Acción `send_product_file`** («Enviar archivos de productos»). `search_products` dice qué archivos tiene cada producto
   (`files: ["Brochure"]`), nunca su dirección. Parámetros: producto, archivo (si hay varios) y pie opcional. En Copiloto queda
   pendiente, como las demás.
3. **El nombre llega al cliente**: «Brochure Power BI.pdf». Se pega a la referencia (`#nombre=`) y WhatsApp lo recibe en
   `filename`. Arregla de paso los documentos del chat, las respuestas rápidas y los flujos, que salían sin nombre.
4. **Enlaces**: se comprueban al enviar (dirección pública, no es una página web, hasta 16 MB) y los de Google Drive, Google
   Docs y Dropbox se convierten a descarga directa. Si no se puede como archivo, o el canal no lo admite (Instagram, TikTok),
   va el enlace en texto y la IA lo sabe. Un archivo subido en un canal que no lo admite: la IA no promete nada y lo dice.
5. **Retención**: el borrado de adjuntos por plan no toca los archivos que siguen en uso en un producto, una respuesta rápida
   o un flujo (hoy borraba los de respuestas rápidas y flujos cuando vencía el mensaje que los envió).

## Enfoques descartados

- Enviar el enlace tal cual a Meta (`link`): Drive responde `application/octet-stream` y Meta lo rechaza después, sin aviso a tiempo.
- Guardar una copia en disco de cada enlace: llena el disco; se descarga al enviar y se sube a Meta.

## Verificación

Pruebas sin base (valor, nombre, enlaces, acción, esquema, retención, proveedor), con base local (RLS) y en el navegador
(crear el campo, subir, pegar enlace, verlo en la tarjeta, acción en el agente) a 1440 y 390 px. Sin envíos reales.
