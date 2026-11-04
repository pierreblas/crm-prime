"use client";

import { emptyMessageLabel } from "./emptyMessage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MessageDto, QuickReplyDto, RewriteMode } from "@crm/shared";
import { renderQuickReply } from "@crm/shared";
import { fetchQuickReplies, mediaSrc, type UploadedMedia } from "@/lib/bff";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";
import { EmojiPicker } from "./EmojiPicker";

/**
 * Cuadro de redacción del inbox.
 *
 * La barra tenía cinco iconos sueltos en fila y dos de ellos no decían lo que
 * hacían: "plantilla" usaba el icono de archivo (igual que adjuntar) y
 * "mensaje con botones" repetía el rayo de las respuestas rápidas. Ahora lo
 * que *manda contenido* vive en un menú «+» con su nombre y una línea de
 * ayuda, y en la barra solo quedan las acciones de uso continuo: emoji,
 * respuestas rápidas, IA y enviar.
 */
export function Composer({
  text,
  onTextChange,
  onSend,
  sending,
  attachment,
  onAttach,
  onRemoveAttachment,
  uploading,
  replyTo,
  onCancelReply,
  contact,
  onAttachSaved,
  onOpenTemplates,
  onOpenButtons,
  windowOpen,
  onSuggest,
  suggesting,
  copilot,
}: {
  text: string;
  onTextChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  attachment: UploadedMedia | null;
  onAttach: (file: File) => void;
  onRemoveAttachment: () => void;
  uploading: boolean;
  replyTo: MessageDto | null;
  onCancelReply: () => void;
  /** Para sustituir {{nombre}} y {{telefono}} en las respuestas rápidas. */
  contact?: { name?: string | null; phone?: string | null };
  /** Adjunta un archivo ya guardado (el de una respuesta rápida). */
  onAttachSaved: (mediaUrl: string, kind: "IMAGE" | "DOCUMENT") => void;
  onOpenTemplates: () => void;
  onOpenButtons: () => void;
  /** Dentro de las 24h se puede escribir libre; fuera, solo plantillas. */
  windowOpen: boolean;
  /** Pide a la IA un borrador y lo carga en el cuadro. */
  onSuggest: () => void;
  suggesting: boolean;
  /** Copiloto: reescribir o traducir el borrador con la clave de la empresa. */
  copilot?: {
    ready: boolean;
    busy: boolean;
    onRewrite: (mode: RewriteMode, language?: string) => void;
    canUndo: boolean;
    onUndo: () => void;
  };
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  // Las respuestas rápidas solo se piden cuando el usuario abre el menú.
  const { data: quickReplies = [] } = useQuery({
    queryKey: ["quick-replies"],
    queryFn: fetchQuickReplies,
    enabled: quickOpen,
  });

  // Crecer con el contenido, con tope para no comerse el hilo.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  // Al citar, el foco va al cuadro: se responde escribiendo, sin clic extra.
  useEffect(() => {
    if (replyTo) areaRef.current?.focus();
  }, [replyTo]);

  // "/" al principio del cuadro sigue abriendo las respuestas rápidas y va
  // filtrando; el botón de la barra abre la lista entera sin escribir nada.
  const slashQuery = useMemo(
    () => (text.startsWith("/") ? text.slice(1).toLowerCase().trim() : null),
    [text],
  );
  const matches = useMemo(() => {
    if (!quickOpen) return [];
    const q = slashQuery ?? "";
    return quickReplies
      .filter(
        (r) =>
          !q ||
          r.shortcut.slice(1).toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.body.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [quickReplies, quickOpen, slashQuery]);

  useEffect(() => {
    if (slashQuery !== null) setQuickOpen(true);
  }, [slashQuery]);

  const canSend = (!!text.trim() || !!attachment) && !sending;
  const thumb = attachment?.kind === "IMAGE" ? mediaSrc(attachment.mediaUrl) : null;

  function closeMenus() {
    setMenuOpen(false);
    setCopilotOpen(false);
    setEmojiOpen(false);
    setQuickOpen(false);
  }

  /**
   * Inserta el emoji donde está el cursor y lo deja justo detrás. Añadirlo al
   * final sería lo fácil, pero rompe la escritura en cuanto el vendedor vuelve
   * atrás a corregir una palabra.
   */
  function insertEmoji(emoji: string) {
    const el = areaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    onTextChange(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const at = start + emoji.length;
      el.setSelectionRange(at, at);
    });
  }

  /** Inserta la respuesta rápida, ya con el nombre del contacto sustituido. */
  function insertQuickReply(q: QuickReplyDto) {
    onTextChange(renderQuickReply(q.body, contact ?? {}));
    if (q.mediaUrl && q.mediaType) onAttachSaved(q.mediaUrl, q.mediaType);
    setQuickOpen(false);
    areaRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && (quickOpen || emojiOpen || menuOpen || copilotOpen)) {
      closeMenus();
      return;
    }
    // Enter envía; Shift+Enter (o Alt) hace salto de línea.
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      // Solo se inserta la respuesta rápida si el cuadro empieza por "/": es
      // el modo en que Enter "completa". Con el panel abierto desde el botón,
      // el texto escrito es un mensaje real y Enter debe enviarlo.
      if (slashQuery !== null && quickOpen && matches[0]) {
        e.preventDefault();
        insertQuickReply(matches[0]);
        return;
      }
      e.preventDefault();
      if (canSend) onSend();
    }
  }

  // Lo que manda contenido distinto del texto. Cada entrada dice su nombre y
  // para qué sirve, en vez de dejarlo en un icono que hay que adivinar.
  const actions: {
    icon: IconName;
    labelKey: MessageKey;
    hintKey: MessageKey;
    onClick: () => void;
    disabled?: boolean;
    disabledHintKey?: MessageKey;
  }[] = [
    {
      icon: "paperclip",
      labelKey: "inbox.attach",
      hintKey: "inbox.attachHint",
      onClick: () => fileRef.current?.click(),
      disabled: uploading || !!attachment,
      disabledHintKey: "inbox.attachTaken",
    },
    {
      icon: "template",
      labelKey: "inbox.templateAction",
      hintKey: "inbox.templateHint",
      onClick: onOpenTemplates,
    },
    {
      icon: "buttons",
      labelKey: "inbox.buttonsAction",
      hintKey: "inbox.buttonsHint",
      onClick: onOpenButtons,
      disabled: !windowOpen,
      disabledHintKey: "inbox.buttonsClosed",
    },
  ];

  return (
    <div style={wrap} data-tour="inbox-composer">
      {/* Cierra al pulsar fuera. El selector de emojis no entra aquí: ya
          vigila por su cuenta el clic fuera y la tecla Esc. */}
      {(menuOpen || copilotOpen || (quickOpen && slashQuery === null)) && (
        <div style={backdrop} onClick={closeMenus} />
      )}

      {/* Respuesta citada */}
      {replyTo && (
        <div style={quoteBar}>
          <span style={quoteIcon}>
            <NavIcon name="reply" size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={quoteWho}>
              {replyTo.direction === "OUTBOUND" ? t("inbox.you") : t("inbox.customer")}
            </div>
            <div style={quoteText}>
              {replyTo.content || replyTo.note || emptyMessageLabel(replyTo.type, t)}
            </div>
          </div>
          <button
            onClick={onCancelReply}
            style={chipBtn}
            title={t("inbox.quoteRemove")}
            aria-label={t("inbox.quoteRemove")}
          >
            <NavIcon name="x" size={14} />
          </button>
        </div>
      )}

      {/* Adjunto pendiente de enviar: con miniatura si es una imagen, porque
          "archivo.jpg" no dice si te equivocaste de foto. */}
      {attachment && (
        <div style={quoteBar}>
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={attachment.fileName} style={thumbImg} />
          ) : (
            <span style={quoteIcon}>
              <NavIcon name="file" size={16} />
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={quoteWho}>{attachment.fileName}</div>
            <div style={quoteText}>
              {attachment.size > 0
                ? attachment.size < 1024 * 1024
                  ? `${Math.round(attachment.size / 1024)} KB`
                  : `${(attachment.size / 1024 / 1024).toFixed(1)} MB`
                : t("inbox.quickReplyFile")}
            </div>
          </div>
          <button
            onClick={onRemoveAttachment}
            style={chipBtn}
            title={t("inbox.removeAttachment")}
            aria-label={t("inbox.removeAttachment")}
          >
            <NavIcon name="x" size={14} />
          </button>
        </div>
      )}

      {/* El copiloto reescribió el borrador: se puede volver atrás. */}
      {copilot?.canUndo && (
        <div style={quoteBar}>
          <span style={quoteIcon}>
            <NavIcon name="wand" size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--muted)" }}>
            {t("inbox.copilotRewritten")}
          </div>
          <button type="button" onClick={copilot.onUndo} style={{ ...chipBtn, width: "auto", padding: "0 10px", fontSize: 12.5 }}>
            {t("inbox.copilotUndo")}
          </button>
        </div>
      )}

      {/* Copiloto: mejorar, cambiar el tono o traducir el borrador */}
      {copilotOpen && copilot && (
        <div style={actionMenu} role="menu" aria-label={t("inbox.copilotMenu")}>
          {COPILOT_ACTIONS.map((a) => {
            const off = !text.trim();
            return (
              <button
                key={a.key}
                role="menuitem"
                disabled={off}
                onClick={() => {
                  setCopilotOpen(false);
                  copilot.onRewrite(a.mode, a.language);
                }}
                title={off ? t("inbox.copilotEmptyDraft") : undefined}
                style={{ ...menuItem(off), padding: "7px 10px" }}
              >
                <span style={{ ...menuIcon, width: 28, height: 28 }}>
                  <NavIcon name={a.icon} size={15} />
                </span>
                <strong style={{ fontSize: 13 }}>{t(a.labelKey)}</strong>
              </button>
            );
          })}
        </div>
      )}

      {/* Menú «+»: adjuntar, plantilla y botones */}
      {menuOpen && (
        <div style={actionMenu} role="menu">
          {actions.map((a) => {
            const off = !!a.disabled;
            return (
              <button
                key={a.labelKey}
                role="menuitem"
                disabled={off}
                onClick={() => {
                  setMenuOpen(false);
                  a.onClick();
                }}
                title={off && a.disabledHintKey ? t(a.disabledHintKey) : undefined}
                style={menuItem(off)}
              >
                <span style={menuIcon}>
                  <NavIcon name={a.icon} size={17} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13 }}>{t(a.labelKey)}</strong>
                  <span style={menuHint}>
                    {off && a.disabledHintKey ? t(a.disabledHintKey) : t(a.hintKey)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Respuestas rápidas */}
      {quickOpen && (
        <div style={quickPanel}>
          <div style={quickHead}>
            <NavIcon name="zap" size={13} />
            {t("inbox.quickReplies")}
            <span style={{ marginLeft: "auto", opacity: 0.7 }}>
              {slashQuery !== null ? t("inbox.quickRepliesKeys") : "Esc"}
            </span>
          </div>
          {matches.length === 0 ? (
            <div style={quickEmpty}>
              {quickReplies.length === 0
                ? t("inbox.noQuickReplies")
                : t("inbox.noQuickMatches")}
            </div>
          ) : (
            matches.map((q, i) => (
              <button
                key={q.id}
                onClick={() => insertQuickReply(q)}
                style={quickItem(slashQuery !== null && i === 0)}
              >
                <strong
                  style={{
                    fontSize: 12.5,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  {q.shortcut} · {q.title}
                  {q.mediaUrl && <NavIcon name="paperclip" size={12} />}
                </strong>
                <span style={quickBody}>{q.body}</span>
              </button>
            ))
          )}
        </div>
      )}

      {emojiOpen && (
        <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
      )}

      <div style={bar}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onAttach(f);
            e.target.value = "";
          }}
        />

        <BarButton
          icon={uploading ? "clock" : "plus"}
          label={uploading ? t("inbox.attachUploading") : t("inbox.moreActions")}
          active={menuOpen}
          disabled={uploading}
          onClick={() => {
            setEmojiOpen(false);
            setQuickOpen(false);
            setMenuOpen((v) => !v);
          }}
        />

        <BarButton
          icon="smile"
          label={t("inbox.emojis")}
          active={emojiOpen}
          onClick={() => {
            setMenuOpen(false);
            setQuickOpen(false);
            setEmojiOpen((v) => !v);
          }}
        />

        <BarButton
          icon="zap"
          label={t("inbox.quickReplies")}
          active={quickOpen}
          onClick={() => {
            setMenuOpen(false);
            setEmojiOpen(false);
            setQuickOpen((v) => !v);
            areaRef.current?.focus();
          }}
        />

        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            attachment
              ? t("inbox.placeholderCaption")
              : t("inbox.placeholderQuickHint")
          }
          style={area}
        />

        {copilot && (
          <BarButton
            icon="wand"
            label={
              !copilot.ready
                ? t("inbox.copilotNoKey")
                : copilot.busy
                  ? t("inbox.copilotRewriting")
                  : t("inbox.copilotMenu")
            }
            active={copilotOpen}
            disabled={!copilot.ready || copilot.busy}
            busy={copilot.busy}
            onClick={() => {
              setMenuOpen(false);
              setEmojiOpen(false);
              setQuickOpen(false);
              setCopilotOpen((v) => !v);
            }}
          />
        )}

        <BarButton
          icon="sparkles"
          label={suggesting ? t("inbox.aiSuggesting") : t("inbox.aiSuggestHint")}
          disabled={suggesting}
          busy={suggesting}
          onClick={onSuggest}
        />

        <button
          type="button"
          onClick={() => canSend && onSend()}
          disabled={!canSend}
          title={sending ? t("inbox.sending") : t("inbox.sendHint")}
          aria-label={sending ? t("inbox.sending") : t("inbox.sendHint")}
          style={sendBtn(canSend)}
        >
          {sending ? <Spinner /> : <NavIcon name="send" size={17} />}
        </button>
      </div>
    </div>
  );
}

/** Lo que el copiloto sabe hacer con el borrador. */
const COPILOT_ACTIONS: { key: string; icon: IconName; labelKey: MessageKey; mode: RewriteMode; language?: string }[] = [
  { key: "improve", icon: "wand", labelKey: "inbox.copilotImprove", mode: "improve" },
  { key: "friendly", icon: "smile", labelKey: "inbox.copilotFriendly", mode: "friendly" },
  { key: "formal", icon: "user", labelKey: "inbox.copilotFormal", mode: "formal" },
  { key: "shorter", icon: "filter", labelKey: "inbox.copilotShorter", mode: "shorter" },
  { key: "grammar", icon: "check", labelKey: "inbox.copilotGrammar", mode: "grammar" },
  { key: "tr-customer", icon: "globe", labelKey: "inbox.copilotTranslateCustomer", mode: "translate", language: "customer" },
  { key: "tr-en", icon: "globe", labelKey: "inbox.copilotTranslateEn", mode: "translate", language: "inglés" },
  { key: "tr-pt", icon: "globe", labelKey: "inbox.copilotTranslatePt", mode: "translate", language: "portugués" },
];

/** Botón de la barra: mismo tamaño y mismo acento para todos. */
function BarButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  busy,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        ...iconBtn,
        color: active ? "var(--accent)" : "var(--muted)",
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--accent-soft)" : "transparent",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !busy ? 0.5 : 1,
      }}
    >
      {busy ? <Spinner /> : <NavIcon name={icon} size={18} />}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 15,
        height: 15,
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        opacity: 0.8,
        animation: "spin 0.8s linear infinite",
        display: "inline-block",
      }}
    />
  );
}

