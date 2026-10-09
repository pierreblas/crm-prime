"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CallDto, CallOutcome } from "@crm/shared";
import { mediaSrc, updateCall } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { useLocale, useT } from "@/i18n/I18nProvider";
import { OutcomeChips, fmt } from "./CallProvider";

/**
 * Una llamada en el hilo de la conversación: dirección, quién, cuánto duró,
 * resultado, grabación y lo que dijo la transcripción. Se edita en el sitio.
 */
export function CallEntry({ call }: { call: CallDto }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<CallOutcome>(call.outcome ?? "answered");
  const [note, setNote] = useState(call.note ?? "");
  const [showTranscript, setShowTranscript] = useState(false);

  const save = useMutation({
    mutationFn: () => updateCall(call.id, { outcome, note: note.trim() || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calls"] });
      setEditing(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const missed = call.status === "missed" || call.status === "no_answer" || call.status === "busy" || call.status === "failed";
  const live = call.status === "ringing" || call.status === "in_progress" || call.status === "queued";
  const rec = call.recordingUrl ? mediaSrc(call.recordingUrl) : null;
  const when = new Date(call.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`call-entry${missed ? " is-missed" : ""}${live ? " is-live" : ""}`}>
      <div className="call-entry__head">
        <span className="call-entry__icon" aria-hidden>
          <NavIcon name="phone" size={13} />
        </span>
        <span className="call-entry__title">
          {t(`calls.direction.${call.direction}` as never)} · {t(`calls.status.${call.status}` as never)}
          {call.durationSec != null && call.durationSec > 0 ? ` · ${fmt(call.durationSec)}` : ""}
        </span>
        <span className="call-entry__meta">
          {call.agent?.name ? `${call.agent.name} · ` : ""}
          {when}
          {call.provider === "manual" ? ` · ${t("calls.manual")}` : ""}
        </span>
      </div>
      {!editing && (call.outcome || call.note) && (
        <div className="call-entry__body">
          {call.outcome && <span className="pf-chip">{t(`calls.outcomes.${call.outcome}` as never)}</span>}
          {call.note && <span>{call.note}</span>}
        </div>
      )}
      {editing && (
        <form
          className="call-entry__edit"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <OutcomeChips value={outcome} onChange={setOutcome} />
          <input className="field field-sm" value={note} maxLength={1000} placeholder={t("calls.note")} onChange={(e) => setNote(e.target.value)} />
          <div className="cp-row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>
              {t("common.save")}
            </button>
          </div>
        </form>
      )}
      {rec && <audio controls preload="none" src={rec} className="call-entry__audio" />}
      {call.transcript && (
        <div className="call-entry__transcript">
          <button type="button" className="cp-link" onClick={() => setShowTranscript((v) => !v)}>
            <NavIcon name="sparkles" size={11} />
            {showTranscript ? t("calls.hideTranscript") : t("calls.transcript")}
          </button>
          {showTranscript && <p>{call.transcript}</p>}
        </div>
      )}
      {!editing && !live && (
        <button type="button" className="call-entry__editbtn" onClick={() => setEditing(true)}>
          {call.outcome ? t("common.edit") : t("calls.outcome")}
        </button>
      )}
    </div>
  );
}
