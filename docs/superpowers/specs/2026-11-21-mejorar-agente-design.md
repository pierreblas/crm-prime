# Mejorar agente: medir, proponer y comparar

Fecha: 21-11-2026 · Estado: aprobado por el usuario el 21-11-2026

## Para qué

Hoy el dueño de un negocio cambia las instrucciones de su agente a ojo: escribe
algo, hace una prueba en «Probar conversación», le parece que va mejor y lo
deja. Eso engaña. El 21-11 medimos el agente de Flyteek con el modelo real y
un mismo cambio dio 6 de 6 con seis respuestas y 14 de 16 con dieciséis; otra
idea «obvia» (ocultar dos campos vacíos) hizo que el agente inventara
requisitos la mitad de las veces. Sin repetir y contar, no se sabe si un cambio
mejora, empeora o no hace nada.

Las piezas ya existen sueltas: el simulador de clientes, el revisor que juzga
cada conversación (simulada o real) y el asistente que redacta instrucciones.
Falta el ciclo que las une: medir con una batería fija de casos, proponer un
cambio que corrija lo que falló, volver a medir con los mismos casos y enseñar
el antes y el después.

Se quiere que cualquier dueño pueda mejorar su agente con datos y sin saber de
prompts, y que el agente venda mejor por WhatsApp sin inventar nada.

## Qué se quiere (y qué no)

**Sí**
- Una batería de casos por agente, guardada: los seis de siempre del
  simulador, los que el dueño escriba y casos sacados de chats reales que
  salieron mal.
- Medir: cada caso varias veces con las instrucciones actuales, y un conteo
  claro por caso y en total.
- Proponer: una IA reescribe las instrucciones para corregir lo que falló,
  aplicando buenas prácticas de venta por WhatsApp, y dice qué cambió y por qué.
- Comparar: la misma batería con la propuesta, antes contra después.
- «Mejorar sola»: repetir proponer y comparar hasta tres vueltas y quedarse con
  la mejor.
- Aplicar con un clic, y poder volver a la versión anterior.
- Ver el coste en tokens antes de empezar y poder detenerlo.

**No, por ahora**
- Que el cambio se aplique solo (se decidió el 21-11: propone y mide sola, pero
  aplica el dueño).
- Pasadas programadas (cada noche, cada semana).
- Tocar algo que no sean las instrucciones: herramientas, conocimiento, modelo.
- Probar dos versiones con clientes reales a la vez.
- Que el dueño edite la guía de buenas prácticas de venta.

**Nunca**
- Enviar un mensaje de WhatsApp: todo corre sobre el simulador.
- Cambiar el agente sin el clic del dueño.
- «Mejorar» añadiendo datos del negocio que no estaban: precios, fechas,
  garantías, políticas. La propuesta solo reordena, aclara y añade reglas de
  conducta.
- Dar por mejora lo que es ruido: si la diferencia es pequeña para las
  repeticiones hechas, se dice «sin diferencia clara».

## Cómo se usa

En la ficha del agente, junto a «Probar conversación», un botón **Mejorar**.
Abre una ventana con tres partes, de arriba abajo:

