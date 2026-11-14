// Traducción de los mensajes de error que acaban en pantalla.
//
// El código sigue escribiendo el mensaje en español (es legible ahí donde se
// lanza) y aquí está su versión en inglés. El filtro de excepciones traduce
// según el idioma que pide el navegador. Hay una prueba que comprueba que
// ningún mensaje del código se quede fuera de esta tabla.

export const ES_TO_EN: Record<string, string> = {
  "Agente no encontrado": "Agent not found",
  "Archivo no encontrado": "File not found",
  "Bot no encontrado": "Agent not found",
  "Campo no encontrado": "Field not found",
  "Clave de API inválida o revocada": "Invalid or revoked API key",
  "Clave no encontrada": "Key not found",
  "Contacto no encontrado": "Contact not found",
  "Conversación no encontrada": "Conversation not found",
  "Credenciales inválidas": "Invalid email or password",
  "Deal no encontrado": "Deal not found",
  "Demasiados intentos de inicio de sesión. Espera unos minutos.":
    "Too many sign-in attempts. Please wait a few minutes.",
  "Difusión no encontrada": "Broadcast not found",
  "Documento no encontrado": "Document not found",
  "El archivo de ejemplo no es válido.": "The sample file is not valid.",
  "El archivo de ejemplo ya no está disponible.":
    "The sample file is no longer available.",
  "El contacto no tiene ninguna conversación abierta. WhatsApp solo permite escribir a quien te escribió en las últimas 24 h.":
    "This contact has no open conversation. WhatsApp only lets you message people who wrote to you in the last 24 hours.",
  "Esa fuente ya no existe": "That source no longer exists",
  "Esa plantilla ya no existe": "That template no longer exists",
  "Ese correo ya está registrado": "That email is already registered",
  "Esta plantilla se importó de Meta y usa componentes que el editor no cubre. Edítala en el panel de Meta.":
    "This template was imported from Meta and uses components the editor does not support. Edit it in Meta's dashboard.",
  "Etapa inválida": "Invalid stage",
  "Etapa no encontrada": "Stage not found",
  "Etiqueta no encontrada": "Tag not found",
  "Facebook no devolvió un token de acceso":
    "Facebook did not return an access token",
  "Falta la clave de API (cabecera Authorization: Bearer crm_…)":
    "Missing API key (Authorization: Bearer crm_… header)",
  "Faltan el App ID o el App secret de Meta (Ajustes › Integraciones) para subir el archivo de ejemplo.":
    "Meta App ID or App secret is missing (Settings › Integrations); both are needed to upload the sample file.",
  "Faltan el App ID o el App secret de Meta. Configúralos en Ajustes › Integraciones.":
    "Meta App ID or App secret is missing. Set them in Settings › Integrations.",
  "Faltan el App ID y el App secret de Meta. Configúralos en Ajustes › Integraciones.":
    "Meta App ID and App secret are missing. Set them in Settings › Integrations.",
  "Firma ausente": "Missing signature",
  "Firma inválida": "Invalid signature",
  "Flujo no encontrado": "Flow not found",
  "Fuente no encontrada": "Source not found",
  "Fuera de la ventana de 24h: solo se pueden enviar plantillas aprobadas.":
    "Outside the 24-hour window: only approved templates can be sent.",
  "La conexión con Facebook caducó. Vuelve a iniciar sesión.":
    "The Facebook connection expired. Please sign in again.",
  "La contraseña actual no es correcta": "Your current password is not correct",
  "La difusión ya está en curso.": "The broadcast is already running.",
  "La etapa tiene deals. Muévelos a otra etapa antes de borrarla.":
    "This stage still has deals. Move them to another stage before deleting it.",
  "La plantilla de bienvenida debe estar aprobada por Meta.":
    "The welcome template must be approved by Meta.",
  "La plantilla no está aprobada por Meta, así que no se puede enviar.":
    "This template is not approved by Meta, so it cannot be sent.",
  "La plantilla se usa en una difusión. Elimina antes esa difusión.":
    "This template is used by a broadcast. Delete that broadcast first.",
  "Las variables deben ir numeradas de forma consecutiva desde {{1}}.":
    "Variables must be numbered consecutively starting at {{1}}.",
  "Lead no encontrado": "Lead not found",
  "Mensaje no encontrado": "Message not found",
  "Meta no devolvió un access_token": "Meta did not return an access_token",
  "No hay etapas configuradas": "No pipeline stages are set up",
  "No hay etapas de pipeline configuradas en el CRM":
    "No pipeline stages are set up in the CRM",
  "No hay una cuenta de WhatsApp Business conectada. Conecta un número en Ajustes › WhatsApp.":
    "No WhatsApp Business account is connected. Connect a number in Settings › WhatsApp.",
  "No puedes desactivar tu propia cuenta": "You cannot deactivate your own account",
  "No puedes eliminar el bot por defecto. Crea otro y reasigna primero.":
    "You cannot delete the default agent. Create another one and reassign first.",
  "No puedes eliminar una difusión en curso.":
    "You cannot delete a broadcast while it is running.",
  "No puedes quitarte el rol de administrador":
    "You cannot remove your own admin role",
  "No se pudo canjear el código de Meta": "Could not exchange Meta's code",
  "No se recibió ningún archivo": "No file was received",
  "No tienes permiso para esta acción":
    "You do not have permission for this action",
  "Oportunidad no encontrada": "Deal not found",
  "Plantilla no encontrada": "Template not found",
  "Producto no encontrado": "Product not found",
  "Página no encontrada": "Page not found",
  "Refresh token inválido": "Invalid refresh token",
  "Refresh token reutilizado. Sesión revocada por seguridad.":
    "Refresh token reused. The session was revoked for security.",
  "Respuesta rápida no encontrada": "Quick reply not found",
  // Correo
  "Buzón no encontrado": "Mailbox not found",
  "Ese buzón ya está conectado": "That mailbox is already connected",
  "Vuelve a escribir la contraseña del buzón para guardar el cambio": "Type the mailbox password again to save this change",
  "Ese buzón es personal de otra persona del equipo": "That mailbox belongs to another team member",
  "Esa persona no es de tu equipo": "That person is not on your team",
  "Plantilla de correo no encontrada": "Email template not found",
  "Ya hay una plantilla de correo con ese nombre": "There is already an email template with that name",
  "Este contacto no tiene correo: escribe la dirección a la que enviar": "This contact has no email: type the address to send to",
  "Esa dirección no está en la lista de bajas": "That address is not on the unsubscribe list",
  "Ese correo no es una dirección válida": "That email is not a valid address",
  "Run de IA no encontrado": "AI run not found",
  "Sesión expirada": "Session expired",
  "Sesión no encontrada": "Session not found",
  "Sesión no válida": "Invalid session",
  "Solo se pueden editar difusiones en borrador o programadas.":
    "Only draft or scheduled broadcasts can be edited.",
  "Sube un archivo de ejemplo para el encabezado: Meta lo exige para aprobar la plantilla.":
    "Upload a sample file for the header: Meta requires it to review the template.",
  "Tu usuario de Facebook no administra ninguna página.":
    "Your Facebook user does not manage any page.",
  "Tu sesión expiró. Vuelve a iniciar sesión.":
    "Your session expired. Please sign in again.",
  "Usuario inactivo": "Inactive user",
  "Usuario no encontrado": "User not found",
  "verify_token inválido": "Invalid verify_token",
  "Esta empresa no tiene configurada su propia app de Meta": "This company has not set up its own Meta app",
  "Esta ruta solo existe bajo el subdominio de una empresa": "This route only exists under a company subdomain",
  "Empresa no encontrada": "Company not found",
  "Embudo no encontrado": "Pipeline not found",
  "La etapa de entrada no es de este embudo": "The entry stage does not belong to this pipeline",
  "No se puede eliminar el embudo predeterminado: marca otro como predeterminado primero": "The default pipeline cannot be deleted: make another one the default first",
  "El embudo tiene oportunidades. Muévelas o elimínalas antes de borrarlo.": "The pipeline has deals. Move or delete them before removing it.",
  "Las etapas a reordenar deben ser del mismo embudo": "Stages to reorder must belong to the same pipeline",
  "Se requiere code o accessToken": "Either code or accessToken is required",
  "No se pudo renovar tu sesión. Reintenta en unos segundos.":
    "Could not refresh your session. Try again in a few seconds.",
  "Plantilla no encontrada o no aprobada": "Template not found or not approved",
  "Combinación de botones no permitida por Meta":
    "Button combination not allowed by Meta",
  "Máximo 10 botones": "Maximum 10 buttons",
  "Máximo 2 botones de URL": "Maximum 2 URL buttons",
  "Máximo 1 botón de teléfono": "Maximum 1 phone button",
  "Máximo 1 botón de copiar código": "Maximum 1 copy-code button",
  "El archivo del encabezado ya no está disponible":
    "The header file is no longer available",
  "El archivo ya no está disponible en el almacenamiento":
    "The file is no longer available in storage",
  "Ya existe un contacto con ese teléfono":
    "A contact with that phone already exists",
  "Vendedor no encontrado": "Seller not found",
  "Ya existe una etiqueta con ese nombre": "A tag with that name already exists",
  "Webhook no encontrado": "Webhook not found",
  "Demasiadas altas desde esta conexión. Inténtalo dentro de una hora.":
    "Too many sign-ups from this connection. Try again in an hour.",
  "El pase ha caducado o no es válido": "The pass has expired or is not valid",
  "El pase no es válido": "The pass is not valid",
  "El registro público está desactivado. Pide a quien administra tu empresa que te invite, o crea una empresa nueva.":
    "Public sign-up is disabled. Ask whoever administers your company to invite you, or create a new company.",
  "Esa empresa no existe": "That company does not exist",
  "Ese subdominio está reservado, elige otro":
    "That subdomain is reserved, choose another one",
  "Esta instalación funciona con una sola empresa (TENANCY_MODE=single)":
    "This installation runs a single company (TENANCY_MODE=single)",
  "Este pase ya se usó": "This pass has already been used",
  "Falta el subdominio": "The subdomain is missing",
  "No hay organización en el contexto de esta operación":
    "There is no organization in the context of this operation",
  "Ese número de WhatsApp ya está conectado en otra empresa":
    "That WhatsApp number is already connected to another company",
  "Indica la dirección de tu empresa (subdominio)":
    "Enter your company address (subdomain)",
  "Esta clave no pertenece a la empresa de esta dirección":
    "This key does not belong to the company at this address",
  "Solo un administrador puede conectar números":
    "Only an administrator can connect numbers",
};

