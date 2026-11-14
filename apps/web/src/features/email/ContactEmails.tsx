"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CONTACT_EMAIL_KEY, isEmailAddress, type EmailDto } from "@crm/shared";
import { fetchContactEmails, updateContact } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";
import { useLocale, useT } from "@/i18n/I18nProvider";
import { EmailComposeDialog } from "./EmailComposeDialog";

/** Cuántos correos se enseñan antes de «ver todos». */
const SHOWN = 3;

/**
 * En la ficha de un contacto: su correo (se edita aquí mismo), el botón para
 * escribirle y los últimos correos que se le enviaron, a mano o desde un flujo.
 */
export function ContactEmails({ contact }: { contact: { id: string; name: string; email: string | null } | null }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const { data: emails } = useQuery({
    queryKey: ["contact-emails", contact?.id],
    queryFn: () => fetchContactEmails(contact!.id),
    enabled: !!contact,
  });

  // Otro contacto: nada de lo que estaba abierto vale.
  useEffect(() => {
    setEditing(false);
    setOpen(null);
    setAll(false);
  }, [contact?.id]);

  const save = useMutation({
    mutationFn: () => updateContact(contact!.id, { fields: { [CONTACT_EMAIL_KEY]: draft.trim() } }),
    onSuccess: () => {
      setEditing(false);
      toast.success(t("inbox.contactSaved"));
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["email-compose", contact!.id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const draftOk = !draft.trim() || isEmailAddress(draft);
  const list = all ? (emails ?? []) : (emails ?? []).slice(0, SHOWN);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="cp-section" data-contact-emails>
      <div className="cp-section__title">
        <span>{t("inbox.emailSection")}</span>
        <button type="button" className="cp-link agenda-cp-add" disabled={!contact} onClick={() => setComposing(true)} data-mail-compose>
          <NavIcon name="mail" size={11} />
          {t("inbox.writeEmail")}
        </button>
      </div>

      {editing ? (
        <form
          className="cp-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (draftOk && !save.isPending) save.mutate();
          }}
        >
          <input
            className="field field-sm"
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="correo@cliente.com"
            aria-label={t("inbox.emailSection")}
            aria-invalid={!draftOk}
            autoFocus
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!draftOk || save.isPending}>
            {save.isPending ? t("common.saving") : t("common.save")}
          </button>
          <button type="button" className="cp-iconbtn" onClick={() => setEditing(false)} aria-label={t("common.cancel")}>
            <NavIcon name="x" size={14} />
          </button>
        </form>
      ) : (
        <div className="mail-cp-address">
          {/* Mientras llega la ficha no se sabe si tiene correo: no se afirma que no. */}
          {!contact ? (
            <span className="cp-empty">{t("common.loading")}</span>
          ) : contact.email ? (
            <span className="mail-cp-address__value">{contact.email}</span>
          ) : (
            <span className="cp-empty">{t("inbox.noEmail")}</span>
          )}
          <button
            type="button"
            className="cp-iconbtn"
            disabled={!contact}
            onClick={() => {
              setDraft(contact?.email ?? "");
              setEditing(true);
            }}
            title={contact?.email ? t("inbox.editEmail") : t("inbox.addEmail")}
            aria-label={contact?.email ? t("inbox.editEmail") : t("inbox.addEmail")}
          >
            <NavIcon name={contact?.email ? "pencil" : "plus"} size={13} />
          </button>
        </div>
      )}

      {list.map((m) => (
        <EmailItem key={m.id} email={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} when={when} />
      ))}
      {!all && (emails?.length ?? 0) > SHOWN && (
        <button type="button" className="cp-link agenda-cp-add" onClick={() => setAll(true)}>
          {t("inbox.showAllEmails", { n: emails!.length })}
        </button>
      )}

      {composing && contact && <EmailComposeDialog contactId={contact.id} contactName={contact.name} onClose={() => setComposing(false)} />}
    </section>
  );
}

function EmailItem({ email, open, onToggle, when }: { email: EmailDto; open: boolean; onToggle: () => void; when: (iso: string) => string }) {
  const t = useT();
  const status = email.status === "sent" ? t("inbox.emailSent") : email.status === "failed" ? t("inbox.emailFailed") : t("inbox.emailQueued");
  return (
    <div className={`mail-cp-item is-${email.status}${open ? " is-open" : ""}`}>
      <button type="button" className="mail-cp-item__head" onClick={onToggle} aria-expanded={open}>
        <NavIcon name={email.status === "failed" ? "alert" : email.status === "queued" ? "hourglass" : "mail"} size={14} />
        <span className="mail-cp-item__main">
          <span className="mail-cp-item__subject">{email.subject}</span>
          <span className="mail-cp-item__meta">
            {status} · {when(email.sentAt ?? email.createdAt)}
            {email.sentBy ? ` · ${email.sentBy}` : ""}
          </span>
        </span>
      </button>
      {open && (
        <div className="mail-cp-item__body">
          <span className="mail-cp-item__meta">
            {email.from} → {email.to}
          </span>
          {email.error && (
            <p className="mail-cp-item__error" role="status">
              {email.error}
            </p>
          )}
          <p className="mail-cp-item__text">{email.body}</p>
          {email.attachments.length > 0 && (
            <span className="mail-cp-item__meta">
              <NavIcon name="paperclip" size={12} /> {email.attachments.map((a) => a.name).join(", ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
