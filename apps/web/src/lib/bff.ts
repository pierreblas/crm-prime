"use client";

import type {
  CreateProductFieldInput,
  ProductFieldDto,
  UpdateProductFieldInput,
  DashboardDto,
  DashboardPeriod,
  AiUsagePeriod,
  AiUsageReport,
  AcceptKnowledgeSuggestionInput,
  AiStatus,
  AnalyzeKnowledgeResult,
  ContactMemory,
  CopilotAskInput,
  CopilotAskResult,
  CopilotRewriteInput,
  CopilotRewriteResult,
  CopilotSummary,
  ImportUrlInput,
  ImportUrlResult,
  KnowledgeIndexStatus,
  KnowledgeSuggestionDto,
  MyPlanDto,
  PlatformOrg,
  PlatformOverview,
  UpdatePlatformOrgInput,
  OnboardingDto,
  OnboardingStepKey,
  TourKey,
  AgentDto,
  AiMode,
  AiSuggestion,
  SessionDto,
  IngestKnowledgeInput,
  KnowledgeDocDto,
  KnowledgeHit,
  ContactDto,
  ConversationDto,
  ConversationFilter,
  ReplyFilter,
  ConversationStatus,
  CreateDealInput,
  UpdateDealInput,
  CreateStageInput,
  UpdateStageInput,
  CreatePipelineInput,
  UpdatePipelineInput,
  PipelineSummaryDto,
  PipelineView,
  StageDto,
  StageAutomationDto,
  CreateStageAutomationInput,
  UpdateStageAutomationInput,
  DealDto,
  MessageDto,
  NoteDto,
  PipelineDto,
  SendMessageInput,
  ConnectWhatsappInput,
  WhatsappChannel,
  ChannelTestResult,
  BotsResponse,
  BotDto,
  CreateBotInput,
  UpdateBotInput,
  FlowsResponse,
  FlowDto,
  CreateFlowInput,
  UpdateFlowInput,
  FlowAssistantRequest,
  FlowAssistantReply,
  PromptAssistantRequest,
  PromptAssistantReply,
  AiSettingsDto,
  UpdateAiSettingsInput,
  AiConnectionTest,
  ApiKeyDto,
  WebhookSubscriptionDto,
  CreateWebhookInput,
  CreatedWebhook,
  UpdateWebhookInput,
  WebhookTestResult,
  CreateApiKeyInput,
  CreatedApiKey,
  UpdateApiKeyInput,
  IntegrationSettingsDto,
  UpdateIntegrationSettingsInput,
  IntegrationTestResult,
  PlaygroundRequest,
  PlaygroundReply,
  ResolveActionsResult,
  TemplateDto,
  CreateTemplateInput,
  UpdateTemplateInput,
  CampaignDto,
  CampaignMeta,
  CreateCampaignInput,
  UpdateCampaignInput,
  AudiencePreview,
  SourceDto,
  CreateSourceInput,
  UpdateSourceInput,
  SellersResponse,
  SellerDto,
  CreateUserInput,
  UpdateUserInput,
  TagDto,
  CreateTagInput,
  UpdateTagInput,
  PublicUser,
  UpdateProfileInput,
  ChangePasswordInput,
  ProductDto,
  CreateProductInput,
  UpdateProductInput,
  ImportProductsInput,
  ImportProductsResult,
  MetaPageDto,
  MetaPagesAvailableResult,
  ConnectMetaPagesInput,
  UpdateMetaPageInput,
  MetaLeadDto,
  MetaLeadStatusValue,
  ContactListItem,
  ContactTagsDto,
  UpdateChannelInput,
  StageRef,
  UpdateContactInput,
  CreateContactInput,
  CustomFieldDto,
  CreateCustomFieldInput,
  UpdateCustomFieldInput,
  QuickReplyDto,
  CreateQuickReplyInput,
  UpdateQuickReplyInput,
  SyncTemplatesResult,
  SendInteractiveInput,
  SendTemplateMessageInput,
  ConnectTicketResult,
  ConnectHubStatus,
  UnreadCount,
  CallDto,
  CallToken,
  CallsConfig,
  CreateManualCallInput,
  UpdateCallInput,
  TwilioProvisionResult,
} from "@crm/shared";

// Fetchers del lado del cliente: llaman al BFF (mismo origen, cookie httpOnly).

let redirectingToLogin = false;

/**
 * fetch al BFF que cierra la sesión en el navegador cuando el servidor dice
 * que terminó: pasa por /auth/expired (borra la cookie) y vuelve aquí tras el
 * login. Mientras navega, la promesa no se resuelve para no disparar toasts de
 * error en todas las consultas a la vez.
 */
async function bffFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
  if (body?.code !== "SESSION_EXPIRED") return res;

  if (!redirectingToLogin) {
    redirectingToLogin = true;
    const back = window.location.pathname + window.location.search;
    window.location.assign(`/auth/expired?callbackUrl=${encodeURIComponent(back)}`);
  }
  return new Promise<Response>(() => {});
}

// Extrae el mensaje de error del backend (NestJS responde { message }) para
// mostrar algo útil en vez de un genérico. Cae al fallback si no hay cuerpo.
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    const msg = (data as { message?: string | string[] }).message;
    if (Array.isArray(msg)) return msg.join(", ");
    if (typeof msg === "string" && msg) return msg;
  } catch {
    /* sin cuerpo JSON */
  }
  return fallback;
}

export type ConversationListParams = {
  filter?: ConversationFilter;
  status?: ConversationStatus;
  reply?: ReplyFilter;
  /** Nombres de etiqueta que debe tener el contacto (FILTER_NONE = ninguna). */
  tags?: string[];
  sourceId?: string;
  agentId?: string;
  channelId?: string;
  /** Último mensaje entre estas fechas (ISO). */
  from?: string;
  to?: string;
  /** Nombre o teléfono del contacto. */
  q?: string;
};