/**
 * Mensajes con datos dentro. Se lanzan con `i18n("clave", { … })` y el filtro
 * rellena los {marcadores} en el idioma que toque.
 */
export const DYNAMIC_MESSAGES = {
  "apiKey.missingScopes": {
    es: 'La clave "{name}" no tiene permiso para esto (falta: {missing})',
    en: 'The key "{name}" lacks permission for this (missing: {missing})',
  },
  "bot.channelTaken": {
    es: 'El canal ya está asignado al agente "{name}". Quítalo de ahí primero.',
    en: 'That channel is already assigned to the agent "{name}". Remove it there first.',
  },
  "template.metaRejected": {
    es: "Meta rechazó la plantilla: {reason}",
    en: "Meta rejected the template: {reason}",
  },
  "template.listFailed": {
    es: "No se pudieron leer las plantillas de Meta: {reason}",
    en: "Could not read your templates from Meta: {reason}",
  },
  "template.duplicate": {
    es: 'Ya existe una plantilla "{name}" en idioma {language}.',
    en: 'A template named "{name}" already exists in {language}.',
  },
  "template.variableMismatch": {
    es: "El cuerpo usa {used} variable(s) y hay {declared} definida(s). Deben coincidir.",
    en: "The body uses {used} variable(s) but {declared} are defined. They must match.",
  },
  "template.sendFailed": {
    es: "No se pudo enviar la plantilla: {reason}",
    en: "Could not send the template: {reason}",
  },
  "media.unsupportedType": {
    es: "Tipo no admitido: {mimeType}. Imágenes JPG/PNG/WebP o documentos PDF, Word, Excel, TXT y CSV.",
    en: "Unsupported type: {mimeType}. Images JPG/PNG/WebP or documents PDF, Word, Excel, TXT and CSV.",
  },
  "meta.uploadStartFailed": {
    es: "No se pudo iniciar la subida a Meta: {reason}",
    en: "Could not start the upload to Meta: {reason}",
  },
  "meta.uploadFailed": {
    es: "No se pudo subir el archivo de ejemplo a Meta: {reason}",
    en: "Could not upload the sample file to Meta: {reason}",
  },
  "meta.subscribeFailed": {
    es: "No se pudo suscribir la página: {reason}",
    en: "Could not subscribe the page: {reason}",
  },
  "meta.requestFailed": {
    es: "No se pudo {what}: {reason}",
    en: "Could not {what}: {reason}",
  },
  "product.skuTaken": {
    es: 'Ya existe un producto con el SKU "{sku}"',
    en: 'A product with SKU "{sku}" already exists',
  },
  "contact.phoneTaken": {
    es: "Ya existe un contacto con el teléfono {phone}",
    en: "A contact with phone {phone} already exists",
  },
  "contact.phoneNotFound": {
    es: "No hay ningún contacto con el teléfono {phone}",
    en: "There is no contact with phone {phone}",
  },
  "stage.notFoundNamed": {
    es: 'La etapa "{name}" no existe. Disponibles: {available}',
    en: 'Stage "{name}" does not exist. Available: {available}',
  },
  // Validación de payloads (ZodValidationPipe). {field} es la ruta del campo.
  "validation.required": { es: "{field}: es obligatorio", en: "{field}: is required" },
  "validation.minLength": { es: "{field}: mínimo {min} caracteres", en: "{field}: at least {min} characters" },
  "validation.maxLength": { es: "{field}: máximo {max} caracteres", en: "{field}: at most {max} characters" },
  "validation.minItems": { es: "{field}: añade al menos {min}", en: "{field}: add at least {min}" },
  "validation.maxItems": { es: "{field}: máximo {max} elementos", en: "{field}: at most {max} items" },
  "validation.min": { es: "{field}: debe ser al menos {min}", en: "{field}: must be at least {min}" },
  "validation.max": { es: "{field}: debe ser como mucho {max}", en: "{field}: must be at most {max}" },
  "validation.invalidType": { es: "{field}: valor no válido (se esperaba {expected})", en: "{field}: invalid value (expected {expected})" },
  "validation.invalidOption": { es: "{field}: opción no válida. Opciones: {options}", en: "{field}: invalid option. Options: {options}" },
  "validation.invalidFormat": { es: "{field}: formato no válido ({format})", en: "{field}: invalid format ({format})" },
  "validation.invalid": { es: "{field}: {reason}", en: "{field}: {reason}" },
  "quickReply.shortcutTaken": {
    es: "El atajo {shortcut} ya está en uso.",
    en: "The shortcut {shortcut} is already in use.",
  },
} as const;

export type DynamicMessageKey = keyof typeof DYNAMIC_MESSAGES;
