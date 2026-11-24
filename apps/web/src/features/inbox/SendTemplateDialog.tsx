"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isMediaHeader, type TemplateFill, type VariableSource, type VariableValue } from "@crm/shared";
import { fetchTemplates, sendTemplateMessage, uploadMedia } from "@/lib/bff";
import { useHeaderMedia } from "../campaigns/useHeaderMedia";
import { toast } from "@/lib/toast";
import { TemplatePreview } from "../campaigns/TemplatePreview";
import { dialogInput, dialogLabel, ghostBtn, primaryBtn } from "./dialogStyles";

const SOURCE_LABEL: Record<VariableSource, string> = {
  static: "Texto fijo",
  contact_name: "Nombre del contacto",
  contact_phone: "Teléfono del contacto",
};

/**
 * Envía una plantilla aprobada a la conversación. Es lo único que Meta permite
 * fuera de la ventana de 24h, así que también sirve para reactivar un chat.
 */
export function SendTemplateDialog({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: templates = [], isPending } = useQuery({
    queryKey: ["templates"],
    queryFn: fetchTemplates,
  });

  const approved = templates.filter((t) => t.status === "APPROVED");
  const [templateId, setTemplateId] = useState("");
  const template = approved.find((t) => t.id === templateId) ?? null;

  const [vars, setVars] = useState<Record<number, VariableValue>>({});
  const [headerText, setHeaderText] = useState("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string | null>(null);
  const [headerFileName, setHeaderFileName] = useState<string | null>(null);
  const [urlValues, setUrlValues] = useState<Record<number, string>>({});

  const headerNeedsFile =
    template?.header?.format === "IMAGE" ||
    template?.header?.format === "VIDEO" ||
    template?.header?.format === "DOCUMENT";
  const headerHasVar =
    template?.header?.format === "TEXT" && template.header.text.includes("{{");
  const dynamicUrls = (template?.buttons ?? [])
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.type === "URL" && b.url.includes("{{"));

  const fill: TemplateFill = useMemo(
    () => ({
      body: (template?.variables ?? []).map(
        (v) => vars[v.index] ?? { index: v.index, source: "static", value: "" },
      ),
      urlButtons: dynamicUrls.map(({ index }) => ({
        index,
        value: urlValues[index] ?? "",
      })),
      ...(headerHasVar
        ? { headerText: { index: 1, source: "static" as const, value: headerText } }
        : {}),
      ...(headerMediaUrl ? { headerMediaUrl } : {}),
    }),
    [template, vars, dynamicUrls, urlValues, headerHasVar, headerText, headerMediaUrl],
  );

  const send = useMutation({
    mutationFn: () => sendTemplateMessage({ conversationId, templateId, fill }),
    onSuccess: () => {
      toast.success("Plantilla enviada.");
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Sin elegir otro, sale el que aprobó Meta (si Driony no lo tenía, lo trae).
  const { media: defaultMedia, loading: loadingMedia } = useHeaderMedia(template);
  const [another, setAnother] = useState(false);
  // Un hueco vacío llegaría como «-» al cliente.
  const varsReady = fill.body.every((v) => v.source !== "static" || !!v.value?.trim()) && (!headerHasVar || !!headerText.trim()) && fill.urlButtons.every((u) => !!u.value.trim());
  const ready = !!template && !loadingMedia && varsReady && (!headerNeedsFile || !!headerMediaUrl || !!defaultMedia);
  const shown = headerMediaUrl ?? defaultMedia;
  const preview = template && isMediaHeader(template.header) && shown ? { ...template.header, example: shown } : (template?.header ?? null);
  const mediaWord = template?.header?.format === "VIDEO" ? "el video" : template?.header?.format === "DOCUMENT" ? "el documento" : "la imagen";

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog"
        style={{ width: 640, maxHeight: "86vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 4px" }}>Enviar una plantilla</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          Solo se pueden enviar plantillas aprobadas por Meta.
        </p>

        {isPending ? (
          <p style={{ color: "var(--muted)" }}>Cargando plantillas…</p>
        ) : approved.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            No tienes plantillas aprobadas. Créalas en Difusiones › Plantillas y
            espera la aprobación de Meta.
          </p>
        ) : (
          <>
            <div style={dialogLabel}>Plantilla</div>
            <select
              style={dialogInput}
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setVars({});
                setHeaderMediaUrl(null);
                setHeaderFileName(null);
                setAnother(false);
                // Lo habitual: {{1}} es el nombre del cliente.
                const t = approved.find((x) => x.id === e.target.value);
                if (t?.variables.some((v) => v.index === 1)) setVars({ 1: { index: 1, source: "contact_name" } });
              }}
            >
              <option value="">Elige una…</option>
              {approved.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>

            {template && (
              <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {headerHasVar && (
                    <div>
                      <div style={dialogLabel}>Encabezado</div>
                      <input
                        style={dialogInput}
                        value={headerText}
                        placeholder="Valor del hueco del encabezado"
                        onChange={(e) => setHeaderText(e.target.value)}
                      />
                    </div>
                  )}

                  {headerNeedsFile && (
                    <div>
                      <div style={dialogLabel} data-header-default={defaultMedia ? "si" : "no"}>
                        {loadingMedia
                          ? `Trayendo de Meta ${mediaWord}…`
                          : headerFileName
                            ? `Se envía ${headerFileName}`
                            : defaultMedia
                              ? `Se envía ${mediaWord} de la plantilla.`
                              : `Sube ${mediaWord} de la plantilla`}
                        {defaultMedia && !another && (
                          <button type="button" style={{ ...ghostBtn, marginLeft: 8, padding: "2px 8px", fontSize: 12 }} onClick={() => setAnother(true)}>
                            Usar otro archivo
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        hidden={loadingMedia || (!!defaultMedia && !another)}
                        style={{ ...dialogInput, padding: 7 }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          void uploadMedia(file)
                            .then((m) => {
                              setHeaderMediaUrl(m.mediaUrl);
                              setHeaderFileName(m.fileName);
                            })
                            .catch((err: Error) => toast.error(err.message));
                        }}
                      />
                    </div>
                  )}

                  {template.variables.map((v) => {
                    const val = vars[v.index] ?? {
                      index: v.index,
                      source: "static" as const,
                      value: "",
                    };
                    return (
                      <div key={v.index}>
                        <div style={dialogLabel}>
                          {v.name ? `{{${v.name}}}` : `{{${v.index}}} · ${v.label}`}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <select
                            style={{ ...dialogInput, width: 170 }}
                            value={val.source}
                            onChange={(e) =>
                              setVars((prev) => ({
                                ...prev,
                                [v.index]: {
                                  ...val,
                                  source: e.target.value as VariableSource,
                                },
                              }))
                            }
                          >
                            {(Object.keys(SOURCE_LABEL) as VariableSource[]).map((s) => (
                              <option key={s} value={s}>
                                {SOURCE_LABEL[s]}
                              </option>
                            ))}
                          </select>
                          {val.source === "static" && (
                            <input
                              style={dialogInput}
                              value={val.value ?? ""}
                              placeholder="Texto…"
                              onChange={(e) =>
                                setVars((prev) => ({
                                  ...prev,
                                  [v.index]: { ...val, value: e.target.value },
                                }))
                              }
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {dynamicUrls.map(({ b, index }) => (
                    <div key={index}>
                      <div style={dialogLabel}>
                        Enlace del botón {b.type === "URL" ? b.text : ""}
                      </div>
                      <input
                        style={dialogInput}
                        value={urlValues[index] ?? ""}
                        placeholder="Se añade al final del enlace"
                        onChange={(e) =>
                          setUrlValues((prev) => ({ ...prev, [index]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>

                <div style={{ flex: "0 1 260px" }}>
                  <TemplatePreview
                    header={preview}
                    body={template.body}
                    footer={template.footer}
                    buttons={template.buttons}
                  />
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onClose} style={ghostBtn}>
            Cancelar
          </button>
          <button
            onClick={() => send.mutate()}
            disabled={!ready || send.isPending}
            style={primaryBtn}
          >
            {send.isPending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