export async function fetchConversations(params: ConversationListParams = {}): Promise<ConversationDto[]> {
  const sp = new URLSearchParams({ filter: params.filter ?? "all" });
  if (params.reply && params.reply !== "all") sp.set("reply", params.reply);
  if (params.status) sp.set("status", params.status);
  if (params.tags?.length) sp.set("tags", params.tags.join(","));
  for (const k of ["sourceId", "agentId", "channelId", "from", "to", "q"] as const) {
    if (params[k]) sp.set(k, params[k]!);
  }
  const res = await bffFetch(`/api/bff/conversations?${sp.toString()}`);
  if (!res.ok) throw new Error("No se pudieron cargar las conversaciones");
  return res.json();
}

export async function assignConversation(
  conversationId: string,
  agentId: string | null,
): Promise<ConversationDto> {
  const res = await bffFetch(`/api/bff/conversations/${conversationId}/assign`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  if (!res.ok) throw new Error("No se pudo asignar");
  return res.json();
}

/** Al abrir el chat: pone a cero los mensajes sin leer de la conversación. */
export async function markConversationRead(conversationId: string): Promise<void> {
  const res = await bffFetch(`/api/bff/conversations/${conversationId}/read`, { method: "PATCH" });
  if (!res.ok) throw new Error("No se pudo marcar como leída");
}

export async function setConversationStatus(
  conversationId: string,
  status: ConversationStatus,
): Promise<ConversationDto> {
  const res = await bffFetch(`/api/bff/conversations/${conversationId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("No se pudo cambiar el estado");
  return res.json();
}

export async function setAiMode(
  conversationId: string,
  mode: AiMode,
): Promise<ConversationDto> {
  const res = await bffFetch(`/api/bff/conversations/${conversationId}/ai-mode`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error("No se pudo cambiar el modo IA");
  return res.json();
}

export async function fetchNotes(conversationId: string): Promise<NoteDto[]> {
  const res = await bffFetch(`/api/bff/conversations/${conversationId}/notes`);
  if (!res.ok) throw new Error("No se pudieron cargar las notas");
  return res.json();
}

export async function addNote(
  conversationId: string,
  body: string,
): Promise<NoteDto> {
  const res = await bffFetch(`/api/bff/conversations/${conversationId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error("No se pudo agregar la nota");
  return res.json();
}

export async function fetchAgents(): Promise<AgentDto[]> {
  const res = await bffFetch("/api/bff/agents");
  if (!res.ok) throw new Error("No se pudieron cargar los agentes");
  return res.json();
}

// ── Sesiones / dispositivos ──────────────────────────────────
export async function fetchSessions(): Promise<SessionDto[]> {
  const res = await bffFetch("/api/bff/auth/sessions");
  if (!res.ok) throw new Error("No se pudieron cargar las sesiones");
  return res.json();
}

export async function revokeSession(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/auth/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo cerrar la sesión");
}

// ── Configuración del agente IA ──────────────────────────────
// ── Conexión de WhatsApp ─────────────────────────────────────
/** Alias, embudo de entrada y agente de IA de un número. Devuelve la lista actualizada. */
export async function updateWhatsappChannel(id: string, input: UpdateChannelInput): Promise<WhatsappChannel[]> {
  const res = await bffFetch(`/api/bff/whatsapp/connection/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await bffError(res, "No se pudo guardar el número"));
  const data = (await res.json()) as { channels: WhatsappChannel[] };
  return data.channels ?? [];
}

export async function fetchWhatsappChannels(): Promise<WhatsappChannel[]> {
  const res = await bffFetch("/api/bff/whatsapp/connection");
  if (!res.ok) throw new Error("No se pudo obtener el estado de WhatsApp");
  const data = (await res.json()) as { channels: WhatsappChannel[] };
  return data.channels ?? [];
}

export async function connectWhatsapp(
  input: ConnectWhatsappInput,
): Promise<WhatsappChannel[]> {
  const res = await bffFetch("/api/bff/whatsapp/connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo conectar WhatsApp");
  }
  const data = (await res.json()) as { channels: WhatsappChannel[] };
  return data.channels ?? [];
}

/**
 * Pase para conectar WhatsApp desde el conector en dominio fijo. En una
 * instalación de una sola empresa devuelve `connectUrl: null`: el SDK de Meta
 * carga en la propia página, como siempre.
 */
export async function requestWhatsappConnectTicket(): Promise<ConnectTicketResult> {
  const res = await bffFetch("/api/bff/whatsapp/connect/ticket", { method: "POST" });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo iniciar la conexión");
  }
  return (await res.json()) as ConnectTicketResult;
}

export async function fetchUnreadCount(): Promise<UnreadCount> {
  const res = await bffFetch("/api/bff/conversations/unread-count");
  if (!res.ok) throw new Error("No se pudo contar lo pendiente");
  return res.json();
}

export async function fetchWhatsappConnectStatus(): Promise<ConnectHubStatus> {
  const res = await bffFetch("/api/bff/whatsapp/connect/status");
  if (!res.ok) throw new Error("No se pudo comprobar el estado de la conexión");
  return res.json();
}

export async function disconnectWhatsapp(
  phoneNumberId: string,
): Promise<WhatsappChannel[]> {
  const res = await bffFetch("/api/bff/whatsapp/connection/disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumberId }),
  });
  if (!res.ok) throw new Error("No se pudo desconectar");
  const data = (await res.json()) as { channels: WhatsappChannel[] };
  return data.channels ?? [];
}

// ── Bots (agentes IA) ────────────────────────────────────────
export async function fetchBots(): Promise<BotsResponse> {
  const res = await bffFetch("/api/bff/bots");
  if (!res.ok) throw new Error("No se pudieron cargar los bots");
  return res.json();
}

export async function createBot(input: CreateBotInput): Promise<BotDto> {
  const res = await bffFetch("/api/bff/bots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo crear el agente"));
  return res.json();
}

export async function updateBot(
  id: string,
  input: UpdateBotInput,
): Promise<BotDto> {
  const res = await bffFetch(`/api/bff/bots/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar el agente"));
  return res.json();
}

export async function deleteBot(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/bots/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo eliminar el bot");
  }
}

// Playground: probar el agente IA sin enviar nada por WhatsApp.
export async function testAgent(
  input: PlaygroundRequest,
): Promise<PlaygroundReply> {
  const res = await bffFetch("/api/bff/bots/playground", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo probar el agente"));
  return res.json();
}

// Aplica o descarta las acciones que la IA dejó pendientes en un run.
export async function resolveAiActions(
  conversationId: string,
  runId: string,
  approve: boolean,
): Promise<ResolveActionsResult> {
  const res = await bffFetch(
    `/api/bff/conversations/${conversationId}/ai/runs/${runId}/actions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve }),
    },
  );
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudieron aplicar las acciones"));
  }
  return res.json();
}

/** Comprueba contra Meta que el token de un canal sigue valiendo. */
export async function testWhatsappChannel(
  phoneNumberId: string,
): Promise<ChannelTestResult> {
  const res = await bffFetch("/api/bff/whatsapp/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumberId }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo probar el canal"));
  return res.json();
}

// ── Claves de API (integraciones entrantes) ──────────────────
export async function fetchApiKeys(): Promise<ApiKeyDto[]> {
  const res = await bffFetch("/api/bff/api-keys");
  if (!res.ok) throw new Error("No se pudieron cargar las claves de API");
  return res.json();
}

// Única llamada que devuelve el secreto completo: hay que mostrarlo al vuelo.
export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<CreatedApiKey> {
  const res = await bffFetch("/api/bff/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo crear la clave"));
  return res.json();
}

export async function updateApiKey(
  id: string,
  input: UpdateApiKeyInput,
): Promise<ApiKeyDto> {
  const res = await bffFetch(`/api/bff/api-keys/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar la clave"));
  return res.json();
}

export async function revokeApiKey(id: string): Promise<ApiKeyDto> {
  const res = await bffFetch(`/api/bff/api-keys/${id}/revoke`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo revocar la clave"));
  return res.json();
}

export async function deleteApiKey(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/api-keys/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo eliminar la clave"));
}

// ── Webhooks salientes (el CRM avisa a otros sistemas) ───────
export async function fetchWebhooksOut(): Promise<WebhookSubscriptionDto[]> {
  const res = await bffFetch("/api/bff/webhooks-out");
  if (!res.ok) throw new Error("No se pudieron cargar los webhooks");
  return res.json();
}

export async function createWebhookOut(
  input: CreateWebhookInput,
): Promise<CreatedWebhook> {
  const res = await bffFetch("/api/bff/webhooks-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo crear el webhook"));
  return res.json();
}

export async function updateWebhookOut(
  id: string,
  input: UpdateWebhookInput,
): Promise<WebhookSubscriptionDto> {
  const res = await bffFetch(`/api/bff/webhooks-out/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar"));
  return res.json();
}

export async function deleteWebhookOut(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/webhooks-out/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo eliminar"));
}

export async function testWebhookOut(id: string): Promise<WebhookTestResult> {
  const res = await bffFetch(`/api/bff/webhooks-out/${id}/test`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo probar"));
  return res.json();
}

// ── Llamadas telefónicas ─────────────────────────────────────
export async function fetchCallsConfig(): Promise<CallsConfig> {
  const res = await bffFetch("/api/bff/calls/config");
  if (!res.ok) throw new Error("No se pudo saber si hay llamadas configuradas");
  return res.json();
}

export async function fetchCallToken(): Promise<CallToken> {
  const res = await bffFetch("/api/bff/calls/token", { method: "POST" });
  if (!res.ok) throw new Error(await bffError(res, "No se pudo iniciar el teléfono"));
  return res.json();
}

export async function fetchCalls(filter: { conversationId?: string; contactId?: string }): Promise<CallDto[]> {
  const sp = new URLSearchParams();
  if (filter.conversationId) sp.set("conversationId", filter.conversationId);
  if (filter.contactId) sp.set("contactId", filter.contactId);
  const res = await bffFetch(`/api/bff/calls?${sp.toString()}`);
  if (!res.ok) throw new Error("No se pudieron cargar las llamadas");
  return res.json();
}

export async function logManualCall(input: CreateManualCallInput): Promise<CallDto> {
  const res = await bffFetch("/api/bff/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await bffError(res, "No se pudo registrar la llamada"));
  return res.json();
}

export async function updateCall(idOrSid: string, input: UpdateCallInput): Promise<CallDto> {
  const res = await bffFetch(`/api/bff/calls/${encodeURIComponent(idOrSid)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await bffError(res, "No se pudo guardar la llamada"));
  return res.json();
}

export async function provisionTwilio(): Promise<TwilioProvisionResult> {
  const res = await bffFetch("/api/bff/calls/provision", { method: "POST" });
  if (!res.ok) throw new Error(await bffError(res, "No se pudo activar Twilio"));
  return res.json();
}

// ── Integraciones (credenciales que consume el CRM) ──────────
export async function fetchIntegrationSettings(): Promise<IntegrationSettingsDto> {
  const res = await bffFetch("/api/bff/integrations");
  if (!res.ok) throw new Error("No se pudieron cargar las integraciones");
  return res.json();
}

export async function updateIntegrationSettings(
  input: UpdateIntegrationSettingsInput,
): Promise<IntegrationSettingsDto> {
  const res = await bffFetch("/api/bff/integrations", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudieron guardar las integraciones"));
  }
  return res.json();
}

export async function testIntegration(): Promise<IntegrationTestResult> {
  const res = await bffFetch("/api/bff/integrations/test", { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo probar"));
  return res.json();
}

// ── Medios del inbox (imágenes y documentos) ─────────────────
export interface UploadedMedia {
  mediaUrl: string; // referencia interna, es lo que se manda en sendMessage
  previewUrl: string;
  kind: "IMAGE" | "DOCUMENT";
  mimeType: string;
  size: number;
  fileName: string;
}

export async function uploadMedia(file: File): Promise<UploadedMedia> {
  const form = new FormData();
  form.append("file", file);
  // Sin Content-Type a mano: el navegador pone el boundary del multipart.
  const res = await bffFetch("/api/bff/media", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo subir el archivo"));
  return res.json();
}

/** URL para pintar un medio en el CRM a partir de su referencia interna. */
export function mediaSrc(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith("storage://")) {
    return `/api/bff/media/${mediaUrl.slice("storage://".length)}`;
  }
  // URL externa (o un medio antiguo previo al almacenamiento propio).
  return mediaUrl.startsWith("http") ? mediaUrl : null;
}

// ── Flujos (constructor visual) ──────────────────────────────
export async function fetchFlows(): Promise<FlowsResponse> {
  const res = await bffFetch("/api/bff/flows");
  if (!res.ok) throw new Error("No se pudieron cargar los flujos");
  return res.json();
}

export async function fetchFlow(id: string): Promise<FlowDto> {
  const res = await bffFetch(`/api/bff/flows/${id}`);
  if (!res.ok) throw new Error("No se pudo cargar el flujo");
  return res.json();
}

export async function createFlow(input: CreateFlowInput): Promise<FlowDto> {
  const res = await bffFetch("/api/bff/flows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo crear el flujo");
  }
  return res.json();
}

export async function updateFlow(
  id: string,
  input: UpdateFlowInput,
): Promise<FlowDto> {
  const res = await bffFetch(`/api/bff/flows/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo guardar el flujo");
  }
  return res.json();
}

export async function deleteFlow(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/flows/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar el flujo");
}

// Asistente IA del constructor: propone un grafo, no lo guarda.
export async function askFlowAssistant(
  input: FlowAssistantRequest,
): Promise<FlowAssistantReply> {
  const res = await bffFetch("/api/bff/flows/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "El asistente no pudo responder"));
  }
  return res.json();
}

// Asistente de redacción: propone instrucciones o mensajes para un agente.
export async function askPromptAssistant(
  input: PromptAssistantRequest,
): Promise<PromptAssistantReply> {
  const res = await bffFetch("/api/bff/bots/prompt-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "El asistente no pudo responder"));
  }
  return res.json();
}

// ── Ajustes de IA (proveedor + API key) ──────────────────────
export async function fetchAiSettings(): Promise<AiSettingsDto> {
  const res = await bffFetch("/api/bff/ai-settings");
  if (!res.ok) throw new Error("No se pudieron cargar los ajustes de IA");
  return res.json();
}

export async function updateAiSettings(
  input: UpdateAiSettingsInput,
): Promise<AiSettingsDto> {
  const res = await bffFetch("/api/bff/ai-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudieron guardar los ajustes"));
  }
  return res.json();
}

export async function testAiConnection(): Promise<AiConnectionTest> {
  const res = await bffFetch("/api/bff/ai-settings/test", { method: "POST" });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudo probar la conexión"));
  }
  return res.json();
}

// ── Plantillas ───────────────────────────────────────────────
export async function fetchTemplates(): Promise<TemplateDto[]> {
  const res = await bffFetch("/api/bff/templates");
  if (!res.ok) throw new Error("No se pudieron cargar las plantillas");
  return res.json();
}

export async function createTemplate(
  input: CreateTemplateInput,
): Promise<TemplateDto> {
  const res = await bffFetch("/api/bff/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo crear la plantilla");
  }
  return res.json();
}

export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<TemplateDto> {
  const res = await bffFetch(`/api/bff/templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo guardar la plantilla");
  return res.json();
}

/** Trae del panel de Meta las plantillas ya creadas y sus estados. */
export async function syncTemplates(): Promise<SyncTemplatesResult> {
  const res = await bffFetch("/api/bff/templates/sync", { method: "POST" });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudo sincronizar con Meta"));
  }
  return res.json();
}

// ── Respuestas rápidas del agente ────────────────────────────
export async function fetchQuickReplies(): Promise<QuickReplyDto[]> {
  const res = await bffFetch("/api/bff/quick-replies");
  if (!res.ok) throw new Error("No se pudieron cargar las respuestas rápidas");
  return res.json();
}

export async function createQuickReply(
  input: CreateQuickReplyInput,
): Promise<QuickReplyDto> {
  const res = await bffFetch("/api/bff/quick-replies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo crear"));
  return res.json();
}

export async function updateQuickReply(
  id: string,
  input: UpdateQuickReplyInput,
): Promise<QuickReplyDto> {
  const res = await bffFetch(`/api/bff/quick-replies/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar"));
  return res.json();
}

export async function deleteQuickReply(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/quick-replies/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo eliminar"));
}

// ── Formularios de Meta (Lead Ads) ───────────────────────────
export async function fetchMetaPages(): Promise<MetaPageDto[]> {
  const res = await bffFetch("/api/bff/meta/pages");
  if (!res.ok) throw new Error("No se pudieron cargar las páginas");
  return res.json();
}

/** Paso 1: qué páginas administra el usuario que acaba de entrar con Facebook. */
export async function fetchAvailableMetaPages(
  code: string,
): Promise<MetaPagesAvailableResult> {
  const res = await bffFetch("/api/bff/meta/pages/available", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudo leer tus páginas"));
  }
  return res.json();
}

/** Paso 2: conectar y suscribir las elegidas. */
export async function connectMetaPages(
  input: ConnectMetaPagesInput,
): Promise<MetaPageDto[]> {
  const res = await bffFetch("/api/bff/meta/pages/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudieron conectar las páginas"));
  }
  return res.json();
}

export async function updateMetaPage(
  id: string,
  input: UpdateMetaPageInput,
): Promise<MetaPageDto[]> {
  const res = await bffFetch(`/api/bff/meta/pages/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar"));
  return res.json();
}

export async function resubscribeMetaPage(id: string): Promise<MetaPageDto[]> {
  const res = await bffFetch(`/api/bff/meta/pages/${id}/resubscribe`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo suscribir"));
  return res.json();
}

export async function disconnectMetaPage(id: string): Promise<MetaPageDto[]> {
  const res = await bffFetch(`/api/bff/meta/pages/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo desconectar"));
  return res.json();
}

export async function fetchMetaLeads(
  status?: MetaLeadStatusValue,
): Promise<MetaLeadDto[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await bffFetch(`/api/bff/meta/leads${qs}`);
  if (!res.ok) throw new Error("No se pudieron cargar los leads");
  return res.json();
}

export async function convertMetaLead(
  id: string,
  phone: string,
): Promise<{ contactId: string }> {
  const res = await bffFetch(`/api/bff/meta/leads/${id}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo convertir"));
  return res.json();
}

export async function discardMetaLead(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/meta/leads/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo descartar"));
}

// ── Envíos especiales desde el chat ──────────────────────────
/** Mensaje con botones (sin plantilla; solo dentro de las 24h). */
export async function sendInteractive(
  input: SendInteractiveInput,
): Promise<MessageDto> {
  const res = await bffFetch("/api/bff/messages/interactive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudo enviar el mensaje"));
  }
  return res.json();
}

/** Plantilla aprobada: también funciona fuera de la ventana de 24h. */
export async function sendTemplateMessage(
  input: SendTemplateMessageInput,
): Promise<MessageDto> {
  const res = await bffFetch("/api/bff/messages/template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudo enviar la plantilla"));
  }
  return res.json();
}

export async function deleteTemplate(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/templates/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo eliminar la plantilla");
  }
}

// ── Difusiones ───────────────────────────────────────────────
export async function fetchCampaigns(): Promise<CampaignDto[]> {
  const res = await bffFetch("/api/bff/campaigns");
  if (!res.ok) throw new Error("No se pudieron cargar las difusiones");
  return res.json();
}

export async function fetchCampaignMeta(): Promise<CampaignMeta> {
  const res = await bffFetch("/api/bff/campaigns/meta");
  if (!res.ok) throw new Error("No se pudieron cargar los datos de la difusión");
  return res.json();
}

export async function fetchAudiencePreview(
  tagIds: string[],
): Promise<AudiencePreview> {
  const res = await bffFetch(
    `/api/bff/campaigns/audience?tagIds=${encodeURIComponent(tagIds.join(","))}`,
  );
  if (!res.ok) throw new Error("No se pudo calcular la audiencia");
  return res.json();
}

export async function createCampaign(
  input: CreateCampaignInput,
): Promise<CampaignDto> {
  const res = await bffFetch("/api/bff/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo crear la difusión");
  }
  return res.json();
}

export async function updateCampaign(
  id: string,
  input: UpdateCampaignInput,
): Promise<CampaignDto> {
  const res = await bffFetch(`/api/bff/campaigns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo guardar la campaña");
  return res.json();
}

export async function launchCampaign(id: string): Promise<CampaignDto> {
  const res = await bffFetch(`/api/bff/campaigns/${id}/launch`, { method: "POST" });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo lanzar la campaña");
  }
  return res.json();
}

export async function cancelCampaign(id: string): Promise<CampaignDto> {
  const res = await bffFetch(`/api/bff/campaigns/${id}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error("No se pudo cancelar la campaña");
  return res.json();
}

export async function deleteCampaign(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/campaigns/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo eliminar la campaña");
  }
}

// ── Base de conocimiento (RAG) ───────────────────────────────
export async function fetchKnowledge(): Promise<KnowledgeDocDto[]> {
  const res = await bffFetch("/api/bff/knowledge");
  if (!res.ok) throw new Error("No se pudo cargar la base de conocimiento");
  return res.json();
}

export async function ingestKnowledge(
  input: IngestKnowledgeInput,
): Promise<KnowledgeDocDto> {
  const res = await bffFetch("/api/bff/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo guardar el documento");
  }
  return res.json();
}

export async function deleteKnowledge(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/knowledge/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar el documento");
}

export async function searchKnowledge(q: string): Promise<KnowledgeHit[]> {
  const res = await bffFetch(`/api/bff/knowledge/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("La búsqueda falló");
  return res.json();
}

// ── IA (copilot) ─────────────────────────────────────────────
export async function suggestReply(
  conversationId: string,
): Promise<AiSuggestion> {
  const res = await bffFetch(
    `/api/bff/conversations/${conversationId}/ai/suggest`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error("La IA no pudo generar una sugerencia");
  return res.json();
}

export async function fetchMessages(
  conversationId: string,
): Promise<MessageDto[]> {
  const res = await bffFetch(`/api/bff/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error("No se pudieron cargar los mensajes");
  return res.json();
}

export async function sendMessage(input: SendMessageInput): Promise<MessageDto> {
  const res = await bffFetch("/api/bff/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { message?: string | string[] }
      | null;
    const msg = Array.isArray(body?.message)
      ? body?.message.join(", ")
      : body?.message;
    throw new Error(msg ?? "No se pudo enviar el mensaje");
  }
  return res.json();
}

export async function reactToMessage(
  messageId: string,
  emoji: string,
): Promise<MessageDto> {
  const res = await bffFetch("/api/bff/messages/react", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, emoji }),
  });
  if (!res.ok) throw new Error("No se pudo reaccionar");
  return res.json();
}