const wrap: React.CSSProperties = {
  position: "relative",
  borderTop: "1px solid var(--border)",
  background: "var(--panel)",
};

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 15,
};

const bar: React.CSSProperties = {
  // Por encima del fondo que cierra los menús, para que se pueda saltar de un
  // botón a otro sin que el primer clic se gaste solo en cerrar.
  position: "relative",
  zIndex: 16,
  display: "flex",
  alignItems: "flex-end",
  gap: 8,
  padding: "10px 16px",
};

const area: React.CSSProperties = {
  flex: 1,
  minHeight: 38,
  maxHeight: 160,
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  lineHeight: 1.45,
  fontFamily: "inherit",
  resize: "none",
  overflowY: "auto",
};

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  flexShrink: 0,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  transition: "color 150ms, background 150ms, border-color 150ms",
};

const chipBtn: React.CSSProperties = {
  ...iconBtn,
  width: 28,
  height: 28,
  borderColor: "transparent",
};

function sendBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    flexShrink: 0,
    borderRadius: 10,
    border: "none",
    background: active ? "var(--accent)" : "var(--field)",
    color: active ? "var(--accent-ink)" : "var(--muted)",
    cursor: active ? "pointer" : "default",
    transition: "background 160ms cubic-bezier(0.22,1,0.36,1)",
  };
}

const quoteBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 16px",
  borderTop: "1px solid var(--border)",
  background: "rgba(154, 185, 194, 0.03)",
};

const quoteIcon: React.CSSProperties = {
  color: "var(--accent-text)",
  display: "inline-flex",
  flexShrink: 0,
};

const thumbImg: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 6,
  objectFit: "cover",
  flexShrink: 0,
};

const quoteWho: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: "var(--accent-text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const quoteText: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const panelBase: React.CSSProperties = {
  position: "absolute",
  bottom: "100%",
  marginBottom: 8,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  boxShadow: "var(--shadow-overlay)",
  overflow: "hidden",
  zIndex: 20,
};

const actionMenu: React.CSSProperties = {
  ...panelBase,
  left: 16,
  width: 290,
  maxWidth: "calc(100% - 32px)",
  padding: 6,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

function menuItem(disabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    padding: "9px 10px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: disabled ? "var(--muted)" : "var(--text)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

const menuIcon: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 32,
  height: 32,
  borderRadius: 8,
  background: "var(--field)",
  color: "var(--accent-text)",
  flexShrink: 0,
};

const menuHint: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--muted)",
  lineHeight: 1.35,
};

const quickPanel: React.CSSProperties = {
  ...panelBase,
  left: 16,
  right: 16,
};

const quickHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--muted)",
  borderBottom: "1px solid var(--border)",
};

const quickEmpty: React.CSSProperties = {
  padding: "12px",
  fontSize: 12.5,
  color: "var(--muted)",
};

function quickItem(first: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: "100%",
    textAlign: "left",
    padding: "9px 12px",
    border: "none",
    background: first ? "var(--accent-soft)" : "transparent",
    color: "var(--text)",
    cursor: "pointer",
  };
}

const quickBody: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
