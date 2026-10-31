"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "@crm/shared";
import { changePassword, fetchMe, updateProfile } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { PasswordStrength, scorePassword } from "@/components/PasswordStrength";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  AGENT: "Vendedor",
};

export function AccountManager({ initial }: { initial: PublicUser }) {
  const { data: me = initial } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    initialData: initial,
  });

  return (
    <div style={wrap}>
      <ProfileCard me={me} />
      <PasswordCard />
      <section style={card}>
        <h3 style={cardTitle}>Sesiones y dispositivos</h3>
        <p style={muted}>
          Revisa dónde tienes la cuenta abierta y cierra los dispositivos que no
          reconozcas.
        </p>
        <Link href="/sessions" className="user-chip" style={linkBtn}>
          Administrar sesiones →
        </Link>
      </section>
    </div>
  );
}

function ProfileCard({ me }: { me: PublicUser }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.name ?? "");
  const dirty = name.trim() !== (me.name ?? "") && name.trim().length > 0;

  const save = useMutation({
    mutationFn: () => updateProfile({ name: name.trim() }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["me"], updated);
      toast.success("Perfil actualizado");
    },
  });

  return (
    <section style={card}>
      <h3 style={cardTitle}>Perfil</h3>
      <div style={field}>
        <label style={label}>Nombre</label>
        <input
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tu nombre"
        />
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={label}>Correo</label>
          <div style={readonly}>{me.email}</div>
        </div>
        <div style={{ minWidth: 140 }}>
          <label style={label}>Rol</label>
          <div style={readonly}>
            <span style={roleBadge(me.role)}>
              {ROLE_LABEL[me.role] ?? me.role}
            </span>
          </div>
        </div>
      </div>
      <div style={actions}>
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          style={primaryBtn}
        >
          {save.isPending ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </section>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooWeak = next.length > 0 && (next.length < 8 || scorePassword(next) < 2);
  const canSubmit =
    current.length > 0 &&
    next.length >= 8 &&
    next === confirm &&
    !tooWeak;

  const change = useMutation({
    mutationFn: () =>
      changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Contraseña actualizada. Se cerraron las demás sesiones.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section style={card}>
      <h3 style={cardTitle}>Contraseña</h3>
      <p style={muted}>
        Al cambiarla se cerrarán automáticamente tus otras sesiones por
        seguridad.
      </p>
      <div style={field}>
        <label style={label}>Contraseña actual</label>
        <input
          type="password"
          style={input}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <div style={field}>
        <label style={label}>Nueva contraseña</label>
        <input
          type="password"
          style={input}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
        />
        <PasswordStrength value={next} />
      </div>
      <div style={field}>
        <label style={label}>Repite la nueva contraseña</label>
        <input
          type="password"
          style={{
            ...input,
            borderColor: mismatch ? "var(--danger)" : "var(--border)",
          }}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        {mismatch && (
          <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>
            Las contraseñas no coinciden.
          </div>
        )}
      </div>
      <div style={actions}>
        <button
          onClick={() => change.mutate()}
          disabled={!canSubmit || change.isPending}
          style={primaryBtn}
        >
          {change.isPending ? "Cambiando…" : "Cambiar contraseña"}
        </button>
      </div>
    </section>
  );
}

const wrap: React.CSSProperties = {
  maxWidth: 640,
  margin: "0 auto",
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 18,
};

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
  boxShadow: "var(--shadow-card)",
};

const cardTitle: React.CSSProperties = { margin: "0 0 12px", fontSize: 16 };

const muted: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 13.5,
  marginTop: 0,
};

const field: React.CSSProperties = { marginBottom: 14 };

const label: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: "var(--muted)",
  marginBottom: 5,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

const readonly: React.CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--muted)",
  fontSize: 14,
};

const actions: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 4,
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  display: "inline-block",
  marginTop: 4,
  color: "var(--accent)",
  fontSize: 14,
  fontWeight: 600,
  padding: "4px 0",
};

function roleBadge(role: string): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "3px 10px",
    borderRadius: 999,
    background: role === "ADMIN" ? "#1f5a6f" : "var(--surface-3)",
    color: "#eaf2ff",
  };
}
