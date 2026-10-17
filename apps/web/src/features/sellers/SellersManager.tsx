"use client";

import { NavIcon } from "@/components/NavIcons";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import {
  ACTION_LABELS,
  PERMISSION_PRESETS,
  SCOPE_LABELS,
  SECTION_LABELS,
  permissionActions,
  permissionSections,
  visibilityScopes,
  type PermissionPreset,
  type Role,
  type SellerDto,
  type SourceDto,
  type UserPermissions,
} from "@crm/shared";
import {
  assignSellerSources,
  createSource,
  createUser,
  deleteSource,
  fetchSellers,
  updateUser,
} from "@/lib/bff";
import { PasswordStrength, scorePassword } from "@/components/PasswordStrength";

/**
 * Equipo: las personas de la empresa, qué ve cada una (alcance), qué
 * secciones abre y qué puede hacer. Cada tarjeta guarda sus cambios con un
 * botón; el rol y el estado, al momento.
 */
export function SellersManager() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["sellers"],
    queryFn: fetchSellers,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["sellers"] });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const sources = data?.sources ?? [];
  const sellers = data?.sellers ?? [];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 22 }}>
      {isPending && <p style={muted}>Cargando…</p>}
      {isError && <p style={{ color: "#ff6b6b" }}>{(error as Error).message}</p>}

      <section>
        <h3 style={{ margin: "0 0 4px" }}>Equipo</h3>
        <p style={{ ...muted, marginTop: 0 }}>
          Crea las cuentas de tu equipo. Los <strong>administradores</strong> lo ven todo y gestionan la
          configuración. A cada <strong>vendedor</strong> le decides qué chats ve, qué secciones abre y qué
          puede hacer.
        </p>
        <CreateUserForm onCreated={refresh} />
      </section>

      <section>
        <h3 style={{ margin: "0 0 4px" }}>Fuentes</h3>
        <p style={{ ...muted, marginTop: 0 }}>
          El origen de tus leads (Facebook Ads, Instagram, Web, Referido…). Un vendedor con alcance «sus
          fuentes» ve los contactos de las que le marques.
        </p>
        <SourcesEditor sources={sources} onChanged={refresh} />
      </section>

      <section>
        <h3 style={{ margin: "0 0 4px" }}>Personas y permisos</h3>
        <p style={{ ...muted, marginTop: 0 }}>
          Abre la tarjeta de cada persona para ajustar su alcance, sus secciones y sus acciones, o aplica una
          plantilla. «Ver sus chats» abre la bandeja filtrada por esa persona.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-sellers-list>
          {sellers.map((s) => (
            <SellerRow key={s.id} seller={s} sources={sources} onSaved={refresh} />
          ))}
        </div>
      </section>
    </div>
  );
}

type PresetChoice = PermissionPreset | "admin";

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [preset, setPreset] = useState<PresetChoice>("seller");

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setPreset("seller");
  };

  const create = useMutation({
    mutationFn: () =>
      createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role: (preset === "admin" ? "ADMIN" : "AGENT") as Role,
        ...(preset !== "admin" ? { permissions: PERMISSION_PRESETS[preset].permissions } : {}),
      }),
    onSuccess: () => {
      toast.success("Usuario creado");
      reset();
      setOpen(false);
      onCreated();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canSubmit =
    name.trim().length > 0 && /.+@.+\..+/.test(email) && password.length >= 8 && scorePassword(password) >= 2;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={primaryBtn}>
        + Nuevo usuario
      </button>
    );
  }

  return (
    <div style={{ ...box, display: "flex", flexDirection: "column", gap: 12 }} data-create-user>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={fieldLabel}>Nombre</div>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Pérez" />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={fieldLabel}>Correo</div>
          <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ana@empresa.com" />
        </div>
        <div style={{ width: 190 }}>
          <div style={fieldLabel}>Perfil</div>
          <select style={{ ...input, padding: "8px 10px" }} value={preset} onChange={(e) => setPreset(e.target.value as PresetChoice)} aria-label="Perfil">
            <option value="seller">{PERMISSION_PRESETS.seller.label}</option>
            <option value="supervisor">{PERMISSION_PRESETS.supervisor.label}</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
      </div>
      <p style={{ ...muted, fontSize: 13, margin: 0 }}>
        {preset === "admin" ? "Lo ve y lo puede todo, incluida la configuración." : PERMISSION_PRESETS[preset].description}
        {preset !== "admin" && " Luego puedes afinarlo en su tarjeta."}
      </p>
      <div style={{ maxWidth: 320 }}>
        <div style={fieldLabel}>Contraseña temporal</div>
        <input
          type="password"
          style={input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 8 caracteres"
          autoComplete="new-password"
        />
        <PasswordStrength value={password} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          style={ghostBtn}
        >
          Cancelar
        </button>
        <button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending} style={primaryBtn}>
          {create.isPending ? "Creando…" : "Crear usuario"}
        </button>
      </div>
    </div>
  );
}

