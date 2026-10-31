"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateQuickReplyInput, QuickReplyDto } from "@crm/shared";
import {
  createQuickReply,
  deleteQuickReply,
  fetchQuickReplies,
  updateQuickReply,
  uploadMedia,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";

/**
 * Respuestas rápidas: textos guardados que el vendedor inserta escribiendo su
 * atajo ("/precio") en el chat. Son mensajes normales, así que solo sirven
 * dentro de la ventana de 24h; fuera de ella hay que usar una plantilla.
 */
export function QuickRepliesSettings() {
  const queryClient = useQueryClient();
  const { data: replies, isPending } = useQuery({
    queryKey: ["quick-replies"],
    queryFn: fetchQuickReplies,
  });
  const [editing, setEditing] = useState<QuickReplyDto | "new" | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["quick-replies"] });

  const remove = useMutation({
    mutationFn: deleteQuickReply,
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, maxWidth: 560 }}>
          Textos que el equipo reutiliza a diario. En el chat se insertan
          escribiendo su atajo, por ejemplo <code>/precio</code>. Puedes usar{" "}
          <code>{"{{nombre}}"}</code> y <code>{"{{telefono}}"}</code>, y adjuntar
          una imagen o un documento.
        </p>
        <button onClick={() => setEditing("new")} style={primaryBtn}>
          + Nueva
        </button>
      </div>

      {editing && (
        <QuickReplyForm
          reply={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}

      {isPending && <p style={{ color: "var(--muted)" }}>Cargando…</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(replies ?? []).map((r) => (
          <div key={r.id} style={{ ...box, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code style={{ color: "var(--accent)" }}>{r.shortcut}</code>
                <strong>{r.title}</strong>
                {r.mediaUrl && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                  >
                    <NavIcon name={r.mediaType === "IMAGE" ? "image" : "file"} size={13} />
                    {r.mediaType === "IMAGE" ? "imagen" : "documento"}
                  </span>
                )}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>
                {r.body}
              </div>
            </div>
            <button onClick={() => setEditing(r)} style={ghostBtn}>
              Editar
            </button>
            <button
              onClick={() => {
                void confirmDialog({
                  message: `¿Eliminar la respuesta rápida ${r.shortcut}?`,
                  danger: true,
                }).then((ok) => ok && remove.mutate(r.id));
              }}
              style={{ ...ghostBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}
            >
              Eliminar
            </button>
          </div>
        ))}
        {replies && replies.length === 0 && !editing && (
          <p style={{ color: "var(--muted)" }}>Aún no hay respuestas rápidas.</p>
        )}
      </div>
    </div>
  );
}

function QuickReplyForm({
  reply,
  onClose,
  onSaved,
}: {
  reply?: QuickReplyDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? "/");
  const [title, setTitle] = useState(reply?.title ?? "");
  const [body, setBody] = useState(reply?.body ?? "");
  const [mediaUrl, setMediaUrl] = useState<string | null>(reply?.mediaUrl ?? null);
  const [mediaType, setMediaType] = useState<QuickReplyDto["mediaType"]>(
    reply?.mediaType ?? null,
  );
  const [fileName, setFileName] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const payload: CreateQuickReplyInput = {
        shortcut,
        title,
        body,
        mediaUrl,
        mediaType,
      };
      return reply
        ? updateQuickReply(reply.id, payload)
        : createQuickReply(payload);
    },
    onSuccess: onSaved,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div style={{ ...box, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width: 170 }}>
          <div style={label}>Atajo</div>
          <input
            style={input}
            value={shortcut}
            placeholder="/precio"
            onChange={(e) => {
              const v = e.target.value.toLowerCase().replace(/[^a-z0-9_/-]/g, "");
              setShortcut(v.startsWith("/") ? v : `/${v}`);
            }}
          />
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <div style={label}>Nombre</div>
          <input
            style={input}
            value={title}
            placeholder="Lista de precios"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </div>

      <div>
        <div style={label}>Mensaje</div>
        <textarea
          style={{ ...input, minHeight: 110, resize: "vertical", fontFamily: "inherit" }}
          value={body}
          placeholder="Hola {{nombre}}, te paso nuestra lista de precios 👇"
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <div>
        <div style={label}>Archivo adjunto (opcional)</div>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          style={{ ...input, padding: 8 }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void uploadMedia(file)
              .then((m) => {
                setMediaUrl(m.mediaUrl);
                setMediaType(m.kind);
                setFileName(m.fileName);
              })
              .catch((err: Error) => toast.error(err.message));
          }}
        />
        {(fileName || mediaUrl) && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
              {fileName ?? "Archivo guardado"}
            </span>
            <button
              style={ghostBtn}
              onClick={() => {
                setMediaUrl(null);
                setMediaType(null);
                setFileName(null);
              }}
            >
              Quitar
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={ghostBtn}>
          Cancelar
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || shortcut.length < 2 || !title || !body}
          style={primaryBtn}
        >
          {save.isPending ? "Guardando…" : reply ? "Guardar" : "Crear"}
        </button>
      </div>
    </div>
  );
}

const box: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 18,
};

const input: React.CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

const label: React.CSSProperties = {
  fontSize: 13,
  color: "var(--muted)",
  marginBottom: 4,
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};
