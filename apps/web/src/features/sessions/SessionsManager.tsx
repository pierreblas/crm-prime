"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionDto } from "@crm/shared";
import { fetchSessions, revokeOtherSessions, revokeSession } from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";

const PLATFORM_LABEL: Record<string, string> = {
  WEB: "Navegador web",
  IOS: "iPhone / iPad",
  ANDROID: "Android",
};

export function SessionsManager() {
  const queryClient = useQueryClient();
  const { data: sessions, isPending, isError, error } = useQuery({
    queryKey: ["sessions-list"],
    queryFn: fetchSessions,
  });

  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["sessions-list"] }),
  });

  const revokeOthers = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => {
      toast.success("Se cerraron las demás sesiones");
      queryClient.invalidateQueries({ queryKey: ["sessions-list"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const otherCount = (sessions ?? []).filter((s) => !s.current).length;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Dispositivos y navegadores donde tu cuenta está abierta. Si no
          reconoces uno, ciérralo: su sesión se revoca al instante.
        </p>
        {otherCount > 0 && (
          <button
            onClick={() => {
              void confirmDialog({
                message: `¿Cerrar las otras ${otherCount} sesion${otherCount > 1 ? "es" : ""}? Tendrás que volver a iniciar sesión en esos dispositivos.`,
                danger: true,
              }).then((ok) => ok && revokeOthers.mutate());
            }}
            disabled={revokeOthers.isPending}
            style={revokeAllBtn}
          >
            {revokeOthers.isPending ? "Cerrando…" : "Cerrar las demás"}
          </button>
        )}
      </div>

      {isPending && <p style={{ color: "var(--muted)" }}>Cargando…</p>}
      {isError && <p style={{ color: "var(--danger)" }}>{(error as Error).message}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(sessions ?? []).map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            revoking={revoke.isPending && revoke.variables === s.id}
            onRevoke={() => revoke.mutate(s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionRow({
  session: s,
  revoking,
  onRevoke,
}: {
  session: SessionDto;
  revoking: boolean;
  onRevoke: () => void;
}) {
  return (
    <div style={row}>
      <span style={dot(s.current ? "var(--accent)" : "var(--muted)")} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>{s.deviceName || PLATFORM_LABEL[s.platform] || s.platform}</strong>
          {s.current && <span style={badge}>Este dispositivo</span>}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
          {PLATFORM_LABEL[s.platform] ?? s.platform}
          {s.ipAddress ? ` · ${s.ipAddress}` : ""}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
          Última actividad: {new Date(s.lastUsedAt).toLocaleString("es")}
        </div>
      </div>
      {!s.current && (
        <button onClick={onRevoke} disabled={revoking} style={ghostBtn}>
          {revoking ? "Cerrando…" : "Cerrar sesión"}
        </button>
      )}
    </div>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 16px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--panel)",
  boxShadow: "var(--shadow-card)",
};

const badge: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "#0a6b42",
  color: "#ffffff",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--danger-border)",
  background: "transparent",
  color: "var(--danger)",
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const revokeAllBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--danger-border)",
  background: "transparent",
  color: "var(--danger)",
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

function dot(color: string): React.CSSProperties {
  return { width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 };
}
