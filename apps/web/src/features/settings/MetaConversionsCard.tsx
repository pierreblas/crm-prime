"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConversionsOverview } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { card, ghostBtn, primaryBtn, smBtn } from "@/components/ui";
import { disableConversions, enableConversions, fetchConversions, retryConversion } from "@/lib/bff";
import { toast } from "@/lib/toast";

const EVENT_LABEL: Record<string, string> = {
  LeadSubmitted: "Potencial (LeadSubmitted)",
  Purchase: "Compra (Purchase)",
};

/**
 * Conversiones de anuncios: cuando un chat que vino de un anuncio Click to
 * WhatsApp llega a «Potencial» o «Ganada», Driony se lo cuenta a Meta para que
 * la campaña optimice hacia clientes reales. Se activa por número.
 */
export function MetaConversionsCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["conversions"], queryFn: fetchConversions });
  const set = (fresh: ConversionsOverview) => queryClient.setQueryData(["conversions"], fresh);
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => (on ? enableConversions(id) : disableConversions(id)),
    onSuccess: (fresh, v) => {
      set(fresh);
      toast.success(v.on ? "Conversiones activadas en este número" : "Conversiones desactivadas");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const retry = useMutation({
    mutationFn: retryConversion,
    onSuccess: set,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div style={card} data-conversions-card>
      <h3 style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <NavIcon name="target" size={16} /> Conversiones de anuncios (Meta)
      </h3>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
        Cuando un chat que vino de un anuncio de Click to WhatsApp avanza en el embudo, Driony envía a Meta los eventos
        de cada etapa (<code>LeadSubmitted</code> al llegar a Potencial, <code>Purchase</code> con el valor al llegar a
        Ganada, y los que tú añadas). Así tus campañas aprenden de los clientes que compran, no solo de los clics. Los
        eventos de cada etapa se eligen en <a href="/settings?tab=stages" style={{ color: "var(--accent-text)" }}>Ajustes › Embudos y etapas</a>.
      </p>

      {!data ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando…</p>
      ) : data.channels.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Conecta un número de WhatsApp para activarlas.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.channels.map((c) => (
            <div key={c.id} style={row} data-conversions-channel={c.id}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{c.label ?? c.displayPhoneNumber ?? "Número"}</strong>
                {c.label && c.displayPhoneNumber && <span style={{ color: "var(--muted)" }}> · {c.displayPhoneNumber}</span>}
                <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                  {c.enabled
                    ? `Activas · dataset ${c.datasetId}`
                    : c.wabaId
                      ? "Desactivadas"
                      : "Sin cuenta de WhatsApp Business: vuelve a conectar el número"}
                </span>
              </span>
              <button
                type="button"
                style={c.enabled ? { ...ghostBtn, ...smBtn } : { ...primaryBtn, ...smBtn }}
                disabled={toggle.isPending || !c.wabaId}
                onClick={() => toggle.mutate({ id: c.id, on: !c.enabled })}
              >
                {c.enabled ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
        </div>
      )}

      {data && data.events.length > 0 && (
        <>
          <h4 style={{ margin: "16px 0 8px", fontSize: 13 }}>Últimos eventos enviados</h4>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }} data-conversions-events>
              <thead>
                <tr>
                  {["Evento", "Oportunidad", "Valor", "Estado", "Fecha"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td style={td}>{EVENT_LABEL[e.eventName] ?? e.eventName}</td>
                    <td style={td}>
                      {e.dealTitle ?? "—"}
                      {e.contactName && <span style={{ color: "var(--muted)" }}> · {e.contactName}</span>}
                    </td>
                    <td style={td}>{e.value != null ? `${e.value.toFixed(2)} ${e.currency ?? ""}` : "—"}</td>
                    <td style={td}>
                      {e.status === "sent" ? (
                        <span style={{ color: "var(--positive)" }}>Enviado</span>
                      ) : (
                        <span style={{ color: "#e08a8a" }} title={e.error ?? undefined}>
                          Falló{" "}
                          <button
                            type="button"
                            style={{ ...ghostBtn, ...smBtn, padding: "2px 8px", marginLeft: 6 }}
                            onClick={() => retry.mutate(e.id)}
                            disabled={retry.isPending}
                          >
                            Reintentar
                          </button>
                        </span>
                      )}
                    </td>
                    <td style={td}>{new Date(e.sentAt ?? e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
};
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 500, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--border)" };
