"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AiMode,
  ConversationStatus,
  MessageType,
  type AiSuggestion,
  type ConversationDto,
} from "@crm/shared";
import {
  assignConversation,
  fetchAgents,
  fetchMessages,
  fetchNotes,
  fetchCalls,
  fetchSources,
  markConversationRead,
  reactToMessage,
  sendMessage,
  setAiMode,
  setConversationStatus,
  setContactSource,
  resolveAiActions,
  suggestReply,
  uploadMedia,
  mediaSrc,
  type UploadedMedia,
} from "@/lib/bff";
import { toast } from "@/lib/toast";
import { MessageText } from "./MessageText";
import { SendTemplateDialog } from "./SendTemplateDialog";
import { SendButtonsDialog } from "./SendButtonsDialog";
import { MediaBubble } from "./MediaBubble";
import { AiModeSwitch } from "./AiModeSwitch";
import { Composer } from "./Composer";
import { ContactPanel, type ContactPanelTab } from "./ContactPanel";
import { useAiStatus } from "@/features/copilot/useAiStatus";
import { copilotRewrite } from "@/lib/bff";
import type { RewriteMode } from "@crm/shared";
import {
  AiTypingBubble,
  DaySeparator,
  MessageStatus,
  MessagesSkeleton,
  isNewDay,
} from "./ChatBits";
import { NavIcon } from "@/components/NavIcons";
import { useLocale, useT } from "@/i18n/I18nProvider";
import { useAiTyping } from "./aiTyping";
import { CallEntry } from "@/features/calls/CallEntry";
import { useCalls } from "@/features/calls/CallProvider";
import type { CallDto } from "@crm/shared";
import type { Translator } from "@/i18n/translate";
import type { MessageDto } from "@crm/shared";

/**
 * Cuánto queda de la ventana de 24 h de WhatsApp. Devuelve null si ya cerró:
 * el dato estaba en la API desde siempre y no se enseñaba en ningún sitio, así
 * que el vendedor solo se enteraba cuando ya era tarde para escribir libre.
 */