```
Mejorar agente · Lia
──────────────────────────────────────────────────────────────
1. Casos de prueba (6 de 8 marcados)                [+ Nuevo caso]
   ☑ Pregunta el precio                    simulado
   ☑ Está indeciso                         simulado
   ☑ Pide qué incluye y requisitos         tuyo
   ☑ «Es caro, lo pienso»                  de un chat real · 18 nov
   ☐ Cliente molesto                       simulado
   [Añadir desde un chat real]

2. Qué hacer
   Repeticiones por caso  (1) (3•) (5)     Mensajes por chat (4•) (6) (8)
   ( ) Solo medir cómo está hoy
   (•) Medir y proponer mejoras    Vueltas: (1•) (2) (3)
   Gastará unos 1,2 M de tokens (36 conversaciones y 1 propuesta).
                                              [Empezar]

3. Resultado                          Antes        Propuesta
   Atendió bien                       9 de 18      14 de 18
   Inventó un dato                    2            0
   Llegó a buen fin                   7 de 18      12 de 18
   → Mejora clara.

   Por caso                           Antes   Propuesta
   Pregunta el precio                 3/3     3/3
   Pide qué incluye y requisitos      0/3     3/3      [ver chats]
   «Es caro, lo pienso»               1/3     2/3      [ver chats]

   Qué cambió (4)
   • Nueva regla: si preguntan un dato que no tienes → «Déjame
     consultarlo» y pasar a una persona.  Por: «Pide qué incluye…» 0/3
   • …
   [Ver las instrucciones propuestas]   [Aplicar al agente]  [Descartar]

Versiones anteriores: 21 nov 10:32 (antes de aplicar) [Restaurar]
```

- La medición corre en el servidor: se puede cerrar la ventana y volver; al
  volver se ve el avance o el resultado. Una sola a la vez por empresa.
- «Ver chats» abre las conversaciones de ese caso con lo que marcó el revisor,
  igual que en el simulador.
- «Ver las instrucciones propuestas» muestra el texto con lo añadido y lo
  quitado resaltado.
- «Aplicar al agente» guarda la propuesta como instrucciones y deja la versión
  anterior en «Versiones anteriores». Si el dueño editó el agente mientras
  corría la medición, se avisa y no se aplica encima sin confirmar.
- En «Revisión de chats reales», cada chat marcado «Mal» o «Revisar» tiene
  **Añadir a los casos de prueba**.

### Un caso sacado de un chat real

El simulador no puede repetir un chat palabra por palabra (el agente contesta
distinto cada vez y el cliente simulado reacciona). Un caso es una situación:
título y descripción del cliente. Al añadir desde un chat real, una IA lee el
chat y redacta esa situación («Vio el anuncio de un curso, le parece caro y
dice que lo va a pensar; si le ofrecen pagar en partes, pregunta cómo»); el
dueño la revisa y la guarda. No se guardan nombres, teléfonos ni datos del
cliente en el caso. El caso va a la batería del agente que atendió ese chat.

## Cómo se mide

Cada conversación simulada la juzga el revisor que ya existe (bien, revisar,
mal, con sus hallazgos). Se le añade una pregunta más: **¿llegó a buen fin?**
Es decir, si terminó como le conviene al negocio dado lo que quería el cliente:
venta o cita encaminada, o pase a una persona cuando tocaba. Sí o no.

El revisor lo responde siempre; el simulador y la revisión de chats reales no
lo enseñan por ahora.

El cliente simulado es el de «Probar como» (nombre y país, que fija la moneda
de los precios): uno por medición, el mismo para todas sus conversaciones.

Lo que ve el dueño, por caso y en total, son tres conteos:
- **Atendió bien**: conversaciones con veredicto «bien».
- **Inventó un dato**: conversaciones con algún hallazgo de dato inventado.
- **Llegó a buen fin**.

Para elegir la mejor versión se usa una puntuación interna por conversación:
bien 2, revisar 1, mal 0, más 1 si llegó a buen fin (máximo 3). Reglas:
- Una propuesta que inventa más que la versión de partida nunca gana.
- «Mejora clara» solo si gana al menos un 10 % del máximo posible; por debajo,
  «sin diferencia clara», y se recomienda no aplicar o repetir con más
  repeticiones.
- En «mejorar sola», cada vuelta parte de la mejor versión hasta ese momento, y
  se detiene antes si ya no queda nada que corregir.

## Cómo propone

