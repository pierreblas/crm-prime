"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TikTokAccountDto } from "@crm/shared";
import { deleteTikTokAccount, fetchSources, fetchTikTokAccounts, startTikTokConnect, updateTikTokAccount } from "@/lib/bff";
import { useChannelRouting } from "@/features/whatsapp/ChannelConfigDialog";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";

/**
 * Ajustes › Canales › TikTok. Cada cuenta de empresa de TikTok se conecta con
 * su propio login (TikTok nos devuelve al API con un pase de un solo uso) y
 * sus mensajes directos entran en la bandeja. Por cuenta: encendida o no, y
 * quién la atiende.
 */
export function TikTokSettings() {
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const { data, isPending } = useQuery({ queryKey: ["tiktok-accounts"], queryFn: fetchTikTokAccounts });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tiktok-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["sources"] });
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  // La vuelta desde TikTok: ?connected=1 o ?error=… (el API redirige aquí).
  useEffect(() => {
    if (params.get("channel") !== "tiktok") return;
    const error = params.get("error");
    const connected = params.get("connected");
    if (error) toast.error(error);
    else if (connected) toast.success("Cuenta de TikTok conectada.");
    if (error || connected) window.history.replaceState(null, "", `${window.location.pathname}?tab=channels&channel=tiktok`);
  }, [params]);

  const start = useMutation({
    mutationFn: startTikTokConnect,
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error((e as Error).message),
  });

  const accounts = data?.accounts ?? [];

  return (
    <div className="ch-panel">
      <div className="ch-panel__head">
        <div>
          <h4>TikTok</h4>
          <p>Los mensajes directos de tu cuenta de empresa de TikTok entran en la bandeja, con el agente de IA, los flujos y el embudo de siempre.</p>
        </div>
        {data?.configured && (
          <button type="button" className="btn btn-primary btn-sm ch-add" onClick={() => start.mutate()} disabled={start.isPending} data-tiktok-connect>
            {start.isPending ? "Abriendo TikTok…" : accounts.length ? "Añadir cuenta" : "Conectar con TikTok"}
          </button>
        )}
      </div>

      {data && !data.configured && (
        <div style={card}>
          <strong>Falta configurar la app de TikTok</strong>
          <p style={{ ...muted, margin: "4px 0 0" }}>
            Define <code>TIKTOK_APP_ID</code> y <code>TIKTOK_APP_SECRET</code> en el servidor del API. La app de TikTok for Business tiene que tener
            aprobado el producto «Business Messaging API» (revisión de seguridad de datos de TikTok).
          </p>
        </div>
      )}

      {isPending && <p style={muted}>Cargando…</p>}
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} onChanged={refresh} onReconnect={() => start.mutate()} busy={start.isPending} />
      ))}
      {!isPending && data?.configured && accounts.length === 0 && (
        <div style={empty}>
          <div style={{ color: "var(--muted)", opacity: 0.6 }}>
            <NavIcon name="message" size={26} />
          </div>
          <p style={{ ...muted, margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>Aún no hay cuentas conectadas.</strong>
            <br />
            Pulsa «Conectar con TikTok» y entra con la cuenta de empresa cuyos mensajes quieres atender desde aquí.
          </p>
        </div>
      )}

      <details className="ch-details">
        <summary>
          Cómo funciona <small>· requisitos de la cuenta, ventana de 48 h y lo que TikTok permite</small>
        </summary>
        <div className="ch-details__body">
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>
              La cuenta tiene que ser de <strong>empresa</strong> (no personal) y tener <strong>acceso avanzado</strong>: vinculada a TikTok for
              Business o a un Business Center, o verificada como empresa. Y aceptar mensajes de todos (Privacidad › Mensajes directos), o cada
              chat habrá que aceptarlo a mano en la app.
            </li>
            <li>
              Disponible para cuentas registradas en Latinoamérica, Asia-Pacífico, Oriente Medio y Norteamérica. No para las de la Unión Europea,
              Suiza ni el Reino Unido; las de Estados Unidos exigen una revisión adicional de TikTok a Driony.
            </li>
            <li>
              <strong>El cliente escribe primero</strong> y puedes responder hasta <strong>48 horas</strong> después de su último mensaje, con un
              tope de 10 mensajes por cada vez que te escribe. No hay plantillas, difusiones ni respuestas fuera de plazo.
            </li>
            <li>
              Solo <strong>texto e imágenes</strong> (JPG o PNG de hasta 3 MB). Los botones de los flujos van como opciones numeradas en el texto, y
              los enlaces no se pueden pulsar en TikTok: el agente lo sabe y escribe los datos en el mensaje.
            </li>
            <li>
              El permiso dura 30 días sin que la cuenta vuelva a entrar en Driony; si caduca, la fila lo indica y basta con «Volver a autorizar».
            </li>
            {data?.callbackUrl && (
              <li>
                Para quien administra la app de TikTok: la URL de retorno registrada debe ser <code style={code}>{data.callbackUrl}</code>; el webhook{" "}
                {data.webhookUrl ? (
                  <>
                    (<code style={code}>{data.webhookUrl}</code>) lo registra el propio API.
                  </>
                ) : (
                  "se registra solo cuando la API tiene URL pública."
                )}
              </li>
            )}
          </ul>
        </div>
      </details>
    </div>
  );
}

