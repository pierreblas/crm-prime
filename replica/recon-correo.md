# Recon: Kommo — correo dentro del CRM

Fecha: 2026-11-14. Alcance acotado: solo el correo de Kommo (buzones, bandeja,
enviar desde el lead, plantillas, firmas y envío automático). Objetivo: ver cómo
lo resuelve Kommo y qué hace falta para que Driony envíe correos y tenga
plantillas de correo. Se replica el **comportamiento**, no el código, los textos
ni la marca de Kommo.

Fuentes: solo la documentación pública de Kommo y su página de precios. Sin
cuenta de Kommo, sin capturas de su app y sin leer su código ni sus APIs
privadas. Lo que la documentación no dice queda marcado como «no documentado».

## 1. Alcance

| | |
| --- | --- |
| App | Kommo (web) |
| Parte | Correo: conectar buzones, bandeja, redactar y responder, plantillas, variables, firmas, correo automático en el Digital Pipeline y en el Salesbot |
| Para quién | Driony: CRM de WhatsApp con IA para empresas de LatAm |
| Bucle central | El equipo conecta su buzón → escribe a un lead con una plantilla (a mano o por una automatización de etapa) → la respuesta vuelve a la ficha del lead |

## 2. Fuentes

| fuente | URL | qué aporta |
| --- | --- | --- |
| Resumen de correo | https://support.kommo.com/docs/mail-overview.md | Capacidades, direcciones inteligentes, permisos |
| Conectar buzones | https://support.kommo.com/docs/connect-and-manage-mailboxes.md | Alta, buzón personal o compartido, firmas, desconexión |
| Gestionar correos | https://support.kommo.com/docs/manage-emails-in-kommo.md | Bandeja, redactar, responder, crear lead, borrar |
| Plantillas de correo | https://support.kommo.com/docs/create-and-use-email-templates.md | Campos de la plantilla, HTML, uso |
| Variables | https://support.kommo.com/docs/dynamic-fields.md | Sintaxis y lista de variables |
| Envío automático | https://support.kommo.com/docs/send-emails-automatically.md | Disparador «Send an email», remitente, baja |
| Disparadores del Digital Pipeline | https://support.kommo.com/docs/set-up-digital-pipeline-triggers.md | Opciones del disparador de correo |
| Pasos del Salesbot | https://support.kommo.com/docs/salesbot-overview.md | Acción «Send email» del bot |
| Lectura de correos de leads | https://support.kommo.com/docs/set-up-email-parsing.md | Crear leads desde correos con formato fijo |
| Problemas de conexión | https://support.kommo.com/docs/troubleshooting-mail-connection.md | Fallos típicos y campos obligatorios |
| Precios | https://www.kommo.com/pricing/ | Filas de correo del comparador de planes |
| Índice de la documentación | https://support.kommo.com/docs/llms.txt | Mapa de artículos |

## 3. Pantallas

Reconstruidas a partir de los pasos de la documentación (no hay capturas).

| ID | pantalla | cómo se llega | para qué | componentes clave | estados |
| --- | --- | --- | --- | --- | --- |
| S01 | Ajustes de correo | Settings › Email settings | Ver buzones, direcciones inteligentes y firmas | lista de buzones, «+ Add email», direcciones para copiar, firma por usuario | sin buzones, con buzones |
| S02 | Conectar buzón | «+ Add email» | Dar de alta una dirección | campo de dirección, «Continue with Google» o «Continue», permiso en el proveedor, personal o compartido, hilos sí/no, «Create contacts for all replied emails» | conectado, contraseña rechazada (2FA), IMAP apagado |
| S03 | Ajustes del buzón | clic en un buzón | Cambiar cómo funciona | personal ↔ compartido, hilos, «Share with administrator», enviar por el servidor de Kommo, interruptor de conexión | al desconectar pregunta si borra los correos |
| S04 | Bandeja de correo | Communication › Email inbox | Leer y ordenar | carpetas: una por dirección, todos los recibidos, todos los enviados, borrados; hilos; barra con «Delete» y «Restore» | vacía, con hilos, borrados (30 días) |
| S05 | Hilo | clic en un correo | Leer y responder | mensajes del hilo, caja de respuesta, «Template», formato, «Attach file», «Send», nombre del lead arriba a la derecha, «Create lead» | con lead, sin lead |
| S06 | Redactar | «Compose» | Correo nuevo | destinatario, «Template», asunto, cuerpo con formato, adjunto, «Send» | «Send» apagado si falta buzón, asunto, cuerpo o destinatario |
| S07 | Plantillas de correo | Automations › Templates › Email templates | Listar plantillas | lista, «+ Add a template», lápiz al pasar el ratón | vacía, con plantillas |
| S08 | Editor de plantilla | «+ Add a template» o lápiz | Crear o editar | nombre, asunto (obligatorio), cuerpo, adjunto, «Send email with HTML markup», lista de variables, «Save», «Delete template» | — |
| S09 | Ficha del lead | clic en un lead | Escribirle y ver el historial | selector de acción › «Email», cuerpo, «Send»; los correos aparecen en el historial | — |
| S10 | Disparador «Send an email» | Leads › Setup › hueco bajo una etapa | Correo automático por etapa | condiciones, cuándo se ejecuta, plantilla, remitente, tres casillas | sin buzón conectado, sin plantillas |
| S11 | Paso «Send email» del bot | Salesbot › acciones | Correo dentro de un bot | plantilla, «connect» si no hay buzón | — |
| S12 | Lectura de correos | Setup del embudo › «Add source» › «Email Parsing» | Leads desde correos con formato fijo | asistente de 4 pasos: reenvío, código, correo de muestra, mapear campos | — |

