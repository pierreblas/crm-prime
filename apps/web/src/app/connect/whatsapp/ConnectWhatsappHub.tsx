"use client";

import { useEffect, useRef, useState } from "react";
import { connectWithTicket } from "./actions";

const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID ?? "";
const CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID ?? "";
// Graph API v24.0 (octubre de 2025, disponible hasta febrero de 2028).
const GRAPH_VERSION = "v24.0";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

export interface HubTexts {
  title: string;
  subtitle: string;
  loadingSdk: string;
  continueWithMeta: string;
  waiting: string;
  /** Qué hacer en el celular mientras Meta espera (coexistencia). */
  waitingHint: string;
  saving: string;
  done: string;
  notCompleted: string;
  /** Meta rechazó la app de la plataforma: todavía sin acceso avanzado. */
  notApproved: string;
  /** Meta devolvió un error concreto; {message} es su texto. */
  metaError: string;
  missingConfig: string;
  backHint: string;
}

type Estado =
  | { tipo: "cargando" }
  | { tipo: "listo" }
  | { tipo: "esperando" }
  | { tipo: "guardando" }
  | { tipo: "hecho"; url: string }
  | { tipo: "error"; mensaje: string };

/** Lo que Meta cuenta por postMessage durante el Embedded Signup. */
interface Sesion {
  event?: string;
  phoneNumberId?: string;
  wabaId?: string;
  errorMessage?: string;
  errorCode?: string;
}

/** Error de Meta cuando la app de la plataforma aún no tiene acceso avanzado. */
const SIN_ACCESO_AVANZADO = /2655111|advanced (permission|access)|permisos avanzados|acceso avanzado/i;

/**
 * El único sitio donde carga el SDK de Meta en una instalación SaaS.
 *
 * Esta página vive en el dominio raíz, que es el que está listado en la app
 * de Meta. El pase que llega en la URL dice quién es y de qué empresa; aquí no
 * hay sesión ni hace falta: al terminar, el pase y el resultado de Meta viajan
 * a la API, que abre el contexto de esa empresa y guarda el número.
 *
 * Lo normal es verla **dentro de un modal del panel de la empresa** (`embed`):
 * un iframe servido desde el dominio raíz. Meta mira el dominio del marco que
 * llama a `FB.login`, no el de la página de fuera, así que el usuario no sale
 * de `acme.driony.com` y aun así el SDK arranca en `driony.com`.
 *
 * Embedded Signup **v4**: los productos (WhatsApp, coexistencia…) se eligen en
 * la configuración de Facebook Login for Business, no aquí. `extras` va casi
 * vacío; `featureType` sigue siendo el selector que abre la rama de
 * coexistencia. La v2 (`sessionInfoVersion`) se retira el 15 de octubre de 2026.
 */
