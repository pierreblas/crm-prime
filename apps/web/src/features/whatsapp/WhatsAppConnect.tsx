"use client";

import { NavIcon } from "@/components/NavIcons";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WhatsappChannel } from "@crm/shared";
import { ChannelConfigDialog, useChannelRouting } from "./ChannelConfigDialog";
import {
  connectWhatsapp,
  disconnectWhatsapp,
  fetchWhatsappChannels,
  fetchWhatsappConnectStatus,
  fetchIntegrationSettings,
  requestWhatsappConnectTicket,
  testWhatsappChannel,
} from "@/lib/bff";
import { PlanGate, useMyPlan } from "@/features/plans/usePlan";

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

/**
 * `hub`: instalación SaaS. El SDK de Meta NO carga aquí (Meta solo lo permite
 * en dominios listados a mano, y este es el subdominio de una empresa): el
 * botón pide un pase y enseña el conector del dominio raíz en un modal, dentro
 * de un iframe. Meta mira el dominio del marco que llama a `FB.login`, no el
 * de la página de fuera: el usuario no sale de su subdominio y aun así el SDK
 * arranca en el dominio listado.
 */
export function WhatsAppConnect({ hub = false, embedded = false }: { hub?: boolean; embedded?: boolean }) {
  // Configuración avanzada (alta manual, webhook): se abre sola al renovar un token.
  const [techOpen, setTechOpen] = useState(false);
  const queryClient = useQueryClient();
  const [sdkReady, setSdkReady] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [hubPending, setHubPending] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  // URL del conector en el modal (iframe) y su origen: solo se aceptan sus avisos.
  const [hubUrl, setHubUrl] = useState<string | null>(null);
  const hubOriginRef = useRef<string | null>(null);
  const hubWindowRef = useRef<Window | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  // Canal cuyo token se va a renovar: precarga el formulario manual.
  const [editing, setEditing] = useState<WhatsappChannel | null>(null);
  // Número cuya configuración (alias, embudo, agente) se está editando.
  const [configuring, setConfiguring] = useState<WhatsappChannel | null>(null);
  const routing = useChannelRouting();
  const manualRef = useRef<HTMLDivElement | null>(null);
  const signupRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});

  const { data: channels, isPending } = useQuery({
    queryKey: ["wa-channels"],
    queryFn: fetchWhatsappChannels,
  });
  // SaaS: ¿Meta ya aprobó a la plataforma? Hasta entonces, a la empresa se le
  // explica en vez de abrirle una ventana de Meta que acaba en error.
  const { data: hubStatus } = useQuery({
    queryKey: ["wa-connect-status"],
    queryFn: fetchWhatsappConnectStatus,
    enabled: hub,
    staleTime: 60_000,
  });
  const pendingApproval = hub && hubStatus?.approval === "pending";

  const connect = useMutation({
    mutationFn: connectWhatsapp,
    onSuccess: () => {
      toast.success("Número conectado");
      queryClient.invalidateQueries({ queryKey: ["wa-channels"] });
    },
  });
  const disconnect = useMutation({
    mutationFn: disconnectWhatsapp,
    onSuccess: () => {
      toast.success("Número desconectado");
      queryClient.invalidateQueries({ queryKey: ["wa-channels"] });
    },
  });

  // Vuelta del conector: `?connected=1`. Se limpia de la URL para que un
  // refresco no repita el aviso.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setJustConnected(true);
      queryClient.invalidateQueries({ queryKey: ["wa-channels"] });
      params.delete("connected");
      const limpia = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
      window.history.replaceState(null, "", limpia);
    }
  }, [queryClient]);

  // Aviso del conector (ventana en el dominio raíz) al terminar: refrescar sin recargar.
  useEffect(() => {
    if (!hub) return;
    function onMessage(e: MessageEvent) {
      if (!hubOriginRef.current || e.origin !== hubOriginRef.current) return;
      if (e.data?.type !== "driony:whatsapp-connected") return;
      setHubUrl(null);
      setHubPending(false);
      setJustConnected(true);
      queryClient.invalidateQueries({ queryKey: ["wa-channels"] });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [hub, queryClient]);

  // Si el usuario cierra la ventana del conector sin terminar, el botón vuelve a estar disponible.
  useEffect(() => {
    if (!hubPending) return;
    const id = setInterval(() => {
      const w = hubWindowRef.current;
      if (w && w.closed) {
        hubWindowRef.current = null;
        setHubPending(false);
        queryClient.invalidateQueries({ queryKey: ["wa-channels"] });
      }
    }, 800);
    return () => clearInterval(id);
  }, [hubPending, queryClient]);

  // Cerrar el modal a medias (Esc, la X o fuera): el botón vuelve a estar
  // disponible y se refresca la lista por si en realidad sí acabó.
  function cerrarConector() {
    setHubUrl(null);
    setHubPending(false);
    queryClient.invalidateQueries({ queryKey: ["wa-channels"] });
  }
  useEffect(() => {
    if (!hubUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setHubUrl(null);
      setHubPending(false);
      queryClient.invalidateQueries({ queryKey: ["wa-channels"] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hubUrl, queryClient]);

  // Cargar el SDK de Facebook (Embedded Signup). En SaaS no: ver `hub`.
  // (En un subdominio de empresa Meta lo rechazaría: «dominio de host desconocido».)
  useEffect(() => {
    if (!APP_ID || hub) return;
    window.fbAsyncInit = () => {
      window.FB.init({
        appId: APP_ID,
        autoLogAppEvents: true,
        xfbml: true,
        version: GRAPH_VERSION,
      });
      setSdkReady(true);
    };
    if (document.getElementById("fb-sdk")) {
      if (window.FB) setSdkReady(true);
      return;
    }
    const s = document.createElement("script");
    s.id = "fb-sdk";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/es_LA/sdk.js";
    document.body.appendChild(s);
  }, []);

  // El Embedded Signup envía por postMessage el waba_id / phone_number_id al
  // terminar (en coexistencia solo el waba_id: el número lo resuelve la API).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!String(event.origin).endsWith("facebook.com")) return;
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && String(data.event ?? "").startsWith("FINISH")) {
          signupRef.current = {
            phoneNumberId: data.data?.phone_number_id,
            wabaId: data.data?.waba_id,
          };
        }
      } catch {
        /* ignorar mensajes ajenos */
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function launch() {
    if (hub) {
      // Al conector en el dominio raíz, con un pase de un solo uso, dentro de
      // un modal: el panel se queda aquí y se refresca al terminar. La ventana
      // de Meta la abre el propio conector con el clic del usuario dentro del
      // iframe, así que aquí no hay que pelearse con el bloqueador de
      // emergentes.
      // En una ventana propia del dominio raíz, no en un iframe: incrustado, el
      // SDK de Meta toma como dominio de host la página que lo contiene
      // (empresa.driony.com) y falla con «dominio de host desconocido». La
      // ventana se abre YA, en el clic, para que el bloqueador no la frene, y
      // se le da la dirección cuando llega el pase.
      setHubError(null);
      setHubPending(true);
      const w = window.open("about:blank", "driony-connect-whatsapp", "width=760,height=820");
      hubWindowRef.current = w;
      try {
        const t = await requestWhatsappConnectTicket();
        if (!t.connectUrl) throw new Error("El conector no está disponible");
        const url = new URL(t.connectUrl);
        hubOriginRef.current = url.origin;
        if (w && !w.closed) {
          w.location.href = url.toString();
          w.focus();
        } else {
          // Emergentes bloqueados: se abre en esta misma pestaña y el conector vuelve al panel al terminar.
          window.location.assign(url.toString());
        }
      } catch (e) {
        w?.close();
        hubWindowRef.current = null;
        setHubError((e as Error).message);
        setHubPending(false);
      }
      return;
    }
    if (!window.FB || !CONFIG_ID) return;
    signupRef.current = {};
    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        const { phoneNumberId, wabaId } = signupRef.current;
        if (code && (phoneNumberId || wabaId)) {
          // Se pide coexistencia; si Meta no la dejó, la API lo guarda como API.
          connect.mutate({ code, phoneNumberId, wabaId, mode: "coexistence" });
        }
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        // Embedded Signup v4: los productos van en la configuración de
        // Facebook Login for Business; `featureType` abre la rama de coexistencia.
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
        },
      },
    );
  }

  const missingConfig = !APP_ID || !CONFIG_ID;
  const list = channels ?? [];
  const connectError = connect.isError ? (connect.error as Error).message : hubError;
  // En SaaS el botón no depende del SDK: no hay SDK en esta página.
  const ready = hub || sdkReady;
  const connecting = connect.isPending || hubPending;
  // Alta con la app propia de la empresa: abre el formulario y lo deja a la vista.
  const abrirManual = () => {
    setEditing(null);
    setTechOpen(true);
    setManualOpen(true);
    requestAnimationFrame(() => manualRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="ch-panel" style={embedded ? undefined : { maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <div className="ch-panel__head">
        <div>
          <h4>Números de WhatsApp</h4>
          <p>Conecta uno o varios. Cada conversación se responde por el número por el que entró.</p>
        </div>
        {!missingConfig && list.length > 0 && !pendingApproval && (
          <button onClick={launch} disabled={!ready || connecting} className="btn btn-primary btn-sm ch-add" data-tour="wa-connect">
            <WaIcon />
            {connecting ? "Conectando…" : "Añadir número"}
          </button>
        )}
      </div>

      <details className="ch-details" data-wa-modes>
        <summary>
          ¿Modo API o Coexistencia? <small>· en qué se diferencian</small>
        </summary>
        <div className="ch-details__body">
          <div className="ch-modes">
            <div className="ch-mode">
              <strong>Coexistencia</strong>
              Sigues usando el número también en la app de WhatsApp Business del celular, y los mensajes se ven en los dos lados. Solo la activa Meta con el botón «Conectar WhatsApp».
            </div>
            <div className="ch-mode">
              <strong>API</strong>
              El número se atiende solo desde Driony. Es el modo de los números añadidos a mano con un token de Meta.
            </div>
          </div>
        </div>
      </details>

      {/* Plan Gratis: el botón conecta en modo API; la coexistencia es de Pro. */}
      <PlanGate feature="coexistence">
        Con tu plan, «Conectar WhatsApp» deja el número en modo API: se atiende solo desde
        Driony. Con la coexistencia sigues usando el número también en el celular.
      </PlanGate>

      {pendingApproval && (
        <PendingApproval compact={list.length > 0} connecting={connecting} onManual={abrirManual} onTryAnyway={launch} />
      )}

      {connectError && (
        <p style={{ color: "#ff6b6b", fontSize: 13 }}>{connectError}</p>
      )}
      {justConnected && (
        <p style={{ color: "#7ee2a8", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <NavIcon name="check" size={14} />
          Número conectado. Ya puedes recibir y enviar mensajes desde el CRM.
        </p>
      )}

      {isPending ? (
        <div className="skeleton" style={{ height: 76, borderRadius: 12 }} />
      ) : missingConfig || list.length === 0 ? (
        <div style={card}>
          {missingConfig ? (
            <PendingConfig hasAppId={!!APP_ID} />
          ) : pendingApproval ? (
            <EmptyPending onManual={abrirManual} />
          ) : (
            <Empty ready={ready} connecting={connecting} onConnect={launch} />
          )}
        </div>
      ) : (
          <div className="ch-list" data-wa-list>
            {list.map((ch) => (
              <ChannelRow
                routing={routing.describe(ch)}
                onConfigure={() => setConfiguring(ch)}
                key={ch.id}
                channel={ch}
                onUpdateToken={() => {
                  setEditing(ch);
                  setTechOpen(true);
                  setManualOpen(true);
                  // Que el formulario quede a la vista al abrirlo desde arriba.
                  requestAnimationFrame(() =>
                    manualRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    }),
                  );
                }}
                onDisconnect={() => disconnect.mutate(ch.phoneNumberId)}
                disconnecting={
                  disconnect.isPending &&
                  disconnect.variables === ch.phoneNumberId
                }
              />
            ))}
          </div>
      )}

      {/* Lo técnico, junto y plegado: alta manual con token, webhook y
          sincronización. Se abre solo al renovar un token. */}
      <details
        className="ch-details"
        open={techOpen}
        onToggle={(e) => setTechOpen((e.currentTarget as HTMLDetailsElement).open)}
        data-wa-advanced
      >
        <summary data-tour="wa-manual">
          Configuración avanzada <small>· número a mano con token, webhook y sincronización</small>
        </summary>
        <div className="ch-details__body">
          {/* Alta manual: para pruebas y para entornos sin Embedded Signup
              (en localhost el popup de Facebook no es viable). */}
          <div ref={manualRef}>
            <button
              onClick={() => {
                setManualOpen((v) => !v);
                setEditing(null);
              }}
              style={linkBtn}
            >
              <span style={chevron(manualOpen)} aria-hidden>
                <NavIcon name="chevron-down" size={14} />
              </span>
              {editing
                ? `Actualizar el token de ${editing.label ?? editing.phoneNumberId}`
                : "Añadir un número a mano (token de Meta)"}
            </button>
            {manualOpen && (
              <ManualConnect
                channel={editing}
                hub={hub}
                onDone={() => {
                  setEditing(null);
                  queryClient.invalidateQueries({ queryKey: ["wa-channels"] });
                }}
              />
            )}
          </div>

          {!missingConfig && list.length > 0 && (
            <p>
              <strong>Sincronización con el celular.</strong> Lo que escribas desde la app de WhatsApp
              también aparece en el CRM, y la IA se pausa cuando respondes tú. Requiere los campos{" "}
              <code>messages</code> y <code>message_echoes</code> suscritos en el webhook.
            </p>
          )}

          <WebhookInfo hub={hub} />
        </div>
      </details>

      <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
        Al conectar aceptas nuestra{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)" }}>
          Política de Privacidad
        </a>
        .
      </p>

      {configuring && (
        <ChannelConfigDialog
          channel={list.find((c) => c.id === configuring.id) ?? configuring}
          onClose={() => setConfiguring(null)}
        />
      )}

      {hubUrl && (
        <div className="confirm-backdrop" onClick={cerrarConector}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Conectar WhatsApp"
            style={hubDialog}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={hubHead}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                <WaIcon />
                Conectar WhatsApp
              </span>
              <button onClick={cerrarConector} aria-label="Cerrar" style={hubClose}>
                <NavIcon name="x" size={16} />
              </button>
            </div>
            {/* El conector del dominio raíz: ahí sí arranca el SDK de Meta. */}
            <iframe src={hubUrl} title="Conectar WhatsApp" style={hubFrame} />
          </div>
        </div>
      )}
    </div>
  );
}

const hubDialog: React.CSSProperties = {
  width: 480,
  maxWidth: "100%",
  borderRadius: 12,
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  boxShadow: "var(--shadow-card)",
  overflow: "hidden",
};

const hubHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  background: "var(--panel)",
};

const hubClose: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  padding: 4,
  display: "inline-flex",
};

const hubFrame: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 320,
  border: 0,
};