/** Una cuenta: estado, interruptor y quién la atiende. */
function AccountRow({
  account,
  onChanged,
  onReconnect,
  busy,
}: {
  account: TikTokAccountDto;
  onChanged: () => void;
  onReconnect: () => void;
  busy: boolean;
}) {
  const routing = useChannelRouting();
  const { data: sources = [] } = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const bots = routing.bots.filter((b) => b.isActive || b.id === account.bot?.id);
  const defaultBot = routing.bots.find((b) => b.isDefault);
  const defaultPipeline = routing.pipelines.find((p) => p.isDefault);
  const autoSource = sources.find((s) => s.kind === "tiktok");

  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateTikTokAccount>[1]) => updateTikTokAccount(account.id, input),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => deleteTikTokAccount(account.id),
    onSuccess: () => {
      toast.success("Cuenta de TikTok desconectada");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const name = account.username ? `@${account.username}` : (account.displayName ?? account.businessId);
  const status =
    account.status === "reauth_required"
      ? { tone: "warn", text: "Hay que volver a autorizar" }
      : account.status === "error"
        ? { tone: "warn", text: account.statusReason ?? "Con error" }
        : !account.isActive
          ? { tone: "muted", text: "Apagada" }
          : { tone: "ok", text: "Recibiendo mensajes" };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }} data-tiktok-account={name}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {account.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.avatarUrl} alt="" width={36} height={36} style={{ borderRadius: "50%", flexShrink: 0 }} />
        ) : (
          <span style={avatar} aria-hidden>
            {name.replace(/^@/, "").slice(0, 2).toUpperCase()}
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong>{name}</strong>
          {account.displayName && account.username && <span style={{ ...muted, marginLeft: 8 }}>{account.displayName}</span>}
          <div className={`ch-status is-${status.tone}`}>{status.text}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {account.status === "reauth_required" && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onReconnect} disabled={busy}>
              Volver a autorizar
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={remove.isPending}
            onClick={() =>
              void confirmDialog({ message: `¿Desconectar la cuenta ${name}? Las conversaciones ya recibidas se conservan.`, danger: true }).then(
                (ok) => ok && remove.mutate(),
              )
            }
          >
            Eliminar
          </button>
        </div>
      </div>
      {account.status === "reauth_required" && account.statusReason && <p style={{ ...muted, color: "var(--warning)", margin: 0 }}>{account.statusReason}</p>}
      <label className="agenda-check">
        <input type="checkbox" checked={account.isActive} disabled={save.isPending} onChange={(e) => save.mutate({ isActive: e.target.checked })} />
        <span>{save.isPending ? "Guardando…" : "Recibir en la bandeja los mensajes directos de esta cuenta"}</span>
      </label>
      {account.isActive && (
        <div style={formRow}>
          <label style={field}>
            <span style={label}>Agente de IA</span>
            <select className="field field-sm" value={account.bot?.id ?? ""} disabled={save.isPending} onChange={(e) => save.mutate({ botId: e.target.value || null })}>
              <option value="">{defaultBot ? `${defaultBot.name} (predeterminado)` : "El predeterminado de la empresa"}</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label style={field}>
            <span style={label}>Fuente de sus contactos</span>
            <select className="field field-sm" value={account.sourceId ?? ""} disabled={save.isPending} onChange={(e) => save.mutate({ sourceId: e.target.value || null })}>
              <option value="">{autoSource ? `La automática (${autoSource.name})` : "La automática «TikTok»"}</option>
              {sources
                .filter((s) => !s.kind)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label style={field}>
            <span style={label}>Embudo de entrada</span>
            <select className="field field-sm" value={account.pipelineId ?? ""} disabled={save.isPending} onChange={(e) => save.mutate({ pipelineId: e.target.value || null })}>
              <option value="">{defaultPipeline ? `${defaultPipeline.name} (predeterminado)` : "El predeterminado"}</option>
              {routing.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14 };
const card: React.CSSProperties = { padding: 14, border: "1px solid var(--border)", background: "var(--panel)" };
const empty: React.CSSProperties = { ...card, display: "flex", gap: 14, alignItems: "center" };
const avatar: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "var(--surface-2)",
  color: "var(--muted)",
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
};
const formRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: React.CSSProperties = { fontSize: 12.5, color: "var(--muted)", fontWeight: 600 };
const code: React.CSSProperties = { fontSize: 12, wordBreak: "break-all" };
