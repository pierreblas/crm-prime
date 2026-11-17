"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ASSISTANT_AUDIO_MAX_BYTES, ASSISTANT_AUDIO_MAX_SECONDS } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { transcribeAssistantAudio } from "@/lib/bff";

/**
 * Contar el negocio con la voz en vez de escribirlo: graba aquí (hasta cinco
 * minutos) o sube una nota de voz que ya tengas, por ejemplo la de WhatsApp.
 * El audio se pasa a texto y ese texto va al cuadro de al lado, para que la
 * persona lo revise antes de enviarlo: puede que haya entendido mal un
 * nombre o un precio. El audio no se guarda.
 */

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "recording"; startedAt: number }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const BARS = 18;

/** Une lo dictado a lo que ya había en el cuadro. */
export function appendDictation(prev: string, text: string): string {
  const before = prev.trimEnd();
  return before ? `${before}\n${text}` : text;
}

function pickMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const options: [string, string][] = [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/mp4", "m4a"],
    ["audio/ogg;codecs=opus", "ogg"],
  ];
  for (const [mime, ext] of options) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return { mime: "", ext: "webm" };
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceInput({
  onText,
  label = "Contarlo en un audio",
  hint,
  disabled,
}: {
  onText: (text: string) => void;
  /** Texto del botón de grabar. */
  label?: string;
  /** Una línea bajo los botones mientras no se graba. */
  hint?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const unmounted = useRef(false);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => setCanRecord(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!pickMime()), []);

  const release = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  }, []);

  // Al cerrar la ventana a medio grabar, el micrófono se suelta.
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    };
  }, [release]);

  // El texto llega cuando termina la grabación: se entrega al cuadro tal como
  // está entonces, no como estaba al empezar a grabar.
  const deliver = useRef(onText);
  deliver.current = onText;
  const transcribe = useCallback(async (audio: Blob, fileName: string) => {
    setState({ kind: "working" });
    try {
      const text = await transcribeAssistantAudio(audio, fileName);
      if (unmounted.current) return;
      deliver.current(text);
      setState({ kind: "done" });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }, []);

  async function start() {
    const pick = pickMime();
    if (!pick) return;
    setState({ kind: "asking" });
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const denied = (e as DOMException)?.name === "NotAllowedError";
      setState({
        kind: "error",
        message: denied
          ? "El navegador no nos deja usar el micrófono. Permítelo en el candado de la barra de direcciones, o sube un audio."
          : "No encontramos un micrófono. Conecta uno o sube un audio que ya tengas.",
      });
      return;
    }
    stream.current = media;
    chunks.current = [];
    cancelled.current = false;
    const rec = new MediaRecorder(media, pick.mime ? { mimeType: pick.mime } : undefined);
    recorder.current = rec;
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunks.current.push(ev.data);
    };
    rec.onstop = () => {
      release();
      if (cancelled.current) return;
      const blob = new Blob(chunks.current, { type: rec.mimeType || pick.mime || "audio/webm" });
      if (!blob.size) {
        setState({ kind: "error", message: "La grabación salió vacía. Prueba otra vez." });
        return;
      }
      void transcribe(blob, `nota-de-voz.${pick.ext}`);
    };
    rec.start(1000);
    setElapsed(0);
    setState({ kind: "recording", startedAt: Date.now() });

    // El nivel de la voz, para ver que el micrófono oye algo.
    try {
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(media).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        raf.current = requestAnimationFrame(tick);
        if (t - last < 90) return;
        last = t;
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevels((prev) => [...prev.slice(1), Math.min(1, peak / 64)]);
      };
      raf.current = requestAnimationFrame(tick);
    } catch {
      /* sin medidor: se graba igual */
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function cancel() {
    cancelled.current = true;
    stop();
    release();
    setState({ kind: "idle" });
  }

  // Reloj de la grabación y corte al llegar al máximo.
  useEffect(() => {
    if (state.kind !== "recording") return;
    const id = window.setInterval(() => {
      const s = (Date.now() - state.startedAt) / 1000;
      setElapsed(s);
      if (s >= ASSISTANT_AUDIO_MAX_SECONDS && recorder.current?.state === "recording") recorder.current.stop();
    }, 250);
    return () => window.clearInterval(id);
  }, [state]);

  function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > ASSISTANT_AUDIO_MAX_BYTES) {
      setState({ kind: "error", message: `Ese audio pesa más de ${Math.round(ASSISTANT_AUDIO_MAX_BYTES / 1024 / 1024)} MB. Recórtalo, o grábalo aquí en partes.` });
      return;
    }
    void transcribe(file, file.name || "audio");
  }

  const busy = state.kind === "asking" || state.kind === "working";

  if (state.kind === "recording") {
    const left = ASSISTANT_AUDIO_MAX_SECONDS - elapsed;
    return (
      <div className="voice-input is-recording" role="group" aria-label="Grabando audio">
        <span className="voice-input__dot" aria-hidden="true" />
        <span className="voice-input__time" aria-live="off">
          {clock(elapsed)}
        </span>
        <span className="voice-input__meter" aria-hidden="true">
          {levels.map((l, i) => (
            <span key={i} style={{ transform: `scaleY(${0.12 + l * 0.88})` }} />
          ))}
        </span>
        {left <= 30 && <span className="voice-input__left">quedan {clock(left)}</span>}
        <span className="voice-input__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={stop}>
            <span className="voice-input__square" aria-hidden="true" /> Listo
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="voice-input">
      <div className="voice-input__row">
        {canRecord && (
          <button type="button" className="voice-input__btn" onClick={() => void start()} disabled={disabled || busy}>
            <NavIcon name="mic" size={14} /> {label}
          </button>
        )}
        <button
          type="button"
          className="voice-input__btn voice-input__btn--quiet"
          onClick={() => fileInput.current?.click()}
          disabled={disabled || busy}
          title="Una nota de voz de WhatsApp, un MP3, un M4A…"
        >
          <NavIcon name="paperclip" size={13} /> {canRecord ? "Subir audio" : "Subir un audio"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.opus,.ogg,.oga,.m4a,.mp3,.wav,.webm,.aac,.amr,video/mp4"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <p className={`voice-input__status${state.kind === "error" ? " is-error" : ""}`} role={state.kind === "error" ? "alert" : "status"}>
        {state.kind === "asking" && "Permite el micrófono para empezar…"}
        {state.kind === "working" && (
          <>
            <span className="voice-input__spin" aria-hidden="true" /> Pasando tu audio a texto…
          </>
        )}
        {state.kind === "done" && "Listo: revisa el texto por si entendimos mal algún nombre o precio."}
        {state.kind === "error" && state.message}
        {state.kind === "idle" && hint}
      </p>
    </div>
  );
}