/**
 * Alta manual de un número con credenciales de Meta.
 * Útil para probar en local: el Embedded Signup exige una app registrada con
 * dominio HTTPS, mientras que aquí basta con pegar el token y el Phone number
 * ID que Meta muestra en el panel de la app.
 */
function ManualConnect({
  channel,
  hub,
  onDone,
}: {
  /** Canal existente: solo hay que renovarle el token. */
  channel: WhatsappChannel | null;
  /** SaaS: el token viene de la app de Meta PROPIA de la empresa. */
  hub: boolean;
  onDone: () => void;
}) {
  const renewing = !!channel;
  const [phoneNumberId, setPhoneNumberId] = useState(
    channel?.phoneNumberId ?? "",
  );
  const [accessToken, setAccessToken] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState(
    channel?.displayPhoneNumber ?? "",
  );
  const [label, setLabel] = useState(channel?.label ?? "");
  const [wabaId, setWabaId] = useState(channel?.wabaId ?? "");
  const [mode, setMode] = useState<"api" | "coexistence">(
    channel?.mode === "coexistence" ? "coexistence" : "api",
  );

  const save = useMutation({
    mutationFn: () =>
      connectWhatsapp({
        phoneNumberId: phoneNumberId.trim(),
        accessToken: accessToken.trim(),
        displayPhoneNumber: displayPhoneNumber.trim() || undefined,
        label: label.trim() || undefined,
        wabaId: wabaId.trim() || undefined,
        mode,
      }),
    onSuccess: () => {
      setAccessToken("");
      onDone();
    },
  });

  const ready = !!phoneNumberId.trim() && !!accessToken.trim();

  return (
    <div style={{ ...card, marginTop: 10 }}>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        {renewing ? (
          <>
            Pega el <strong>token nuevo</strong> de Meta → tu app → WhatsApp →{" "}
            <em>API Setup</em>. El resto de datos ya están rellenos: al guardar
            se <strong>actualiza este mismo número</strong>, no se duplica.
          </>
        ) : (
          <>
            En Meta → tu app → WhatsApp → <em>API Setup</em> están el{" "}
            <strong>Phone number ID</strong> y un <strong>token temporal</strong>{" "}
            (caduca en 24 h; para algo permanente, un token de usuario de
            sistema).
            {hub && (
              <>
                {" "}
                Aquí la app es <strong>la tuya</strong>: antes guarda su App
                secret y verify token en Ajustes › Integraciones y apunta el
                webhook de tu app a la URL de más abajo; si no, enviarás pero
                no recibirás.
              </>
            )}
          </>
        )}
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={fieldLabel}>Phone number ID *</label>
          <input
            style={{ ...field, opacity: renewing ? 0.6 : 1 }}
            value={phoneNumberId}
            placeholder="106540352242922"
            readOnly={renewing}
            title={renewing ? "Identifica el canal que se actualiza" : undefined}
            onChange={(e) => setPhoneNumberId(e.target.value)}
          />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label style={fieldLabel}>Número visible</label>
          <input
            style={field}
            value={displayPhoneNumber}
            placeholder="+1 555 078 3881"
            onChange={(e) => setDisplayPhoneNumber(e.target.value)}
          />
        </div>
      </div>

      <label style={{ ...fieldLabel, marginTop: 10 }}>Access token *</label>
      <input
        autoFocus={renewing}
        style={{ ...field, fontFamily: "ui-monospace, monospace" }}
        type="password"
        autoComplete="off"
        value={accessToken}
        placeholder="EAAG…"
        onChange={(e) => setAccessToken(e.target.value)}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <div style={{ flex: "1 1 160px" }}>
          <label style={fieldLabel}>Alias</label>
          <input
            style={field}
            value={label}
            placeholder="Pruebas"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label style={fieldLabel}>WABA ID</label>
          <input
            style={field}
            value={wabaId}
            placeholder="opcional"
            onChange={(e) => setWabaId(e.target.value)}
          />
        </div>
        <div style={{ flex: "0 1 180px" }}>
          <label style={fieldLabel}>Modo</label>
          <select
            style={field}
            value={mode}
            onChange={(e) => setMode(e.target.value as "api" | "coexistence")}
          >
            <option value="api">API (solo desde el CRM)</option>
            {/* A mano no se activa: solo se conserva si el número ya la tenía. */}
            <option value="coexistence" disabled={channel?.mode !== "coexistence"}>
              Coexistencia (solo la activa Meta vía proveedor aprobado)
            </option>
          </select>
        </div>
      </div>

      {/* Con app propia no hay Embedded Signup, y sin él no hay Coexistencia:
          que se sepa antes de elegir, no después de que no llegue nada. */}
      {hub && !renewing && (
        <p style={{ ...avisoModo, display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            <NavIcon name="alert" size={14} />
          </span>
          <span>
            Un número añadido con tu propia app trabaja en <strong>modo API</strong>:
            se atiende solo desde el CRM. La <strong>Coexistencia</strong> (seguir
            usando el número en la app de WhatsApp Business del celular) no se
            puede activar por cuenta propia: Meta solo la habilita a través del
            registro integrado de un <strong>proveedor tecnológico aprobado</strong>,
            con acceso avanzado. En Driony la da el botón «Conectar WhatsApp»
            cuando Meta apruebe la plataforma. Si al pulsarlo Meta mostró el error
            #2655111, es eso: aún no está aprobado.
          </span>
        </p>
      )}

      {save.isError && (
        <p style={{ color: "#ff6b6b", fontSize: 13 }}>
          {(save.error as Error).message}
        </p>
      )}
      {save.isSuccess && (
        <p style={{ color: "#7ee2a8", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <NavIcon name="check" size={14} />
          {renewing ? "Token actualizado" : "Número conectado"}
        </p>
      )}

      <button
        onClick={() => save.mutate()}
        disabled={!ready || save.isPending}
        style={{ ...addBtn, marginTop: 12, opacity: ready ? 1 : 0.5 }}
      >
        {save.isPending
          ? "Guardando…"
          : renewing
            ? "Actualizar token"
            : "Conectar número"}
      </button>
    </div>
  );
}

/**
 * Lo que hay que pegar en Meta para recibir mensajes. En localhost la URL no
 * es accesible desde fuera, así que se avisa de que hace falta un túnel.
 */
function WebhookInfo({ hub }: { hub: boolean }) {
  // El origen se lee tras montar: en el servidor no hay window, y leerlo en
  // el render hacía que el HTML del servidor y el del cliente no coincidieran.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  // SaaS: la URL del webhook propio la da la API (lleva el slug de la empresa).
  const { data: integ } = useQuery({ queryKey: ["integration-settings"], queryFn: fetchIntegrationSettings, enabled: hub, staleTime: 60_000 });
  const ownUrl = integ?.whatsappWebhookUrl ?? null;

  // SaaS: la plataforma ya recibe los mensajes de los números conectados con
  // el botón. Esta URL, bajo el subdominio de la empresa, es solo para quien
  // añadió un número a mano con su PROPIA app de Meta.
  if (hub) {
    return (
      <div style={syncNote}>
        <strong style={{ color: "var(--text)" }}>
          URL del webhook (solo si usas tu propia app de Meta)
        </strong>
        <p style={{ margin: "6px 0 0" }}>
          Con el botón «Conectar WhatsApp» no hace falta nada de esto: la
          plataforma ya recibe tus mensajes. Si añadiste un número a mano con tu
          propia app, en tu app → WhatsApp → Configuración → Webhooks pon como{" "}
          <strong>Callback URL</strong>:
        </p>
        <code style={urlBox}>{ownUrl ?? "…"}</code>
        <p style={{ margin: "8px 0 0" }}>
          El <strong>Verify token</strong> es el que guardaste en Ajustes ›
          Integraciones (guárdalo ahí <strong>antes</strong> de pulsar «Verificar y
          guardar» en Meta). Suscribe los campos <code>messages</code> y{" "}
          <code>message_echoes</code>.
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...syncNote, borderColor: isLocal ? "#7a6f4a" : "#1f6f46" }}>
      <strong style={{ color: "var(--text)" }}>
        URL del webhook (para recibir mensajes)
      </strong>
      <p style={{ margin: "6px 0 0" }}>
        En Meta → WhatsApp → Configuración → Webhooks, pon como{" "}
        <strong>Callback URL</strong>:
      </p>
      <code style={urlBox}>
        {isLocal ? "https://TU-TUNEL.ngrok-free.app" : origin}
        /api/v1/whatsapp/webhook
      </code>
      <p style={{ margin: "8px 0 0" }}>
        El <strong>Verify token</strong> es el de Ajustes › Integraciones.
        Suscribe los campos <code>messages</code> y <code>message_echoes</code>.
      </p>
      {isLocal && (
        <p style={{ margin: "8px 0 0", color: "#e0b766" }}>
          <span style={{ marginRight: 6, verticalAlign: "-2px", display: "inline-block" }}>
            <NavIcon name="alert" size={14} />
          </span>
          Estás en localhost: Meta no puede alcanzar tu máquina. Para{" "}
          <strong>recibir</strong> mensajes necesitas exponer el puerto 3001 con
          un túnel, por ejemplo <code>ngrok http 3001</code> o{" "}
          <code>cloudflared tunnel --url http://localhost:3001</code>.{" "}
          <strong>Enviar</strong> sí funciona sin túnel.
        </p>
      )}
    </div>
  );
}

const avisoModo: React.CSSProperties = {
  marginTop: 12,
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid #7a6f4a",
  background: "rgba(224,183,102,0.08)",
  color: "#e0b766",
  fontSize: 12.5,
  lineHeight: 1.5,
};

const urlBox: React.CSSProperties = {
  display: "block",
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 7,
  background: "var(--field)",
  border: "1px solid var(--border)",
  fontSize: 12,
  wordBreak: "break-all",
};

// Flecha del desplegable: mira a la derecha cerrado y abajo abierto.
function chevron(open: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    transition: "transform 150ms",
    transform: open ? "none" : "rotate(-90deg)",
  };
}

const linkBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
  padding: 0,
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: "var(--muted)",
  marginBottom: 5,
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

const syncNote: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--muted)",
  fontSize: 13,
  lineHeight: 1.6,
};

