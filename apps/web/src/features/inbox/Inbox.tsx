"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ConversationStatus,
  type ConversationDto,
  type ConversationFilter,
  type ReplyFilter,
} from "@crm/shared";
import { fetchAgents, fetchConversations, fetchSources, fetchTags, setConversationStatus } from "@/lib/bff";
import {
  DateFilter,
  EMPTY_DATE,
  FilterGroup,
  FiltersToggle,
  TagPicker,
  dateBounds,
  isDateActive,
  type DateFilterValue,
} from "@/components/Filters";
import { FILTER_NONE } from "@crm/shared";
import { useInboxSocket } from "@/hooks/useInboxSocket";
import { useRealtimeCtx } from "@/components/RealtimeProvider";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";
import { toast } from "@/lib/toast";
import { ConversationList, ConversationListSkeleton, previewOf } from "./ConversationList";
import { ChatWindow } from "./ChatWindow";

const FILTERS: { key: ConversationFilter; labelKey: MessageKey }[] = [
  { key: "all", labelKey: "inbox.filterAll" },
  { key: "unassigned", labelKey: "inbox.filterUnassigned" },
  { key: "mine", labelKey: "inbox.filterMine" },
];

// "Cualquiera" y no "Todas": el filtro de arriba ya usa esa palabra y dos
// "Todas" seguidas no dejan claro qué apaga cada una.
const REPLY_FILTERS: { key: ReplyFilter; labelKey: MessageKey; dot?: string }[] = [
  { key: "all", labelKey: "inbox.replyAny" },
  { key: "pending", labelKey: "inbox.replyPending", dot: "var(--warning)" },
  { key: "replied", labelKey: "inbox.replyReplied", dot: "var(--accent)" },
];

type StatusFilter = ConversationStatus | "";
type Sort = "recent" | "waiting";