function windowLeft(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours} h` : `${minutes} min`;
}

export function ChatWindow({
  conversation,
  onBack,
  onCloseAndNext,
}: {
  conversation: ConversationDto;
  /** Móvil: volver a la lista. */
  onBack?: () => void;
  /** Cerrar esta conversación y abrir la siguiente de la lista. */
  onCloseAndNext?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  // Panel lateral (contacto / copiloto); null = cerrado.
  const [panel, setPanel] = useState<ContactPanelTab | null>(null);
  // Archivo ya subido y pendiente de enviar (se manda al pulsar Enviar).
  const [attachment, setAttachment] = useState<UploadedMedia | null>(null);
  // Mensaje citado en la respuesta que se está redactando.
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [buttonsOpen, setButtonsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [ai, setAi] = useState<AiSuggestion | null>(null);
  // Borrador antes de que el copiloto lo reescribiera (para Deshacer).
  const [beforeRewrite, setBeforeRewrite] = useState<string | null>(null);
  const { data: aiStatus } = useAiStatus();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // La cuenta atrás de la ventana se recalcula cada minuto; si no, un "quedan
  // 3 h" se queda congelado toda la tarde en la pantalla de quien no recarga.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!conversation.windowOpen) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [conversation.windowOpen]);

  /**
   * Adjunta un archivo que ya está guardado (el de una respuesta rápida), sin
   * volver a subirlo. El tamaño real no lo sabemos aquí y no hace falta: solo
   * se usa para el envío.
   */
  function attachSaved(mediaUrl: string, kind: "IMAGE" | "DOCUMENT") {
    setAttachment({
      mediaUrl,
      previewUrl: mediaSrc(mediaUrl) ?? "",
      kind,
      mimeType: kind === "IMAGE" ? "image/jpeg" : "application/octet-stream",
      size: 0,
      fileName: t("inbox.quickReplyFile"),
    });
  }

  const suggestMut = useMutation({
    mutationFn: () => suggestReply(conversation.id),
    onSuccess: (s) => {
      setAi(s);
      if (s.suggestion) setText(s.suggestion);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const rewriteMut = useMutation({
    mutationFn: ({ mode, language }: { mode: RewriteMode; language?: string }) =>
      copilotRewrite(conversation.id, { text, mode, language }),
    onSuccess: (r) => {
      setBeforeRewrite(text);
      setText(r.text);
    },
  });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", conversation.id],
    queryFn: () => fetchMessages(conversation.id),
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
  });

  // Las notas se piden siempre, no solo al abrir el panel: es lo que permite
  // que el botón lleve el número y que se vean sin tener que ir a buscarlas.
  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ["notes", conversation.id],
    queryFn: () => fetchNotes(conversation.id),
  });

  // Las llamadas van en el hilo, entre los mensajes, por fecha.
  const { data: calls = [] } = useQuery({
    queryKey: ["calls", conversation.id],
    queryFn: () => fetchCalls({ conversationId: conversation.id }),
  });
  const phone = useCalls();

  // Filtro del buscador: se aplica sobre lo ya cargado, sin ir al servidor.
  const searching = searchOpen && search.trim().length > 0;
  const visible = useMemo(() => {
    if (!searching) return messages;
    const q = search.trim().toLowerCase();
    return messages.filter((m) => (m.content ?? "").toLowerCase().includes(q));
  }, [messages, search, searching]);

  type TimelineItem = { kind: "msg"; m: MessageDto; at: string } | { kind: "call"; c: CallDto; at: string };
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = visible.map((m) => ({ kind: "msg", m, at: m.createdAt }));
    // Al buscar texto, el hilo deja de ser continuo: las llamadas no entran.
    if (!searching) for (const c of calls) items.push({ kind: "call", c, at: c.createdAt });
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [visible, calls, searching]);

  // La IA está redactando: o la pediste tú (copilot), o el servidor avisa de
  // que el autopilot está escribiendo. Antes se adivinaba («el último mensaje
  // es del contacto») y se quedaba encendido cuando la IA decidía no contestar.
  const serverTyping = useAiTyping(conversation.id);
  const aiThinking = suggestMut.isPending || serverTyping;

  const invalidateConvs = () =>
    queryClient.invalidateQueries({ queryKey: ["conversations"] });

  // Abrir el chat (o recibir mensajes con él abierto) lo marca como leído.
  useEffect(() => {
    if ((conversation.unreadCount ?? 0) === 0) return;
    void markConversationRead(conversation.id)
      .then(invalidateConvs)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, conversation.unreadCount]);

  const sendMut = useMutation({
    mutationFn: async () => {
      await sendMessage({
        conversationId: conversation.id,
        // Con adjunto va como IMAGE/DOCUMENT y el texto viaja de pie de foto.
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(attachment
          ? {
              type:
                attachment.kind === "IMAGE"
                  ? MessageType.IMAGE
                  : MessageType.DOCUMENT,
              mediaUrl: attachment.mediaUrl,
              caption: text.trim() || undefined,
            }
          : { type: MessageType.TEXT, text: text.trim() }),
      });
      // Enviar la respuesta es la aprobación: se aplican las acciones que la
      // IA dejó pendientes (etiquetar, mover de etapa…).
      if (ai?.runId && ai.pendingActions.length) {
        return resolveAiActions(conversation.id, ai.runId, true);
      }
      return null;
    },
    onSuccess: (result) => {
      setText("");
      setAttachment(null);
      setReplyTo(null);
      setAi(null);
      if (result?.executed.length) {
        toast.success(
          t("inbox.actionsApplied", { count: result.executed.length }),
        );
        // Las acciones tocan contacto, etiquetas y pipeline.
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
        queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      }
      for (const err of result?.errors ?? []) toast.error(err);
      queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] });
      invalidateConvs();
    },
  });

  // Descartar la sugerencia rechaza también sus acciones pendientes.
  const discardAi = () => {
    const current = ai;
    setAi(null);
    if (current?.runId && current.pendingActions.length) {
      void resolveAiActions(conversation.id, current.runId, false).catch(
        () => undefined,
      );
    }
  };

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadMedia(file),
    onSuccess: setAttachment,
    onError: (e) => toast.error((e as Error).message),
  });

  const reactMut = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      reactToMessage(messageId, emoji),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] }),
  });

  const { data: sources = [] } = useQuery({
    queryKey: ["sources"],
    queryFn: fetchSources,
  });

  const sourceMut = useMutation({
    mutationFn: (sourceId: string | null) =>
      setContactSource(conversation.contact.id, sourceId),
    onSuccess: invalidateConvs,
  });

  const assignMut = useMutation({
    mutationFn: (agentId: string | null) =>
      assignConversation(conversation.id, agentId),
    onSuccess: invalidateConvs,
  });

  const statusMut = useMutation({
    mutationFn: (status: ConversationStatus) =>
      setConversationStatus(conversation.id, status),
    onSuccess: invalidateConvs,
  });

  const aiModeMut = useMutation({
    mutationFn: (mode: AiMode) => setAiMode(conversation.id, mode),
    onSuccess: invalidateConvs,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, calls.length]);

  const left = conversation.windowOpen
    ? windowLeft(conversation.windowExpiresAt)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header className="chat-header" style={chatHeader}>
        <div className="chat-header__id" style={{ display: "flex", gap: 12, minWidth: 0, alignItems: "center", flex: "1 1 220px" }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              title={t("inbox.back")}
              aria-label={t("inbox.back")}
              style={toggleBtn(false)}
            >
              <NavIcon name="arrow-left" size={16} />
            </button>
          )}
          <span style={avatar} aria-hidden>
            {initials(conversation.contact.name ?? conversation.contact.phone)}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <strong style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {conversation.contact.name ?? conversation.contact.phone}
            </strong>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              {conversation.contact.phone}
            </span>
            {conversation.contact.tags.length > 0 && (
              <button
                type="button"
                className="chat-tags"
                onClick={() => setPanel("contact")}
                title={t("inbox.tags")}
              >
                {conversation.contact.tags.map((tag) => (
                  <span key={tag.name} style={tagChip(tag.color)}>
                    {tag.name}
                  </span>
                ))}
              </button>
            )}
          </div>
        </div>

        <div className="chat-header__tools" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {/* Cuánto queda de la ventana de 24 h: el dato que decide si puedes
              escribir libre o solo mandar una plantilla. */}
          {left && (
            <span
              style={windowChip}
              title={t("inbox.windowOpenTitle", { time: left })}
            >
              <NavIcon name="hourglass" size={12} />
              {t("inbox.windowOpenLeft", { time: left })}
            </span>
          )}

          <AiModeSwitch
            value={conversation.aiMode}
            paused={conversation.aiPaused}
            disabled={aiModeMut.isPending}
            onChange={(m) => aiModeMut.mutate(m)}
          />

          <button
            type="button"
            onClick={() =>
              phone.call(conversation.contact.phone, {
                name: conversation.contact.name,
                contactId: conversation.contact.id,
                conversationId: conversation.id,
              })
            }
            title={t("calls.call")}
            aria-label={t("calls.call")}
            style={toggleBtn(false)}
          >
            <NavIcon name="phone" size={16} />
          </button>

          <button
            type="button"
            onClick={() => {
              setSearchOpen((v) => !v);
              setSearch("");
            }}
            title={t("inbox.searchInThread")}
            aria-label={t("inbox.searchInThread")}
            aria-pressed={searchOpen}
            style={toggleBtn(searchOpen)}
          >
            <NavIcon name="search" size={16} />
          </button>

          <select
            value={conversation.assignedAgent?.id ?? ""}
            onChange={(e) => assignMut.mutate(e.target.value || null)}
            disabled={assignMut.isPending}
            title={t("inbox.assignTo")}
            aria-label={t("inbox.assignTo")}
            style={control}
          >
            <option value="">{t("inbox.unassigned")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email}
              </option>
            ))}
          </select>

          <select
            value={conversation.status}
            onChange={(e) =>
              statusMut.mutate(e.target.value as ConversationStatus)
            }
            disabled={statusMut.isPending}
            title={t("inbox.status")}
            aria-label={t("inbox.status")}
            style={control}
          >
            <option value={ConversationStatus.OPEN}>{t("inbox.statusOpen")}</option>
            <option value={ConversationStatus.PENDING}>
              {t("inbox.statusPending")}
            </option>
            <option value={ConversationStatus.CLOSED}>
              {t("inbox.statusClosed")}
            </option>
          </select>

          {onCloseAndNext && conversation.status !== ConversationStatus.CLOSED && (
            <button
              type="button"
              onClick={onCloseAndNext}
              title={t("inbox.closeAndNext")}
              aria-label={t("inbox.closeAndNext")}
              style={{ ...toggleBtn(false), width: "auto", padding: "0 10px", gap: 6 }}
            >
              <NavIcon name="check" size={15} />
              {t("inbox.closeAndNextShort")}
            </button>
          )}

          {/* Antes decía solo "Notas" y no se sabía si había alguna sin
              abrirlo. El número lo dice de un vistazo. */}
          <button
            type="button"
            onClick={() => setPanel((p) => (p ? null : "contact"))}
            title={t("inbox.detailsHint")}
            aria-pressed={panel !== null}
            style={{ ...toggleBtn(panel !== null), width: "auto", padding: "0 10px", gap: 6 }}
          >
            <NavIcon name="note" size={15} />
            {t("inbox.details")}
            {notes.length > 0 && <span style={countBadge}>{notes.length}</span>}
          </button>
        </div>
      </header>

      <div className="chat-body">
      <div className="chat-main">
      <div style={messagesArea}>
        {isLoading && <MessagesSkeleton />}
        {!isLoading && messages.length === 0 && calls.length === 0 && (
          <div style={emptyThread}>
            <NavIcon name="message" size={28} />
            <p style={{ margin: "10px 0 0", fontWeight: 600 }}>
              {t("inbox.emptyThread")}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>
              {t("inbox.emptyThreadHint")}
            </p>
          </div>
        )}
        {searching && visible.length === 0 && messages.length > 0 && (
          <div style={emptyThread}>
            <NavIcon name="search" size={24} />
            <p style={{ margin: "10px 0 0", fontSize: 13 }}>
              {t("inbox.noSearchMatches", { query: search.trim() })}
            </p>
          </div>
        )}
        {timeline.map((it, i) => (
          <Fragment key={it.kind === "msg" ? it.m.id : `call-${it.c.id}`}>
            {/* Sin búsqueda activa los separadores orientan; con ella
                estorbarían, porque el hilo ya no es continuo. */}
            {!searching && isNewDay(it.at, timeline[i - 1]?.at) && (
              <DaySeparator date={new Date(it.at)} />
            )}
            {it.kind === "msg" ? (
              <MessageBubble
                message={it.m}
                locale={locale}
                t={t}
                highlight={searching ? search.trim() : null}
                onReact={(emoji) => reactMut.mutate({ messageId: it.m.id, emoji })}
                onReply={() => setReplyTo(it.m)}
              />
            ) : (
              <CallEntry call={it.c} />
            )}
          </Fragment>
        ))}
        {aiThinking && <AiTypingBubble />}
        <div ref={bottomRef} />
      </div>

      {searchOpen && (
        <div style={searchBar}>
          <NavIcon name="search" size={15} />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("inbox.searchPlaceholder")}
            style={searchInput}
          />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {search.trim()
              ? t("inbox.searchResults", {
                  shown: visible.length,
                  total: messages.length,
                })
              : messages.length === 1
                ? t("inbox.threadMessagesOne")
                : t("inbox.threadMessagesOther", { count: messages.length })}
          </span>
          <button
            onClick={() => {
              setSearchOpen(false);
              setSearch("");
            }}
            style={{ ...control, padding: "5px 7px", cursor: "pointer" }}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <NavIcon name="x" size={14} />
          </button>
        </div>
      )}

      {ai && (
        <div style={ai.escalate ? aiBannerWarn : aiBanner}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <NavIcon name={ai.escalate ? "alert" : "sparkles"} size={15} />
            {ai.escalate ? (
              <span>
                {t("inbox.aiEscalate")}
                {ai.escalationReason ? `: ${ai.escalationReason}` : ""}.
              </span>
            ) : (
              <span>{t("inbox.aiLoaded")}</span>
            )}
          </span>
          {ai.pendingActions.length > 0 && (
            <div style={actionsBox}>
              <strong style={{ fontSize: 12 }}>{t("inbox.aiWillApply")}</strong>
              <ul style={{ margin: "5px 0 0", paddingLeft: 18 }}>
                {ai.pendingActions.map((a) => (
                  <li key={a.id} style={{ fontSize: 12.5 }}>
                    {a.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            {ai.classification && (
              <>
                {ai.classification.intent} ·{" "}
                {sentimentLabel(ai.classification.sentiment, t)}
                {ai.classification.urgency === "high"
                  ? ` · ${t("inbox.aiUrgent")}`
                  : ""}{" "}
                ·{" "}
              </>
            )}
            {ai.provider}/{ai.model}
            {ai.toolsUsed.length ? ` · ${ai.toolsUsed.join(", ")}` : ""}
            {" · "}
            <button onClick={discardAi} style={discardBtn}>
              {t("inbox.aiDiscard")}
            </button>
          </span>
        </div>
      )}

      {conversation.windowOpen ? (
        <Composer
          text={text}
          onTextChange={setText}
          onSend={() => sendMut.mutate()}
          sending={sendMut.isPending}
          attachment={attachment}
          onAttach={(f) => uploadMut.mutate(f)}
          onRemoveAttachment={() => setAttachment(null)}
          uploading={uploadMut.isPending}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          contact={conversation.contact}
          onAttachSaved={attachSaved}
          onOpenTemplates={() => setTemplateOpen(true)}
          onOpenButtons={() => setButtonsOpen(true)}
          onSuggest={() => suggestMut.mutate()}
          suggesting={suggestMut.isPending}
          copilot={{
            ready: !!aiStatus?.ready,
            busy: rewriteMut.isPending,
            onRewrite: (mode, language) => rewriteMut.mutate({ mode, language }),
            canUndo: beforeRewrite !== null,
            onUndo: () => {
              if (beforeRewrite !== null) setText(beforeRewrite);
              setBeforeRewrite(null);
            },
          }}
          windowOpen
        />
      ) : (
        <div style={windowClosed}>
          <span style={{ color: "var(--warning)", display: "inline-flex", flexShrink: 0 }}>
            <NavIcon name="hourglass" size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
            {t("inbox.windowClosedBody")}
          </div>
          <button
            onClick={() => setTemplateOpen(true)}
            style={sendTemplateBtn}
            type="button"
          >
            <NavIcon name="template" size={15} />
            {t("inbox.sendTemplate")}
          </button>
        </div>
      )}
      {sendMut.isError && (
        <div style={{ color: "var(--danger)", padding: "0 16px 12px", fontSize: 13 }}>
          {(sendMut.error as Error).message}
        </div>
      )}
      </div>

      {panel && (
        <ContactPanel
          conversation={conversation}
          tab={panel}
          onTab={setPanel}
          onClose={() => setPanel(null)}
          notes={notes}
          notesLoading={notesLoading}
          sources={sources}
          onSourceChange={(id) => sourceMut.mutate(id)}
          sourceSaving={sourceMut.isPending}
          onUseText={(v) => {
            setBeforeRewrite(text || null);
            setText(v);
          }}
        />
      )}
      </div>

      {templateOpen && (
        <SendTemplateDialog
          conversationId={conversation.id}
          onClose={() => setTemplateOpen(false)}
        />
      )}
      {buttonsOpen && (
        <SendButtonsDialog
          conversationId={conversation.id}
          onClose={() => setButtonsOpen(false)}
        />
      )}
    </div>
  );
}

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function MessageBubble({
  message: m,
  onReact,
  onReply,
  highlight,
  locale,
  t,
}: {
  message: MessageDto;
  onReact: (emoji: string) => void;
  onReply: () => void;
  highlight: string | null;
  locale: string;
  t: Translator;
}) {
  const out = m.direction === "OUTBOUND";
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      className="msg-row"
      style={{
        alignSelf: out ? "flex-end" : "flex-start",
        maxWidth: "78%",
        minWidth: 0,
        display: "flex",
        flexDirection: out ? "row-reverse" : "row",
        alignItems: "center",
        gap: 6,
        position: "relative",
      }}
    >
      <div
        style={{
          background: out ? "var(--bubble-out)" : "var(--surface-2)",
          color: "var(--text)",
          padding: "8px 12px",
          borderRadius: 10,
          position: "relative",
        }}
      >
        {/* Cita: qué se está respondiendo, como en WhatsApp. */}
        {m.replyTo && (
          <div style={quotedBlock}>
            <div style={quotedWho}>
              {m.replyTo.direction === "OUTBOUND"
                ? t("inbox.you")
                : t("inbox.customer")}
            </div>
            <div style={quotedText}>
              {m.replyTo.content || `[${m.replyTo.type.toLowerCase()}]`}
            </div>
          </div>
        )}
        {m.mediaUrl && (
          <MediaBubble mediaUrl={m.mediaUrl} type={m.type} caption={m.content} transcript={m.transcript ?? null} />
        )}
        {m.content ? (
          <MessageText text={m.content} highlight={highlight} />
        ) : (
          !m.mediaUrl && (
            <div style={{ opacity: 0.6 }}>[{m.type.toLowerCase()}]</div>
          )
        )}
        {m.buttons && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
            {m.buttons.map((b) => (
              <div key={b.id} style={messageButton}>
                {b.title}
              </div>
            ))}
          </div>
        )}
        <div style={metaRow(out)}>
          <span style={{ fontSize: 10.5, color: "rgba(230,237,246,0.45)" }}>
            {new Date(m.createdAt).toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {out && <MessageStatus status={m.status} author={m.author} />}
        </div>
        {m.reaction && (
          <span
            style={{
              position: "absolute",
              bottom: -10,
              [out ? "left" : "right"]: 8,
              background: "var(--field)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "0 5px",
              fontSize: 13,
              lineHeight: "18px",
            }}
          >
            {m.reaction}
          </span>
        )}
      </div>

      {/* Acciones del mensaje. Citar ya estaba hecho de punta a punta —el
          cuadro de abajo sabe mostrar la cita y el envío manda replyToId—
          pero no había ningún botón que lo disparara: la función existía y
          era inalcanzable. */}
      <div className="msg-actions" style={{ display: "flex", gap: 4 }}>
        <button
          className="msg-action"
          onClick={onReply}
          title={t("inbox.reply")}
          aria-label={t("inbox.reply")}
        >
          <NavIcon name="reply" size={13} />
        </button>
        <button
          className="msg-action"
          onClick={() => setPickerOpen((v) => !v)}
          title={t("inbox.react")}
          aria-label={t("inbox.react")}
        >
          <NavIcon name="smile" size={13} />
        </button>
      </div>

      {pickerOpen && (
        <>
          <div style={pickerBackdrop} onClick={() => setPickerOpen(false)} />
          <div style={emojiPicker}>
            {REACTIONS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  onReact(m.reaction === e ? "" : e);
                  setPickerOpen(false);
                }}
                style={{
                  ...emojiBtn,
                  background: m.reaction === e ? "var(--accent-soft)" : "transparent",
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const pickerBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 4,
};

const emojiPicker: React.CSSProperties = {
  position: "absolute",
  top: -42,
  display: "flex",
  gap: 2,
  background: "var(--field)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "4px 6px",
  zIndex: 5,
  boxShadow: "var(--shadow-overlay)",
};

const emojiBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 18,
  padding: "2px 3px",
  borderRadius: 6,
};

function tagChip(color: string | null): React.CSSProperties {
  const bg =
    color && /^#?[0-9a-fA-F]{3,8}$/.test(color)
      ? color.startsWith("#")
        ? color
        : `#${color}`
      : "#2c4b7a";
  return {
    fontSize: 11,
    padding: "1px 8px",
    borderRadius: 999,
    background: bg,
    color: "#eaf2ff",
  };
}

