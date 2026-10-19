"use client";

import { useEffect, useState } from "react";

const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID ?? "";
const GRAPH_VERSION = "v24.0";
// Lo que Meta exige para leer formularios: ver las páginas, administrar sus
// webhooks y descargar los leads. Igual que en Ajustes › Canales.
const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "leads_retrieval", "ads_management"].join(",");

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

type Estado = { tipo: "cargando" } | { tipo: "listo" } | { tipo: "esperando" } | { tipo: "hecho" } | { tipo: "error"; mensaje: string };

/** Carga el SDK, hace el login con el clic de la persona y devuelve el código al panel que abrió la ventana. */
export function MetaLoginHub({ origin }: { origin: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

  useEffect(() => {
    if (!APP_ID) {
      setEstado({ tipo: "error", mensaje: "Falta el id de la app de Meta en el servidor (NEXT_PUBLIC_WHATSAPP_APP_ID)." });
      return;
    }
    if (window.FB) {
      setEstado({ tipo: "listo" });
      return;
    }
    window.fbAsyncInit = () => {
      window.FB.init({ appId: APP_ID, xfbml: false, version: GRAPH_VERSION });
      setEstado({ tipo: "listo" });
    };
    if (!document.getElementById("fb-sdk")) {
      const s = document.createElement("script");
      s.id = "fb-sdk";
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.src = "https://connect.facebook.net/es_LA/sdk.js";
      s.onerror = () => setEstado({ tipo: "error", mensaje: "No se pudo cargar el SDK de Meta (¿bloqueador de contenido?)." });
      document.body.appendChild(s);
    }
  }, []);

  function entrar() {
    if (!window.FB) return;
    setEstado({ tipo: "esperando" });
    // Respuesta por defecto del SDK: un token de usuario corto que la API
    // comprueba contra la app y alarga. (El flujo por código exige un
    // redirect_uri que no controlamos y Meta lo rechazaba.)
    window.FB.login(
      (response: any) => {
        const accessToken = response?.authResponse?.accessToken;
        if (!accessToken) {
          setEstado({ tipo: "error", mensaje: "No se completó el inicio de sesión con Facebook. Vuelve a intentarlo." });
          return;
        }
        // Solo al panel que nos abrió, y solo si es el subdominio que validó el servidor.
        window.opener?.postMessage({ type: "driony:meta-token", accessToken }, origin);
        setEstado({ tipo: "hecho" });
        setTimeout(() => window.close(), 600);
      },
      { scope: SCOPES },
    );
  }

  const ocupado = estado.tipo === "esperando" || estado.tipo === "hecho";
  return (
    <div style={caja}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Conectar con Facebook</h1>
      <p style={texto}>Entra con la cuenta que administra tus páginas. Al terminar, esta ventana se cierra y vuelves al panel.</p>
      {estado.tipo === "error" && (
        <p role="alert" style={{ ...texto, color: "#e08a8a" }}>
          {estado.mensaje}
        </p>
      )}
      <button
        onClick={entrar}
        disabled={estado.tipo === "cargando" || estado.tipo === "error" || ocupado}
        style={{ ...boton, opacity: estado.tipo === "cargando" || ocupado ? 0.6 : 1 }}
      >
        {estado.tipo === "cargando"
          ? "Cargando Meta…"
          : estado.tipo === "esperando"
            ? "Esperando a Facebook…"
            : estado.tipo === "hecho"
              ? "Listo, volviendo al panel…"
              : "Continuar con Facebook"}
      </button>
    </div>
  );
}

const caja: React.CSSProperties = {
  padding: 22,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};
const texto: React.CSSProperties = { margin: 0, color: "var(--muted)", lineHeight: 1.5, fontSize: 14 };
const boton: React.CSSProperties = {
  padding: "11px 16px",
  borderRadius: 9,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
