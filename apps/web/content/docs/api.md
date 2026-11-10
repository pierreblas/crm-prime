# API pública

Con la API tu sistema **llama** al CRM para leer o escribir. Para que el CRM **te avise** de lo que pasa, usa los [webhooks salientes](/docs/webhooks). Normalmente se usan los dos.

La documentación interactiva de todos los endpoints, con «probar» desde el navegador, está en `https://api.driony.com/api/docs`.

## Conseguir una clave

**Ajustes › Claves de API → Nueva clave.** Elige solo los permisos que la integración necesite: una landing que crea leads no tiene por qué poder leer tu base de contactos entera.

| Ámbito | Permite |
|---|---|
| `leads:write` | Crear leads por el webhook de entrada |
| `contacts:read` | Listar y leer contactos |
| `contacts:write` | Crear y editar contactos |
| `deals:write` | Crear oportunidades y moverlas de etapa |
| `messages:send` | Enviar mensajes de WhatsApp |
| `analytics:read` | Consultar métricas agregadas |
| `products:read` | Listar y leer el catálogo |
| `products:write` | Crear, actualizar y cargar en bloque productos |

La clave se muestra **una sola vez**. Si la pierdes, crea otra y revoca la anterior; se guarda solo su hash.

```bash
curl https://tu-empresa.driony.com/api/public/v1/ping \
  -H "Authorization: Bearer crm_a1b2c3d4_…"
# { "ok": true, "key": "n8n-pedidos", "scopes": ["contacts:write"] }
```

`ping` comprueba clave y permisos sin escribir nada.

## La dirección de tu empresa

Base: **`https://tu-empresa.driony.com/api/public/v1`** (también responde `https://api.driony.com/api/public/v1`). Autenticación por `Authorization: Bearer crm_…` (también se acepta `x-api-key`).

**La clave decide de qué empresa son los datos**, nunca la dirección. Una clave creada en el panel de Acme solo alcanza los datos de Acme; usada contra la dirección de otra empresa responde `403`, para que un error de copia y pega no pase desapercibido.

La versión va en la ruta: cuando exista `v2`, `v1` seguirá funcionando.

## Contactos

```bash
# Listar, con filtros y paginación por cursor
curl "https://tu-empresa.driony.com/api/public/v1/contacts?limit=50&tag=interesado" \
  -H "Authorization: Bearer $CRM_KEY"
```

```json
{
  "data": [
    {
      "id": "cmu0…",
      "phone": "+51999888777",
      "name": "Ana",
      "tags": ["interesado"],
      "origin": "ad",
      "fields": { "pais": "Peru" },
      "utm": { "utm_source": "facebook", "utm_campaign": "verano2026" }
    }
  ],
  "nextCursor": "cmu0…",
  "hasMore": true
}
```

Para la página siguiente pasa `nextCursor` como `cursor`. Se usa cursor y no `offset` porque la lista crece por arriba: con offset se repiten o se saltan registros entre páginas.

```bash
# Crear
curl -X POST https://tu-empresa.driony.com/api/public/v1/contacts \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"phone":"51999888777","name":"Ana","tags":["erp"],"fields":{"pais":"Peru"}}'

# Actualizar (los campos se fusionan; `tags` reemplaza el juego entero)
curl -X PATCH https://tu-empresa.driony.com/api/public/v1/contacts/cmu0… \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Ana Pérez","fields":{"ciudad":"Lima"}}'
```

El teléfono se normaliza a E.164: da igual `51999888777`, `+51 999 888 777` o `0051999888777`.

### Campos personalizados

Cada campo tiene una **clave** fija (`ciudad`, `presupuesto`…) que ves y copias en **Contactos › Campos**. Úsala en `fields`: no cambia aunque renombres el campo, así que tu integración no se rompe.

- También se acepta el nombre visible del campo, escrito como sea: `"Ciudad"` o `"ciudad"` van al mismo sitio.
- Una clave que no es de ningún campo se guarda igual (en minúsculas y con `_`). Aparece en **Contactos › Campos › Datos que llegan sin campo**, desde donde la conviertes en campo con un clic.
- Para borrar un valor, envíalo vacío: `"fields": {"ciudad": ""}`.

### Importar desde Excel o CSV

En **Contactos › Importar**: el teléfono es obligatorio; nombre, etiquetas y fuente se reconocen por el título de la columna. El resto de columnas va a un campo existente, a un campo nuevo (con su clave a la vista antes de importar) o se ignora. Los números sin prefijo reciben el del país que elijas. Si el teléfono ya existe, el contacto se completa sin tocar su consentimiento. Los importados no disparan flujos de «lead nuevo»: para escribirles, usa una difusión.

## Oportunidades

```bash
# Crear (si el contacto no existe, se crea)
curl -X POST https://tu-empresa.driony.com/api/public/v1/deals \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"phone":"51999888777","title":"Pedido #4821","value":1250,"currency":"PEN"}'

# Mover de etapa, por NOMBRE
curl -X PATCH https://tu-empresa.driony.com/api/public/v1/deals/cmu0…/stage \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"stage":"Ganado"}'
```

