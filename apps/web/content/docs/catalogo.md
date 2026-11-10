# Catálogo de productos

El catálogo es lo que el agente de IA consulta para cotizar, recomendar y enviar fotos: productos, servicios, talleres, lo que vendas. Puedes crearlos a mano, importarlos desde Excel o conectar tu tienda para que Driony los lea solo.

## Cada producto

- **Nombre, SKU, precio base y moneda.** El SKU es opcional, pero es lo que permite actualizar un producto al volver a importar en vez de duplicarlo.
- **Precios en otras monedas.** A cada cliente se le cotiza en la moneda de su país (por el prefijo de su teléfono); si no hay precio en esa moneda, se le da el base.
- **Imagen (URL).** El agente puede enviársela al cliente.
- **Descripción.** El agente la usa para responder: qué incluye, tallas, condiciones.
- **Campos propios.** Los datos que necesite tu negocio: talla, color, duración, modalidad, fecha, cupos. Se crean en Productos › Campos y cada uno dice si lo ve el agente y si se muestra en la tarjeta. Cada campo tiene una **clave** (`talla`, `fecha_de_inicio`…): Driony la propone a partir del nombre, puedes cambiarla al crear el campo y después es fija aunque lo renombres, para que ninguna integración se rompa. La ves y la copias en Productos › Campos, y es la que usan la [API](/docs/api) (`fields`), la importación por archivo y las tiendas conectadas.
- **Activo.** Los inactivos siguen en el catálogo, pero el agente no los ofrece.

## Importar desde Excel o CSV

En Productos › Importar sube un .xlsx o un CSV (por ejemplo, exportado de Google Sheets). El archivo se lee en tu navegador y verás una vista previa antes de importar nada.

- Se reconocen las columnas **nombre, sku, precio, moneda, descripción, imagen y activo**, en español o en inglés. Las del CSV que exporta WooCommerce («Name», «SKU», «Regular price», «Images», «Published») también.
- Una columna **precio_USD** o **price MXN** es el precio en esa moneda.
- Las columnas que se llamen como tus campos propios («Talla», «Color») rellenan esos campos.
- Los productos cuyo SKU ya existe se actualizan; el resto se crean. Hay una plantilla descargable con ejemplos.

## Conectar tu tienda

En Productos › Tiendas conectas una tienda o una hoja y Driony lee su catálogo cada hora (o cada 6 horas, una vez al día, o solo cuando tú lo pidas). Qué pasa en cada lectura:

- La tienda **manda** sobre nombre, SKU, precio, moneda, imagen, descripción y si está activo. Si cambias uno de esos datos en Driony, en la siguiente lectura vuelve al de la tienda.
- Lo que es solo de Driony **se conserva**: tus campos propios que la tienda no trae y los precios en otras monedas.
- Un producto que la tienda **deja de traer** (lo borraste, lo archivaste, lo pasaste a borrador) no se borra: queda **inactivo**, y vuelve solo si reaparece.
- Un producto que ya tenías **con el mismo SKU** pasa a ser el de la tienda en vez de duplicarse.
- Cada **variante** (talla, color…) es un producto en Driony, con sus opciones en campos que se crean solos («Talla», «Color»), igual que el **stock**, el **enlace** a la página del producto y la **categoría**. El agente los ve y puede, por ejemplo, decir si queda stock o mandar el enlace.

Puedes pausar una conexión, leer ahora, cambiar la frecuencia, o quitarla conservando sus productos o borrándolos con ella. Las credenciales se guardan cifradas y nunca se muestran enteras.

### WooCommerce

1. En WordPress: **WooCommerce › Ajustes › Avanzado › REST API › Añadir clave**, con permisos de **Lectura**.
2. Copia la **clave de cliente** (ck_…) y la **clave secreta** (cs_…) ahí mismo: la secreta solo se muestra una vez.
3. En Driony: Productos › Tiendas › Conectar › WooCommerce, pega la dirección de la tienda (https) y las dos claves, y pulsa «Probar conexión».

Si la tienda dice que no responde la API, revisa que en WordPress › Ajustes › Enlaces permanentes haya cualquier opción menos «Simple». Los productos variables entran como un producto por variación.

### Shopify

Hace falta una app con el permiso **read_products**. Hay dos caminos:

- **ID y secreto de cliente** (el camino actual): crea la app en el **Dev Dashboard** de Shopify, en la misma organización que tu tienda, dale el permiso read_products, instálala en la tienda y copia su ID de cliente y su secreto de cliente. Driony pide el token por ti y lo renueva solo (dura 24 horas).
- **Token de acceso**: si ya tienes una app creada desde el panel de la tienda (Configuración › Apps y canales de venta › Desarrollar apps), pega su token de acceso de la API Admin (shpat_…). Desde el 1 de enero de 2026 Shopify no permite crear apps nuevas de ese tipo, pero las que existen siguen funcionando.

