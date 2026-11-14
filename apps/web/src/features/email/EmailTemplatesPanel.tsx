"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildEmailVars, emptyEmailVars, renderEmailText, type EmailAttachment, type EmailTemplateDto } from "@crm/shared";
import { createEmailTemplate, deleteEmailTemplate, fetchEmailTemplates, fetchMe, updateEmailTemplate } from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";
import { EmailAttachments, EmailPreview, EmailTextFields } from "./EmailFields";

/** Un contacto de ejemplo para la vista previa de una plantilla. */
const SAMPLE = buildEmailVars({
  contact: { name: "Ana Torres", phone: "+51999888777", fields: { email: "ana@ejemplo.com" } },
  orgName: "Tu empresa",
  senderName: "Tu nombre",
});

/**
 * Plantillas de correo: textos que el equipo reutiliza, con asunto y variables.
 * No pasan por Meta ni necesitan aprobación; se usan al escribir a un contacto
 * y en el bloque «Enviar correo» de los flujos.
 */
export function EmailTemplatesPanel() {
  const queryClient = useQueryClient();
  // Las crea y edita quien administra; el resto del equipo las usa.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const canEdit = me?.role === "ADMIN";
  const { data: templates, isPending } = useQuery({ queryKey: ["email-templates"], queryFn: fetchEmailTemplates });
  const [editing, setEditing] = useState<EmailTemplateDto | "new" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["email-templates"] });
  const remove = useMutation({
    mutationFn: deleteEmailTemplate,
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });

  if (editing) {
    return <TemplateEditor template={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), void refresh())} />;
  }

  return (
    <div className="mail-templates">
      <div className="mail-head">
        <p className="mail-lead">
          Correos que tu equipo envía a menudo: una cotización, una bienvenida, un recordatorio. No pasan por Meta ni
          esperan aprobación. Se eligen al escribirle a un contacto y en el bloque «Enviar correo» de los flujos.
        </p>
        {canEdit && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing("new")}>
            <NavIcon name="plus" size={14} />
            Nueva plantilla
          </button>
        )}
      </div>

      {isPending && <p className="mail-muted">Cargando…</p>}
      {templates && templates.length === 0 && (
        <p className="src-empty">
          Aún no hay plantillas de correo.{canEdit ? " Crea la primera con el botón de arriba." : " Las crea quien administra el CRM."}
        </p>
      )}

      {(templates ?? []).map((t) => (
        <article key={t.id} className="mail-tpl" data-mail-template={t.name}>
          <div className="mail-tpl__main">
            <strong className="mail-tpl__name">{t.name}</strong>
            <span className="mail-tpl__subject">{t.subject}</span>
            <p className="mail-tpl__body">{t.body}</p>
            {t.attachments.length > 0 && (
              <span className="mail-muted mail-tpl__files">
                <NavIcon name="paperclip" size={13} />
                {t.attachments.map((a) => a.name).join(", ")}
              </span>
            )}
          </div>
          {canEdit && (
            <div className="mail-row__actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>
                Editar
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  void confirmDialog({
                    message: `¿Eliminar la plantilla «${t.name}»? Los flujos que la usan dejarán de enviar ese correo.`,
                    danger: true,
                  }).then((ok) => ok && remove.mutate(t.id));
                }}
              >
                Eliminar
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function TemplateEditor({ template, onClose, onSaved }: { template?: EmailTemplateDto; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [attachments, setAttachments] = useState<EmailAttachment[]>(template?.attachments ?? []);

  // Variables que no son ni las fijas ni un dato del ejemplo: campos propios o
  // del flujo. No es un error, pero conviene saber que dependen del contacto.
  const loose = useMemo(() => emptyEmailVars(`${subject}\n${body}`, SAMPLE), [subject, body]);
  const ready = name.trim() && subject.trim() && body.trim();

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), subject: subject.trim(), body, attachments };
      return template ? updateEmailTemplate(template.id, payload) : createEmailTemplate(payload);
    },
    onSuccess: () => {
      toast.success("Plantilla guardada");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <form
      className="mail-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !save.isPending) save.mutate();
      }}
    >
      <div className="mail-editor__form">
        <h3 className="mail-editor__title">{template ? "Editar plantilla de correo" : "Nueva plantilla de correo"}</h3>
        <label className="agenda-field">
          <span className="label">Nombre (solo lo ve tu equipo)</span>
          <input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Cotización enviada" data-mail-name autoFocus />
        </label>
        <EmailTextFields
          subject={subject}
          body={body}
          onSubject={setSubject}
          onBody={setBody}
          bodyRows={12}
          bodyPlaceholder={"Hola {{primer_nombre}}:\n\nGracias por escribir a {{empresa}}…"}
        />
        <div className="agenda-field">
          <span className="label">Adjuntos (van en cada correo de esta plantilla)</span>
          <EmailAttachments value={attachments} onChange={setAttachments} />
        </div>
        <p className="mail-form__help">
          La firma no se escribe aquí: se añade sola, la del buzón por el que salga. Los correos de los flujos llevan
          además un enlace de baja.
        </p>
        <div className="mail-form__foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!ready || save.isPending}>
            {save.isPending ? "Guardando…" : "Guardar plantilla"}
          </button>
        </div>
      </div>

      <aside className="mail-editor__preview" aria-label="Vista previa">
        <span className="mail-editor__kicker">Vista previa · datos de ejemplo</span>
        <EmailPreview subject={renderEmailText(subject, SAMPLE)} body={renderEmailText(body, SAMPLE) || "Tu mensaje aparecerá aquí."} from="Tu empresa" />
        {loose.length > 0 && (
          <p className="mail-warn" role="status">
            {loose.map((k) => `{{${k}}}`).join(", ")} {loose.length === 1 ? "sale" : "salen"} del campo del contacto o del flujo con esa
            clave. Si un contacto no lo tiene, ese hueco queda en blanco.
          </p>
        )}
      </aside>
    </form>
  );
}