export function ConnectWhatsappHub({
  ticket,
  embed = false,
  coexistence = true,
  t,
}: {
  ticket: string;
  /** Va dentro de un iframe del panel: sin marco propio y sin salir de aquí al acabar. */
  embed?: boolean;
  /** Plan con coexistencia: se abre el flujo que deja el número también en el celular. */
  coexistence?: boolean;
  t: HubTexts;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const sesionRef = useRef<Sesion>({});

  // Cargar el SDK.
  useEffect(() => {
    if (!APP_ID || !CONFIG_ID) return;
    window.fbAsyncInit = () => {
      window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: true, version: GRAPH_VERSION });
      setEstado({ tipo: "listo" });
    };
    if (document.getElementById("fb-sdk")) {
      if (window.FB) setEstado({ tipo: "listo" });
      return;
    }
    const s = document.createElement("script");
    s.id = "fb-sdk";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/es_LA/sdk.js";
    // Un bloqueador de contenido o una CSP pueden impedir la carga: que se vea.
    s.onerror = () =>
      setEstado({ tipo: "error", mensaje: "No se pudo cargar el SDK de Meta (¿bloqueador de contenido?)." });
    document.body.appendChild(s);
    const aviso = setTimeout(() => {
      setEstado((e) =>
        e.tipo === "cargando"
          ? { tipo: "error", mensaje: "El SDK de Meta tarda demasiado en cargar. Desactiva el bloqueador de contenido y recarga." }
          : e,
      );
    }, 12_000);
    return () => clearTimeout(aviso);
  }, []);

  // Meta cuenta por postMessage cómo va el registro: los IDs al terminar
  // (`FINISH*`) o el motivo si lo abandona o falla (`CANCEL`). En coexistencia
  // solo llega el waba_id: el número lo resuelve después la API.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!String(event.origin).endsWith("facebook.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        const d = data.data ?? {};
        console.info("[conector] evento de Meta:", data.event, d);
        if (String(data.event ?? "").startsWith("FINISH")) {
          sesionRef.current = {
            event: data.event,
            phoneNumberId: d.phone_number_id,
            wabaId: d.waba_id,
          };
        } else if (data.event === "CANCEL") {
          sesionRef.current = {
            event: "CANCEL",
            errorMessage: d.error_message,
            errorCode: d.error_code != null ? String(d.error_code) : undefined,
          };
        }
      } catch {
        /* mensajes ajenos */
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Al terminar se avisa a quien nos alberga, que refresca su lista sin
  // recargar: el panel que nos tiene en un iframe (cierra él el modal) o, si
  // se abrió como ventana aparte, la que nos abrió (nos cerramos). Si se llegó
  // aquí como página suelta, se vuelve al panel. Un momento para que se lea el
  // "listo".
  useEffect(() => {
    if (estado.tipo !== "hecho") return;
    const url = estado.url;
    const id = setTimeout(() => {
      // Solo al origen del panel de esa empresa, que es quien nos alberga.
      const origen = new URL(url).origin;
      if (window.parent !== window) {
        window.parent.postMessage({ type: "driony:whatsapp-connected" }, origen);
        return;
      }
      const abridor = window.opener as Window | null;
      if (abridor && !abridor.closed) {
        abridor.postMessage({ type: "driony:whatsapp-connected" }, origen);
        window.close();
        // Si el navegador no deja cerrar, se navega igual al panel.
        setTimeout(() => window.location.assign(url), 300);
        return;
      }
      window.location.assign(url);
    }, 900);
    return () => clearTimeout(id);
  }, [estado]);

  /** Qué decirle a la persona cuando Meta no devolvió un code. */
  function motivo(response: any): string {
    const s = sesionRef.current;
    if (s.event === "CANCEL" && (s.errorMessage || s.errorCode)) {
      const texto = [s.errorMessage, s.errorCode ? `#${s.errorCode}` : null].filter(Boolean).join(" ");
      if (SIN_ACCESO_AVANZADO.test(texto)) return t.notApproved;
      return t.metaError.replace("{message}", texto);
    }
    return `${t.notCompleted} (${response?.status ?? "sin respuesta"})`;
  }

  // Lo que sigue a la respuesta de Meta. Va aparte porque el SDK exige que el
  // callback de FB.login sea una función normal: comprueba su tipo y rechaza
  // un AsyncFunction con "Expression is of type asyncfunction, not function".
  async function procesar(response: any) {
    const code = response?.authResponse?.code;
    const { phoneNumberId, wabaId, event } = sesionRef.current;
    if (!code) {
      setEstado({ tipo: "error", mensaje: motivo(response) });
      return;
    }
    // Terminó el flujo pero sin elegir número (FINISH_ONLY_WABA sin WABA
    // tampoco no debería darse): no hay nada que guardar.
    if (!phoneNumberId && !wabaId) {
      setEstado({ tipo: "error", mensaje: `${t.notCompleted} (${event ?? "sin número"})` });
      return;
    }
    setEstado({ tipo: "guardando" });
    const r = await connectWithTicket({
      ticket,
      code,
      phoneNumberId,
      wabaId,
      mode: coexistence ? "coexistence" : "api",
    });
    if (r.ok) setEstado({ tipo: "hecho", url: r.returnUrl });
    else setEstado({ tipo: "error", mensaje: r.error });
  }

  function lanzar() {
    if (!window.FB) {
      setEstado({ tipo: "error", mensaje: "El SDK de Meta no está disponible. Recarga la página." });
      return;
    }
    sesionRef.current = {};
    setEstado({ tipo: "esperando" });
    // Si en unos segundos no hay ventana ni respuesta, casi siempre es el
    // bloqueador de ventanas emergentes del navegador.
    const vigilante = setTimeout(() => {
      setEstado((e) =>
        e.tipo === "esperando"
          ? { tipo: "error", mensaje: "No se abrió la ventana de Meta. Permite las ventanas emergentes para driony.com y vuelve a intentarlo." }
          : e,
      );
    }, 8_000);
    try {
      window.FB.login(
        // Función normal a propósito: ver `procesar`.
        (response: any) => {
          clearTimeout(vigilante);
          console.info("[conector] respuesta de Meta:", response);
          void procesar(response);
        },
        {
          config_id: CONFIG_ID,
          response_type: "code",
          override_default_response_type: true,
          // Embedded Signup v4: `setup` vacío = Meta pregunta todo al cliente.
          extras: {
            setup: {},
            // Con coexistencia, la rama de Meta que deja el número también en
            // la app del celular; sin ella, el registro normal (modo API).
            ...(coexistence ? { featureType: "whatsapp_business_app_onboarding" } : {}),
          },
        },
      );
    } catch (e) {
      clearTimeout(vigilante);
      console.error("[conector] FB.login lanzó:", e);
      setEstado({ tipo: "error", mensaje: `Meta devolvió un error al abrir la ventana: ${(e as Error).message}` });
    }
  }

  if (!APP_ID || !CONFIG_ID) {
    return (
      <div style={caja}>
        <h1 style={titulo}>{t.title}</h1>
        <p style={texto}>{t.missingConfig}</p>
      </div>
    );
  }

  const ocupado = estado.tipo === "esperando" || estado.tipo === "guardando" || estado.tipo === "hecho";

  return (
    <div style={embed ? cajaEmbebida : caja}>
      <h1 style={titulo}>{t.title}</h1>
      <p style={texto}>{t.subtitle}</p>

      {estado.tipo === "error" && (
        <p role="alert" style={{ ...texto, color: "#e08a8a" }}>{estado.mensaje}</p>
      )}

      <button
        onClick={lanzar}
        disabled={estado.tipo === "cargando" || ocupado}
        style={{ ...boton, opacity: estado.tipo === "cargando" || ocupado ? 0.6 : 1 }}
      >
        {estado.tipo === "cargando"
          ? t.loadingSdk
          : estado.tipo === "esperando"
            ? t.waiting
            : estado.tipo === "guardando"
              ? t.saving
              : estado.tipo === "hecho"
                ? t.done
                : t.continueWithMeta}
      </button>

      {estado.tipo === "esperando" && coexistence && (
        <p style={{ ...texto, fontSize: 13, marginTop: 14 }} data-waiting-hint>{t.waitingHint}</p>
      )}
      {!embed && <p style={{ ...texto, fontSize: 12, marginTop: 18 }}>{t.backHint}</p>}
    </div>
  );
}

const caja: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  padding: 28,
  borderRadius: 12,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  boxShadow: "var(--shadow-card)",
};
// Dentro del modal el marco lo pone el panel.
const cajaEmbebida: React.CSSProperties = { width: "100%", padding: "4px 2px" };
const titulo: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" };
const texto: React.CSSProperties = { color: "var(--muted)", fontSize: 14, lineHeight: 1.5, margin: "8px 0 0" };
const boton: React.CSSProperties = {
  width: "100%",
  marginTop: 22,
  padding: "12px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  font: "inherit",
  cursor: "pointer",
};
