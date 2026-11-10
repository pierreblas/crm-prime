"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFieldTypes,
  fieldKeyFromLabel,
  FIELD_KEY_RE,
  mapMetaLeadFields,
  META_FORM_SOURCE_NAME,
  metaFieldAutoTarget,
  metaQuestionFieldType,
  metaQuestionTypeLabel,
  resolveFieldKeys,
  type CustomFieldType,
  type MetaFormQuestion,
  type MetaFormRule,
  type MetaLeadDto,
  type MetaLeadFormDto,
  type MetaPageDto,
  type StageRef,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import {
  createCustomField,
  createTag,
  fetchCustomFields,
  fetchMetaFormQuestions,
  fetchMetaLeads,
  importMetaFormLeads,
  reprocessMetaLead,
  updateMetaPage,
} from "@/lib/bff";

const STD_TARGETS = [
  { value: "std:name", label: "Nombre" },
  { value: "std:phone", label: "Teléfono" },
  { value: "std:email", label: "Email" },
] as const;
const NEW_FIELD = "new";
const TYPE_LABEL: Record<CustomFieldType, string> = { text: "Texto", number: "Número", date: "Fecha", select: "Lista de opciones" };
const STATUS_LABEL: Record<MetaLeadDto["status"], string> = { PROCESSED: "Procesado", NO_PHONE: "Sin teléfono", ERROR: "Error" };

type Creator = {
  /** La pregunta cuya respuesta irá al campo nuevo. */
  qKey: string;
  label: string;
  key: string;
  editKey: boolean;
  type: CustomFieldType;
  options: string;
};

const ruleOf = (f: MetaLeadFormDto): MetaFormRule => ({
  formId: f.formId,
  formName: f.formName,
  enabled: f.enabled,
  stage: f.stage,
  source: f.source,
  tagIds: f.tagIds,
  fieldMap: f.fieldMap,
});

/**
 * Todo lo de un formulario de Meta en una ventana: si entra, a qué etapa y
 * con qué fuente y etiquetas, a dónde va cada pregunta (con el tipo que Meta
 * le da y la opción de crear el campo ahí mismo), cómo quedaría el contacto
 * con el último lead, y los leads que trajo, con importar anteriores y
 * reprocesar. Se guarda con «Guardar»: hasta entonces nada cambia.
 */