Una IA recibe: las instrucciones actuales, los casos que fallaron con una o dos
conversaciones de ejemplo y lo que marcó el revisor, los conteos, y una guía
fija de venta por WhatsApp (responder primero lo que preguntan, mensajes
cortos, una pregunta por mensaje, proponer siempre el siguiente paso, tratar
una objeción con un motivo y una salida, urgencia solo si es real, qué hacer
con lo que no sabe, cuándo pasar a una persona).

La redacta el modelo de la empresa con el máximo esfuerzo de razonamiento,
como el asistente de instrucciones.

Reglas de la propuesta:
- Cambios mínimos: conserva lo que funciona, la estructura y el tono del dueño.
- No toca los datos entre « » y [ ], ni los nombres de las herramientas.
- No añade datos del negocio que no estén ya en las instrucciones.
- No pasa del tamaño máximo de las instrucciones.
- Devuelve las instrucciones nuevas y una lista de cambios: qué, por qué y por
  qué caso.

Si la IA devuelve algo que no cumple (más largo, sin los datos entre « », sin
formato), esa vuelta se descarta y se dice.

## Formas de construirlo que se consideraron

1. **En el servidor, con resultados guardados** (elegida). La medición corre en
   la API en segundo plano, como hoy la revisión diaria de chats reales, y
   guarda cada conversación. Se puede cerrar la ventana, «mejorar sola» funciona
   sin mirar, y queda historial. Cuesta tablas nuevas y un proceso que hay que
   poder detener y recuperar si la API se reinicia.
2. **En el navegador, como el simulador de hoy.** Casi sin servidor nuevo, pero
   hay que dejar la pestaña abierta diez o veinte minutos, se pierde todo al
   cerrarla y no hay historial. No sirve para «mejorar sola».
3. **Con una cola de trabajos por conversación.** Lo más robusto para muchas
   empresas a la vez, pero es más montaje del que hace falta ahora. Si un día
   la opción 1 se queda corta, el paso es este.

Para la puntuación se descartó un segundo juez aparte: el revisor actual ya lee
la conversación entera con lo que consultó el agente; añadirle una pregunta
cuesta menos y mantiene un solo criterio en simulador, chats reales y mejora.

## Datos

Cuatro tablas nuevas, todas con empresa (`orgId`) y aislamiento por empresa
como el resto.

- **Casos de prueba** del agente: título, descripción, de dónde salió (simulado
  de serie, escrito a mano, de un chat real), el chat de origen si lo hay, y si
  está marcado. Al abrir «Mejorar» por primera vez se crean los seis de serie.
- **Mediciones**: agente, estado (en marcha, terminada, detenida, falló,
  interrumpida), qué se pidió (repeticiones, mensajes, vueltas), las
  instrucciones de partida, cada propuesta con su lista de cambios y sus
  conteos, cuál es la mejor, avance, tokens gastados, y si se aplicó.
- **Conversaciones de la medición**: medición, caso, versión (la de partida o
  la propuesta de la vuelta N), número de repetición, la conversación con lo
  que consultó el agente, veredicto, hallazgos, si llegó a buen fin, tokens.
- **Versiones de las instrucciones**: agente, texto, cuándo, y por qué cambió
  (edición a mano, mejora aplicada, restaurada). Se guarda la versión anterior
  cada vez que cambian las instrucciones, por la vía que sea. Las últimas 20
  por agente.

El simulador y «Probar conversación» hoy solo saben probar las instrucciones
guardadas. Hace falta que el servidor pueda correr una conversación con unas
instrucciones distintas de las guardadas (la propuesta), sin guardarlas. Eso
no se abre al navegador: solo lo usa la medición.

## Límites y coste

- Hasta 12 casos marcados por medición; repeticiones 1, 3 o 5 (3 de serie);
  mensajes por conversación 4, 6 u 8 (4 de serie, para gastar menos); vueltas de
  mejora 1 a 3 (1 de serie).
- Tres conversaciones a la vez, como mucho.
- El coste estimado sale del estimador del simulador y se enseña antes de
  empezar. Referencia medida: el agente de Flyteek, 6 casos por 3 repeticiones
  de 6 mensajes, unas 630 mil tokens por medición.
