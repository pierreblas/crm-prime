"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  formatMoney,
  type ContactListItem,
  type ConversationDto,
  type CustomFieldDto,
  type DealDto,
  type NoteDto,
  type SourceDto,
  type StageRef,
} from "@crm/shared";
import {
  addNote,
  createDeal,
  fetchContact,
  fetchContactDeals,
  fetchCustomFields,
  fetchStages,
  moveDeal,
  updateContact,
} from "@/lib/bff";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";
import { useLocale, useT } from "@/i18n/I18nProvider";
import type { Translator } from "@/i18n/translate";
import { ContactDrawer } from "@/features/contacts/ContactDrawer";
import { useCalls } from "@/features/calls/CallProvider";
import { TagEditor } from "@/features/contacts/TagEditor";
import { CopilotPanel } from "./CopilotPanel";

export type ContactPanelTab = "contact" | "copilot";

/**
 * Panel lateral del chat: quién es el contacto y todo lo que se decide sobre
 * él sin salir de la conversación —en qué etapa del embudo va, qué etiquetas
 * lleva, sus campos, su fuente y las notas internas—. Antes esto estaba
 * repartido: las etiquetas solo las ponía el bot, la etapa se cambiaba en el
 * tablero y la ficha vivía en Contactos.
 *
 * Las consultas cuelgan de las claves `contacts` y `pipeline`: así cualquier
 * invalidación de esas secciones (acciones de la IA, cambios en tiempo real
 * del tablero) refresca también este panel sin cablear nada más.
 */
