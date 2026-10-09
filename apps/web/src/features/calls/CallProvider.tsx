"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Call, Device } from "@twilio/voice-sdk";
import { callOutcomes, type CallOutcome } from "@crm/shared";
import { fetchCallToken, fetchCallsConfig, logManualCall, updateCall } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n/I18nProvider";

export type CallPhase = "idle" | "connecting" | "ringing" | "in_call" | "incoming" | "wrapup";

export interface ActiveCall {
  phone: string;
  name: string | null;
  contactId: string | null;
  conversationId: string | null;
  incoming: boolean;
  startedAt: number | null; // cuando contestaron
  sid: string | null; // CallSid de Twilio: con él se guarda el resultado
}

interface CallContextValue {
  /** La empresa tiene Twilio activo: se llama desde el navegador. */
  configured: boolean;
  phase: CallPhase;
  active: ActiveCall | null;
  muted: boolean;
  /** Llamar a un número. Sin Twilio, abre el teléfono del equipo y ofrece registrar la llamada. */
  call: (phone: string, meta: { name?: string | null; contactId?: string | null; conversationId?: string | null }) => void;
  accept: () => void;
  reject: () => void;
  hangup: () => void;
  toggleMute: () => void;
  /** Abre el formulario de «Registrar llamada» para un contacto. */
  logFor: (meta: { phone: string; name?: string | null; contactId: string; conversationId?: string | null }) => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCalls(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCalls fuera de CallProvider");
  return ctx;
}

/**
 * Softphone de la app: un Device de Twilio por pestaña, registrado con el
 * token del usuario, que suena cuando llaman al número de la empresa y marca
 * desde cualquier «Llamar». La barra de llamada (abajo a la derecha) vive aquí
 * para estar en todas las pantallas.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: config } = useQuery({ queryKey: ["calls", "config"], queryFn: fetchCallsConfig, staleTime: 60_000 });
  const configured = !!config?.configured;

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [muted, setMuted] = useState(false);
  // Registro manual (sin Twilio, o tras colgar).
  const [manual, setManual] = useState<{ phone: string; name: string | null; contactId: string; conversationId: string | null } | null>(null);

  const finish = useCallback((wrap: boolean) => {
    callRef.current = null;
    setMuted(false);
    setPhase((p) => (wrap && p !== "idle" ? "wrapup" : "idle"));
    if (!wrap) setActive(null);
    queryClient.invalidateQueries({ queryKey: ["calls"] });
  }, [queryClient]);

  const wire = useCallback(
    (call: Call) => {
      callRef.current = call;
      call.on("accept", () => {
        setPhase("in_call");
        setActive((a) => (a ? { ...a, startedAt: Date.now(), sid: call.parameters.CallSid ?? a.sid } : a));
      });
      call.on("ringing", () => setPhase((p) => (p === "connecting" ? "ringing" : p)));
      call.on("disconnect", () => finish(true));
      call.on("cancel", () => finish(false));
      call.on("reject", () => finish(false));
      call.on("error", (e: Error) => {
        toast.error(e.message || t("calls.error"));
        finish(false);
      });
    },
    [finish, t],
  );

  // Registrar el Device cuando la empresa tiene llamadas configuradas.
  useEffect(() => {
    if (!configured) return;
    let disposed = false;
    let device: Device | null = null;
    (async () => {
      try {
        const [{ Device: TwilioDevice }, tok] = await Promise.all([import("@twilio/voice-sdk"), fetchCallToken()]);
        if (disposed) return;
        device = new TwilioDevice(tok.token, { codecPreferences: ["opus", "pcmu"] as never, closeProtection: true });
        deviceRef.current = device;
        device.on("tokenWillExpire", async () => {
          try {
            const fresh = await fetchCallToken();
            device?.updateToken(fresh.token);
          } catch {
            /* se reintenta en el siguiente aviso */
          }
        });
        device.on("error", (e: Error) => {
          // 31005 = conexión perdida; el SDK reintenta solo.
          if (!/31005/.test(e.message)) toast.error(e.message || t("calls.error"));
        });
        device.on("incoming", (call: Call) => {
          const p = call.customParameters;
          setActive({
            phone: call.parameters.From ?? "",
            name: p.get("contactName") || null,
            contactId: p.get("contactId") || null,
            conversationId: p.get("conversationId") || null,
            incoming: true,
            startedAt: null,
            sid: call.parameters.CallSid ?? null,
          });
          setPhase("incoming");
          wire(call);
        });
        await device.register();
      } catch (e) {
        toast.error((e as Error).message || t("calls.error"));
      }
    })();
    return () => {
      disposed = true;
      device?.destroy();
      deviceRef.current = null;
    };
  }, [configured, wire, t]);

  const call = useCallback<CallContextValue["call"]>(
    (phone, meta) => {
      if (!configured || !deviceRef.current) {
        // Sin Twilio: se enseña el número con un enlace tel: (lo abre quien
        // quiera) y la llamada se apunta a mano. Navegar solos a tel: dejaba
        // la pestaña detrás del aviso del sistema.
        if (meta.contactId) setManual({ phone, name: meta.name ?? null, contactId: meta.contactId, conversationId: meta.conversationId ?? null });
        else toast.info(t("calls.notConfigured"));
        return;
      }
      if (phase !== "idle" && phase !== "wrapup") return;
      setActive({
        phone,
        name: meta.name ?? null,
        contactId: meta.contactId ?? null,
        conversationId: meta.conversationId ?? null,
        incoming: false,
        startedAt: null,
        sid: null,
      });
      setPhase("connecting");
      deviceRef.current
        .connect({
          params: {
            To: phone,
            ...(meta.contactId ? { contactId: meta.contactId } : {}),
            ...(meta.conversationId ? { conversationId: meta.conversationId } : {}),
          },
        })
        .then((c) => {
          wire(c);
          setActive((a) => (a ? { ...a, sid: c.parameters.CallSid ?? null } : a));
        })
        .catch((e: Error) => {
          toast.error(/permission|NotAllowed|microphone/i.test(e.message) ? t("calls.micDenied") : e.message || t("calls.error"));
          finish(false);
        });
    },
    [configured, phase, wire, finish, t],
  );

  const accept = useCallback(() => callRef.current?.accept(), []);
  const reject = useCallback(() => {
    callRef.current?.reject();
    finish(false);
  }, [finish]);
  const hangup = useCallback(() => callRef.current?.disconnect(), []);
  const toggleMute = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    c.mute(!c.isMuted());
    setMuted(c.isMuted());
  }, []);
  const logFor = useCallback<CallContextValue["logFor"]>((meta) => {
    setManual({ phone: meta.phone, name: meta.name ?? null, contactId: meta.contactId, conversationId: meta.conversationId ?? null });
  }, []);

  const value = useMemo<CallContextValue>(
    () => ({ configured, phase, active, muted, call, accept, reject, hangup, toggleMute, logFor }),
    [configured, phase, active, muted, call, accept, reject, hangup, toggleMute, logFor],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {phase !== "idle" && active && (
        <CallDock
          phase={phase}
          active={active}
          muted={muted}
          onAccept={accept}
          onReject={reject}
          onHangup={hangup}
          onMute={toggleMute}
          onClose={() => {
            setPhase("idle");
            setActive(null);
          }}
        />
      )}
      {manual && <ManualCallDialog meta={manual} onClose={() => setManual(null)} />}
    </CallContext.Provider>
  );
}

