"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EMAIL_DEFAULT_DAILY_LIMIT,
  EMAIL_MAX_DAILY_LIMIT,
  EMAIL_PROVIDER_PRESETS,
  emailProviders,
  isEmailAddress,
  type EmailAccountDto,
  type EmailProvider,
} from "@crm/shared";
import {
  createEmailAccount,
  deleteEmailAccount,
  deleteEmailUnsubscribe,
  fetchAgents,
  fetchEmailAccounts,
  fetchEmailUnsubscribes,
  testEmailAccount,
  updateEmailAccount,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";

/**
 * Ajustes › Correo: los buzones desde los que escribe la empresa y la lista de
 * bajas. Driony no tiene servicio de envío propio: cada correo sale por el
 * servidor del buzón conectado, con su dirección real.
 */
export function EmailSettings() {
  const queryClient = useQueryClient();
  const { data: accounts, isPending } = useQuery({ queryKey: ["email-accounts"], queryFn: fetchEmailAccounts });
  const { data: unsubscribes } = useQuery({ queryKey: ["email-unsubscribes"], queryFn: fetchEmailUnsubscribes });
  const [editing, setEditing] = useState<EmailAccountDto | "new" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["email-accounts"] });

  const test = useMutation({
    mutationFn: testEmailAccount,
    onSuccess: (r) => {
      toast.success(`Prueba enviada a ${r.to}. Revisa que llegó.`);
      void refresh();
    },
    onError: (e) => {
      toast.error((e as Error).message);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: deleteEmailAccount,
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const resubscribe = useMutation({
    mutationFn: deleteEmailUnsubscribe,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-unsubscribes"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="mail-settings">
      <section className="src-section">
        <div className="mail-head">
          <div className="src-section__head">
            <h4>Buzones</h4>
            <p>
              Conecta la dirección desde la que escribe tu empresa. Los correos salen por tu propio servidor y las
              respuestas llegan a tu buzón de siempre, no a Driony.
            </p>
          </div>
          {editing === null && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing("new")}>
              <NavIcon name="plus" size={14} />
              Conectar buzón
            </button>
          )}
        </div>

        {editing === "new" && <AccountForm onClose={() => setEditing(null)} onSaved={() => (setEditing(null), void refresh())} />}

        {isPending && <p className="mail-muted">Cargando…</p>}
        {accounts && accounts.length === 0 && editing === null && (
          <p className="src-empty">
            Aún no hay ningún buzón. Conecta uno para escribir a tus contactos por correo y para usar el bloque «Enviar
            correo» en los flujos.
          </p>
        )}

        {(accounts ?? []).map((a) =>
          editing !== "new" && editing?.id === a.id ? (
            <AccountForm key={a.id} account={a} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), void refresh())} />
          ) : (
            <div key={a.id} className="mail-row" data-mail-account={a.address}>
              <span className={`mail-row__mark${a.status === "error" ? " is-error" : ""}`} aria-hidden="true">
                <NavIcon name="mail" size={16} />
              </span>
              <div className="mail-row__main">
                <strong className="mail-row__address">{a.address}</strong>
                <div className="mail-row__meta">
                  <span className="src-chip">{a.owner ? `Personal · ${a.owner.name}` : "Compartido"}</span>
                  <span>{EMAIL_PROVIDER_PRESETS[a.provider].label}</span>
                  <span className="mail-count">
                    {a.sentToday}/{a.dailyLimit} hoy
                  </span>
                </div>
                {a.lastError && (
                  <p className="mail-row__error" role="status">
                    {a.status === "error" ? "El servidor rechazó el acceso: " : "Último fallo: "}
                    {a.lastError}
                  </p>
                )}
              </div>
              <div className="mail-row__actions">
                <button type="button" className="btn btn-ghost btn-sm" disabled={test.isPending} onClick={() => test.mutate(a.id)}>
                  {test.isPending && test.variables === a.id ? "Enviando…" : "Probar"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    void confirmDialog({
                      message: `¿Desconectar ${a.address}? Los correos ya enviados se quedan en el historial; los flujos que lo usaban saldrán por el buzón compartido.`,
                      danger: true,
                    }).then((ok) => ok && remove.mutate(a.id));
                  }}
                >
                  Desconectar
                </button>
              </div>
            </div>
          ),
        )}
      </section>

      <section className="src-section">
        <div className="src-section__head">
          <h4>Bajas</h4>
          <p>
            Los correos automáticos (los de los flujos) llevan un enlace de baja. Quien lo usa queda aquí y deja de
            recibirlos. Escribirle a mano sigue siendo posible.
          </p>
        </div>
        {unsubscribes && unsubscribes.length === 0 && <p className="src-empty">Nadie se ha dado de baja.</p>}
        {(unsubscribes ?? []).map((u) => (
          <div key={u.id} className="mail-unsub">
            <span className="mail-unsub__address">{u.address}</span>
            <span className="mail-muted">{new Date(u.createdAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void confirmDialog({ message: `¿Quitar ${u.address} de la lista de bajas? Volverá a recibir los correos automáticos.` }).then(
                  (ok) => ok && resubscribe.mutate(u.id),
                );
              }}
            >
              Quitar
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function AccountForm({ account, onClose, onSaved }: { account?: EmailAccountDto; onClose: () => void; onSaved: () => void }) {
  const { data: team } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const [provider, setProvider] = useState<EmailProvider>(account?.provider ?? "gmail");
  const [address, setAddress] = useState(account?.address ?? "");
  const [fromName, setFromName] = useState(account?.fromName ?? "");
  const [smtpHost, setSmtpHost] = useState(account?.smtpHost ?? EMAIL_PROVIDER_PRESETS.gmail.host);
  const [smtpPort, setSmtpPort] = useState(String(account?.smtpPort ?? EMAIL_PROVIDER_PRESETS.gmail.port));
  // El usuario suele ser la propia dirección: se rellena solo hasta que se toca.
  const [smtpUser, setSmtpUser] = useState(account?.smtpUser ?? "");
  const [userTouched, setUserTouched] = useState(!!account && account.smtpUser !== account.address);
  const [smtpPass, setSmtpPass] = useState("");
  const [ownerId, setOwnerId] = useState(account?.owner?.id ?? "");
  const [signature, setSignature] = useState(account?.signature ?? "");
  const [dailyLimit, setDailyLimit] = useState(String(account?.dailyLimit ?? EMAIL_DEFAULT_DAILY_LIMIT));

  const pickProvider = (next: EmailProvider) => {
    setProvider(next);
    const preset = EMAIL_PROVIDER_PRESETS[next];
    if (preset.host) setSmtpHost(preset.host);
    setSmtpPort(String(preset.port));
  };

  const user = userTouched ? smtpUser : address;
  const port = Number(smtpPort);
  const limit = Number(dailyLimit);
  const addressOk = isEmailAddress(address);
  const limitOk = Number.isInteger(limit) && limit >= 1 && limit <= EMAIL_MAX_DAILY_LIMIT;
  const ready = addressOk && smtpHost.trim().length > 2 && Number.isInteger(port) && port > 0 && !!user.trim() && (!!account || !!smtpPass) && limitOk;

  const save = useMutation({
    mutationFn: () => {
      const base = {
        address: address.trim(),
        fromName: fromName.trim(),
        provider,
        smtpHost: smtpHost.trim(),
        smtpPort: port,
        smtpUser: user.trim(),
        userId: ownerId || null,
        signature,
        dailyLimit: limit,
      };
      return account
        ? updateEmailAccount(account.id, { ...base, ...(smtpPass ? { smtpPass } : {}) })
        : createEmailAccount({ ...base, smtpPass });
    },
    onSuccess: () => {
      toast.success(account ? "Buzón guardado" : "Buzón conectado: el servidor aceptó el acceso");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const preset = EMAIL_PROVIDER_PRESETS[provider];
  return (
    <form
      className="mail-form"
      data-mail-form={account ? "edit" : "new"}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !save.isPending) save.mutate();
      }}
    >
      <div className="mail-form__providers seg" role="group" aria-label="Proveedor de correo">
        {emailProviders.map((p) => (
          <button key={p} type="button" className={provider === p ? "is-active" : ""} aria-pressed={provider === p} onClick={() => pickProvider(p)}>
            {EMAIL_PROVIDER_PRESETS[p].label}
          </button>
        ))}
      </div>
      <p className="mail-form__help">
        {preset.help}{" "}
        {provider === "gmail" && (
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
            Crear contraseña de aplicación
          </a>
        )}
      </p>

      <div className="agenda-form-row">
        <label className="agenda-field">
          <span className="label">Dirección</span>
          <input className="field" type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ventas@tuempresa.com" autoComplete="off" required />
        </label>
        <label className="agenda-field">
          <span className="label">Nombre que verá quien recibe</span>
          <input className="field" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="El nombre de tu empresa" maxLength={80} />
        </label>
      </div>

      <div className="agenda-form-row">
        <label className="agenda-field" style={{ flex: 2 }}>
          <span className="label">Servidor de salida (SMTP)</span>
          <input className="field mail-mono" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.tuproveedor.com" autoComplete="off" spellCheck={false} required />
        </label>
        <label className="agenda-field" style={{ flex: "0 1 110px", minWidth: 90 }}>
          <span className="label">Puerto</span>
          <input className="field mail-mono" inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value.replace(/\D/g, ""))} required />
        </label>
      </div>

      <div className="agenda-form-row">
        <label className="agenda-field">
          <span className="label">Usuario</span>
          <input
            className="field"
            value={user}
            onChange={(e) => {
              setUserTouched(true);
              setSmtpUser(e.target.value);
            }}
            placeholder="Casi siempre, la misma dirección"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="agenda-field">
          <span className="label">{provider === "gmail" ? "Contraseña de aplicación" : "Contraseña"}</span>
          <input
            className="field"
            type="password"
            value={smtpPass}
            onChange={(e) => setSmtpPass(e.target.value)}
            placeholder={account ? "Sin cambios: déjala vacía" : ""}
            autoComplete="new-password"
          />
        </label>
      </div>

      <div className="agenda-form-row">
        <label className="agenda-field">
          <span className="label">Quién lo usa</span>
          <select className="field" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Toda la empresa (compartido)</option>
            {(team ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                Solo {u.name ?? u.email} (personal)
              </option>
            ))}
          </select>
        </label>
        <label className="agenda-field" style={{ flex: "0 1 200px" }}>
          <span className="label">Tope de correos al día</span>
          <input className="field mail-mono" inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value.replace(/\D/g, ""))} aria-invalid={!limitOk} />
        </label>
      </div>
      <p className="mail-form__help">
        {ownerId
          ? "Un buzón personal solo lo usa su dueño para escribir, y los flujos cuando él lleva el chat."
          : "El buzón compartido lo usa todo el equipo y es por el que salen los correos de los flujos."}{" "}
        El tope protege tu dirección: los proveedores bloquean a quien envía demasiado en un día (entre 1 y {EMAIL_MAX_DAILY_LIMIT.toLocaleString("es")}).
      </p>

      <label className="agenda-field">
        <span className="label">Firma (va al final de cada correo de este buzón)</span>
        <textarea className="field" rows={3} value={signature} onChange={(e) => setSignature(e.target.value)} maxLength={2000} placeholder={"Ana Torres\nClínica Sol · 01 555 0100"} />
      </label>

      <div className="mail-form__foot">
        <span className="mail-muted">Al guardar se comprueba que el servidor acepta el usuario y la contraseña.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!ready || save.isPending}>
          {save.isPending ? "Comprobando…" : account ? "Guardar" : "Conectar"}
        </button>
      </div>
    </form>
  );
}