El dominio es el **.myshopify.com** de la tienda (Configuración › Dominios), no tu dominio propio. Solo se leen los productos **activos**; cada variante es un producto en Driony.

### Mercado Libre

1. En Driony: Productos › Tiendas › Conectar › **Mercado Libre**, elige el país de tu cuenta y pulsa «Continuar en Mercado Libre».
2. Inicia sesión con tu cuenta de vendedor y autoriza a Driony a **leer tus publicaciones**. No se publica ni se modifica nada en Mercado Libre.
3. Vuelves a Productos › Tiendas con la cuenta conectada y la primera lectura en marcha.

Se leen las publicaciones **activas** y **pausadas** (las pausadas quedan inactivas en Driony; las cerradas dejan de venir y se desactivan). Cada variación es un producto, con sus combinaciones (talla, color…), el **stock**, el **enlace** a la publicación, la **categoría**, la **marca** y la condición cuando no es nueva. El SKU es el **SKU de vendedor** de la publicación. La autorización se renueva sola; si la revocas en Mercado Libre, la conexión marca error y basta con volver a conectarla.

Las empresas de la nube no configuran nada en Mercado Libre: usan la app de Driony. En una instalación propia hace falta una app en el portal de desarrolladores de Mercado Libre (permiso de lectura y «Offline access») con la URL de retorno `…/api/v1/products/sources/mercadolibre/callback` y, en Notificaciones, la URL `…/api/v1/products/sources/mercadolibre/notifications` con el tema **items**. Variables: `MERCADOLIBRE_APP_ID` y `MERCADOLIBRE_APP_SECRET`.

### Google Sheets o un CSV por enlace

1. Comparte la hoja con **Cualquier persona con el enlace** (Lector), o usa Archivo › Compartir › **Publicar en la web**.
2. Pega el enlace de la hoja. Se lee la pestaña que tenga el enlace (gid); por defecto, la primera.
3. Las columnas son las mismas que en el importador: nombre y precio obligatorios; moneda, sku, descripción, imagen, activo, precio_XXX y tus campos por su nombre, opcionales.

Sin columna SKU, cada fila se reconoce por su nombre: si cambias un nombre, se creará un producto nuevo y el anterior quedará inactivo. También vale cualquier otro enlace público que devuelva un CSV.

## Avisos al instante (webhooks de la tienda)

Cada conexión tiene una **URL de aviso** propia (en Productos › Tiendas, en su fila). Cuando la tienda la llama, Driony relee el catálogo en ese momento en vez de esperar a la siguiente lectura. El aviso solo avisa: los datos se leen siempre de la tienda con las credenciales guardadas.

- **WooCommerce**: si la clave de la API tiene permiso de lectura/escritura, Driony crea solos los webhooks de producto (creado, actualizado, eliminado, restaurado). Si solo tiene lectura, créalos tú en WooCommerce › Ajustes › Avanzado › Webhooks con la URL y el **secreto** que muestra Driony, o da permiso de escritura y pulsa «Registrar de nuevo».
- **Shopify**: Driony registra los webhooks de producto en la tienda al conectar. Si no pudo, créalos en Configuración › Notificaciones › Webhooks (eventos de producto, formato JSON) con la URL que muestra Driony.
- **Mercado Libre**: no hay nada que configurar por conexión: las notificaciones de la app (tema «items») avisan de cada cambio en tus publicaciones.
- **Hojas de Google**: Google no avisa, pero puedes llamar a la URL (POST) desde un Apps Script `onEdit`, Zapier o Make, y la hoja se releerá al momento.

Muchos avisos seguidos (una tienda manda uno por variante) se juntan en una sola lectura.

## Cargar el catálogo por la API

Si tu sistema no es una tienda (un ERP, un punto de venta, un n8n), puede **empujar** los productos con una clave de API con el permiso `products:write`: uno a uno o el catálogo entero en bloque por SKU, con la opción de desactivar lo que ya no mande. Los productos quedan ligados a una conexión **API · nombre-de-la-clave** que ves en Productos › Tiendas. Detalles y ejemplos en la [API pública](/docs/api).

### Otras plataformas

Tiendanube, VTEX y similares todavía no se conectan directamente. Mientras tanto: exporta el catálogo a Excel y usa «Importar», o mantén una hoja de Google con tus productos y conéctala.