## 4. Flujos de usuario

```
F01 Conectar un buzón
    S01 → «+ Add email» → dirección → permiso en el proveedor → personal o compartido → «Save»
    happy path: unos 6 clics
    edge: 2FA activo (hace falta contraseña de aplicación), IMAP apagado en el proveedor,
          cambio de contraseña (deja de sincronizar: desconectar sin borrar y reconectar)

F02 Escribir a un lead con una plantilla
    S09 → selector de acción › Email → «Template» → retocar → «Send»
    happy path: unos 5 clics
    edge: el lead no tiene correo, no hay buzón conectado, falta el asunto

F03 Crear una plantilla
    S07 → «+ Add a template» → nombre, asunto, cuerpo, variables → (adjunto) → (HTML) → «Save»
    solo administradores

F04 Correo automático al entrar a una etapa
    S10 → condiciones → «When moved to this stage» → plantilla → remitente → casillas → guardar
    remitente: el responsable del lead, un buzón corporativo o un usuario concreto;
               si ese usuario no tiene buzón, sale del buzón compartido
    casillas:  solo al contacto principal · enlace de baja · aplicar a los leads que ya están en la etapa

F05 Responder un correo entrante
    S04 → S05 → escribir o «Template» → «Send»
    si el remitente no existe: «Create lead» (el asunto pasa a ser el nombre del lead)

F06 Guardar en el CRM un correo enviado desde fuera
    El usuario pone la dirección inteligente en CC o CCO desde Gmail u otro → aparece en S04 hasta 15 min después
```

## 5. Componentes

| componente | variantes | estados | pantallas |
| --- | --- | --- | --- |
| Fila de buzón | personal, compartido | conectado, con error, desconectado | S01 |
| Selector de plantilla | en redactar, en responder, en disparador, en bot | sin plantillas | S05, S06, S10, S11 |
| Editor de cuerpo | texto con formato, HTML propio | — | S05, S06, S08 |
| Lista de variables | lead, contacto, empresa, responsable | — | S08 |
| Selector de remitente | responsable del lead, buzón corporativo, usuario concreto | sin buzón (cae al compartido) | S10 |
| Hilo de correo | agrupado, mensajes sueltos | con lead, sin lead | S04, S05 |
| Firma | una por usuario | — | S01 |
| Adjuntar archivo | — | — | S05, S06, S08 |

## 6. Modelo de datos inferido

```
Mailbox         id, address, kind (personal | shared), owner_user_id, provider (google | imap_smtp),
                credenciales o token, threading (bool), auto_create_contacts (bool),
                share_with_admin (bool), connected (bool)
                evidencia: alta y ajustes del buzón. Confianza: alta

EmailThread     id, mailbox_id, lead_id?, contact_id?, subject, last_message_at
                evidencia: «emails group into threads», lead visible en el hilo. Confianza: media

Email           id, thread_id, direction (in | out), from, to, subject, body_html, attachments[],
                folder (inbox | sent | deleted), deleted_at (se purga a los 30 días), sent_by_user_id
                evidencia: carpetas, borrar y restaurar. Confianza: media
                SUPOSICIÓN: cc y cco no aparecen en los artículos leídos

EmailTemplate   id, name, subject, body, is_html (bool), attachment
                evidencia: editor de plantilla. Confianza: alta

Signature       user_id, body_html
                evidencia: «choose a user», se añade al responder. Confianza: alta

Unsubscribe     address, created_at   — baja de todos los correos automáticos
                evidencia: casilla «Add a link "unsubscribe"». Confianza: media

SmartAddress    address (@mail.kommo.com), purpose (guardar | crear lead)
                evidencia: resumen de correo. Confianza: media

ParserRule      forwarding_address, sample_email_id, field_map (json), tags[], stage_id, responsible_user_id
                evidencia: asistente de lectura de correos. Confianza: media
```

Variables (sintaxis de Kommo; Driony ya usa `{{variable}}` en los flujos):
`{{lead.id}}`, `{{lead.name}}`, `{{lead.cf.<campo>}}`, `{{contact.name}}`,
`{{contact.first_name}}`, `{{contact.last_name}}`, `{{contact.cf.<campo>}}`,
`{{contact.responsible}}`, `{{contact.responsible.email}}`, `{{company.name}}`,
`{{profile.name}}`, `{{profile.phone}}`. No documenta qué pasa si el campo está vacío.

