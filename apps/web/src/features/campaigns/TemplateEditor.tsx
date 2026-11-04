"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import type {
  CreateTemplateInput,
  HeaderFormat,
  TemplateButton,
  TemplateCategory,
  TemplateDto,
  TemplateHeader,
} from "@crm/shared";
import { validateButtons } from "@crm/shared";
import { createTemplate, updateTemplate, uploadMedia } from "@/lib/bff";
import { box, ghostBtn, input, label, primaryBtn } from "./styles";
import { TemplatePreview } from "./TemplatePreview";

// Extrae los índices {{1}}, {{2}}… de un texto.
export function extractVars(body: string): number[] {
  const set = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

const HEADER_OPTIONS: { value: HeaderFormat | "NONE"; text: string }[] = [
  { value: "NONE", text: "Sin encabezado" },
  { value: "TEXT", text: "Texto" },
  { value: "IMAGE", text: "Imagen" },
  { value: "VIDEO", text: "Video" },
  { value: "DOCUMENT", text: "Documento" },
  { value: "LOCATION", text: "Ubicación" },
];

const BUTTON_OPTIONS: { value: TemplateButton["type"]; text: string }[] = [
  { value: "QUICK_REPLY", text: "Respuesta rápida" },
  { value: "URL", text: "Ir a una web" },
  { value: "PHONE_NUMBER", text: "Llamar" },
  { value: "COPY_CODE", text: "Copiar código" },
];

const CATEGORY_HELP: Record<TemplateCategory, string> = {
  MARKETING: "Promociones y novedades. Requiere que el contacto acepte recibirlas.",
  UTILITY: "Avisos de algo que el cliente pidió: pedidos, citas, pagos.",
  AUTHENTICATION: "Códigos de verificación de un solo uso.",
};

function newButton(type: TemplateButton["type"]): TemplateButton {
  switch (type) {
    case "QUICK_REPLY":
      return { type, text: "" };
    case "URL":
      return { type, text: "", url: "https://" };
    case "PHONE_NUMBER":
      return { type, text: "", phoneNumber: "" };
    case "COPY_CODE":
      return { type, example: "" };
  }
}

export function TemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template?: TemplateDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!template;
  const [name, setName] = useState(template?.name ?? "");
  const [language, setLanguage] = useState(template?.language ?? "es");
  const [category, setCategory] = useState<TemplateCategory>(
    template?.category ?? "MARKETING",
  );
  const [header, setHeader] = useState<TemplateHeader | null>(
    template?.header ?? null,
  );
  const [headerFileName, setHeaderFileName] = useState<string | null>(null);
  const [body, setBody] = useState(template?.body ?? "");
  const [footer, setFooter] = useState(template?.footer ?? "");
  const [buttons, setButtons] = useState<TemplateButton[]>(
    template?.buttons ?? [],
  );
  const [submitToMeta, setSubmitToMeta] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const vars = useMemo(() => extractVars(body), [body]);
  const [varLabels, setVarLabels] = useState<Record<number, string>>(
    Object.fromEntries((template?.variables ?? []).map((v) => [v.index, v.label])),
  );
  const buttonsError = validateButtons(buttons);
  const headerNeedsFile =
    header?.format === "IMAGE" ||
    header?.format === "VIDEO" ||
    header?.format === "DOCUMENT";
  const missingHeaderFile = headerNeedsFile && !header.example && !editing;

  const upload = useMutation({
    mutationFn: (file: File) => uploadMedia(file),
    onSuccess: (media) => {
      setUploadError(null);
      setHeaderFileName(media.fileName);
      setHeader((h) =>
        h && h.format !== "TEXT" && h.format !== "LOCATION"
          ? { ...h, example: media.mediaUrl }
          : h,
      );
    },
    onError: (e) => setUploadError((e as Error).message),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        language,
        category,
        header,
        body,
        footer: footer.trim() || null,
        buttons,
        variables: vars.map((index) => ({
          index,
          label: varLabels[index]?.trim() || `Variable ${index}`,
        })),
      };
      return editing
        ? updateTemplate(template.id, payload)
        : createTemplate({ ...payload, name, submitToMeta } as CreateTemplateInput);
    },
    onSuccess: () => {
      toast.success(editing ? "Plantilla guardada" : "Plantilla creada");
      onSaved();
    },
  });

  function setHeaderFormat(value: HeaderFormat | "NONE") {
    setHeaderFileName(null);
    if (value === "NONE") setHeader(null);
    else if (value === "TEXT") setHeader({ format: "TEXT", text: "" });
    else if (value === "LOCATION") setHeader({ format: "LOCATION" });
    else setHeader({ format: value });
  }

  const disabled =
    save.isPending ||
    !body.trim() ||
    (!editing && !name) ||
    !!buttonsError ||
    missingHeaderFile ||
    (header?.format === "TEXT" && !header.text.trim());

  return (
    <div style={{ ...box, display: "flex", gap: 20, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <div style={label}>Nombre (minúsculas y _)</div>
            <input
              style={input}
              value={name}
              disabled={editing}
              placeholder="promo_septiembre"
              onChange={(e) =>
                setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
              }
            />
          </div>
          <div style={{ width: 110 }}>
            <div style={label}>Idioma</div>
            <input
              style={input}
              value={language}
              disabled={editing}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <div style={label}>Categoría</div>
            <select
              style={input}
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
            >
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utilidad</option>
              <option value="AUTHENTICATION">Autenticación</option>
            </select>
          </div>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0 }}>
          {CATEGORY_HELP[category]}
        </p>

        {/* ── Encabezado ── */}
        <div>
          <div style={label}>Encabezado</div>
          <select
            style={input}
            value={header?.format ?? "NONE"}
            onChange={(e) => setHeaderFormat(e.target.value as HeaderFormat | "NONE")}
          >
            {HEADER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.text}
              </option>
            ))}
          </select>
        </div>

        {header?.format === "TEXT" && (
          <div>
            <input
              style={input}
              maxLength={60}
              value={header.text}
              placeholder="Hasta 60 caracteres, admite una variable {{1}}"
              onChange={(e) => setHeader({ format: "TEXT", text: e.target.value })}
            />
          </div>
        )}

        {headerNeedsFile && (
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 6 }}>
              Meta pide un archivo de ejemplo para revisar la plantilla. Al
              enviarla podrás usar otro archivo distinto.
            </div>
            <input
              type="file"
              accept={
                header.format === "IMAGE"
                  ? "image/jpeg,image/png"
                  : header.format === "VIDEO"
                    ? "video/mp4"
                    : ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
              }
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
              }}
              style={{ ...input, padding: 8 }}
            />
            {upload.isPending && (
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Subiendo…</div>
            )}
            {headerFileName && (
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
                Ejemplo: {headerFileName}
              </div>
            )}
            {uploadError && (
              <div style={{ color: "var(--danger)", fontSize: 12.5 }}>{uploadError}</div>
            )}
          </div>
        )}

        {/* ── Cuerpo ── */}
        <div>
          <div style={label}>Cuerpo del mensaje</div>
          <textarea
            style={{ ...input, minHeight: 120, resize: "vertical", fontFamily: "inherit" }}
            value={body}
            maxLength={1024}
            placeholder="Hola {{1}}, tenemos una promo para ti 🎉"
            onChange={(e) => setBody(e.target.value)}
          />
          <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "right" }}>
            {body.length}/1024
          </div>
        </div>

        {vars.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={label}>Qué va en cada variable</div>
            {vars.map((v) => (
              <div key={v} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code style={{ width: 48 }}>{`{{${v}}}`}</code>
                <input
                  style={input}
                  value={varLabels[v] ?? ""}
                  placeholder={`Ejemplo para la variable ${v} (ej. Renzo)`}
                  onChange={(e) =>
                    setVarLabels((prev) => ({ ...prev, [v]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        )}

        {/* ── Pie ── */}
        <div>
          <div style={label}>Pie (opcional, 60 caracteres)</div>
          <input
            style={input}
            maxLength={60}
            value={footer}
            placeholder="Responde STOP para no recibir más mensajes"
            onChange={(e) => setFooter(e.target.value)}
          />
        </div>

        {/* ── Botones ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={label}>Botones (opcional)</div>
          {buttons.map((b, i) => (
            <ButtonRow
              key={i}
              button={b}
              onChange={(next) =>
                setButtons((prev) => prev.map((x, j) => (j === i ? next : x)))
              }
              onRemove={() =>
                setButtons((prev) => prev.filter((_, j) => j !== i))
              }
            />
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {BUTTON_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                style={ghostBtn}
                onClick={() => setButtons((prev) => [...prev, newButton(o.value)])}
              >
                + {o.text}
              </button>
            ))}
          </div>
          {buttonsError && (
            <div style={{ color: "var(--danger)", fontSize: 12.5 }}>{buttonsError}</div>
          )}
        </div>

        {!editing && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={submitToMeta}
              onChange={(e) => setSubmitToMeta(e.target.checked)}
            />
            Enviar a Meta para aprobación (sin esto no se puede usar en envíos reales)
          </label>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
          {save.isError && (
            <span style={{ color: "var(--danger)", fontSize: 13 }}>
              {(save.error as Error).message}
            </span>
          )}
          <button onClick={onClose} style={ghostBtn}>
            Cancelar
          </button>
          <button onClick={() => save.mutate()} disabled={disabled} style={primaryBtn}>
            {save.isPending
              ? "Guardando…"
              : editing
                ? "Guardar cambios"
                : "Crear plantilla"}
          </button>
        </div>
      </div>

      <div style={{ flex: "0 1 320px" }}>
        <div style={label}>Vista previa</div>
        <TemplatePreview
          header={header}
          body={body}
          footer={footer}
          buttons={buttons}
        />
      </div>
    </div>
  );
}

function ButtonRow({
  button,
  onChange,
  onRemove,
}: {
  button: TemplateButton;
  onChange: (b: TemplateButton) => void;
  onRemove: () => void;
}) {
  const typeName =
    BUTTON_OPTIONS.find((o) => o.value === button.type)?.text ?? button.type;

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 8,
      }}
    >
      <span style={{ fontSize: 12, color: "var(--muted)", width: 110 }}>
        {typeName}
      </span>

      {button.type !== "COPY_CODE" && (
        <input
          style={{ ...input, flex: "1 1 130px", width: "auto" }}
          maxLength={25}
          value={button.text}
          placeholder="Texto del botón"
          onChange={(e) => onChange({ ...button, text: e.target.value })}
        />
      )}

      {button.type === "URL" && (
        <input
          style={{ ...input, flex: "2 1 220px", width: "auto" }}
          value={button.url}
          placeholder="https://tusitio.com/promo/{{1}}"
          onChange={(e) => onChange({ ...button, url: e.target.value })}
        />
      )}

      {button.type === "PHONE_NUMBER" && (
        <input
          style={{ ...input, flex: "1 1 150px", width: "auto" }}
          value={button.phoneNumber}
          placeholder="51987654321"
          onChange={(e) => onChange({ ...button, phoneNumber: e.target.value })}
        />
      )}

      {button.type === "COPY_CODE" && (
        <input
          style={{ ...input, flex: "1 1 150px", width: "auto" }}
          maxLength={15}
          value={button.example}
          placeholder="PROMO25"
          onChange={(e) => onChange({ ...button, example: e.target.value })}
        />
      )}

      <button type="button" onClick={onRemove} style={{ ...ghostBtn, color: "var(--danger)" }}>
        Quitar
      </button>
    </div>
  );
}