// ── Barra de llamada ─────────────────────────────────────────
function CallDock({
  phase,
  active,
  muted,
  onAccept,
  onReject,
  onHangup,
  onMute,
  onClose,
}: {
  phase: CallPhase;
  active: ActiveCall;
  muted: boolean;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  onMute: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (phase !== "in_call") return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);
  void tick;
  const elapsed = active.startedAt ? Math.floor((Date.now() - active.startedAt) / 1000) : 0;
  const who = active.name || active.phone || t("calls.unknownCaller");
  const label =
    phase === "incoming"
      ? t("calls.incoming")
      : phase === "connecting"
        ? t("calls.connecting")
        : phase === "ringing"
          ? t("calls.ringing")
          : phase === "in_call"
            ? `${t("calls.inCall")} · ${fmt(elapsed)}`
            : t("calls.ended");

  if (phase === "wrapup") {
    return (
      <div className="call-dock" role="dialog" aria-label={t("calls.title")}>
        <WrapUp active={active} onDone={onClose} />
      </div>
    );
  }
  return (
    <div className={`call-dock${phase === "incoming" ? " is-incoming" : ""}`} role="dialog" aria-label={t("calls.title")}>
      <div className="call-dock__head">
        <span className={`call-dock__pulse${phase === "in_call" ? " is-live" : ""}`} aria-hidden>
          <NavIcon name="phone" size={16} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="call-dock__who">{who}</div>
          <div className="call-dock__state">
            {label}
            {active.name && active.phone ? ` · ${active.phone}` : ""}
          </div>
        </div>
      </div>
      <div className="call-dock__actions">
        {phase === "incoming" ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onAccept}>
              <NavIcon name="phone" size={14} />
              {t("calls.accept")}
            </button>
            <button type="button" className="btn btn-danger" onClick={onReject}>
              {t("calls.reject")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onMute} disabled={phase !== "in_call"} aria-pressed={muted}>
              <NavIcon name={muted ? "mic" : "mic"} size={14} />
              {muted ? t("calls.unmute") : t("calls.mute")}
            </button>
            <button type="button" className="btn btn-danger" onClick={onHangup}>
              {t("calls.hangup")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Al colgar: cómo fue, y una nota. Va a la llamada que Twilio ya registró. */
function WrapUp({ active, onDone }: { active: ActiveCall; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<CallOutcome>(active.startedAt ? "answered" : "no_answer");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => updateCall(active.sid!, { outcome, note: note.trim() || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calls"] });
      toast.success(t("calls.logged"));
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <form
      className="call-dock__wrap"
      onSubmit={(e) => {
        e.preventDefault();
        if (active.sid) save.mutate();
        else onDone();
      }}
    >
      <div className="call-dock__who">{t("calls.ended")} · {active.name || active.phone}</div>
      <div className="call-dock__state">{t("calls.outcome")}</div>
      <OutcomeChips value={outcome} onChange={setOutcome} />
      <input className="field field-sm" value={note} maxLength={1000} placeholder={t("calls.note")} onChange={(e) => setNote(e.target.value)} />
      <div className="call-dock__actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          {t("calls.skip")}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

export function OutcomeChips({ value, onChange }: { value: CallOutcome; onChange: (v: CallOutcome) => void }) {
  const t = useT();
  return (
    <div className="flt-chips">
      {callOutcomes.map((o) => (
        <button key={o} type="button" className={`flt-chip${value === o ? " is-on" : ""}`} onClick={() => onChange(o)}>
          {t(`calls.outcomes.${o}` as never)}
        </button>
      ))}
    </div>
  );
}

/** Registrar a mano una llamada hecha desde el celular. */
function ManualCallDialog({
  meta,
  onClose,
}: {
  meta: { phone: string; name: string | null; contactId: string; conversationId: string | null };
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [outcome, setOutcome] = useState<CallOutcome>("answered");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () =>
      logManualCall({
        contactId: meta.contactId,
        ...(meta.conversationId ? { conversationId: meta.conversationId } : {}),
        direction,
        outcome,
        ...(minutes ? { durationSec: Math.round(Number(minutes) * 60) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calls"] });
      toast.success(t("calls.logged"));
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="confirm-backdrop confirm-backdrop--top" onClick={onClose} />
      <form
        className="call-manual"
        role="dialog"
        aria-label={t("calls.logCall")}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="call-dock__who">{t("calls.logCall")}</div>
        <div className="call-dock__state">
          {meta.name || meta.phone}
          {meta.name ? ` · ${meta.phone}` : ""}
        </div>
        <a className="btn btn-ghost btn-sm" href={`tel:${meta.phone}`} style={{ alignSelf: "flex-start" }}>
          <NavIcon name="phone" size={13} />
          {t("calls.openDialer")}
        </a>
        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={direction === "OUTBOUND"} onClick={() => setDirection("OUTBOUND")}>
            {t("calls.direction.OUTBOUND")}
          </button>
          <button type="button" role="tab" aria-selected={direction === "INBOUND"} onClick={() => setDirection("INBOUND")}>
            {t("calls.direction.INBOUND")}
          </button>
        </div>
        <OutcomeChips value={outcome} onChange={setOutcome} />
        <div className="cp-row">
          <input className="field field-sm" type="number" min={0} step={1} inputMode="numeric" value={minutes} placeholder={t("calls.durationMin")} onChange={(e) => setMinutes(e.target.value)} style={{ flex: "0 0 140px" }} />
          <input className="field field-sm" value={note} maxLength={1000} placeholder={t("calls.note")} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="call-dock__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>
            {save.isPending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </>
  );
}

export function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
