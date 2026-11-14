"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  emptyEmailVars,
  isEmailAddress,
  renderEmailText,
  withEmailSignature,
  type EmailAccountDto,
  type EmailAttachment,
} from "@crm/shared";
import { fetchEmailCompose, fetchEmailTemplates, fetchMe, sendEmail } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";
import { EmailAttachments, EmailTextFields } from "./EmailFields";

/** El buzón propio va primero: quien tiene uno personal escribe desde él. */
function defaultAccount(accounts: EmailAccountDto[]): EmailAccountDto | undefined {
  return accounts.find((a) => a.owner) ?? accounts[0];
}

/** Cambia la firma del final del texto por la del buzón nuevo, si la persona no la tocó. */
function swapSignature(body: string, from: string, to: string): string {
  const old = from.trim();
  const base = old && body.trimEnd().endsWith(old) ? body.trimEnd().slice(0, -old.length) : body;
  return withEmailSignature(base, to);
}

/**
 * Escribir un correo a un contacto. Elegir una plantilla la deja ya rellenada
 * con sus datos para retocarla; lo que se ve es lo que se envía.
 */
export function EmailComposeDialog({ contactId, contactName, onClose }: { contactId: string; contactName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: ctx, isPending, error } = useQuery({
    queryKey: ["email-compose", contactId],
    queryFn: () => fetchEmailCompose(contactId),
    staleTime: 0,
  });
  const { data: templates } = useQuery({ queryKey: ["email-templates"], queryFn: fetchEmailTemplates });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });

  const [accountId, setAccountId] = useState("");
  const [to, setTo] = useState("");
  const [saveTo, setSaveTo] = useState(true);
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);

  // Al llegar los datos: buzón por defecto, el correo guardado y la firma ya puesta.
  const ready = useRef(false);
  useEffect(() => {
    if (!ctx || ready.current) return;
    ready.current = true;
    const first = defaultAccount(ctx.accounts);
    setAccountId(first?.id ?? "");
    setTo(ctx.to ?? "");
    setBody(withEmailSignature("", first?.signature));
  }, [ctx]);

  useEffect(() => {
    // En captura y sin dejarlo pasar: Esc cierra esta ventana, no la ficha de debajo.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const account = ctx?.accounts.find((a) => a.id === accountId);
  const vars = useMemo(() => ctx?.vars ?? {}, [ctx]);
  const template = templates?.find((t) => t.id === templateId);
  // Variables de la plantilla que este contacto no tiene: quedaron en blanco.
  const blanks = template ? emptyEmailVars(`${template.subject}\n${template.body}`, vars) : [];

  const pickAccount = (id: string) => {
    const next = ctx?.accounts.find((a) => a.id === id);
    setBody((b) => swapSignature(b, account?.signature ?? "", next?.signature ?? ""));
    setAccountId(id);
  };

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    setSubject(renderEmailText(t.subject, vars));
    setBody(withEmailSignature(renderEmailText(t.body, vars), account?.signature));
    setAttachments(t.attachments);
  };

  const toOk = isEmailAddress(to);
  const isNewAddress = toOk && to.trim().toLowerCase() !== (ctx?.to ?? "");
  const canSend = !!account && toOk && !!subject.trim() && !!body.trim();

  const send = useMutation({
    mutationFn: () =>
      sendEmail({
        contactId,
        accountId,
        to: to.trim(),
        saveToContact: isNewAddress && (saveTo || !ctx?.to),
        subject,
        body,
        templateId: templateId || undefined,
        attachments,
      }),
    onSuccess: () => {
      toast.success(`Correo enviado a ${to.trim()}`);
      void queryClient.invalidateQueries({ queryKey: ["contact-emails", contactId] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      void queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
      onClose();
    },
    onError: (e) => {
      toast.error((e as Error).message);
      void queryClient.invalidateQueries({ queryKey: ["contact-emails", contactId] });
    },
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const noMailbox = !!ctx && ctx.accounts.length === 0;
  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog agenda-dialog agenda-dialog--wide mail-compose"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-compose-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="agenda-dialog__head">
          <h2 id="mail-compose-title" className="agenda-dialog__title">
            Correo a {contactName}
          </h2>
          <button type="button" className="cp-iconbtn" onClick={onClose} aria-label="Cerrar">
            <NavIcon name="x" size={15} />
          </button>
        </header>

        {isPending ? (
          <div className="agenda-dialog__body">
            <p className="mail-muted">Cargando…</p>
          </div>
        ) : error ? (
          <div className="agenda-dialog__body">
            <p className="mail-warn" role="alert">
              {(error as Error).message}
            </p>
          </div>
        ) : noMailbox ? (
          <div className="agenda-dialog__body">
            <div className="mail-nobox">
              <NavIcon name="mail" size={22} />
              <strong>Todavía no hay un buzón conectado</strong>
              <p>
                Para escribir por correo, tu empresa conecta primero la dirección desde la que envía.{" "}
                {me?.role === "ADMIN" ? "Toma un par de minutos." : "Lo hace quien administra el CRM, en Ajustes › Correo."}
              </p>
              {me?.role === "ADMIN" && (
                <Link href="/settings?tab=email" className="btn btn-primary btn-sm" onClick={onClose}>
                  Conectar un buzón
                </Link>
              )}
            </div>
          </div>
        ) : (
          <form
            className="mail-compose__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend && !send.isPending) send.mutate();
            }}
          >
            <div className="agenda-dialog__body">
              <div className="agenda-form-row">
                <label className="agenda-field">
                  <span className="label">De</span>
                  <select className="field" value={accountId} onChange={(e) => pickAccount(e.target.value)} data-mail-from>
                    {ctx!.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.fromName ? `${a.fromName} · ${a.address}` : a.address}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="agenda-field">
                  <span className="label">Para</span>
                  <input
                    className="field"
                    type="email"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="correo@cliente.com"
                    aria-invalid={!!to && !toOk}
                    autoFocus={!ctx!.to}
                    data-mail-to
                  />
                </label>
              </div>
              {isNewAddress && !!ctx!.to && (
                <label className="mail-check">
                  <input type="checkbox" checked={saveTo} onChange={(e) => setSaveTo(e.target.checked)} />
                  Guardar {to.trim()} como el correo de este contacto (ahora tiene {ctx!.to})
                </label>
              )}
              {isNewAddress && !ctx!.to && <p className="mail-form__help">Este contacto no tenía correo: la dirección se guarda en su ficha al enviar.</p>}
              {ctx!.unsubscribed && (
                <p className="mail-warn" role="status">
                  Esta persona se dio de baja de los correos automáticos. Puedes escribirle a mano si te lo pidió.
                </p>
              )}

              <label className="agenda-field">
                <span className="label">Plantilla</span>
                <select className="field" value={templateId} onChange={(e) => pickTemplate(e.target.value)} data-mail-template-pick>
                  <option value="">Sin plantilla: escribir desde cero</option>
                  {(templates ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              {blanks.length > 0 && (
                <p className="mail-warn" role="status">
                  Este contacto no tiene {blanks.map((k) => `{{${k}}}`).join(", ")}: {blanks.length === 1 ? "ese hueco quedó" : "esos huecos quedaron"} en
                  blanco. Revisa el texto antes de enviar.
                </p>
              )}

              <EmailTextFields subject={subject} body={body} onSubject={setSubject} onBody={setBody} bodyRows={11} />
              <EmailAttachments value={attachments} onChange={setAttachments} />
            </div>
            <footer className="agenda-dialog__foot">
              <span className="mail-muted agenda-dialog__who">
                Sale por {account?.address ?? "…"}. Las respuestas llegan a ese buzón.
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={!canSend || send.isPending} data-mail-send>
                <NavIcon name="send" size={14} />
                {send.isPending ? "Enviando…" : "Enviar correo"}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