- Cuenta como gasto de IA de la empresa, con un nombre propio en «Consumo de
  IA» («Mejora del agente»). Si la IA incluida se agota a mitad, la medición se
  detiene con lo que lleva y lo dice.
- Solo administradores.

## Orden de entrega

Se construye en tres tramos; cada uno deja algo que se puede usar.

1. **Medir y comparar a mano.** Batería (de serie y propios), medición con
   repeticiones en el servidor, resultado por caso, versiones y restaurar. El
   dueño cambia las instrucciones a mano y vuelve a medir.
2. **Proponer y aplicar.** La propuesta con su lista de cambios, la comparación
   antes y después, «Aplicar», y «mejorar sola» hasta tres vueltas.
3. **Casos de chats reales.** «Añadir desde un chat real» y el botón en
   «Revisión de chats reales».

## Lo que queda a criterio de quien lo construya

- El texto exacto de la guía de venta y del encargo a la IA que propone; se
  ajusta midiendo con un agente de prueba, no a ojo.
- Cómo se resaltan los cambios en las instrucciones propuestas.
- Cada cuánto pregunta la ventana por el avance.
- Si una medición interrumpida por un reinicio se puede continuar o solo
  repetir (basta con repetir).

## Decisiones tomadas sin preguntar (revisar)

- Tres conteos a la vista y una puntuación interna, en vez de una nota única.
- «Mejora clara» a partir del 10 % del máximo.
- 4 mensajes por conversación de serie, no los 6 del simulador, por coste.
- Se guardan versiones de las instrucciones también cuando se editan a mano.
- Un caso de un chat real es una situación redactada, no el chat repetido.
- Una sola medición a la vez por empresa.
- Disponible en todos los planes; gasta de los tokens de IA de la empresa.
- Al borrar un agente se borran sus casos, mediciones y versiones.

## Notas de la construcción (21-11-2026)

Decisiones tomadas al construirlo, medidas con el modelo real sobre un agente de
prueba:

- **La IA propone cambios puntuales, no reescribe las instrucciones.** Devuelve
  una lista de cambios (añadir una regla tras una línea, corregir una línea,
  quitarla) y el servidor los coloca sobre el texto del dueño. Así lo que no se
  toca queda letra por letra, y la lista «Qué cambió» es exactamente lo que
  cambia. Cada cambio se valida por separado: el que añade un dato del negocio
  que no estaba (dinero, porcentajes, horas, plazos), quita algo entre « », [ ] o
  una herramienta, o corrige una línea que no existe, se descarta solo y se dice
  por qué; los demás siguen valiendo. Una regla nueva cuya línea de referencia
  no existe va al final. Se conserva la viñeta del dueño.
- **La propuesta la redacta gpt-5-mini** (el modelo del revisor) con
  razonamiento medio, y si la clave no lo tiene, el modelo del agente. El diseño
  decía «el modelo de la empresa»; con gpt-4o-mini confundía lo que dijo el
  agente en el chat con sus instrucciones, y con razonamiento alto a veces se
  quedaba sin margen y no respondía.
- **El revisor sabe lo que el agente sabía del cliente de prueba** (nombre y
  país). Sin eso marcaba «inventó un dato» cuando el agente usaba el nombre del
  cliente, lo que falseaba los conteos. También vale para el simulador de
  siempre.
- **Si la IA se queda sin tokens o sin clave a mitad, la medición se para** con
  lo que lleva y lo dice. Un fallo puntual (un tiempo de espera) no la para: esa
  conversación no cuenta.
- **Tope de 40 casos guardados por agente** (12 marcados por medición, como
  estaba).
- El coste estimado se queda corto o largo según el agente (±30 % en lo medido):
  sigue siendo el estimador del simulador más unas 9 000 tokens por propuesta.