export function Inbox() {
  const t = useT();
  const queryClient = useQueryClient();
  const { connected } = useInboxSocket();
  const { setOpenConversation } = useRealtimeCtx();
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // En móvil solo cabe un panel: la lista o el chat.
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [reply, setReply] = useState<ReplyFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("");
  const [channelId, setChannelId] = useState<string>("");
  const [sort, setSort] = useState<Sort>("recent");
  const [search, setSearch] = useState("");

  // Filtros avanzados: se resuelven en el servidor (la lista viene acotada a
  // las 100 más recientes; filtrar después de cortar perdería conversaciones).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [date, setDate] = useState<DateFilterValue>(EMPTY_DATE);
  // «Ver sus chats» desde Equipo: la bandeja llega filtrada por esa persona.
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("agent");
    if (a) {
      setAgentId(a);
      setFiltersOpen(true);
    }
  }, []);
  const { data: tagList = [] } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const { data: sources = [] } = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const advCount = (tags.length ? 1 : 0) + (sourceId ? 1 : 0) + (agentId ? 1 : 0) + (isDateActive(date) ? 1 : 0);
  const clearAdvanced = () => {
    setTags([]);
    setSourceId("");
    setAgentId("");
    setDate(EMPTY_DATE);
  };
  // La búsqueda también va al servidor, con un respiro para no pedir por tecla.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const bounds = dateBounds(date);
  const fromIso = bounds.from === null ? undefined : new Date(bounds.from).toISOString();
  const toIso = bounds.to === null ? undefined : new Date(bounds.to).toISOString();

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["conversations", filter, reply, status, tags, sourceId, agentId, fromIso, toIso, debouncedQ],
    queryFn: () =>
      fetchConversations({
        filter,
        status: status || undefined,
        reply,
        tags,
        sourceId: sourceId || undefined,
        agentId: agentId || undefined,
        from: fromIso,
        to: toIso,
        q: debouncedQ || undefined,
      }),
    // Al cambiar un filtro se mantiene la lista anterior hasta que llega la nueva.
    placeholderData: keepPreviousData,
  });

  // Números presentes en lo cargado, para el filtro por canal.
  const channels = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conversations) {
      if (c.channel) map.set(c.channel.id, c.channel.label ?? c.channel.displayPhoneNumber ?? c.channel.id);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  }, [conversations]);

  // Búsqueda, canal y orden se aplican sobre lo ya cargado: instantáneo y sin
  // una vuelta al servidor por cada tecla.
  const query = search.trim().toLowerCase();
  const shown = useMemo(() => {
    let list = conversations;
    if (channelId) list = list.filter((c) => c.channel?.id === channelId);
    if (query) {
      list = list.filter(
        (c) =>
          (c.contact.name ?? "").toLowerCase().includes(query) ||
          c.contact.phone.toLowerCase().includes(query) ||
          (c.lastMessage?.text ?? "").toLowerCase().includes(query),
      );
    }
    if (sort === "waiting") {
      // Primero quien más tiempo lleva esperando; después el resto, recientes.
      const ts = (c: ConversationDto) => (c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0);
      list = [...list].sort((a, b) => {
        if (a.awaitingReply !== b.awaitingReply) return a.awaitingReply ? -1 : 1;
        return a.awaitingReply ? ts(a) - ts(b) : ts(b) - ts(a);
      });
    }
    return list;
  }, [conversations, channelId, query, sort]);

  const awaitingCount = useMemo(
    () => conversations.filter((c) => c.awaitingReply).length,
    [conversations],
  );

  // En escritorio se abre la primera; en móvil se espera a que el usuario elija.
  const selected = useMemo(() => {
    const id = selectedId ?? (isMobile ? null : (shown[0]?.id ?? null));
    return shown.find((c) => c.id === id) ?? null;
  }, [shown, selectedId, isMobile]);

  const nombreDe = useCallback((c: ConversationDto) => c.contact.name ?? c.contact.phone, []);
  const previewDe = useCallback((c: ConversationDto) => previewOf(c, t).text, [t]);
  // Para que los avisos globales callen en el chat que se está viendo.
  useEffect(() => {
    setOpenConversation(selected?.id ?? null);
    return () => setOpenConversation(null);
  }, [selected?.id, setOpenConversation]);
  // Llegar desde un aviso: /?c=<id> abre ese chat.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (!c) return;
    setSelectedId(c);
    setMobilePane("chat");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  function select(c: ConversationDto) {
    setSelectedId(c.id);
    setMobilePane("chat");
  }

  // Cerrar y pasar a la siguiente de la lista: para triar de corrido.
  const closeMut = useMutation({
    mutationFn: (id: string) => setConversationStatus(id, ConversationStatus.CLOSED),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    onError: (e) => toast.error((e as Error).message),
  });
  function closeAndNext() {
    if (!selected) return;
    const i = shown.findIndex((c) => c.id === selected.id);
    const next = shown[i + 1] ?? shown[i - 1] ?? null;
    closeMut.mutate(selected.id);
    if (next) setSelectedId(next.id);
    else {
      setSelectedId(null);
      setMobilePane("list");
    }
  }

  // Atajos: ↑/↓ cambian de conversación, Esc vuelve a la lista en móvil.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!shown.length) return;
        e.preventDefault();
        const i = shown.findIndex((c) => c.id === selected?.id);
        const j = e.key === "ArrowDown" ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1);
        const c = shown[j];
        if (c) {
          setSelectedId(c.id);
          document.querySelector(`[data-conversation-id="${c.id}"]`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Escape" && isMobile) {
        setMobilePane("list");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, selected, isMobile]);

  const showList = !isMobile || mobilePane === "list";
  const showChat = !isMobile || mobilePane === "chat";

  return (
    <div className="inbox" style={{ display: "flex", height: "calc(100vh - var(--header-h))" }}>
      {showList && (
        <aside className="inbox-list" style={listPane} data-tour="inbox-list">
          <div style={paneHeader}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
              {t("inbox.conversations")}
              {!isLoading && (
                <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>
                  · {shown.length}
                  {awaitingCount > 0 && (
                    <span style={{ color: "var(--warning)" }}> · {t("inbox.awaitingCount", { n: awaitingCount })}</span>
                  )}
                </span>
              )}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {/* El estado no se comunica solo con color: punto + palabra. */}
              <span style={liveChip(connected)}>
                <span style={liveDot(connected)} />
                {connected ? t("inbox.live") : t("inbox.offline")}
              </span>
            </span>
          </div>

          <div style={filterBar}>
            <label style={searchField}>
              <NavIcon name="search" size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("inbox.searchConversations")}
                style={searchInput}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  title={t("common.close")}
                  aria-label={t("common.close")}
                  style={clearBtn}
                >
                  <NavIcon name="x" size={13} />
                </button>
              )}
            </label>

            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    setFilter(f.key);
                    setAgentId("");
                  }}
                  style={chip(filter === f.key)}
                >
                  {t(f.labelKey)}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <FiltersToggle compact open={filtersOpen} count={advCount} onClick={() => setFiltersOpen((v) => !v)} />
              <button
                type="button"
                onClick={() => setSort((s) => (s === "recent" ? "waiting" : "recent"))}
                title={sort === "recent" ? t("inbox.sortWaiting") : t("inbox.sortRecent")}
                style={chip(sort === "waiting")}
              >
                <NavIcon name="hourglass" size={11} />
                {sort === "waiting" ? t("inbox.sortWaitingShort") : t("inbox.sortRecentShort")}
              </button>
            </div>

            <ReplySwitch value={reply} onChange={setReply} />

            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                aria-label={t("inbox.status")}
                style={{ ...statusSelect, flex: 1 }}
              >
                <option value="">{t("inbox.statusAll")}</option>
                <option value={ConversationStatus.OPEN}>{t("inbox.statusOpen")}</option>
                <option value={ConversationStatus.PENDING}>{t("inbox.statusPending")}</option>
                <option value={ConversationStatus.CLOSED}>{t("inbox.statusClosed")}</option>
              </select>
              {channels.length > 1 && (
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  aria-label={t("inbox.channelFilter")}
                  style={{ ...statusSelect, flex: 1 }}
                >
                  <option value="">{t("inbox.allChannels")}</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {filtersOpen && (
              <div className="flt-panel" data-tour="inbox-filters">
                <FilterGroup label={t("filters.tags")}>
                  <TagPicker tags={tagList} selected={tags} onChange={setTags} />
                </FilterGroup>
                <div className="flt-row">
                  <FilterGroup label={t("filters.source")}>
                    <select
                      className="field field-sm"
                      value={sourceId}
                      onChange={(e) => setSourceId(e.target.value)}
                      aria-label={t("filters.source")}
                    >
                      <option value="">{t("filters.anySource")}</option>
                      <option value={FILTER_NONE}>{t("filters.noSource")}</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </FilterGroup>
                  <FilterGroup label={t("filters.agent")}>
                    <select
                      className="field field-sm"
                      value={agentId}
                      onChange={(e) => {
                        setAgentId(e.target.value);
                        if (e.target.value) setFilter("all");
                      }}
                      aria-label={t("filters.agent")}
                    >
                      <option value="">{t("filters.anyAgent")}</option>
                      <option value={FILTER_NONE}>{t("filters.unassigned")}</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name ?? a.email}
                        </option>
                      ))}
                    </select>
                  </FilterGroup>
                </div>
                <FilterGroup label={t("filters.lastMessage")}>
                  <DateFilter value={date} onChange={setDate} />
                </FilterGroup>
                {advCount > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={clearAdvanced}>
                    <NavIcon name="x" size={12} />
                    {t("filters.clear")}
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {isLoading ? (
              <ConversationListSkeleton />
            ) : (
              <ConversationList
                conversations={shown}
                selectedId={selected?.id ?? null}
                onSelect={select}
                emptyMessage={
                  query
                    ? t("inbox.noMatches", { query: search.trim() })
                    : advCount > 0
                      ? t("inbox.noFilterMatches")
                      : undefined
                }
              />
            )}
          </div>
        </aside>
      )}

      {showChat && (
        <main className="inbox-chat" style={{ flex: 1, minWidth: 0 }} data-tour="inbox-chat">
          {selected ? (
            <ChatWindow
              key={selected.id}
              conversation={selected}
              onBack={isMobile ? () => setMobilePane("list") : undefined}
              onCloseAndNext={closeAndNext}
            />
          ) : (
            <div style={emptyPane}>
              <NavIcon name="inbox" size={30} />
              <p style={{ margin: "12px 0 0", fontWeight: 600 }}>{t("inbox.selectConversation")}</p>
              <p style={{ margin: "4px 0 0", fontSize: 13 }}>{t("inbox.selectConversationHint")}</p>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

// Switch segmentado para el filtro de respuesta (Cualquiera / Sin responder /
// Respondidas) con indicador deslizante.
function ReplySwitch({ value, onChange }: { value: ReplyFilter; onChange: (v: ReplyFilter) => void }) {
  const t = useT();
  const index = REPLY_FILTERS.findIndex((f) => f.key === value);

  return (
    <div style={switchTrack} role="tablist" aria-label={t("inbox.replyFilterLabel")}>
      <span aria-hidden style={{ ...switchThumb, transform: `translateX(${index * 100}%)` }} />
      {REPLY_FILTERS.map((f) => {
        const active = f.key === value;
        return (
          <button key={f.key} role="tab" aria-selected={active} onClick={() => onChange(f.key)} style={switchSeg(active)}>
            {f.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: f.dot, flexShrink: 0 }} />}
            {t(f.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────

const switchTrack: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: `repeat(${REPLY_FILTERS.length}, 1fr)`,
  padding: 3,
  borderRadius: 999,
  background: "var(--field)",
  border: "1px solid var(--border)",
};

const switchThumb: React.CSSProperties = {
  position: "absolute",
  top: 3,
  left: 3,
  width: `calc((100% - 6px) / ${REPLY_FILTERS.length})`,
  height: "calc(100% - 6px)",
  borderRadius: 999,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
  transition: "transform 0.22s cubic-bezier(0.22,1,0.36,1)",
  pointerEvents: "none",
};

function switchSeg(active: boolean): React.CSSProperties {
  return {
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "6px 8px",
    borderRadius: 999,
    border: "none",
    background: "transparent",
    color: active ? "var(--text)" : "var(--muted)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "color 0.18s ease",
  };
}

const listPane: React.CSSProperties = {
  width: 360,
  borderRight: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  minWidth: 0,
};

const paneHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "14px 14px 12px 16px",
  borderBottom: "1px solid var(--border)",
  fontWeight: 600,
};


function liveChip(connected: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    color: connected ? "var(--positive)" : "var(--muted)",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flexShrink: 0,
  };
}

function liveDot(connected: boolean): React.CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: connected ? "var(--positive)" : "#7a8aa0",
    flexShrink: 0,
  };
}

const filterBar: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};

const searchField: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--muted)",
};

const searchInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  background: "transparent",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
};

const clearBtn: React.CSSProperties = {
  display: "inline-flex",
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  padding: 0,
};

function chip(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    borderRadius: 999,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "var(--accent-ink)" : "var(--muted)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

const statusSelect: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13,
  minWidth: 0,
};

const emptyPane: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "var(--muted)",
  textAlign: "center",
  padding: 24,
};
