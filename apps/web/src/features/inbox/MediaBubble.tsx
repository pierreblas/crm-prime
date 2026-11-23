"use client";

import { useState } from "react";
import { mediaName } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { mediaSrc } from "@/lib/bff";
import { useT } from "@/i18n/I18nProvider";

/**
 * Pinta el medio de un mensaje: imágenes en línea (se amplían al hacer
 * clic), stickers pequeños, audios y videos con su reproductor, documentos
 * como una fila descargable. Debajo, si la IA ya lo leyó, lo que entendió
 * (transcripción del audio o descripción de la imagen).
 *
 * El binario no se sirve como estático público: va por el BFF, que añade el
 * JWT de la sesión, así que un enlace suelto no expone el archivo.
 */
export function MediaBubble({
  mediaUrl,
  type,
  caption,
  transcript = null,
}: {
  mediaUrl: string;
  type: string;
  caption: string | null;
  transcript?: string | null;
}) {
  const t = useT();
  const src = mediaSrc(mediaUrl);
  const [zoom, setZoom] = useState(false);
  const [failed, setFailed] = useState(false);

  const understood = transcript ? (
    <div style={aiLine} title={t("inbox.aiSees")}>
      <NavIcon name="sparkles" size={11} />
      <span>{transcript}</span>
    </div>
  ) : null;

  if (!src) {
    return (
      <div style={fallback}>
        {t("inbox.mediaUnavailable", { type: type.toLowerCase() })}
      </div>
    );
  }

  if (type === "AUDIO") {
    return (
      <>
        <audio controls preload="none" src={src} style={audio} />
        {understood}
      </>
    );
  }

  if (type === "VIDEO") {
    return (
      <>
        <video controls preload="metadata" src={src} style={video} />
        {understood}
      </>
    );
  }

  if (type === "STICKER") {
    return (
      <>
        {failed ? (
          <div style={fallback}>Sticker</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Sticker" onError={() => setFailed(true)} style={sticker} />
        )}
        {understood}
      </>
    );
  }

  if (type !== "IMAGE") {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" style={docRow}>
        <NavIcon name="file" size={19} />
        <span style={{ textDecoration: "underline" }}>
          {mediaName(mediaUrl) || caption || t("inbox.openDocument")}
        </span>
      </a>
    );
  }

  if (failed) {
    return (
      <div style={fallback}>
        {t("inbox.mediaUnavailable", { type: t("inbox.imageAlt") })}
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={caption ?? t("inbox.imageAlt")}
        onClick={() => setZoom(true)}
        onError={() => setFailed(true)}
        style={thumb}
      />
      {understood}
      {zoom && (
        <div style={overlay} onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption ?? t("inbox.imageAlt")} style={full} />
        </div>
      )}
    </>
  );
}

const thumb: React.CSSProperties = {
  display: "block",
  maxWidth: "100%",
  maxHeight: 280,
  borderRadius: 8,
  cursor: "zoom-in",
  marginBottom: 4,
};

const sticker: React.CSSProperties = {
  display: "block",
  width: 140,
  height: 140,
  objectFit: "contain",
  marginBottom: 4,
};

const audio: React.CSSProperties = {
  display: "block",
  width: 260,
  maxWidth: "100%",
  marginBottom: 4,
};

const video: React.CSSProperties = {
  display: "block",
  maxWidth: "100%",
  maxHeight: 280,
  borderRadius: 8,
  marginBottom: 4,
};

const aiLine: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 5,
  marginTop: 2,
  marginBottom: 4,
  fontSize: 12.5,
  lineHeight: 1.4,
  color: "var(--muted)",
  fontStyle: "italic",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.85)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  cursor: "zoom-out",
  padding: 24,
};

const full: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  borderRadius: 8,
};

const docRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "var(--text)",
  fontSize: 13,
  marginBottom: 4,
};

const fallback: React.CSSProperties = {
  opacity: 0.6,
  fontSize: 13,
  fontStyle: "italic",
};
