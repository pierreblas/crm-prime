"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CONTACT_EMAIL_KEY,
  EMAIL_MAX_ATTACHMENTS,
  EMAIL_MAX_ATTACH_BYTES,
  EMAIL_VARIABLES,
  emailTextToHtml,
  type EmailAttachment,
} from "@crm/shared";
import { fetchCustomFields, uploadMedia } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";

/** «120 KB», «2,4 MB»: el peso de un adjunto, en corto. */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es", { maximumFractionDigits: 1 })} MB`;
}

/**
 * Asunto y cuerpo de un correo, con el menú «Insertar variable». La variable
 * entra donde estaba el cursor del último de los dos campos que se tocó.
 */
export function EmailTextFields({
  subject,
  body,
  onSubject,
  onBody,
  bodyRows = 10,
  bodyPlaceholder,
}: {
  subject: string;
  body: string;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  bodyRows?: number;
  bodyPlaceholder?: string;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const last = useRef<"subject" | "body">("body");
  const { data: custom } = useQuery({ queryKey: ["custom-fields"], queryFn: fetchCustomFields });

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const el = last.current === "subject" ? subjectRef.current : bodyRef.current;
    const value = last.current === "subject" ? subject : body;
    const set = last.current === "subject" ? onSubject : onBody;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    set(value.slice(0, start) + token + value.slice(end));
    // El cursor queda detrás de lo insertado, en el mismo campo.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <>
      <label className="agenda-field">
        <span className="label">Asunto</span>
        <input
          ref={subjectRef}
          className="field"
          value={subject}
          maxLength={200}
          onChange={(e) => onSubject(e.target.value)}
          onFocus={() => (last.current = "subject")}
          data-mail-subject
        />
      </label>
      <div className="agenda-field">
        <div className="mail-bodyhead">
          <label className="label" htmlFor="mail-body">
            Mensaje
          </label>
          <select
            className="field field-sm mail-varmenu"
            value=""
            aria-label="Insertar variable"
            onChange={(e) => e.target.value && insert(e.target.value)}
          >
            <option value="">Insertar variable…</option>
            <optgroup label="Del contacto y tu empresa">
              {EMAIL_VARIABLES.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </optgroup>
            {(custom ?? []).some((f) => f.key !== CONTACT_EMAIL_KEY) && (
              <optgroup label="Campos del contacto">
                {(custom ?? [])
                  .filter((f) => f.key !== CONTACT_EMAIL_KEY)
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </div>
        <textarea
          id="mail-body"
          ref={bodyRef}
          className="field mail-body"
          rows={bodyRows}
          value={body}
          maxLength={20000}
          placeholder={bodyPlaceholder}
          onChange={(e) => onBody(e.target.value)}
          onFocus={() => (last.current = "body")}
          data-mail-body
        />
      </div>
    </>
  );
}

/** Adjuntos de un correo o de una plantilla: sube el archivo y guarda su referencia. */
export function EmailAttachments({ value, onChange }: { value: EmailAttachment[]; onChange: (next: EmailAttachment[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const total = value.reduce((sum, a) => sum + a.size, 0);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    let next = [...value];
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (next.length >= EMAIL_MAX_ATTACHMENTS) {
          toast.error(`Como máximo ${EMAIL_MAX_ATTACHMENTS} adjuntos por correo`);
          break;
        }
        if (next.reduce((sum, a) => sum + a.size, 0) + file.size > EMAIL_MAX_ATTACH_BYTES) {
          toast.error(`«${file.name}» no cabe: los adjuntos pasarían de ${fileSize(EMAIL_MAX_ATTACH_BYTES)} en total`);
          continue;
        }
        const up = await uploadMedia(file);
        next = [...next, { ref: up.mediaUrl, name: up.fileName, mimeType: up.mimeType, size: up.size }];
        onChange(next);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="mail-attach">
      {value.map((a) => (
        <span key={a.ref} className="mail-attach__file">
          <NavIcon name="paperclip" size={13} />
          <span className="mail-attach__name">{a.name}</span>
          <span className="mail-count">{fileSize(a.size)}</span>
          <button type="button" className="mail-attach__x" aria-label={`Quitar ${a.name}`} onClick={() => onChange(value.filter((x) => x.ref !== a.ref))}>
            <NavIcon name="x" size={12} />
          </button>
        </span>
      ))}
      <input ref={input} type="file" multiple hidden onChange={(e) => void add(e.target.files)} />
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || value.length >= EMAIL_MAX_ATTACHMENTS} onClick={() => input.current?.click()}>
        <NavIcon name="paperclip" size={14} />
        {busy ? "Subiendo…" : "Adjuntar archivo"}
      </button>
      {value.length > 0 && (
        <span className="mail-muted mail-count">
          {fileSize(total)} de {fileSize(EMAIL_MAX_ATTACH_BYTES)}
        </span>
      )}
    </div>
  );
}

/**
 * Cómo lo verá quien lo recibe: el mismo HTML que sale por el servidor. Va en
 * claro a propósito: casi todos los programas de correo son de fondo blanco.
 */
export function EmailPreview({ subject, body, from, note }: { subject: string; body: string; from?: string; note?: string }) {
  return (
    <div className="mail-preview">
      <div className="mail-preview__meta">
        {from && <span className="mail-preview__from">{from}</span>}
        <strong className="mail-preview__subject">{subject.trim() || "(sin asunto)"}</strong>
      </div>
      {/* emailTextToHtml escapa todo lo que no sea su propio marcado. */}
      <div className="mail-preview__body" dangerouslySetInnerHTML={{ __html: emailTextToHtml(body) }} />
      {note && <p className="mail-preview__note">{note}</p>}
    </div>
  );
}