export function ContactPanel({
  conversation,
  tab,
  onTab,
  onClose,
  notes,
  notesLoading,
  sources,
  onSourceChange,
  sourceSaving,
  onUseText,
}: {
  conversation: ConversationDto;
  tab: ContactPanelTab;
  onTab: (tab: ContactPanelTab) => void;
  onClose: () => void;
  notes: NoteDto[];
  notesLoading: boolean;
  sources: SourceDto[];
  onSourceChange: (id: string | null) => void;
  sourceSaving: boolean;
  /** Carga un texto en el cuadro de mensaje (respuestas del copiloto). */
  onUseText: (text: string) => void;
}) {
  const t = useT();
  const contactId = conversation.contact.id;

  const { data: contact } = useQuery({
    queryKey: ["contacts", "one", contactId],
    queryFn: () => fetchContact(contactId),
  });
  const { data: fields = [] } = useQuery({
    queryKey: ["custom-fields"],
    queryFn: fetchCustomFields,
  });

  return (
    <>
      <div className="chat-side__backdrop" onClick={onClose} aria-hidden />
      <aside className="chat-side" aria-label={t("inbox.details")}>
        <header className="chat-side__head">
          <div className="seg" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "contact"}
              onClick={() => onTab("contact")}
            >
              <NavIcon name="user" size={13} />
              {t("inbox.panelContact")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "copilot"}
              onClick={() => onTab("copilot")}
            >
              <NavIcon name="sparkles" size={13} />
              {t("inbox.panelCopilot")}
            </button>
          </div>
          <button
            type="button"
            className="cp-iconbtn"
            onClick={onClose}
            title={t("inbox.closePanel")}
            aria-label={t("inbox.closePanel")}
          >
            <NavIcon name="x" size={15} />
          </button>
        </header>

        <div className="chat-side__body">
          {tab === "copilot" ? (
            <div style={{ padding: "12px 0 4px" }}>
              <CopilotPanel conversationId={conversation.id} onUseText={onUseText} />
            </div>
          ) : (
            <>
              <Identity conversation={conversation} contact={contact ?? null} sources={sources} fields={fields} />
              <DealsSection contactId={contactId} contactName={conversation.contact.name ?? conversation.contact.phone} />
              <section className="cp-section">
                <div className="cp-section__title">{t("inbox.tags")}</div>
                <TagEditor contactId={contactId} applied={conversation.contact.tags} />
              </section>
              <section className="cp-section">
                <div className="cp-section__title">{t("inbox.source")}</div>
                <select
                  className="field field-sm"
                  value={conversation.contact.source?.id ?? ""}
                  onChange={(e) => onSourceChange(e.target.value || null)}
                  disabled={sourceSaving}
                  aria-label={t("inbox.source")}
                >
                  <option value="">{t("inbox.noSource")}</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </section>
              <FieldsSection contact={contact ?? null} fields={fields} />
              <NotesSection conversationId={conversation.id} notes={notes} loading={notesLoading} />
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ── Identidad: nombre editable, teléfono, país y moneda ──────
function Identity({
  conversation,
  contact,
  sources,
  fields,
}: {
  conversation: ConversationDto;
  contact: ContactListItem | null;
  sources: SourceDto[];
  fields: CustomFieldDto[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const phone = useCalls();
  const name = conversation.contact.name ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["pipeline"] });
  };

  const rename = useMutation({
    mutationFn: (value: string) => updateContact(conversation.contact.id, { name: value || null }),
    onSuccess: () => {
      toast.success(t("inbox.contactSaved"));
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function commit() {
    setEditing(false);
    const value = draft.trim();
    if (value !== name) rename.mutate(value);
  }

  return (
    <section className="cp-section cp-identity">
      <span className="cp-avatar" aria-hidden>
        {initials(name || conversation.contact.phone)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            autoFocus
            className="cp-name__input"
            value={draft}
            placeholder={t("inbox.noName")}
            maxLength={160}
            aria-label={t("inbox.contactName")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="cp-name">
            <h3 className={name ? "" : "cp-name--empty"}>{name || t("inbox.noName")}</h3>
            <button
              type="button"
              className="cp-iconbtn"
              onClick={() => setEditing(true)}
              title={t("inbox.editName")}
              aria-label={t("inbox.editName")}
            >
              <NavIcon name="pencil" size={12} />
            </button>
          </div>
        )}
        <div className="cp-meta">
          <span>{conversation.contact.phone}</span>
          {contact && (
            <span>
              {contact.country?.name ?? t("inbox.countryUnknown")}
              {contact.currency ? ` · ${t("inbox.quoteIn", { currency: contact.currency })}` : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          disabled={!contact}
          onClick={() => setProfileOpen(true)}
        >
          <NavIcon name="user" size={13} />
          {t("inbox.fullProfile")}
        </button>
        <div className="cp-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              phone.call(conversation.contact.phone, {
                name: conversation.contact.name,
                contactId: conversation.contact.id,
                conversationId: conversation.id,
              })
            }
          >
            <NavIcon name="phone" size={13} />
            {t("calls.call")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              phone.logFor({
                phone: conversation.contact.phone,
                name: conversation.contact.name,
                contactId: conversation.contact.id,
                conversationId: conversation.id,
              })
            }
          >
            {t("calls.logCall")}
          </button>
        </div>
      </div>

      {profileOpen && contact && (
        <ContactDrawer
          contact={contact}
          sources={sources}
          fields={fields}
          onClose={() => setProfileOpen(false)}
          onSaved={() => {
            setProfileOpen(false);
            refresh();
          }}
        />
      )}
    </section>
  );
}

// ── Embudo: oportunidades abiertas y su etapa ────────────────
function DealsSection({ contactId, contactName }: { contactId: string; contactName: string }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(contactName);
  const [stageId, setStageId] = useState("");
  const [value, setValue] = useState("");

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ["pipeline", "contact-deals", contactId],
    queryFn: () => fetchContactDeals(contactId),
  });
  const { data: stages = [] } = useQuery({
    queryKey: ["pipeline", "stages"],
    queryFn: fetchStages,
  });

  // Etapas agrupadas por embudo; el predeterminado viene primero de la API.
  const groups = useMemo(() => {
    const byPipeline = new Map<string, { name: string; stages: StageRef[] }>();
    for (const s of stages) {
      const g = byPipeline.get(s.pipelineId) ?? { name: s.pipelineName, stages: [] };
      g.stages.push(s);
      byPipeline.set(s.pipelineId, g);
    }
    return [...byPipeline.values()];
  }, [stages]);
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? "";
  const stageLabel = (s: StageRef) =>
    `${s.name}${s.isWon ? ` · ${t("inbox.stageWon")}` : s.isLost ? ` · ${t("inbox.stageLost")}` : ""}`;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pipeline"] });

  const move = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) => moveDeal(dealId, stageId),
    onSuccess: (d) => {
      toast.success(t("inbox.dealMoved", { stage: stageName(d.stageId) }));
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const create = useMutation({
    mutationFn: () =>
      createDeal({
        contactId,
        title: title.trim() || contactName,
        stageId: stageId || stages[0]?.id,
        ...(value.trim() ? { value: Number(value) } : {}),
      }),
    onSuccess: (d) => {
      toast.success(t("inbox.dealCreated", { stage: stageName(d.stageId) }));
      setAdding(false);
      setValue("");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="cp-section">
      <div className="cp-section__title">
        <span>{t("inbox.pipelineSection")}</span>
        <Link
          href={deals[0] ? `/pipeline?id=${deals[0].pipelineId}&deal=${deals[0].id}` : "/pipeline"}
          className="cp-link"
        >
          {t("inbox.openBoard")}
          <NavIcon name="arrow-right" size={11} />
        </Link>
      </div>

      {deals.map((d) => (
        <DealRow
          key={d.id}
          deal={d}
          groups={groups}
          stageLabel={stageLabel}
          locale={locale}
          busy={move.isPending}
          onMove={(stageId) => move.mutate({ dealId: d.id, stageId })}
          t={t}
        />
      ))}

      {!isLoading && deals.length === 0 && !adding && (
        <p className="cp-empty">{t("inbox.noDeal")}</p>
      )}

      {adding ? (
        <form
          className="cp-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <input
            autoFocus
            className="field field-sm"
            value={title}
            maxLength={160}
            placeholder={t("inbox.dealTitle")}
            aria-label={t("inbox.dealTitle")}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="cp-row">
            <select
              className="field field-sm"
              value={stageId || stages[0]?.id || ""}
              onChange={(e) => setStageId(e.target.value)}
              aria-label={t("inbox.dealStage")}
              style={{ flex: 1.4 }}
            >
              {groups.map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {stageLabel(s)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              className="field field-sm"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={value}
              placeholder={t("inbox.dealValue")}
              aria-label={t("inbox.dealValue")}
              onChange={(e) => setValue(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
          <div className="cp-row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending || stages.length === 0}>
              {create.isPending ? t("common.saving") : t("inbox.createDeal")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            setTitle(contactName);
            setAdding(true);
          }}
        >
          <NavIcon name="plus" size={13} />
          {t("inbox.addToPipeline")}
        </button>
      )}
    </section>
  );
}

function DealRow({
  deal,
  groups,
  stageLabel,
  locale,
  busy,
  onMove,
  t,
}: {
  deal: DealDto;
  groups: { name: string; stages: StageRef[] }[];
  stageLabel: (s: StageRef) => string;
  locale: string;
  busy: boolean;
  onMove: (stageId: string) => void;
  t: Translator;
}) {
  return (
    <div className="cp-deal">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span className="cp-deal__title">{deal.title}</span>
        {deal.value !== null && (
          <span className="cp-deal__value">{formatMoney(deal.value, deal.currency, locale)}</span>
        )}
      </div>
      <select
        className="field field-sm"
        value={deal.stageId}
        disabled={busy}
        aria-label={t("inbox.dealStage")}
        onChange={(e) => onMove(e.target.value)}
      >
        {groups.map((g) => (
          <optgroup key={g.name} label={g.name}>
            {g.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {stageLabel(s)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ── Campos del negocio: se editan aquí mismo ─────────────────
function FieldsSection({ contact, fields }: { contact: ContactListItem | null; fields: CustomFieldDto[] }) {
  const t = useT();
  const queryClient = useQueryClient();
  const saved = useMemo(() => contact?.fields ?? {}, [contact]);
  const [values, setValues] = useState<Record<string, string>>(saved);

  // Al refrescar la ficha (acciones de la IA, tiempo real) se cargan los
  // valores nuevos, salvo que haya algo a medio escribir: eso no se pisa.
  const lastSaved = useRef(saved);
  useEffect(() => {
    const untouched = Object.keys({ ...lastSaved.current, ...values }).every(
      (k) => (values[k] ?? "") === (lastSaved.current[k] ?? ""),
    );
    lastSaved.current = saved;
    if (untouched) setValues(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const dirty = fields.some((f) => (values[f.key] ?? "") !== (saved[f.key] ?? ""));

  const save = useMutation({
    mutationFn: () => updateContact(contact!.id, { fields: values }),
    onSuccess: () => {
      toast.success(t("inbox.contactSaved"));
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="cp-section">
      <div className="cp-section__title">{t("inbox.fields")}</div>
      {fields.length === 0 ? (
        <p className="cp-empty">{t("inbox.noFields")}</p>
      ) : (
        <form
          className="cp-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && contact) save.mutate();
          }}
        >
          {fields.map((f) => (
            <label key={f.id} className="cp-field">
              <span className="label">{f.label}</span>
              {f.type === "select" ? (
                <select
                  className="field field-sm"
                  value={values[f.key] ?? ""}
                  disabled={!contact}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="field field-sm"
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  value={values[f.key] ?? ""}
                  disabled={!contact}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
          {dirty && (
            <div className="cp-row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValues(saved)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>
                {save.isPending ? t("common.saving") : t("inbox.saveFields")}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

// ── Notas internas ───────────────────────────────────────────
function NotesSection({
  conversationId,
  notes,
  loading,
}: {
  conversationId: string;
  notes: NoteDto[];
  loading: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const add = useMutation({
    mutationFn: () => addNote(conversationId, body.trim()),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["notes", conversationId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="cp-section">
      <div className="cp-section__title">{t("inbox.notes")}</div>
      <p className="cp-empty">{t("inbox.notesHint")}</p>
      {loading && <span className="cp-empty">{t("common.loading")}</span>}
      {!loading && notes.length === 0 && <span className="cp-empty">{t("inbox.noNotes")}</span>}
      {notes.map((n) => (
        <div key={n.id} className="cp-note">
          <div>{n.body}</div>
          <div className="cp-note__meta">
            {n.author.name ?? t("inbox.agent")} · {new Date(n.createdAt).toLocaleString(locale)}
          </div>
        </div>
      ))}
      <form
        className="cp-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <input
          className="field field-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("inbox.addNote")}
          aria-label={t("inbox.addNote")}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={add.isPending || !body.trim()}>
          {t("inbox.add")}
        </button>
      </form>
    </section>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  const digits = value.replace(/\D/g, "");
  return (digits.slice(-2) || value.slice(0, 2)).toUpperCase();
}