Se trabaja con el **nombre** de la etapa, no con su id: tu sistema no tiene por qué conocer identificadores internos. Si el nombre no existe, el error te dice cuáles hay. Con varios embudos, se busca primero en el predeterminado.

## Mensajes

```bash
curl -X POST https://tu-empresa.driony.com/api/public/v1/messages \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"phone":"51999888777","text":"Tu pedido salió hoy 📦"}'
```

**Limitación de WhatsApp, no del CRM:** solo puedes escribir a quien te haya escrito en las últimas 24 h. Fuera de esa ventana hay que usar una plantilla aprobada (desde Difusiones). Si no hay conversación abierta, la API responde `400` explicándolo.

## Catálogo

Para que tu ERP, tu tienda o un n8n mantengan los productos que el agente de IA cotiza. La llave es el **SKU**: con él se actualiza en vez de duplicar.

```bash
# Listar (filtros: search, sku, active=true|false, updatedSince=ISO)
curl "https://tu-empresa.driony.com/api/public/v1/products?active=true&limit=100" \
  -H "Authorization: Bearer $CRM_KEY"

# Crear uno
curl -X POST https://tu-empresa.driony.com/api/public/v1/products \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"sku":"CAM-001","name":"Camiseta azul","price":59.9,"currency":"PEN",
       "prices":[{"currency":"USD","amount":16}],"imageUrl":"https://misitio.com/camiseta.jpg",
       "description":"Algodón 100%","fields":{"Talla":"M","Color":"Azul"}}'

# Actualizar (los campos se fusionan; un valor vacío borra el campo; `prices` reemplaza el juego entero)
curl -X PATCH https://tu-empresa.driony.com/api/public/v1/products/cmu0… \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"price":54.9,"fields":{"Color":""}}'
```

### Cargar el catálogo entero

```bash
curl -X PUT https://tu-empresa.driony.com/api/public/v1/products/bulk \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"deactivateMissing":true,"products":[
        {"sku":"CAM-001","name":"Camiseta azul","price":59.9,"currency":"PEN"},
        {"sku":"GOR-002","name":"Gorra negra","price":12,"currency":"USD"}]}'
# { "created": 1, "updated": 1, "deactivated": 3, "errors": [] }
```

- Hasta **500 productos por envío**; para más, varios envíos.
- Los productos que empuja una clave quedan ligados a una conexión **API · nombre-de-la-clave**, visible en **Productos › Tiendas**, igual que una tienda conectada.
- Con `deactivateMissing` los productos que esa misma clave cargó antes y no vienen en el envío quedan **inactivos** (no se borran). Así mandas el catálogo completo y Driony queda igual que tu sistema.
- Un SKU que ya existía se actualiza aunque sea de otra conexión; si viene de una tienda conectada, esa tienda lo volverá a pisar en su siguiente lectura.
- `fields` acepta la clave del campo (la ves y la copias en **Productos › Campos**) o su nombre visible (`"talla"` o `"Talla"`); una clave que no es de ningún campo se guarda igual y aparece cuando crees el campo.
- Tras cada carga en bloque se dispara el webhook saliente `catalog.synced`.

## Métricas

```bash
curl "https://tu-empresa.driony.com/api/public/v1/stats/summary?days=30" -H "Authorization: Bearer $CRM_KEY"
curl  https://tu-empresa.driony.com/api/public/v1/stats/funnel        -H "Authorization: Bearer $CRM_KEY"
curl  https://tu-empresa.driony.com/api/public/v1/stats/sellers       -H "Authorization: Bearer $CRM_KEY"
```

Pensados para alimentar un Metabase, un Looker o un panel propio.

## Recibir leads: el camino más corto

Si solo quieres meter leads desde una landing o un formulario, basta una clave con `leads:write`:

```bash
curl -X POST https://tu-empresa.driony.com/api/v1/webhooks/lead \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{"phone":"51999888777","name":"Ana","source":"Facebook Ads",
       "tags":["nuevo"],"fields":{"ciudad":"Lima"}}'
```

El nombre de la clave queda registrado como procedencia del contacto, así que sabes qué integración lo creó sin fiarte de lo que declare quien llama.

## Errores

Formato uniforme, con el motivo en el idioma de la petición (`Accept-Language`):

| Código | Qué pasó |
|---|---|
| `400` | Datos inválidos. `message` es una lista con el campo y el problema |
| `401` | Clave ausente, inválida o revocada |
| `403` | La clave no tiene el ámbito necesario (dice cuál falta), o se usó contra la dirección de otra empresa |
| `404` | El recurso no existe |

```json
{ "message": "La clave \"solo-metricas\" no tiene permiso para esto (falta: contacts:write)",
  "error": "Forbidden", "statusCode": 403 }
```