function ChannelRow({
  channel,
  routing,
  onConfigure,
  onDisconnect,
  onUpdateToken,
  disconnecting,
}: {
  channel: WhatsappChannel;
  /** A qué embudo entra y qué agente lo atiende, en palabras. */
  routing: { pipeline: string; bot: string; flows: number };
  onConfigure: () => void;
  onDisconnect: () => void;
  onUpdateToken: () => void;
  disconnecting: boolean;
}) {
  const online = channel.isActive && channel.status === "connected";
  const broken = channel.status === "error";
  const queryClient = useQueryClient();

  const test = useMutation({
    mutationFn: () => testWhatsappChannel(channel.phoneNumberId),
    // Probar puede cambiar el estado del canal (lo repara o lo marca roto).
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["wa-channels"] }),
  });

  const state = broken ? "error" : online ? "ok" : "off";
  const name = channel.label || channel.displayPhoneNumber || channel.phoneNumberId;
  const phone = channel.label ? channel.displayPhoneNumber ?? channel.phoneNumberId : null;

  return (
    <div className={`ch-row is-${state}`} data-wa-row={channel.phoneNumberId}>
      <span className="ch-row__avatar" aria-hidden="true">
        <WaIcon />
      </span>
      <div className="ch-row__main">
        <div className="ch-row__title">
          <strong>{name}</strong>
          {phone && <span className="ch-row__phone">{phone}</span>}
        </div>
        <div className="ch-row__meta">
          <span className={`ch-badge is-${state}`}>
            {broken && <NavIcon name="alert" size={11} />}
            {broken ? "Token caducado" : online ? "Conectado" : "Inactivo"}
          </span>
          <span className="ch-badge" title={channel.mode === "coexistence" ? "También se usa en la app del celular" : "Se atiende solo desde Driony"}>
            {channel.mode === "coexistence" ? "Coexistencia" : "API"}
            {channel.source === "env" ? " · .env" : ""}
          </span>
          {channel.source !== "env" && (
            <>
              <span title="Embudo al que entran las conversaciones nuevas de este número">
                <NavIcon name="pipeline" size={12} />
                {routing.pipeline}
              </span>
              <span title="Agente de IA que atiende este número">
                <NavIcon name="bot" size={12} />
                {routing.bot}
              </span>
              {routing.flows > 0 && (
                <span title="Flujos que escuchan solo este número">
                  <NavIcon name="flow" size={12} />
                  {routing.flows === 1 ? "1 flujo" : `${routing.flows} flujos`}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="ch-row__actions">
        {channel.source !== "env" && (
          <button onClick={onConfigure} className="btn btn-ghost btn-sm" title="Alias, embudo de entrada y agente de IA de este número">
            <NavIcon name="settings" size={13} />
            Configurar
          </button>
        )}
        <button onClick={() => test.mutate()} disabled={test.isPending} className="btn btn-ghost btn-sm" title="Comprobar token, plataforma, suscripción y webhook">
          {test.isPending ? "Probando…" : "Probar"}
        </button>
        {channel.source !== "env" && (
          <button onClick={onUpdateToken} className={`btn ${broken ? "btn-primary" : "btn-ghost"} btn-sm`} title="Pegar un token nuevo para este número">
            Actualizar token
          </button>
        )}
        {channel.source !== "env" && online && (
          <button onClick={onDisconnect} disabled={disconnecting} className="btn btn-ghost btn-sm ch-danger">
            {disconnecting ? "…" : "Desconectar"}
          </button>
        )}
      </div>

      {broken && (
        <div className="ch-row__note is-error" role="alert">
          <div className="ch-row__note-title">
            <NavIcon name="alert" size={13} />
            {channel.statusReason || "El token de este número ya no vale."}
          </div>
          <div style={{ marginTop: 4, opacity: 0.9 }}>
            Pulsa «Actualizar token» y pega uno nuevo. Para no repetirlo cada 24 h, usa un token de usuario de sistema, que no caduca.
          </div>
        </div>
      )}
      {test.data && (
        <div className={`ch-row__note ${test.data.ok ? "is-ok" : "is-error"}`} data-channel-checks-box>
          <div className="ch-row__note-title">
            <NavIcon name={test.data.ok ? "check" : "x"} size={13} />
            {test.data.message}
          </div>
          {test.data.checks.length > 0 && (
            <ul data-channel-checks>
              {test.data.checks.map((c) => (
                <li key={c.key} className={c.ok === false ? "is-bad" : c.ok ? "is-good" : "is-unknown"}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>
                    <NavIcon name={c.ok === false ? "x" : c.ok ? "check" : "question"} size={13} />
                  </span>
                  <span>
                    <strong style={{ fontWeight: 600, color: "inherit" }}>{c.label}</strong>
                    {c.detail && <span style={{ opacity: 0.85 }}> · {c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "8px 13px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "#f3f8ff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const routingRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "4px 14px",
  marginTop: 6,
  fontSize: 12.5,
  color: "var(--muted)",
};

const routingChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
};

const errorNote: React.CSSProperties = {
  marginTop: 6,
  padding: "7px 9px",
  borderRadius: 7,
  border: "1px solid #6b3232",
  background: "rgba(200,80,80,0.12)",
  color: "#ffb3b3",
  fontSize: 12.5,
  lineHeight: 1.45,
};

function Empty({
  ready,
  connecting,
  onConnect,
}: {
  ready: boolean;
  connecting: boolean;
  onConnect: () => void;
}) {
  // Plan sin coexistencia: el conector deja el número en modo API.
  const { data: myPlan } = useMyPlan();
  const apiOnly = !!myPlan?.saas && !myPlan.plan.features.coexistence;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={dot("#7a8aa0")} />
        <strong style={{ fontSize: 16 }}>Sin números conectados</strong>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
        {apiOnly ? (
          <>
            Pulsa el botón y se abrirá la ventana oficial de Meta. Elige tu cuenta de
            empresa y el número: quedará conectado en <strong>modo API</strong>, atendido
            desde Driony. Repite el proceso por cada número que quieras añadir.
          </>
        ) : (
          <>
            Pulsa el botón y se abrirá la ventana oficial de Meta. Elige tu cuenta y
            número; si ese número ya lo usas en la app del celular,{" "}
            <strong>escanea el QR con tu WhatsApp Business</strong> para activar la
            Coexistencia. Repite el proceso por cada número que quieras añadir.
          </>
        )}
      </p>
      <div>
        <button onClick={onConnect} disabled={!ready || connecting} style={waBtn}>
          <WaIcon />
          {connecting ? "Conectando…" : ready ? "Conectar WhatsApp" : "Cargando…"}
        </button>
      </div>
    </div>
  );
}

/**
 * SaaS, mientras Meta no apruebe a la plataforma como proveedor tecnológico:
 * el registro integrado solo funciona para cuentas con rol en la app de Meta,
 * así que a la empresa se le cuenta la situación y la alternativa, en vez de
 * abrirle una ventana de Meta que acaba en el error #2655111.
 */
function PendingApproval({
  compact,
  connecting,
  onManual,
  onTryAnyway,
}: {
  compact: boolean;
  connecting: boolean;
  onManual: () => void;
  onTryAnyway: () => void;
}) {
  return (
    <div style={pendingBox} role="status">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={dot("#e0a458")} />
        <strong style={{ color: "var(--text)", fontSize: 15 }}>
          Conexión con un clic: en revisión por Meta
        </strong>
      </div>
      <p style={{ margin: "8px 0 0" }}>
        Driony está en proceso de aprobación de Meta como <strong>proveedor tecnológico</strong>.
        Hasta que Meta lo apruebe, el botón «Conectar WhatsApp» y la Coexistencia con el celular
        no están disponibles.{" "}
        {!compact && (
          <>
            Mientras tanto puedes conectar tu número con <strong>tu propia app de Meta</strong>:
            funciona igual en modo API, atendido desde Driony.{" "}
          </>
        )}
        Te avisaremos en cuanto esté listo.
      </p>
      {!compact && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <button onClick={onManual} style={waBtn}>
            <WaIcon />
            Conectar con mi propia app de Meta
          </button>
          <a
            href="/docs/whatsapp#con-tu-propia-app-de-meta"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", fontSize: 13 }}
          >
            Cómo se hace, paso a paso
          </a>
        </div>
      )}
      <button
        type="button"
        onClick={onTryAnyway}
        disabled={connecting}
        style={tryAnywayBtn}
        title="Solo funciona con una cuenta de Facebook que tenga rol en la app de Meta de la plataforma"
      >
        {connecting ? "Conectando…" : "Soy del equipo de la plataforma: abrir el registro de Meta igualmente"}
      </button>
    </div>
  );
}

function EmptyPending({ onManual }: { onManual: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={dot("#7a8aa0")} />
        <strong style={{ fontSize: 16 }}>Sin números conectados</strong>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
        Añade tu número con tu propia app de Meta. Cuando Meta apruebe la plataforma, el botón
        «Conectar WhatsApp» aparecerá aquí.
      </p>
      <div>
        <button onClick={onManual} style={linkBtn}>
          <NavIcon name="arrow-down" size={14} />
          Ir al formulario de alta
        </button>
      </div>
    </div>
  );
}

const pendingBox: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 10,
  border: "1px solid #7a6f4a",
  background: "rgba(224,183,102,0.08)",
  color: "var(--muted)",
  fontSize: 13.5,
  lineHeight: 1.55,
};

const tryAnywayBtn: React.CSSProperties = {
  marginTop: 12,
  padding: 0,
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: 3,
};

function PendingConfig({ hasAppId }: { hasAppId: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={dot("#e0a458")} />
        <strong style={{ fontSize: 16 }}>Configuración pendiente</strong>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
        Falta un dato de Meta para habilitar el botón de conexión:
      </p>
      <ol style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7, marginTop: 0 }}>
        {!hasAppId && (
          <li>
            <code>NEXT_PUBLIC_WHATSAPP_APP_ID</code> en{" "}
            <code>apps/web/.env.local</code>.
          </li>
        )}
        <li>
          En tu App de Meta → <strong>Facebook Login for Business</strong> →
          <strong> Configurations</strong> → crea una configuración <strong>nueva</strong> de
          Embedded Signup (versión 4): marca el producto WhatsApp y, si vas a ofrecer
          Coexistencia, la opción de WhatsApp Business App. Copia su <strong>Config ID</strong>.
        </li>
        <li>
          Pégalo en <code>NEXT_PUBLIC_WHATSAPP_CONFIG_ID</code> (en{" "}
          <code>apps/web/.env.local</code>) y reinicia <code>npm run dev</code>.
        </li>
      </ol>
    </div>
  );
}

export function WaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.5-1.2-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l1.8.9c.3.1.4.2.5.3 0 .2 0 .8-.2 1.6Z" />
    </svg>
  );
}

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 22,
  boxShadow: "var(--shadow-card)",
};

const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "rgba(255,255,255,0.02)",
};

const waBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 20px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "#f3f8ff",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};

const addBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  borderRadius: 9,
  border: "none",
  background: "var(--accent)",
  color: "#f3f8ff",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "7px 13px",
  borderRadius: 8,
  border: "1px solid #5a2a2a",
  background: "transparent",
  color: "#e08a8a",
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap",
};

function dot(color: string): React.CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  };
}

function pill(bg: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 9px",
    borderRadius: 999,
    background: bg,
    color: "#e9f1ff",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  };
}