function SourcesEditor({ sources, onChanged }: { sources: SourceDto[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2c4b7a");
  const create = useMutation({
    mutationFn: () => createSource({ name: name.trim(), color }),
    onSuccess: () => {
      setName("");
      onChanged();
    },
  });
  const remove = useMutation({ mutationFn: deleteSource, onSuccess: onChanged });
  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {sources.map((s) => (
          <span key={s.id} style={chip(s.color)}>
            {s.name}
            <span style={{ opacity: 0.7 }}> · {s.contactCount}</span>
            <button
              onClick={() => {
                void confirmDialog({ message: `¿Eliminar la fuente "${s.name}"?`, danger: true }).then((ok) => ok && remove.mutate(s.id));
              }}
              style={chipX}
              title="Eliminar"
            >
              <NavIcon name="x" size={12} />
            </button>
          </span>
        ))}
        {sources.length === 0 && <span style={muted}>Aún no hay fuentes.</span>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ width: 38, height: 38, padding: 0, border: "none", background: "none", cursor: "pointer" }}
          title="Color"
        />
        <input
          style={input}
          value={name}
          placeholder="Nueva fuente (ej. Facebook Ads)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) create.mutate();
          }}
        />
        <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} style={primaryBtn}>
          Añadir
        </button>
      </div>
    </div>
  );
}

const samePerms = (a: UserPermissions, b: UserPermissions) => JSON.stringify(a) === JSON.stringify(b);
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

