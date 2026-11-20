# Descuentos de producto

Fecha: 20-11-2026 · Estado: aprobado por el usuario el 20-11-2026

## Para qué

Hoy un producto de Driony tiene un solo precio. Cuando está rebajado pasa una
de estas cosas, según cómo llegó el producto:

- De Shopify, WooCommerce o Mercado Libre llega el precio vigente (ya
  rebajado) y el precio de antes se descarta: el agente cotiza bien, pero no
  sabe que hay descuento ni puede decir «antes costaba X».
- De un archivo o una hoja, la columna «Precio normal» se toma como el precio
  y «Precio oferta» no se reconoce: el agente cotiza sin el descuento.
- Con el descuento en un campo aparte («Descuento: 20 %»), el agente lo
  menciona pero no dice el precio final, porque tiene prohibido calcular (y
  debe seguir así: un modelo que calcula precios se equivoca).
- No hay fecha de fin: la oferta se sigue ofreciendo hasta que alguien cambie
  el precio a mano.

Se quiere que cualquier empresa de Driony pueda tener productos con descuento
y que el agente lo diga bien: precio de hoy, precio de antes y hasta cuándo.

## Qué se quiere (y qué no)

**Sí**
- Un producto puede tener precio normal, precio con descuento y, opcional,
  fecha de fin. También en cada una de sus otras monedas.
- Al pasar la fecha, vuelve solo al precio normal.
- El agente recibe los datos ya calculados y los dice tal cual:
  «Cuesta USD 40 (antes USD 50, 20 % de descuento hasta el 30 de noviembre)».
- Las tiendas conectadas lo llenan solas. En el editor se puede poner a mano,
  con un atajo «−20 %» que rellena todas las monedas.
- En la lista de productos se ve de un vistazo qué está rebajado.

**No, por ahora**
- Cupones con código, descuentos por cantidad o por cliente.
- Promociones que se aplican a muchos productos de una vez («Cyber Days»).
  Se pueden montar después encima de esto.
- Fecha de inicio (programar un descuento que todavía no empieza).
- En la importación por archivo: fecha de fin y descuento por cada moneda.

**Lo que sería un fracaso aunque «funcione»**
- Que el agente diga un precio distinto del que cobra la tienda.
- Que el agente calcule o invente un descuento, o alargue la fecha.
- Que un descuento vencido se siga ofreciendo.

## Formas que se consideraron

- **A. Precio normal + precio con descuento + fecha de fin (elegida).** Dos
  importes por moneda. Es lo que ya mandan las tiendas, los precios quedan
  redondos y el sistema hace las cuentas.
- **B. Solo un porcentaje por producto.** Rápido de escribir y vale para todas
  las monedas, pero deja precios feos (S/ 87,43) y no cuadra con las tiendas,
  que mandan importes: el agente cotizaría unos céntimos distinto.
- **C. Promociones aparte.** Una promoción para muchos productos. Más grande:
  pantalla nueva y reglas de choque entre promociones y con el precio de la
  tienda. Queda para después.

Elegida A por el usuario el 20-11-2026.

## Cómo se guarda (decisión del constructor)

`price` sigue significando **lo que paga el cliente hoy**. Se añade al lado el
precio de antes:

| Dónde | Campo nuevo | Significado |
|---|---|---|
| `Product` | `regularPrice Decimal?` | precio normal; null = sin descuento |
| `Product` | `saleEndsAt DateTime?` | hasta cuándo vale el descuento; null = sin fecha |
| `ProductPrice` | `regularAmount Decimal?` | precio normal en esa moneda |

Por qué así y no al revés (guardar el normal en `price` y el rebajado aparte):
es exactamente lo que mandan Shopify (`price` / `compareAtPrice`), WooCommerce
(`price` / `regular_price`) y Mercado Libre (`price` / `original_price`), y
todo lo que hoy lee `price` (filtros y orden por precio en SQL, API pública,
el agente) sigue siendo correcto sin tocarlo. El riesgo de la otra forma es
que un sitio que se olvide de actualizar cotice el precio sin descuento.

Reglas:
- Hay descuento solo si `regularPrice > price`. Si no, `regularPrice` y
  `saleEndsAt` se guardan como null (una tienda que manda los dos iguales no
  tiene oferta).
- `saleEndsAt` sin `regularPrice` no tiene sentido: se rechaza al guardar.
- Una fecha de fin ya pasada se rechaza al guardar a mano.
- Porcentaje = `round((1 − price / regularPrice) × 100)`, entero. Se calcula
  al leer; no se guarda.
- Cada moneda es independiente: una moneda sin `regularAmount` no tiene
  descuento en esa moneda, aunque la base sí lo tenga. En cada una vale la
  misma regla (`regularAmount > amount`, o se rechaza al guardar a mano).
- La fecha de fin es una sola por producto y vale para todas sus monedas.
- Las columnas nuevas son opcionales y nacen vacías: los productos que ya
  existen quedan sin descuento, sin migrar nada. Los campos personalizados que
  una empresa ya tenga («Precio normal», «Descuento»…) no se tocan.

## Vencimiento

Dos protecciones, porque «descuento vencido que se sigue ofreciendo» es un
fracaso:

1. **Al leer.** Una función compartida (`productPricing` en
   `packages/shared`, junto a `priceFor`) que recibe el producto, la moneda y
   la hora, y devuelve `{ amount, currency, fallback, regular, percent,
   endsAt }`. Si `saleEndsAt` ya pasó, devuelve el precio normal y ningún
   descuento. La usan el agente, la lista y la ficha de productos y la API
   pública. `priceFor` queda como envoltorio para no romper a quien la usa.
