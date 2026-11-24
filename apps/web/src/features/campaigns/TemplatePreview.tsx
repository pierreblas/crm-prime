"use client";

import type { CSSProperties } from "react";
import type { TemplateButton, TemplateHeader } from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { mediaSrc } from "@/lib/bff";

const HEADER_ICON: Record<string, IconName> = {
  IMAGE: "image",
  VIDEO: "video",
  DOCUMENT: "file",
  LOCATION: "map-pin",
};

const HEADER_TEXT: Record<string, string> = {
  IMAGE: "Imagen",
  VIDEO: "Video",
  DOCUMENT: "Documento",
  LOCATION: "Ubicación",
};

const BUTTON_ICON: Partial<Record<TemplateButton["type"], IconName>> = {
  URL: "link",
  PHONE_NUMBER: "phone",
  COPY_CODE: "copy",
};

/** Cómo se verá el mensaje en el celular del cliente. */
export function TemplatePreview({
  header,
  body,
  footer,
  buttons,
}: {
  header: TemplateHeader | null;
  body: string;
  footer?: string | null;
  buttons: TemplateButton[];
}) {
  return (
    <div style={phone}>
      <div style={bubble}>
        {header?.format === "TEXT" && header.text && (
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{header.text}</div>
        )}
        {header?.format === "IMAGE" && header.example && mediaSrc(header.example) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaSrc(header.example)!} alt="Imagen del encabezado" style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "cover", marginBottom: 8 }} />
        ) : header && header.format !== "TEXT" && (
          <div style={mediaBox}>
            <NavIcon name={HEADER_ICON[header.format]} size={24} />
            <span style={{ fontSize: 12 }}>{HEADER_TEXT[header.format]}</span>
          </div>
        )}

        <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
          {body || "El texto del mensaje aparecerá aquí."}
        </div>

        {footer ? (
          <div style={{ color: "#8fa3bf", fontSize: 12, marginTop: 6 }}>{footer}</div>
        ) : null}

        <div style={{ textAlign: "right", color: "#8fa3bf", fontSize: 10, marginTop: 4 }}>
          12:00
        </div>
      </div>

      {buttons.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {buttons.map((b, i) => {
            const icon = BUTTON_ICON[b.type];
            return (
              <div key={i} style={buttonPill}>
                {icon && <NavIcon name={icon} size={14} />}
                {b.type === "COPY_CODE"
                  ? `Copiar código (${b.example || "…"})`
                  : b.text || "Botón"}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const phone: CSSProperties = {
  background: "#0b141a",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 14,
};

const bubble: CSSProperties = {
  background: "#005c4b",
  color: "#e9f1ff",
  borderRadius: "10px 10px 10px 2px",
  padding: "10px 12px",
};

const mediaBox: CSSProperties = {
  background: "rgba(255,255,255,0.12)",
  borderRadius: 8,
  height: 88,
  marginBottom: 8,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  color: "#cfe3ff",
};

const buttonPill: CSSProperties = {
  background: "#1f2c34",
  color: "#53bdeb",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};
