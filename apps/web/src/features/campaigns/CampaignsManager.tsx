"use client";

import { NavIcon } from "@/components/NavIcons";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import type { CampaignDto } from "@crm/shared";
import {
  cancelCampaign,
  deleteCampaign,
  fetchCampaigns,
  launchCampaign,
} from "@/lib/bff";
import { CampaignWizard } from "./CampaignWizard";
import { CampaignDetail } from "./CampaignDetail";
import { takeCampaignPreset, type CampaignPreset } from "./preset";
import { TemplatesPanel } from "./TemplatesPanel";
import { PlanGate } from "@/features/plans/usePlan";
import { box, ghostBtn, primaryBtn } from "./styles";

type Tab = "campaigns" | "templates";

export const STATUS_LABEL: Record<CampaignDto["status"], string> = {
  DRAFT: "Borrador",
  SCHEDULED: "Programada",
  RUNNING: "Enviando",
  COMPLETED: "Enviada",
  CANCELLED: "Cancelada",
};

export function CampaignsManager() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("campaigns");
  const [wizard, setWizard] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preset, setPreset] = useState<CampaignPreset | null>(null);
  // Llegada desde el embudo («Difusión» en una etapa o en la selección).
  useEffect(() => {
    const p = takeCampaignPreset();
    if (p) {
      setPreset(p);
      setTab("campaigns");
      setWizard(true);
    }
  }, []);

  const { data: campaigns, isPending } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((c) => c.status === "RUNNING") ? 3000 : false,
  });

  const launch = useMutation({
    mutationFn: launchCampaign,
    onSuccess: (c) => {
      toast.success(
        c.status === "SCHEDULED" ? "Difusión programada" : "Difusión lanzada",
      );
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
  const cancel = useMutation({
    mutationFn: cancelCampaign,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
  const remove = useMutation({
    mutationFn: deleteCampaign,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <PlanGate feature="broadcasts" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <TabBtn active={tab === "campaigns"} onClick={() => setTab("campaigns")}>
            Difusiones
          </TabBtn>
          <TabBtn active={tab === "templates"} onClick={() => setTab("templates")}>
            Plantillas
          </TabBtn>
        </div>
        {tab === "campaigns" && !wizard && (
          <button onClick={() => setWizard(true)} style={primaryBtn}>
            + Nueva difusión
          </button>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        {tab === "templates" ? (
          <TemplatesPanel />
        ) : wizard ? (
          <>
            <h2 style={{ marginTop: 0 }}>Nueva difusión</h2>
            <CampaignWizard
              preset={preset}
              onDone={() => {
                setWizard(false);
                setPreset(null);
              }}
            />
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {isPending && <p style={{ color: "var(--muted)" }}>Cargando…</p>}
            {(campaigns ?? []).map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onOpen={() => setOpenId(c.id)}
                onLaunch={() =>
                  void confirmDialog({
                    title: "Lanzar la difusión",
                    message: c.scheduledAt && new Date(c.scheduledAt).getTime() > Date.now()
                      ? `Se programará para el ${new Date(c.scheduledAt).toLocaleString("es")}.`
                      : "Se empezará a enviar ahora a toda la audiencia. No se puede deshacer, solo cancelar lo que falte.",
                    confirmLabel: "Lanzar",
                  }).then((ok) => ok && launch.mutate(c.id))
                }
                onCancel={() => cancel.mutate(c.id)}
                onDelete={() => {
                  void confirmDialog({
                    message: `¿Eliminar la difusión "${c.name}"?`,
                    danger: true,
                  }).then((ok) => ok && remove.mutate(c.id));
                }}
              />
            ))}
            {campaigns && campaigns.length === 0 && (
              <div style={empty}>
                <div style={{ color: "var(--muted)", opacity: 0.6 }}>
                  <NavIcon name="megaphone" size={34} />
                </div>
                <p style={{ color: "var(--muted)" }}>
                  Aún no hay difusiones. Crea una plantilla y lanza la primera.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {(() => {
        const c = openId ? campaigns?.find((x) => x.id === openId) : undefined;
        return c ? <CampaignDetail campaign={c} onClose={() => setOpenId(null)} /> : null;
      })()}
    </div>
  );
}

function CampaignCard({
  campaign: c,
  onOpen,
  onLaunch,
  onCancel,
  onDelete,
}: {
  campaign: CampaignDto;
  onOpen: () => void;
  onLaunch: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const pct = (n: number) =>
    c.totalRecipients ? Math.round((n / c.totalRecipients) * 100) : 0;
  const canLaunch = c.status === "DRAFT" || c.status === "SCHEDULED";
  const running = c.status === "RUNNING";

  return (
    <div style={box} className="cm-card" data-campaign={c.id}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="cm-card__name" onClick={onOpen} title="Ver resultados y destinatarios">
          {c.name}
        </button>
        <span className={`cm-status is-${c.status.toLowerCase()}`}>{STATUS_LABEL[c.status]}</span>
        <span
          style={{
            color: "var(--muted)",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {c.template.name}
          {c.channel && (
            <>
              ·
              <NavIcon name="whatsapp" size={12} />
              {c.channel.label ?? c.channel.displayPhoneNumber}
            </>
          )}
        </span>
        <div style={{ flex: 1 }} />
        {(running || c.status === "COMPLETED" || c.status === "CANCELLED") && (
          <button onClick={onOpen} style={ghostBtn} data-open-detail>
            Ver resultados
          </button>
        )}
        {canLaunch && (
          <button onClick={onLaunch} style={primaryBtn}>
            {c.status === "SCHEDULED" ? "Lanzar ahora" : "Lanzar"}
          </button>
        )}
        {running && (
          <button onClick={onCancel} style={ghostBtn}>
            Cancelar
          </button>
        )}
        {!running && (
          <button
            onClick={onDelete}
            style={{ ...ghostBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}
          >
            Eliminar
          </button>
        )}
      </div>

      {c.status === "SCHEDULED" && c.scheduledAt && (
        <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>
          Se enviará el {new Date(c.scheduledAt).toLocaleString("es", { dateStyle: "long", timeStyle: "short" })}.
        </p>
      )}
      {running && (
        <div className="cm-progress" aria-label={`Enviado ${pct(c.sentCount + c.failedCount)}%`}>
          <span style={{ width: `${pct(c.sentCount + c.failedCount)}%` }} />
        </div>
      )}
      {(running || c.status === "COMPLETED" || c.status === "CANCELLED") && (
        <div style={{ marginTop: 14, display: "flex", gap: 22, flexWrap: "wrap" }}>
          <Metric label="Destinatarios" value={c.totalRecipients} />
          <Metric label="Entregados" value={c.deliveredCount} sub={`${pct(c.deliveredCount)}%`} />
          <Metric label="Leídos" value={c.readCount} sub={`${pct(c.readCount)}%`} />
          <Metric label="Respondieron" value={c.repliedCount} sub={`${pct(c.repliedCount)}%`} color="#7ee2a8" />
          <Metric label="Fallidos" value={c.failedCount} color={c.failedCount ? "#e08a8a" : undefined} />
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? "var(--text)" }}>
        {value}
        {sub && <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 6 }}>{sub}</span>}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 8,
        border: "none",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

const empty: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  textAlign: "center",
  padding: "70px 24px",
  border: "1px dashed var(--border)",
  borderRadius: 12,
};