2. **Un barrido cada 5 minutos** que deja la fila como debe: `price :=
   regularPrice`, `regularPrice := null`, `saleEndsAt := null` (y lo mismo en
   sus otras monedas). Así los filtros y el orden por precio en SQL vuelven a
   ser exactos. Mismo patrón que los otros barridos: `runUnscoped` para
   encontrar lo vencido, `runInOrg` para escribir; se apaga con una variable
   de entorno y se documenta en `ARCHITECTURE-MULTITENANT.md`.

En productos de una tienda conectada, la tienda es la fuente: la siguiente
sincronización trae el precio que toque. El barrido también los restaura para
no ofrecer algo vencido mientras tanto.

## Por dónde entra

- **Editor de productos.** «Precio normal», «Precio con descuento (opcional)»
  y «Hasta (opcional)». Al lado, el porcentaje que resulta. Un atajo «−%»
  rellena el precio con descuento de la moneda base y de todas las demás
  (redondeado a 2 decimales), editable después. Cada otra moneda tiene sus dos
  importes. En un producto de una tienda conectada los campos son de solo
  lectura, como ya pasa con el precio.
  La fecha elegida vale hasta el final de ese día en la hora del navegador.
  Al guardar: con «Precio con descuento» relleno, `price` = ese importe y
  `regularPrice` = el normal; vacío, `price` = el normal y `regularPrice` =
  null (y se borra la fecha). Al abrir un producto con descuento, los campos se
  rellenan al revés.
- **API** (`products.controller` y la API pública): `price` como hoy, más
  `regularPrice` y `saleEndsAt` opcionales; `prices[]` acepta `regularAmount`.
  Solo se añaden campos: quien no los manda no nota nada.
- **Shopify:** `compareAtPrice` de la variante.
- **WooCommerce:** `regular_price` cuando es mayor que `price`, y
  `date_on_sale_to_gmt` como fecha de fin.
- **Mercado Libre:** `original_price`.
- **Archivo y hoja de cálculo:** columna nueva «precio con descuento» (alias:
  precio oferta, oferta, precio rebajado, precio promocional, sale price). Si
  viene y es menor que la columna de precio, la de precio pasa a ser el normal.
  Si no es menor (o está vacía), esa fila queda sin descuento. Sin esa columna
  todo funciona como hoy.

`ExternalProduct` (el molde común de los conectores) gana `regularPrice?` y
`saleEndsAt?`, y `prices[]` gana `regularAmount?`. La sincronización los
escribe y los cuenta al decidir si un producto cambió.

## Por dónde sale

- **Agente (`search_products`).** `price` es el de hoy en la moneda del
  cliente, como ahora. Si hay descuento vigente se añaden `regularPrice`,
  `discount` («20 %») y, si tiene fecha, `discountUntil` («30 de noviembre»,
  en la zona horaria de la agenda de la empresa; por defecto la de Lima). Si el
  producto no tiene precio en la moneda del cliente y se usa el precio base, el
  descuento que se informa es el del precio base.
  Regla fija nueva cuando el agente tiene `search_products`: un producto con
  `regularPrice` está rebajado; decir el precio, el de antes y la fecha tal
  cual vienen; no calcular otro precio ni otro porcentaje, no ofrecer
  descuentos que no vengan ahí y no alargar la fecha.
- **Seguimientos que redacta la IA.** El seguimiento no consulta el catálogo:
  escribe a partir del chat, donde puede haber un descuento que ya venció. Se
  le añade la instrucción de no mencionar precios, descuentos ni fechas de
  oferta. (Que el seguimiento use el dato fresco del producto es otro trabajo.)
- **Lista de productos.** El precio de hoy, el normal tachado y una marca
  «−20 %» (con «hasta 30 nov» si tiene fecha). Filtro «Con descuento».
- **API pública.** `regularPrice`, `saleEndsAt` y `discountPercent` en cada
  producto.

Lo que devuelve la API al navegador (`ProductDto`) gana `regularPrice`,
`saleEndsAt` y `discountPercent`, y cada entrada de `prices[]` gana
`regularAmount`; todo ya pasado por la protección de vencimiento (un descuento
vencido sale como precio normal, sin esperar al barrido).

Lo que no cambia: el valor de las oportunidades, «Ventas por anuncio» y los
filtros y el orden por precio, que siguen usando `price` (lo que se paga hoy).
Entre que vence un descuento y pasa el barrido (hasta 5 minutos) el filtro por
precio puede ir con el importe rebajado; se acepta.

## Lo que queda al constructor

- Nombres exactos de columnas, índices y de la variable que apaga el barrido.
- Cómo se dibuja el atajo «−%» y la marca de la lista, dentro del estilo
  actual de la pantalla de productos.
- Qué pruebas: como mínimo la función compartida (vigente, vencido, sin fecha,
  otra moneda, sin precio en la moneda del cliente), cada conector, la
  importación con y sin la columna nueva, lo que lee el agente, el barrido, y
  una comprobación en el navegador de editor y lista.
- Probarlo con el agente real en la prueba del agente (sin enviar nada),
  restaurando lo que se cambie.

## Decisiones tomadas por el constructor, para revisar

1. `price` = lo que se paga hoy; el normal va aparte (ver «Cómo se guarda»).
2. Sin fecha de inicio.
3. La importación por archivo no trae fecha de fin ni descuento por moneda.
4. La fecha del editor vale hasta el final del día en la hora del navegador;
   el agente la dice en la zona horaria de la agenda de la empresa.
5. Barrido cada 5 minutos, además de la protección al leer.
6. Filtro «Con descuento» en la lista.
7. Los productos de tiendas conectadas no se editan a mano (como hoy).
