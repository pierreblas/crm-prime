"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EMPTY_AUDIENCE,
  variableSources,
  type CampaignAudience,
  type CreateCampaignInput,
  type TemplateFill,
  type VariableSource,
  type VariableValue,
} from "@crm/shared";
import {
  createCampaign,
  fetchCampaignMeta,
  launchCampaign,
  sendCampaignTest,
  uploadMedia,
} from "@/lib/bff";
import { AudienceBuilder } from "./AudienceBuilder";
import type { CampaignPreset } from "./preset";
import { toast } from "@/lib/toast";
import { box, ghostBtn, input, label, primaryBtn } from "./styles";

const SOURCE_LABEL: Record<VariableSource, string> = {
  static: "Texto fijo",
  contact_name: "Nombre del contacto",
  contact_phone: "Teléfono del contacto",
};

export function CampaignWizard({ onDone, preset }: { onDone: () => void; preset?: CampaignPreset | null }) {
  const queryClient = useQueryClient();
  const { data: meta } = useQuery({
    queryKey: ["campaign-meta"],
    queryFn: fetchCampaignMeta,
  });

  const [name, setName] = useState(preset?.name ?? "");
  const [templateId, setTemplateId] = useState("");
  // No repetir a quien recibió otra difusión la última semana: activado por defecto.
  const [audienceDef, setAudienceDef] = useState<CampaignAudience>({ ...EMPTY_AUDIENCE, skipRecentDays: 7, ...preset?.audience });
  const [count, setCount] = useState<{ count: number; skippedRecent: number } | null>(null);
  const onCount = useCallback((c: { count: number; skippedRecent: number } | null) => setCount(c), []);
  const [testPhone, setTestPhone] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [varValues, setVarValues] = useState<Record<number, VariableValue>>({});
  const [headerText, setHeaderText] = useState("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string | null>(null);
  const [headerFileName, setHeaderFileName] = useState<string | null>(null);
  const [urlButtonValues, setUrlButtonValues] = useState<Record<number, string>>({});
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");

  const template = meta?.templates.find((t) => t.id === templateId) ?? null;


  // Inicializa los valores de variables al elegir plantilla.
  useEffect(() => {
    if (!template) return;
    setVarValues((prev) => {
      const next: Record<number, VariableValue> = {};
      for (const v of template.variables) {
        next[v.index] = prev[v.index] ?? { index: v.index, source: "static", value: "" };
      }
      return next;
    });
  }, [template]);

  const variableValues = useMemo(
    () => (template ? template.variables.map((v) => varValues[v.index]).filter(Boolean) : []),
    [template, varValues],
  );

  const headerNeedsFile =
    template?.header?.format === "IMAGE" ||
    template?.header?.format === "VIDEO" ||
    template?.header?.format === "DOCUMENT";
  // Botones cuyo enlace acaba en un hueco: se completa al enviar.
  const dynamicUrlButtons = (template?.buttons ?? [])
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.type === "URL" && b.url.includes("{{"));

  const fill: TemplateFill = useMemo(
    () => ({
      body: variableValues,
      urlButtons: dynamicUrlButtons.map(({ index }) => ({
        index,
        value: urlButtonValues[index] ?? "",
      })),
      ...(headerText ? { headerText: { index: 1, source: "static", value: headerText } } : {}),
      ...(headerMediaUrl ? { headerMediaUrl } : {}),
    }),
    [variableValues, dynamicUrlButtons, headerText, headerMediaUrl],
  );

  const create = useMutation({
    mutationFn: async (launch: boolean) => {
      const payload: CreateCampaignInput = {
        name,
        templateId,
        channelId,
        tagIds: audienceDef.tags,
        audience: audienceDef,
        fill,
        scheduledAt: schedule && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      };
      const campaign = await createCampaign(payload);
      if (launch) await launchCampaign(campaign.id);
      return campaign;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      onDone();
    },
  });

  const canSave = !!name && !!templateId;
  const test = useMutation({
    mutationFn: () => sendCampaignTest({ templateId, channelId, fill, phone: testPhone }),
    onSuccess: () => toast.success("Prueba enviada: revisa tu WhatsApp"),
    onError: (e) => toast.error((e as Error).message),
  });
  function setVar(index: number, patch: Partial<VariableValue>) {
    setVarValues((v) => ({ ...v, [index]: { ...v[index]!, ...patch, index } }));
  }

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {/* 1. Básico */}
        <section style={box}>
          <SecTitle n={1}>Nombre y plantilla</SecTitle>
          <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Nombre de la difusión</div>
              <input
                style={input}
                value={name}
                placeholder="Promo de septiembre"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Plantilla</div>
              <select style={input} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Elige una plantilla…</option>
                {(meta?.templates ?? []).map((t) => (
                  <option key={t.id} value={t.id} disabled={t.status !== "APPROVED"}>
                    {t.name} ({t.language})
                    {t.status !== "APPROVED" ? ` · ${t.status}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {template && (
            <div style={{ marginTop: 10, padding: 12, background: "var(--field)", borderRadius: 8, color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap" }}>
              {template.body}
            </div>
          )}
        </section>

        {/* 2. Audiencia */}
        <section style={box}>
          <SecTitle n={2}>Audiencia</SecTitle>
          <div style={{ marginTop: 10 }}>
            <AudienceBuilder value={audienceDef} onChange={setAudienceDef} tags={meta?.tags ?? []} onCount={onCount} />
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={label}>Número emisor</div>
            <select
              style={{ ...input, maxWidth: 280 }}
              value={channelId ?? ""}
              onChange={(e) => setChannelId(e.target.value || null)}
            >
              <option value="">Número por defecto</option>
              {(meta?.channels ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? c.displayPhoneNumber ?? c.id}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* 3. Contenido de la plantilla */}
        {template &&
          (template.variables.length > 0 ||
            headerNeedsFile ||
            template.header?.format === "TEXT" ||
            dynamicUrlButtons.length > 0) && (
          <section style={box}>
            <SecTitle n={3}>Contenido de la plantilla</SecTitle>

            {template.header?.format === "TEXT" &&
              template.header.text.includes("{{") && (
                <div style={{ marginTop: 10 }}>
                  <div style={label}>Encabezado: {template.header.text}</div>
                  <input
                    style={input}
                    value={headerText}
                    placeholder="Valor del hueco del encabezado"
                    onChange={(e) => setHeaderText(e.target.value)}
                  />
                </div>
              )}

            {headerNeedsFile && (
              <div style={{ marginTop: 10 }}>
                <div style={label}>
                  Archivo del encabezado ({template.header?.format.toLowerCase()})
                </div>
                <input
                  type="file"
                  style={{ ...input, padding: 8 }}
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
                {headerFileName && (
                  <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 4 }}>
                    Se enviará: {headerFileName}
                  </div>
                )}
              </div>
            )}

            {dynamicUrlButtons.map(({ b, index }) => (
              <div key={index} style={{ marginTop: 10 }}>
                <div style={label}>
                  Botón &quot;{b.type === "URL" ? b.text : ""}&quot;: qué se añade al enlace
                </div>
                <input
                  style={input}
                  value={urlButtonValues[index] ?? ""}
                  placeholder="Ej. promo-septiembre"
                  onChange={(e) =>
                    setUrlButtonValues((prev) => ({ ...prev, [index]: e.target.value }))
                  }
                />
              </div>
            ))}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {template.variables.map((v) => {
                const val = varValues[v.index];
                return (
                  <div key={v.index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <code style={{ width: 44, color: "var(--accent)" }}>{`{{${v.index}}}`}</code>
                    <select
                      style={{ ...input, width: 200 }}
                      value={val?.source ?? "static"}
                      onChange={(e) => setVar(v.index, { source: e.target.value as VariableSource })}
                    >
                      {variableSources.map((s) => (
                        <option key={s} value={s}>
                          {SOURCE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    {val?.source === "static" && (
                      <input
                        style={input}
                        value={val.value ?? ""}
                        placeholder="Texto…"
                        onChange={(e) => setVar(v.index, { value: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. Programación */}
        <section style={box}>
          <SecTitle n={4}>Cuándo enviar</SecTitle>
          <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
            <label style={radioRow}>
              <input type="radio" checked={!schedule} onChange={() => setSchedule(false)} />
              Enviar ahora
            </label>
            <label style={radioRow}>
              <input type="radio" checked={schedule} onChange={() => setSchedule(true)} />
              Programar
            </label>
            {schedule && (
              <input
                type="datetime-local"
                style={{ ...input, width: 230 }}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            )}
          </div>
        </section>
      </div>

      {/* Resumen */}
      <aside style={{ ...box, width: 280, flexShrink: 0, position: "sticky", top: 20 }}>
        <strong>Resumen</strong>
        <Summary label="Difusión" value={name || "—"} />
        <Summary label="Plantilla" value={template?.name ?? "—"} />
        <Summary label="Destinatarios" value={count ? `${count.count} contacto${count.count === 1 ? "" : "s"}` : "…"} highlight />
        {count && count.count === 0 && <p style={{ color: "#e0a458", fontSize: 12.5, margin: "4px 0 0" }}>Nadie cumple los filtros: revisa la audiencia.</p>}
        <Summary
          label="Envío"
          value={schedule ? (scheduledAt ? new Date(scheduledAt).toLocaleString() : "programar") : "ahora"}
        />
        <div className="cw-test" data-campaign-test>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Enviar una prueba</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              style={{ ...input, padding: "7px 9px", fontSize: 13 }}
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+51 999 999 999"
              aria-label="Número para la prueba"
              inputMode="tel"
            />
            <button
              type="button"
              onClick={() => test.mutate()}
              disabled={!templateId || testPhone.replace(/\D/g, "").length < 7 || test.isPending}
              style={{ ...ghostBtn, padding: "7px 10px", whiteSpace: "nowrap" }}
              title={templateId ? "Llega como le llegará a tus contactos (el nombre sale como «Prueba»)" : "Elige primero la plantilla"}
            >
              {test.isPending ? "…" : "Probar"}
            </button>
          </div>
        </div>
        {create.isError && (
          <p style={{ color: "#ff6b6b", fontSize: 13 }}>{(create.error as Error).message}</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          <button
            onClick={() => create.mutate(true)}
            disabled={!canSave || create.isPending || (count !== null && count.count === 0)}
            style={primaryBtn}
          >
            {create.isPending
              ? "Procesando…"
              : schedule
                ? "Programar envío"
                : "Crear y enviar"}
          </button>
          <button
            onClick={() => create.mutate(false)}
            disabled={!canSave || create.isPending}
            style={ghostBtn}
          >
            Guardar borrador
          </button>
          <button onClick={onDone} style={ghostBtn}>
            Cancelar
          </button>
        </div>
      </aside>
    </div>
  );
}

function SecTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={stepDot}>{n}</span>
      <strong style={{ fontSize: 15 }}>{children}</strong>
    </div>
  );
}

function Summary({
  label: l,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{l}</div>
      <div style={{ fontSize: highlight ? 18 : 14, fontWeight: highlight ? 700 : 500, color: highlight ? "#7ee2a8" : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

const stepDot: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "var(--accent)",
  color: "#f3f8ff",
  fontSize: 12,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const radioRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 14,
  cursor: "pointer",
};