## 7. Reglas y límites documentados

- Solo sincroniza dos carpetas del proveedor: recibidos y enviados.
- Solo los administradores conectan buzones compartidos, crean plantillas y añaden firmas.
- Borrar un correo en Kommo no lo borra en el proveedor. Los borrados se purgan a los 30 días.
- Las direcciones inteligentes no envían, no reenvían y no se pueden borrar.
- El correo básico está en todos los planes. Un artículo pide plan Advanced o Enterprise para el envío automático; el de disparadores no lo dice.
- Precios públicos el 2026-11-14: Base 25, Advanced 35 y Pro 45 USD por usuario al mes, en pagos de 6 meses.

No documentado: seguimiento de aperturas y clics, envíos masivos propios (remiten a Mailchimp y ActiveCampaign), programar un envío, CC y CCO, tamaño de adjuntos, tope de envíos por día, número de buzones por usuario.

## 8. Comparación con Driony

Driony no tiene nada de correo hoy:

- No hay librería ni servicio de envío en el API (ni siquiera correos propios de Driony, como recuperar la contraseña).
- El contacto no tiene correo como dato propio. `Contact` exige teléfono (`@@unique([orgId, phone])`); el correo solo llega como clave libre `email` en `Contact.metadata`, desde los formularios de Meta y los webhooks de leads.
- Las plantillas (`Template`) son las de WhatsApp aprobadas por Meta: otro ciclo de vida, no sirven para correo.

Lo que ya existe y se puede reutilizar:

| pieza de Driony | para qué sirve aquí |
| --- | --- |
| Motor de flujos (`flowNodeTypes`, 18 tipos) e `interpolate` con `{{variable}}` | Un bloque nuevo «Enviar correo» da correo automático en todo lo que lanza flujos |
| Automatizaciones de etapa (`StageAutomation`: entra a la etapa, mensaje entrante, webhook, sin respuesta; con espera y condiciones) | Equivalen al disparador «Send an email» de Kommo sin construir nada más |
| Pregunta con validación `email` + bloque «Guardar campo» | El bot ya puede pedir y guardar el correo del cliente |
| `encryptSecret` / `decryptSecret` (secret-box) | Guardar la contraseña o el token del buzón cifrados |
| Colas BullMQ | Envío en segundo plano con reintentos |
| Campañas › Plantillas, respuestas rápidas | Sitio natural para una pestaña de plantillas de correo |
| Notas internas en el chat (`messaging.addNote`) | Dejar constancia en el chat de cada correo enviado |
| Seguimientos del agente (toques de texto, IA o plantilla) | Un toque «por correo» cuando la ventana de WhatsApp ya cerró |

Lo que Kommo no documenta y Driony podría ofrecer: correo como salida gratuita cuando la ventana de 24 h de WhatsApp está cerrada (en vez de una plantilla que cobra Meta), redacción del correo con el agente de IA, y aperturas y clics.

## 9. Lo que no se replica

| qué | por qué |
| --- | --- |
| Direcciones inteligentes `@mail.kommo.com` | Exigen un dominio de correo entrante propio de Driony. Se puede ver más adelante |
| Lectura de correos con formato fijo (parsing) | Driony ya recibe leads por formularios de Meta y por webhook. Se puede ver más adelante |
| Integraciones de Mailchimp y ActiveCampaign | Ecosistema de terceros de Kommo |
| «Enviar por el servidor de Kommo» | La documentación no explica qué hace |
| Textos, plantillas de ejemplo y marca de Kommo | Son propiedad de Kommo |

## 10. Tamaño y partes difíciles

- Pantallas: 12 en Kommo. Flujos: 6. Entidades nuevas en Driony: buzón, plantilla de correo, correo, firma y lista de bajas, más el correo del contacto.
- Partes difíciles:
  1. **Acceso al buzón según el proveedor.** Gmail por SMTP pide verificación en dos pasos y una contraseña de aplicación. Microsoft 365 apaga por defecto el SMTP con contraseña a finales de diciembre de 2026 y pide OAuth. El acceso por OAuth exige que Google y Microsoft verifiquen la app de Driony; en Google, leer el buzón por su API es un permiso restringido con evaluación de seguridad.
  2. **Reputación del remitente.** Un envío masivo desde un buzón normal acaba en bloqueo: hacen falta topes por día, enlace de baja y lista de bajas.
  3. **Recibir.** Sincronizar por IMAP, agrupar hilos, emparejar con contactos, admitir contactos sin teléfono y limpiar el HTML entrante antes de mostrarlo.
  4. **Seguridad del servidor.** El servidor SMTP lo escribe el cliente: hay que impedir que apunte a direcciones internas.
- Tamaño: **M** para enviar (buzón, plantillas, redactar, bloque de flujo). Otro **M** para recibir. **M** para masivo con medición.

Siguiente paso: decidir cómo sale el correo (buzón propio o servicio de envío de Driony) y qué entra en la primera entrega; después, `/replica-architect`.