function SellerRow({ seller, sources, onSaved }: { seller: SellerDto; sources: SourceDto[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<UserPermissions>(seller.permissions);
  const [selected, setSelected] = useState<string[]>(seller.sourceIds);
  useEffect(() => {
    setPerms(seller.permissions);
    setSelected(seller.sourceIds);
  }, [seller.permissions, seller.sourceIds]);

  const dirty = !samePerms(perms, seller.permissions) || !sameIds(selected, seller.sourceIds);
  const save = useMutation({
    mutationFn: async () => {
      if (!sameIds(selected, seller.sourceIds)) await assignSellerSources(seller.id, selected);
      if (!samePerms(perms, seller.permissions)) await updateUser(seller.id, { permissions: perms });
    },
    onSuccess: () => {
      toast.success("Permisos guardados");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const mutateUser = useMutation({
    mutationFn: (patch: Parameters<typeof updateUser>[1]) => updateUser(seller.id, patch),
    onSuccess: onSaved,
    onError: (e) => toast.error((e as Error).message),
  });
  const toggleSource = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const isAdmin = seller.role === "ADMIN";
  const stats = seller.stats;

  return (
    <div style={{ ...box, opacity: seller.isActive ? 1 : 0.55 }} data-seller={seller.email}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={avatar}>{(seller.name ?? seller.email)[0]?.toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong>{seller.name ?? seller.email}</strong>
            {!seller.isActive && <span style={chip("#5a4a2a")}>inactivo</span>}
          </div>
          <div style={{ ...muted, fontSize: 12 }}>
            {seller.email} · {isAdmin ? "ve todo" : SCOPE_LABELS[perms.scope].toLowerCase()}
          </div>
          <div style={{ ...muted, fontSize: 12, marginTop: 2 }} data-seller-stats>
            {stats.openAssigned} chats abiertos · {stats.active7d} con movimiento en 7 días · último acceso{" "}
            {stats.lastSeenAt ? relative(stats.lastSeenAt) : "nunca"}
          </div>
        </div>
        <a href={`/?agent=${encodeURIComponent(seller.id)}`} style={ghostBtn} title="Abre la bandeja filtrada por esta persona">
          Ver sus chats
        </a>
        <select
          value={seller.role}
          onChange={(e) => mutateUser.mutate({ role: e.target.value as Role })}
          disabled={mutateUser.isPending}
          title="Rol"
          aria-label={`Rol de ${seller.name ?? seller.email}`}
          style={roleSelect}
        >
          <option value="AGENT">Vendedor</option>
          <option value="ADMIN">Administrador</option>
        </select>
        <button
          onClick={() => {
            if (seller.isActive) {
              void confirmDialog({
                message: `¿Desactivar a "${seller.name ?? seller.email}"? Se cerrarán sus sesiones y no podrá entrar.`,
                danger: true,
              }).then((ok) => ok && mutateUser.mutate({ isActive: false }));
            } else {
              mutateUser.mutate({ isActive: true });
            }
          }}
          disabled={mutateUser.isPending}
          style={seller.isActive ? dangerBtn : primaryBtn}
        >
          {seller.isActive ? "Desactivar" : "Reactivar"}
        </button>
        {!isAdmin && (
          <button onClick={() => setOpen((v) => !v)} style={ghostBtn} aria-expanded={open} aria-label={`Permisos de ${seller.name ?? seller.email}`}>
            Permisos {open ? "▴" : "▾"}
          </button>
        )}
      </div>

      {isAdmin ? (
        <p style={{ ...muted, fontSize: 13, margin: "10px 0 0" }}>Es administrador: ve todas las conversaciones y gestiona la configuración.</p>
      ) : (
        open && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }} data-permissions-panel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ ...muted, fontSize: 12.5 }}>Plantilla:</span>
              {(Object.keys(PERMISSION_PRESETS) as PermissionPreset[]).map((k) => (
                <button key={k} onClick={() => setPerms(PERMISSION_PRESETS[k].permissions)} style={ghostBtn} title={PERMISSION_PRESETS[k].description}>
                  {PERMISSION_PRESETS[k].label}
                </button>
              ))}
            </div>

            <div>
              <div style={fieldLabel}>Qué ve</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {visibilityScopes.map((s) => (
                  <label key={s} style={radioRow}>
                    <input type="radio" name={`scope-${seller.id}`} checked={perms.scope === s} onChange={() => setPerms({ ...perms, scope: s })} />
                    {SCOPE_LABELS[s]}
                  </label>
                ))}
              </div>
              {perms.scope === "sources" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }} data-sources-picker>
                  {sources.map((s) => {
                    const on = selected.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSource(s.id)}
                        style={{
                          ...chip(on ? s.color : null),
                          opacity: on ? 1 : 0.45,
                          cursor: "pointer",
                          border: on ? "1px solid transparent" : "1px solid var(--border)",
                          background: on ? chip(s.color).background : "transparent",
                        }}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                  {sources.length === 0 && <span style={muted}>Crea fuentes primero.</span>}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
              <div>
                <div style={fieldLabel}>Qué secciones abre</div>
                {permissionSections.map((k) => (
                  <label key={k} style={checkRow}>
                    <input type="checkbox" checked={perms.sections[k]} onChange={(e) => setPerms({ ...perms, sections: { ...perms.sections, [k]: e.target.checked } })} />
                    {SECTION_LABELS[k]}
                  </label>
                ))}
              </div>
              <div>
                <div style={fieldLabel}>Qué puede hacer</div>
                {permissionActions.map((k) => (
                  <label key={k} style={checkRow}>
                    <input type="checkbox" checked={perms.actions[k]} onChange={(e) => setPerms({ ...perms, actions: { ...perms.actions, [k]: e.target.checked } })} />
                    {ACTION_LABELS[k]}
                  </label>
                ))}
                <p style={{ ...muted, fontSize: 12, margin: "6px 0 0" }}>Bandeja y contactos siempre; la configuración, solo administradores.</p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              {dirty && (
                <button
                  onClick={() => {
                    setPerms(seller.permissions);
                    setSelected(seller.sourceIds);
                  }}
                  style={ghostBtn}
                >
                  Descartar
                </button>
              )}
              <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} style={primaryBtn} data-save-permissions>
                {save.isPending ? "Guardando…" : "Guardar permisos"}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `hace ${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

const box: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  boxShadow: "var(--shadow-card)",
};
const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14 };
const input: React.CSSProperties = {
  flex: 1,
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
};
const primaryBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "#f3f8ff",
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 14,
  textDecoration: "none",
  whiteSpace: "nowrap",
};
const dangerBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid #5a2a2a",
  background: "transparent",
  color: "#e08a8a",
  cursor: "pointer",
  fontSize: 14,
  whiteSpace: "nowrap",
};
const fieldLabel: React.CSSProperties = { fontSize: 12.5, color: "var(--muted)", marginBottom: 5 };
const roleSelect: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13,
};
const radioRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" };
const checkRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer", marginBottom: 6 };
const avatar: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "var(--accent-soft)",
  color: "var(--accent-text)",
  display: "grid",
  placeItems: "center",
  fontWeight: 700,
};
function chip(color: string | null): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    padding: "4px 10px",
    borderRadius: 999,
    background: color ?? "var(--surface-3)",
    color: "#eaf2ff",
  };
}
const chipX: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  padding: 0,
  display: "inline-flex",
  opacity: 0.8,
};