function sentimentLabel(s: string, t: Translator): string {
  if (s === "negative") return t("inbox.sentimentNegative");
  if (s === "positive") return t("inbox.sentimentPositive");
  return t("inbox.sentimentNeutral");
}

const chatHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
};

const control: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13,
};

// Botón que se queda encendido mientras su panel está abierto: el estado del
// panel se ve en el botón que lo abrió, no hay que buscarlo en la pantalla.
function toggleBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 32,
    width: 32,
    borderRadius: 8,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-soft)" : "var(--field)",
    color: active ? "var(--accent)" : "var(--muted)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "color 150ms, background 150ms, border-color 150ms",
  };
}

const countBadge: React.CSSProperties = {
  minWidth: 17,
  height: 17,
  padding: "0 5px",
  borderRadius: 999,
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontSize: 10.5,
  fontWeight: 700,
  display: "inline-grid",
  placeItems: "center",
};

const windowChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 32,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  color: "var(--muted)",
  fontSize: 11.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const messagesArea: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const messageButton: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "#53bdeb",
  textAlign: "center",
  borderRadius: 7,
  padding: "6px 8px",
  fontSize: 12.5,
};

const sendTemplateBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  flexShrink: 0,
  padding: "9px 14px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

const windowClosed: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 16,
  borderTop: "1px solid var(--border)",
  background: "var(--warning-soft)",
  color: "var(--text)",
};

