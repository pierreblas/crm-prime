"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/useRealtime";
import { setAiTyping } from "@/features/inbox/aiTyping";
import { fetchUnreadCount } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n/I18nProvider";

const PREF_KEY = "inbox.notify";

interface RealtimeCtx {
  connected: boolean;
  /** Mensajes sin leer en toda la bandeja. */
  unread: number;
  soundEnabled: boolean;
  permission: NotificationPermission | "unsupported";
  setSound: (on: boolean) => void;
  requestPermission: () => Promise<void>;
  /** La bandeja dice qué chat tiene abierto: de ese no se avisa. */
  setOpenConversation: (id: string | null) => void;
}

const Ctx = createContext<RealtimeCtx>({
  connected: false,
  unread: 0,
  soundEnabled: true,
  permission: "default",
  setSound: () => undefined,
  requestPermission: async () => undefined,
  setOpenConversation: () => undefined,
});

export const useRealtimeCtx = (): RealtimeCtx => useContext(Ctx);

/**
 * Una sola conexión en tiempo real para toda la app (antes solo la tenía la
 * bandeja, así que fuera de ella no se enteraba nadie de nada). Refresca las
 * listas, enciende el «la IA está escribiendo» y, cuando entra un mensaje de
 * un cliente, avisa esté donde esté la persona: sonido, aviso en pantalla
 * con enlace al chat, notificación del navegador si la pestaña está en
 * segundo plano, y el total en el título y en el menú.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const t = useT();
  const pathname = usePathname();
  const openRef = useRef<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundRef = useRef(true);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    try {
      const on = localStorage.getItem(PREF_KEY) !== "0";
      setSoundEnabled(on);
      soundRef.current = on;
    } catch {
      /* sin almacenamiento: queda encendido */
    }
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    // El navegador solo deja sonar tras un gesto: el primero desbloquea el audio.
    const unlock = () => {
      primeAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const { data: unreadData } = useQuery({
    queryKey: ["unread-count"],
    queryFn: fetchUnreadCount,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const unread = unreadData?.unread ?? 0;

  const avisar = useCallback(
    (conversationId: string, inbound: { contactName: string; preview: string }) => {
      const viendo = !document.hidden && pathname === "/" && openRef.current === conversationId;
      if (viendo) return;
      const title = t("alerts.newMessage", { name: inbound.contactName });
      if (soundRef.current) beep();
      toast.info(`${title}: ${inbound.preview}`, { href: `/?c=${conversationId}`, ms: 6000 });
      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const n = new Notification(title, { body: inbound.preview, tag: `driony-${conversationId}` });
          n.onclick = () => {
            window.focus();
            window.location.assign(`/?c=${conversationId}`);
            n.close();
          };
        } catch {
          /* algunos navegadores lo bloquean fuera de un service worker */
        }
      }
    },
    [pathname, t],
  );
  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;

  const { connected } = useRealtime({
    "inbox.changed": (payload) => {
      const p = payload as { conversationId: string; inbound?: { contactName: string; preview: string } };
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["messages", p.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      if (p.inbound) avisarRef.current(p.conversationId, p.inbound);
    },
    "ai.typing": (payload) => {
      const { conversationId, on } = payload as { conversationId: string; on: boolean };
      setAiTyping(conversationId, on);
    },
    "pipeline.changed": () => queryClient.invalidateQueries({ queryKey: ["pipeline"] }),
    "call.changed": (payload) => {
      const p = payload as { conversationId: string | null; missed?: boolean };
      queryClient.invalidateQueries({ queryKey: ["calls"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (p.missed) toast.info(t("calls.missedToast"), { href: p.conversationId ? `/?c=${p.conversationId}` : undefined, ms: 8000 });
    },
  });

  // Total en el título de la pestaña: "(3) Bandeja".
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
  }, [unread, pathname]);

  const setSound = useCallback((on: boolean) => {
    try {
      localStorage.setItem(PREF_KEY, on ? "1" : "0");
    } catch {
      /* sin almacenamiento */
    }
    setSoundEnabled(on);
    soundRef.current = on;
    if (on) beep();
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      const p = await Notification.requestPermission();
      setPermission(p);
    }
  }, []);

  const setOpenConversation = useCallback((id: string | null) => {
    openRef.current = id;
  }, []);

  return (
    <Ctx.Provider value={{ connected, unread, soundEnabled, permission, setSound, requestPermission, setOpenConversation }}>
      {children}
    </Ctx.Provider>
  );
}

// ── Sonido: dos notas cortas con el AudioContext, sin archivo que cargar ──
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function primeAudio(): void {
  audio();
}

function beep(): void {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime;
  for (const [freq, at] of [
    [880, 0],
    [1175, 0.11],
  ] as const) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.12);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.13);
  }
}