// ── Fuentes y vendedores ─────────────────────────────────────
export async function fetchSources(): Promise<SourceDto[]> {
  const res = await bffFetch("/api/bff/sources");
  if (!res.ok) throw new Error("No se pudieron cargar las fuentes");
  return res.json();
}

export async function createSource(input: CreateSourceInput): Promise<SourceDto> {
  const res = await bffFetch("/api/bff/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo crear la fuente");
  }
  return res.json();
}

export async function updateSource(
  id: string,
  input: UpdateSourceInput,
): Promise<SourceDto> {
  const res = await bffFetch(`/api/bff/sources/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo guardar la fuente");
  return res.json();
}

export async function deleteSource(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/sources/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar la fuente");
}

export async function fetchSellers(): Promise<SellersResponse> {
  const res = await bffFetch("/api/bff/sellers");
  if (!res.ok) throw new Error("No se pudieron cargar los vendedores");
  return res.json();
}

export async function assignSellerSources(
  sellerId: string,
  sourceIds: string[],
): Promise<void> {
  const res = await bffFetch(`/api/bff/sellers/${sellerId}/sources`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceIds }),
  });
  if (!res.ok) throw new Error("No se pudo asignar");
}

// ── Etiquetas ────────────────────────────────────────────────
export async function fetchTags(): Promise<TagDto[]> {
  const res = await bffFetch("/api/bff/tags");
  if (!res.ok) throw new Error("No se pudieron cargar las etiquetas");
  return res.json();
}

export async function createTag(input: CreateTagInput): Promise<TagDto> {
  const res = await bffFetch("/api/bff/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo crear la etiqueta"));
  return res.json();
}

export async function updateTag(
  id: string,
  input: UpdateTagInput,
): Promise<TagDto> {
  const res = await bffFetch(`/api/bff/tags/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar la etiqueta"));
  return res.json();
}

export async function deleteTag(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/tags/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar la etiqueta");
}

// ── Gestión de usuarios del equipo (admin) ───────────────────
export async function createUser(input: CreateUserInput): Promise<SellerDto> {
  const res = await bffFetch("/api/bff/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo crear el usuario"));
  return res.json();
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<SellerDto> {
  const res = await bffFetch(`/api/bff/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo actualizar el usuario"));
  return res.json();
}

// ── Perfil / cuenta ──────────────────────────────────────────
export async function fetchMe(): Promise<PublicUser> {
  const res = await bffFetch("/api/bff/auth/me");
  if (!res.ok) throw new Error("No se pudo cargar tu perfil");
  return res.json();
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<PublicUser> {
  const res = await bffFetch("/api/bff/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar el perfil"));
  return res.json();
}

export async function changePassword(
  input: ChangePasswordInput,
): Promise<void> {
  const res = await bffFetch("/api/bff/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok)
    throw new Error(await errorMessage(res, "No se pudo cambiar la contraseña"));
}

export async function revokeOtherSessions(): Promise<void> {
  const res = await bffFetch("/api/bff/auth/sessions", { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudieron cerrar las otras sesiones");
}

export async function setContactSource(
  contactId: string,
  sourceId: string | null,
): Promise<void> {
  const res = await bffFetch("/api/bff/contacts/source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, sourceId }),
  });
  if (!res.ok) throw new Error("No se pudo cambiar la fuente");
}

// ── Contactos (directorio) ───────────────────────────────────
export async function fetchContactDirectory(
  search = "",
): Promise<ContactListItem[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await bffFetch(`/api/bff/contacts/directory${qs}`);
  if (!res.ok) throw new Error("No se pudieron cargar los contactos");
  return res.json();
}

/** Ficha de un contacto (lo mismo que una fila del directorio). */
export async function fetchContact(id: string): Promise<ContactListItem> {
  const res = await bffFetch(`/api/bff/contacts/${id}`);
  if (!res.ok) throw new Error("No se pudo cargar el contacto");
  return res.json();
}

/** Etiquetas del contacto como conjunto final (las nuevas se crean). */
export async function setContactTags(id: string, tags: string[]): Promise<ContactTagsDto> {
  const res = await bffFetch(`/api/bff/contacts/${id}/tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw new Error(await bffError(res, "No se pudieron guardar las etiquetas"));
  return res.json();
}

export async function updateContact(
  id: string,
  input: UpdateContactInput,
): Promise<void> {
  const res = await bffFetch(`/api/bff/contacts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo guardar el contacto");
}

export async function createContact(
  input: CreateContactInput,
): Promise<{ id: string }> {
  const res = await bffFetch("/api/bff/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo crear el contacto");
  }
  return res.json();
}

// ── Campos personalizados ────────────────────────────────────
export async function fetchCustomFields(): Promise<CustomFieldDto[]> {
  const res = await bffFetch("/api/bff/custom-fields");
  if (!res.ok) throw new Error("No se pudieron cargar los campos");
  return res.json();
}

export async function createCustomField(
  input: CreateCustomFieldInput,
): Promise<CustomFieldDto> {
  const res = await bffFetch("/api/bff/custom-fields", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo crear el campo");
  return res.json();
}

export async function updateCustomField(
  id: string,
  input: UpdateCustomFieldInput,
): Promise<CustomFieldDto> {
  const res = await bffFetch(`/api/bff/custom-fields/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo guardar el campo");
  return res.json();
}

export async function deleteCustomField(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/custom-fields/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar el campo");
}

// ── Campos personalizados del catálogo ───────────────────────
export async function fetchProductFields(): Promise<ProductFieldDto[]> {
  const res = await bffFetch("/api/bff/product-fields");
  if (!res.ok) throw new Error("No se pudieron cargar los campos");
  return res.json();
}

export async function createProductField(input: CreateProductFieldInput): Promise<ProductFieldDto> {
  const res = await bffFetch("/api/bff/product-fields", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo crear el campo"));
  return res.json();
}

export async function updateProductField(id: string, input: UpdateProductFieldInput): Promise<ProductFieldDto> {
  const res = await bffFetch(`/api/bff/product-fields/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar el campo"));
  return res.json();
}

export async function reorderProductFields(ids: string[]): Promise<ProductFieldDto[]> {
  const res = await bffFetch("/api/bff/product-fields/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("No se pudo cambiar el orden");
  return res.json();
}

export async function deleteProductField(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/product-fields/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar el campo");
}

// ── Productos ────────────────────────────────────────────────
export async function fetchProducts(search = ""): Promise<ProductDto[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await bffFetch(`/api/bff/products${qs}`);
  if (!res.ok) throw new Error("No se pudieron cargar los productos");
  return res.json();
}

export async function createProduct(
  input: CreateProductInput,
): Promise<ProductDto> {
  const res = await bffFetch("/api/bff/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo crear el producto");
  }
  return res.json();
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  const res = await bffFetch(`/api/bff/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo guardar el producto");
  return res.json();
}

/** Importación masiva: las filas ya vienen leídas y normalizadas del CSV. */
export async function importProducts(
  input: ImportProductsInput,
): Promise<ImportProductsResult> {
  const res = await bffFetch("/api/bff/products/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "No se pudo importar el archivo"));
  }
  return res.json();
}

export async function deleteProduct(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/products/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar el producto");
}

// ── Pipeline ─────────────────────────────────────────────────
/** Tablero de un embudo (sin id: el predeterminado). `view` = abiertas o descartadas. */
export async function fetchPipeline(
  pipelineId?: string,
  view: PipelineView = "open",
): Promise<PipelineDto> {
  const q = new URLSearchParams();
  if (pipelineId) q.set("id", pipelineId);
  if (view !== "open") q.set("view", view);
  const qs = q.toString();
  const res = await bffFetch(`/api/bff/pipeline${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("No se pudo cargar el pipeline");
  return res.json();
}

// ── Embudos ──────────────────────────────────────────────────
export async function createPipeline(input: CreatePipelineInput): Promise<PipelineSummaryDto> {
  const res = await bffFetch("/api/bff/pipelines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await bffError(res, "No se pudo crear el embudo"));
  return res.json();
}

export async function updatePipeline(
  id: string,
  input: UpdatePipelineInput,
): Promise<PipelineSummaryDto> {
  const res = await bffFetch(`/api/bff/pipelines/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await bffError(res, "No se pudo guardar el embudo"));
  return res.json();
}

export async function deletePipeline(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/pipelines/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await bffError(res, "No se pudo eliminar el embudo"));
}

export async function reorderPipelines(ids: string[]): Promise<void> {
  const res = await bffFetch("/api/bff/pipelines/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("No se pudo reordenar los embudos");
}

export async function discardDeal(dealId: string, reason?: string): Promise<DealDto> {
  const res = await bffFetch(`/api/bff/deals/${dealId}/discard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error("No se pudo descartar la oportunidad");
  return res.json();
}

export async function restoreDeal(dealId: string): Promise<DealDto> {
  const res = await bffFetch(`/api/bff/deals/${dealId}/restore`, { method: "POST" });
  if (!res.ok) throw new Error("No se pudo restaurar la oportunidad");
  return res.json();
}

/** Mensaje de error de la API si lo hay; si no, el de respaldo. */
async function bffError(res: Response, fallback: string): Promise<string> {
  const b = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = Array.isArray(b?.message) ? b?.message[0] : b?.message;
  return m ?? fallback;
}

/** Oportunidades abiertas de un contacto, la más reciente primero. */
export async function fetchContactDeals(contactId: string): Promise<DealDto[]> {
  const res = await bffFetch(`/api/bff/deals?contactId=${encodeURIComponent(contactId)}`);
  if (!res.ok) throw new Error("No se pudieron cargar las oportunidades");
  return res.json();
}

/** Etapas de todos los embudos; el predeterminado va primero. */
export async function fetchStages(): Promise<StageRef[]> {
  const res = await bffFetch("/api/bff/stages");
  if (!res.ok) throw new Error("No se pudieron cargar las etapas");
  return res.json();
}

export async function createDeal(input: CreateDealInput): Promise<DealDto> {
  const res = await bffFetch("/api/bff/deals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo crear el deal");
  return res.json();
}

export async function moveDeal(
  dealId: string,
  stageId: string,
): Promise<DealDto> {
  const res = await bffFetch(`/api/bff/deals/${dealId}/stage`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stageId }),
  });
  if (!res.ok) throw new Error("No se pudo mover el deal");
  return res.json();
}

export async function updateDeal(
  dealId: string,
  input: UpdateDealInput,
): Promise<DealDto> {
  const res = await bffFetch(`/api/bff/deals/${dealId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo guardar el deal");
  return res.json();
}

export async function deleteDeal(dealId: string): Promise<void> {
  const res = await bffFetch(`/api/bff/deals/${dealId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar el deal");
}

// ── Etapas del pipeline ──────────────────────────────────────
export async function createStage(input: CreateStageInput): Promise<StageDto> {
  const res = await bffFetch("/api/bff/stages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo crear la etapa");
  return res.json();
}

export async function updateStage(
  id: string,
  input: UpdateStageInput,
): Promise<StageDto> {
  const res = await bffFetch(`/api/bff/stages/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("No se pudo guardar la etapa");
  return res.json();
}

// ── Automatizaciones de etapa ──
export async function createStageAutomation(
  stageId: string,
  input: CreateStageAutomationInput,
): Promise<StageAutomationDto> {
  const res = await bffFetch(`/api/bff/stages/${stageId}/automations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo crear la automatización");
  }
  return res.json();
}

export async function updateStageAutomation(
  id: string,
  input: UpdateStageAutomationInput,
): Promise<StageAutomationDto> {
  const res = await bffFetch(`/api/bff/stage-automations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo guardar la automatización");
  }
  return res.json();
}

export async function deleteStageAutomation(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/stage-automations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("No se pudo eliminar la automatización");
}

export async function deleteStage(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/stages/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(b?.message ?? "No se pudo eliminar la etapa");
  }
}

export async function reorderStages(ids: string[]): Promise<void> {
  const res = await bffFetch("/api/bff/stages/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("No se pudo reordenar");
}

export async function fetchContacts(search = ""): Promise<ContactDto[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await bffFetch(`/api/bff/contacts${qs}`);
  if (!res.ok) throw new Error("No se pudieron cargar los contactos");
  return res.json();
}

export async function fetchRealtimeToken(): Promise<string> {
  const res = await bffFetch("/api/bff/realtime-token");
  if (!res.ok) throw new Error("No se pudo obtener el token de realtime");
  const data = (await res.json()) as { token: string };
  return data.token;
}

// ── Primeros pasos (onboarding con seguimiento) ────────────

export async function fetchOnboarding(): Promise<OnboardingDto> {
  const res = await bffFetch("/api/bff/onboarding");
  if (!res.ok) throw new Error("No se pudo cargar Primeros pasos");
  return res.json();
}

export async function skipOnboardingStep(key: OnboardingStepKey, skipped: boolean): Promise<void> {
  const res = await bffFetch(`/api/bff/onboarding/steps/${key}/skip`, {
    method: skipped ? "POST" : "DELETE",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo actualizar el paso"));
}

export async function dismissOnboarding(dismissed: boolean): Promise<void> {
  const res = await bffFetch("/api/bff/onboarding/dismiss", {
    method: dismissed ? "POST" : "DELETE",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar la preferencia"));
}

/** Un tour visto: si falla, no pasa nada grave (volverá a salir). */
export async function markTourSeen(key: TourKey): Promise<void> {
  await bffFetch(`/api/bff/onboarding/tours/${key}`, { method: "POST" }).catch(() => undefined);
}

// ── Planes y consola de plataforma ─────────────────────────

export async function fetchMyPlan(): Promise<MyPlanDto> {
  const res = await bffFetch("/api/bff/plans/me");
  if (!res.ok) throw new Error("No se pudo cargar tu plan");
  return res.json();
}

export async function fetchPlatformOverview(): Promise<PlatformOverview> {
  const res = await bffFetch("/api/bff/platform/overview");
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudieron cargar las cifras"));
  return res.json();
}

export async function fetchPlatformOrgs(search = ""): Promise<PlatformOrg[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await bffFetch(`/api/bff/platform/orgs${qs}`);
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudieron cargar las empresas"));
  return res.json();
}

export async function updatePlatformOrg(id: string, input: UpdatePlatformOrgInput): Promise<PlatformOrg> {
  const res = await bffFetch(`/api/bff/platform/orgs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo guardar"));
  return res.json();
}

// ── Copiloto (con la clave de IA de la empresa) ────────────

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchAiStatus(): Promise<AiStatus> {
  const res = await bffFetch("/api/bff/ai/status");
  if (!res.ok) throw new Error("No se pudo comprobar la IA");
  return res.json();
}

export async function copilotRewrite(conversationId: string, input: CopilotRewriteInput): Promise<CopilotRewriteResult> {
  const res = await bffFetch(`/api/bff/ai/conversations/${conversationId}/rewrite`, json(input));
  if (!res.ok) throw new Error(await errorMessage(res, "La IA no pudo reescribir el mensaje"));
  return res.json();
}

export async function copilotSummary(conversationId: string): Promise<CopilotSummary> {
  const res = await bffFetch(`/api/bff/ai/conversations/${conversationId}/summary`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "La IA no pudo resumir la conversación"));
  return res.json();
}

export async function copilotAsk(conversationId: string, input: CopilotAskInput): Promise<CopilotAskResult> {
  const res = await bffFetch(`/api/bff/ai/conversations/${conversationId}/ask`, json(input));
  if (!res.ok) throw new Error(await errorMessage(res, "La IA no pudo responder"));
  return res.json();
}

export async function fetchContactMemory(conversationId: string): Promise<ContactMemory> {
  const res = await bffFetch(`/api/bff/ai/conversations/${conversationId}/memory`);
  if (!res.ok) throw new Error("No se pudo cargar la memoria del cliente");
  return res.json();
}

export async function refreshContactMemory(conversationId: string): Promise<ContactMemory> {
  const res = await bffFetch(`/api/bff/ai/conversations/${conversationId}/memory`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo actualizar la memoria"));
  return res.json();
}

// ── Conocimiento: índice, web y preguntas sin respuesta ────

export async function fetchKnowledgeStatus(): Promise<KnowledgeIndexStatus> {
  const res = await bffFetch("/api/bff/knowledge/status");
  if (!res.ok) throw new Error("No se pudo cargar el estado del conocimiento");
  return res.json();
}

export async function reindexKnowledge(): Promise<{ docs: number; chunks: number }> {
  const res = await bffFetch("/api/bff/knowledge/reindex", { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo reindexar"));
  return res.json();
}

export async function importKnowledgeUrl(input: ImportUrlInput): Promise<ImportUrlResult> {
  const res = await bffFetch("/api/bff/knowledge/import-url", json(input));
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo importar la página"));
  return res.json();
}

export async function fetchKnowledgeSuggestions(): Promise<KnowledgeSuggestionDto[]> {
  const res = await bffFetch("/api/bff/knowledge/suggestions");
  if (!res.ok) throw new Error("No se pudieron cargar las preguntas sin respuesta");
  return res.json();
}

export async function analyzeKnowledge(): Promise<AnalyzeKnowledgeResult> {
  const res = await bffFetch("/api/bff/knowledge/suggestions/analyze", { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudieron analizar las conversaciones"));
  return res.json();
}

export async function acceptKnowledgeSuggestion(id: string, input: AcceptKnowledgeSuggestionInput): Promise<void> {
  const res = await bffFetch(`/api/bff/knowledge/suggestions/${id}/accept`, json(input));
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo añadir al conocimiento"));
}

export async function dismissKnowledgeSuggestion(id: string): Promise<void> {
  const res = await bffFetch(`/api/bff/knowledge/suggestions/${id}/dismiss`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo descartar"));
}

export async function fetchAiUsage(period: AiUsagePeriod): Promise<AiUsageReport> {
  const res = await bffFetch(`/api/bff/ai/usage?period=${period}`);
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo cargar el consumo de IA"));
  return res.json();
}

export async function fetchDashboard(period: DashboardPeriod, tz: string, pipelineId?: string): Promise<DashboardDto> {
  const qs = new URLSearchParams({ period, tz });
  if (pipelineId) qs.set("pipelineId", pipelineId);
  const res = await bffFetch(`/api/bff/dashboard?${qs.toString()}`);
  if (!res.ok) throw new Error(await errorMessage(res, "No se pudo cargar el panel"));
  return res.json();
}