// Iniciales del contacto: identidad sin pedir foto a nadie.
function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  const clean = value.replace(/\D/g, "");
  return (clean.slice(-2) || value.slice(0, 2)).toUpperCase();
}

const avatar: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: "50%",
  background: "var(--accent-soft)",
  color: "#9dc0ff",
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: "0.01em",
};

const searchBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "8px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--muted)",
};

const searchInput: React.CSSProperties = {
  flex: 1,
  padding: "6px 0",
  border: "none",
  background: "transparent",
  color: "var(--text)",
  fontSize: 13.5,
  outline: "none",
};

const emptyThread: React.CSSProperties = {
  margin: "auto",
  textAlign: "center",
  color: "var(--muted)",
  padding: 24,
};

// Cita dentro de la burbuja: barra de acento a la izquierda y texto apagado.
const quotedBlock: React.CSSProperties = {
  borderLeft: "3px solid var(--accent)",
  paddingLeft: 8,
  marginBottom: 6,
  opacity: 0.85,
};

const quotedWho: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#9dc0ff",
};

const quotedText: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--muted)",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

function metaRow(out: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    justifyContent: out ? "flex-end" : "flex-start",
    marginTop: 3,
  };
}

const aiBanner: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 12,
  padding: "8px 16px",
  borderTop: "1px solid var(--border)",
  background: "var(--accent-soft)",
  color: "var(--accent-text)",
  fontSize: 13,
};

// Ocupa toda la fila del banner (que es flex) para quedar bajo el texto.
const actionsBox: React.CSSProperties = {
  flexBasis: "100%",
  order: 3,
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

const discardBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 11,
  textDecoration: "underline",
  padding: 0,
};

const aiBannerWarn: React.CSSProperties = {
  ...aiBanner,
  background: "var(--warning-soft)",
  color: "var(--warning)",
};