export function MetaFormDialog({
  page,
  form,
  stages,
  sources,
  tags,
  onClose,
}: {
  page: MetaPageDto;
  form: MetaLeadFormDto;
  stages: StageRef[];
  sources: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [rule, setRule] = useState<MetaFormRule>(() => ruleOf(form));
  const initial = useMemo(() => JSON.stringify(ruleOf(form)), [form]);
  const dirty = JSON.stringify(rule) !== initial;
  const [creator, setCreator] = useState<Creator | null>(null);
  const [newTag, setNewTag] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const { data: fields = [] } = useQuery({ queryKey: ["custom-fields"], queryFn: fetchCustomFields });
  const questionsQuery = useQuery({
    queryKey: ["meta-form-questions", page.id, form.formId],
    queryFn: () => fetchMetaFormQuestions(page.id, form.formId),
  });
  const questions = questionsQuery.data?.questions ?? [];
  const sample = questionsQuery.data?.sampleLead ?? null;
  const leadsQuery = useQuery({
    queryKey: ["meta-leads", "form", page.pageId, form.formId],
    queryFn: () => fetchMetaLeads({ pageId: page.pageId, formId: form.formId }),
  });
  const leads = leadsQuery.data ?? [];

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["meta-pages"] });
    void queryClient.invalidateQueries({ queryKey: ["meta-forms"] });
    void queryClient.invalidateQueries({ queryKey: ["meta-leads"] });
  };

  const save = useMutation({
    mutationFn: () => updateMetaPage(page.id, { formRules: [...page.formRules.filter((r) => r.formId !== form.formId), rule] }),
    onSuccess: () => {
      refreshAll();
      toast.success(`«${form.formName}» guardado.`);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const addTag = useMutation({
    mutationFn: (name: string) => createTag({ name, color: null }),
    onSuccess: (t) => {
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
      setRule((r) => ({ ...r, tagIds: r.tagIds.includes(t.id) ? r.tagIds : [...r.tagIds, t.id] }));
      setNewTag(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const addField = useMutation({
    mutationFn: (c: Creator) =>
      createCustomField({
        label: c.label.trim(),
        type: c.type,
        options: c.type === "select" ? c.options.split(",").map((o) => o.trim()).filter(Boolean) : [],
        ...(c.editKey && c.key ? { key: c.key } : {}),
      }),
    onSuccess: (created, c) => {
      void queryClient.invalidateQueries({ queryKey: ["custom-fields"] });
      setTarget(c.qKey, `field:${created.key}`);
      setCreator(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const importLeads = useMutation({
    mutationFn: () => importMetaFormLeads(page.id, form.formId),
    onSuccess: (r) => {
      toast.success(
        r.found === 0
          ? "Meta no guarda leads de este formulario (solo conserva los de los últimos 90 días)."
          : `${r.found} lead${r.found === 1 ? "" : "s"} en Meta · ${r.queued} nuevo${r.queued === 1 ? "" : "s"} en cola · ${r.skipped} ya estaba${r.skipped === 1 ? "" : "n"}.`,
      );
      // Entran en segundo plano: se vuelve a mirar en unos segundos.
      setTimeout(refreshAll, 4000);
      setTimeout(refreshAll, 12000);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const reprocess = useMutation({
    mutationFn: (id: string) => reprocessMetaLead(id),
    onSuccess: (lead) => {
      refreshAll();
      toast.success(lead.status === "PROCESSED" ? `Lead reprocesado: contacto ${lead.contactId ? "actualizado" : "creado"}.` : "Reprocesado: sigue sin teléfono.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const setTarget = (key: string, target: string) => {
    setRule((r) => {
      const fieldMap = { ...r.fieldMap };
      if (target) fieldMap[key] = target;
      else delete fieldMap[key];
      return { ...r, fieldMap };
    });
  };
  const openCreator = (q: MetaFormQuestion) =>
    setCreator({
      qKey: q.key,
      label: q.label.trim().slice(0, 80),
      key: "",
      editKey: false,
      type: metaQuestionFieldType(q),
      options: q.options.join(", "),
    });

  // ── Lo que la página pone por defecto, para decirlo en los selectores ──
  const formSource = sources.find((s) => s.name === META_FORM_SOURCE_NAME);
  const pageSourceName =
    page.sourceId && page.sourceId !== formSource?.id ? (sources.find((s) => s.id === page.sourceId)?.name ?? META_FORM_SOURCE_NAME) : META_FORM_SOURCE_NAME;
  const sourceValue =
    rule.source === formSource?.id ? "auto" : rule.source === "page" || rule.source === "auto" || sources.some((s) => s.id === rule.source) ? rule.source : "page";
  const pageStage = !page.createDeal ? "sin oportunidad" : (stages.find((s) => s.id === page.dealStageId) ? `${stages.find((s) => s.id === page.dealStageId)!.name} · ${stages.find((s) => s.id === page.dealStageId)!.pipelineName}` : "primera etapa");
  const stageValue = rule.stage === "page" || rule.stage === "none" || stages.some((s) => s.id === rule.stage) ? rule.stage : "page";
  const stageName = (v: string) => (v === "none" ? "sin oportunidad" : v === "page" ? pageStage : (stages.find((s) => s.id === v) ? `${stages.find((s) => s.id === v)!.name} · ${stages.find((s) => s.id === v)!.pipelineName}` : pageStage));
  const sourceName = (v: string) => (v === "auto" ? META_FORM_SOURCE_NAME : v === "page" ? pageSourceName : (sources.find((s) => s.id === v)?.name ?? pageSourceName));

  /** Qué haría la regla automática con esta pregunta. */
  const autoLabel = (key: string) => {
    const std = metaFieldAutoTarget(key);
    if (std) return STD_TARGETS.find((t) => t.value === std)!.label;
    const resolved = Object.keys(resolveFieldKeys({ [key]: "" }, fields))[0]!;
    const def = fields.find((f) => f.key === resolved);
    return def ? `campo «${def.label}»` : "no sale en la ficha";
  };
  const goesTo = (key: string) => rule.fieldMap[key] ?? metaFieldAutoTarget(key);
  const noPhone = questions.length > 0 && !questions.some((q) => goesTo(q.key) === "std:phone");

  // ── Así quedaría el contacto con el último lead ──
  const preview = useMemo(() => {
    if (!sample) return null;
    const m = mapMetaLeadFields(sample, rule.fieldMap);
    const resolved = resolveFieldKeys(m.extra, fields);
    const extra = Object.entries(resolved).map(([key, value]) => ({ key, value, label: fields.find((f) => f.key === key)?.label ?? null }));
    const tagNames = [...new Set([...page.tagIds, ...rule.tagIds])].map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean) as string[];
    return { ...m, extra, tagNames };
  }, [sample, rule.fieldMap, rule.tagIds, fields, page.tagIds, tags]);

  if (!mounted) return null;

  const creatorAutoKey = creator ? fieldKeyFromLabel(creator.label) : "";
  const creatorKey = creator ? (creator.editKey ? creator.key : creatorAutoKey) : "";
  const creatorKeyBad = !!creator && !FIELD_KEY_RE.test(creatorKey);
  const creatorKeyTaken = !!creator && fields.some((f) => f.key === creatorKey);
  const canCreate = !!creator && creator.label.trim().length > 0 && !creatorKeyBad && !(creator.editKey && creatorKeyTaken);

  return createPortal(
    <div className="pf-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="mfd-title" className="pf-modal mfd" data-meta-form-dialog={form.formId}>
        <header className="pf-modal__head">
          <div>
            <strong id="mfd-title">{form.formName}</strong>
            <div className="mfd__head-meta">
              <span>{page.name}</span>
              {form.status === "ARCHIVED" && <span className="mfd__q-type">Archivado en Meta</span>}
              <span>· {form.leadCount ? `${form.leadCount} lead${form.leadCount === 1 ? "" : "s"}` : "sin leads aún"}</span>
            </div>
          </div>
          <button type="button" className="pf-icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)">
            <NavIcon name="x" size={17} />
          </button>
        </header>

        <div className="mfd__body">
          {/* ── Entrada ── */}
          <section className="mfd__section">
            <div className="pf-switches">
              <label className="pf-switch">
                <input type="checkbox" checked={rule.enabled} onChange={(e) => setRule((r) => ({ ...r, enabled: e.target.checked }))} data-form-enabled />
                <span className="pf-switch__track" aria-hidden />
                <span className="pf-switch__text">
                  <strong>Importar los leads de este formulario</strong>
                  <small>{rule.enabled ? "Cada envío crea o actualiza un contacto con lo de abajo." : "Apagado: sus leads se ignoran y no se guardan."}</small>
                </span>
              </label>
            </div>
          </section>

          {/* ── Destino ── */}
          <section className="mfd__section">
            <h5>
              Dónde entran
              <small>Lo que no cambies sigue a la página.</small>
            </h5>
            <div className="mfd__grid">
              <label>
                <span className="mfd__label">Oportunidad</span>
                <select className="field" value={stageValue} disabled={!rule.enabled} onChange={(e) => setRule((r) => ({ ...r, stage: e.target.value }))} aria-label="Etapa">
                  <option value="page">Como la página ({pageStage})</option>
                  <option value="none">No crear oportunidad</option>
                  {[...new Set(stages.map((s) => s.pipelineName))].map((p) => (
                    <optgroup key={p} label={p}>
                      {stages.filter((s) => s.pipelineName === p).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                <span className="mfd__label">Fuente</span>
                <select className="field" value={sourceValue} disabled={!rule.enabled} onChange={(e) => setRule((r) => ({ ...r, source: e.target.value }))} aria-label="Fuente">
                  <option value="page">Como la página ({pageSourceName})</option>
                  <option value="auto">{META_FORM_SOURCE_NAME} (automática)</option>
                  {sources.filter((s) => s.id !== formSource?.id).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <span className="mfd__label">Etiquetas{page.tagIds.length ? " (además de las de la página)" : ""}</span>
              <div className="mfd__chips">
                {tags.map((t) => {
                  const fromPage = page.tagIds.includes(t.id);
                  const on = fromPage || rule.tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`mfd__chip${on ? " is-on" : ""}`}
                      disabled={fromPage || !rule.enabled}
                      title={fromPage ? "Ya la pone la página" : undefined}
                      onClick={() => setRule((r) => ({ ...r, tagIds: on ? r.tagIds.filter((id) => id !== t.id) : [...r.tagIds, t.id] }))}
                    >
                      {t.name}
                    </button>
                  );
                })}
                {newTag === null ? (
                  <button type="button" className="cfe__link" disabled={!rule.enabled} onClick={() => setNewTag("")} data-new-tag>
                    <NavIcon name="plus" size={12} /> Nueva etiqueta
                  </button>
                ) : (
                  <form
                    className="mfd__newtag"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newTag.trim()) addTag.mutate(newTag.trim().slice(0, 60));
                    }}
                  >
                    <input className="field field-sm" value={newTag} autoFocus maxLength={60} placeholder="Nombre de la etiqueta" onChange={(e) => setNewTag(e.target.value)} aria-label="Nueva etiqueta" />
                    <button type="submit" className="btn btn-primary btn-sm" disabled={!newTag.trim() || addTag.isPending}>
                      {addTag.isPending ? "Creando…" : "Crear"}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewTag(null)}>
                      Cancelar
                    </button>
                  </form>
                )}
              </div>
            </div>
          </section>

          {/* ── Campos ── */}
          <section className="mfd__section">
            <h5>
              A dónde va cada respuesta
              <small>Sin elegir, cada respuesta va sola por el nombre de la pregunta. Si el formulario pide el WhatsApp con una pregunta propia, llévala a Teléfono.</small>
            </h5>
            {questionsQuery.isPending && <p className="mfd__hint">Cargando preguntas…</p>}
            {!questionsQuery.isPending && questions.length === 0 && (
              <p className="mfd__hint">
                Meta no deja leer las preguntas de este formulario con los permisos que diste: aparecerán cuando llegue su primer lead, o antes si vuelves a autorizar la página aceptando todos los permisos.
              </p>
            )}
            {questions.map((q) => {
              const target = rule.fieldMap[q.key] ?? "";
              const lost = target.startsWith("field:") && !fields.some((f) => `field:${f.key}` === target);
              const typeLabel = metaQuestionTypeLabel(q);
              return (
                <div key={q.key} className="mfd__q" data-question={q.key}>
                  <span className="mfd__q-text">
                    <strong>
                      <span title={q.label}>{q.label}</span>
                      {typeLabel && <span className="mfd__q-type">{typeLabel}</span>}
                    </strong>
                    {q.sample ? <small>p. ej. {q.sample}</small> : q.options.length ? <small>{q.options.join(" · ")}</small> : null}
                  </span>
                  <span className="mfd__q-arrow" aria-hidden>
                    <NavIcon name="arrow-right" size={12} />
                  </span>
                  <select
                    className="field"
                    value={creator?.qKey === q.key ? NEW_FIELD : target}
                    disabled={!rule.enabled || addField.isPending}
                    onChange={(e) => {
                      if (e.target.value === NEW_FIELD) openCreator(q);
                      else {
                        setCreator(null);
                        setTarget(q.key, e.target.value);
                      }
                    }}
                    aria-label={`Destino de ${q.label}`}
                  >
                    <option value="">Automático: {autoLabel(q.key)}</option>
                    {STD_TARGETS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                    <option value={NEW_FIELD}>Crear campo…</option>
                    {fields.length > 0 && (
                      <optgroup label="Campos del contacto">
                        {fields.map((f) => (
                          <option key={f.key} value={`field:${f.key}`}>
                            {f.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {lost && <option value={target}>Campo borrado ({target.slice("field:".length)})</option>}
                    <option value="skip">No guardar</option>
                  </select>
                  {creator?.qKey === q.key && (
                    <form
                      className="mfd__creator"
                      data-field-creator
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (canCreate) addField.mutate(creator);
                      }}
                    >
                      <div className="mfd__creator-row">
                        <input className="field" value={creator.label} maxLength={80} placeholder="Nombre del campo" onChange={(e) => setCreator({ ...creator, label: e.target.value })} aria-label="Nombre del campo" />
                        <select className="field" style={{ flex: "0 0 160px" }} value={creator.type} onChange={(e) => setCreator({ ...creator, type: e.target.value as CustomFieldType })} aria-label="Tipo de campo">
                          {customFieldTypes.map((t) => (
                            <option key={t} value={t}>
                              {TYPE_LABEL[t]}
                            </option>
                          ))}
                        </select>
                      </div>
                      {creator.type === "select" && (
                        <input className="field" value={creator.options} placeholder="Opciones separadas por coma" onChange={(e) => setCreator({ ...creator, options: e.target.value })} aria-label="Opciones" />
                      )}
                      <div className="cfe__keyline" data-new-key>
                        <span>Clave para API e importación:</span>
                        {creator.editKey ? (
                          <input
                            className="field field-sm cfe__keyinput"
                            value={creator.key}
                            autoFocus
                            maxLength={40}
                            onChange={(e) => setCreator({ ...creator, key: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                            placeholder={creatorAutoKey}
                            aria-label="Clave"
                          />
                        ) : (
                          <code>{creatorKey}</code>
                        )}
                        {!creator.editKey && (
                          <button type="button" className="cfe__link" onClick={() => setCreator({ ...creator, editKey: true, key: creatorAutoKey })}>
                            cambiar
                          </button>
                        )}
                        {creatorKeyBad && <em>Solo minúsculas, números y _, empezando por letra.</em>}
                        {!creatorKeyBad && creatorKeyTaken && <em>{creator.editKey ? "Ya existe un campo con esa clave." : `Ya existe: se usará ${creatorKey}_1.`}</em>}
                        {!creatorKeyBad && !creatorKeyTaken && <small>No cambia aunque renombres el campo.</small>}
                      </div>
                      <div className="mfd__creator-row">
                        <button type="submit" className="btn btn-primary btn-sm" disabled={!canCreate || addField.isPending}>
                          {addField.isPending ? "Creando…" : "Crear campo y usarlo"}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreator(null)}>
                          Cancelar
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
            {noPhone && rule.enabled && <p className="mfd__danger">Ninguna pregunta va al teléfono: sus leads quedarán pendientes hasta que les pongas uno a mano.</p>}
          </section>

          {/* ── Vista previa ── */}
          <section className="mfd__section" data-form-preview>
            <h5>
              Así quedaría el contacto
              <small>{preview ? "Con las respuestas del último lead recibido y lo que has elegido arriba." : "Cuando llegue el primer lead verás aquí cómo quedaría su contacto."}</small>
            </h5>
            {preview && (
              <dl className="mfd__preview">
                <div>
                  <dt>Nombre</dt>
                  <dd>{preview.name ?? <em>sin nombre</em>}</dd>
                </div>
                <div>
                  <dt>Teléfono</dt>
                  <dd>{preview.phone ?? <em>sin teléfono: queda pendiente</em>}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd className={preview.email ? "" : "is-off"}>{preview.email ?? "—"}</dd>
                </div>
                <div>
                  <dt>Fuente</dt>
                  <dd>{sourceName(sourceValue)}</dd>
                </div>
                <div>
                  <dt>Etiquetas</dt>
                  <dd className={preview.tagNames.length ? "" : "is-off"}>{preview.tagNames.length ? preview.tagNames.join(", ") : "ninguna"}</dd>
                </div>
                <div>
                  <dt>Oportunidad</dt>
                  <dd>{stageName(stageValue)}</dd>
                </div>
                {preview.extra.map((x) => (
                  <div key={x.key}>
                    <dt>{x.label ?? x.key}</dt>
                    <dd>
                      {x.value}
                      {!x.label && (
                        <>
                          {" "}
                          <em>no sale en la ficha: no hay un campo «{x.key}»</em>
                        </>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {/* ── Leads recibidos ── */}
          <section className="mfd__section" data-form-leads>
            <h5>
              Leads recibidos
              <small>Los importados y reprocesados no mandan la plantilla de bienvenida ni arrancan flujos; la oportunidad sí se crea.</small>
            </h5>
            <div className="mfd__chips">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!rule.enabled || dirty || importLeads.isPending}
                title={dirty ? "Guarda los cambios antes de importar" : !rule.enabled ? "Activa el formulario para importar sus leads" : "Meta guarda los leads de los últimos 90 días"}
                onClick={() => {
                  void confirmDialog({
                    title: "Importar leads anteriores",
                    message: `Se leerán los leads de «${form.formName}» que Meta aún guarda (los últimos 90 días) y entrarán los que no estén en Driony, con la configuración actual. No se les escribe ni arrancan flujos.`,
                    confirmLabel: "Importar",
                  }).then((ok) => ok && importLeads.mutate());
                }}
                data-import-leads
              >
                {importLeads.isPending ? "Leyendo en Meta…" : "Importar leads anteriores"}
              </button>
              {dirty && <span className="mfd__hint">Guarda los cambios antes de importar o reprocesar.</span>}
            </div>
            {leadsQuery.isPending && <p className="mfd__hint">Cargando leads…</p>}
            {!leadsQuery.isPending && leads.length === 0 && <p className="mfd__hint">Aún no ha llegado ningún lead de este formulario.</p>}
            {leads.length > 0 && (
              <div className="mfd__leads">
                {leads.slice(0, 50).map((lead) => (
                  <div key={lead.id} className="mfd__lead" data-form-lead={lead.id}>
                    <span className="mfd__lead-main">
                      <strong>{lead.name ?? "Sin nombre"}</strong>
                      <small>
                        {[lead.phone, lead.email, lead.campaignName ? `Campaña: ${lead.campaignName}` : null].filter(Boolean).join(" · ") || "sin teléfono ni email"}
                        {lead.status === "ERROR" && lead.error ? ` · ${lead.error}` : ""}
                      </small>
                    </span>
                    <span className="mfd__q-type" style={lead.status === "ERROR" ? { color: "var(--danger)" } : lead.status === "NO_PHONE" ? { color: "var(--warning)" } : undefined}>
                      {STATUS_LABEL[lead.status]}
                    </span>
                    <span className="mfd__lead-when">{new Date(lead.createdAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={dirty || !rule.enabled || reprocess.isPending}
                      onClick={() => reprocess.mutate(lead.id)}
                      title="Vuelve a pasar este lead con la configuración actual"
                    >
                      Reprocesar
                    </button>
                  </div>
                ))}
                {leads.length > 50 && <p className="mfd__hint">Se muestran los últimos 50.</p>}
              </div>
            )}
          </section>
        </div>

        <footer className="mfd__foot">
          <span className="mfd__state">{save.isPending ? "Guardando…" : dirty ? "Cambios sin guardar" : ""}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {dirty ? "Descartar" : "Cerrar"}
          </button>
          <button type="button" className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-form-save>
            Guardar
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
