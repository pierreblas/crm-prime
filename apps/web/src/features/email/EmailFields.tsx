"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CONTACT_EMAIL_KEY,
  EMAIL_MAX_ATTACHMENTS,
  EMAIL_MAX_ATTACH_BYTES,
  EMAIL_MAX_HTML_CHARS,
  EMAIL_MAX_TEXT_CHARS,
  EMAIL_VARIABLES,
  emailHtmlWarnings,
  emailPreviewDoc,
  emailTextToHtml,
  type EmailAttachment,
  type EmailFormat,
} from "@crm/shared";
import { fetchCustomFields, uploadMedia } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";
import { contactFieldsOnly } from "@/lib/custom-fields";

/** «120 KB», «2,4 MB»: el peso de un adjunto, en corto. */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es", { maximumFractionDigits: 1 })} MB`;
}

const count = (n: number) => n.toLocaleString("es");

/** El valor, pero solo cuando lleva un rato quieto: la vista previa no se recarga en cada tecla. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * Un correo HTML tal como lo verá quien lo reciba. El HTML lo escribe la
 * empresa y no se filtra, así que va en un marco aislado: `sandbox` sin
 * permiso de scripts ni de origen. Nada de lo que traiga se ejecuta ni alcanza
 * la sesión de Driony. Los enlaces se abren en otra pestaña.
 */
export function EmailHtmlFrame({ html, className = "" }: { html: string; className?: string }) {
  const settled = useSettled(html, 250);
  const doc = useMemo(() => emailPreviewDoc(settled), [settled]);
  return (
    <div className={`mail-frame ${className}`.trim()}>
      <iframe title="Vista previa del correo" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={doc} data-mail-frame />
    </div>
  );
}

/**
 * Asunto y cuerpo de un correo, con el menú «Insertar variable». La variable
 * entra donde estaba el cursor del último de los dos campos que se tocó.
 *
 * Con `onFormat`, el cuerpo se puede escribir como texto o como HTML propio.
 * Quien usa el componente hace el cambio (y decide qué pasa con lo ya escrito).
 * Con `previewHtml`, en HTML se puede alternar entre el código y cómo queda.
 */
export function EmailTextFields({
  subject,
  body,
  format = "text",
  onSubject,
  onBody,
  onFormat,
  previewHtml,
  bodyRows = 10,
  bodyPlaceholder,
}: {
  subject: string;
  body: string;
  format?: EmailFormat;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  onFormat?: (next: EmailFormat) => void;
  /** El HTML ya con las variables puestas, para verlo aquí mismo. */
  previewHtml?: string;
  bodyRows?: number;
  bodyPlaceholder?: string;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const last = useRef<"subject" | "body">("body");
  const [view, setView] = useState<"code" | "preview">("code");
  const { data: custom } = useQuery({ queryKey: ["custom-fields"], queryFn: fetchCustomFields, select: contactFieldsOnly });
  const html = format === "html";
  const previewing = html && previewHtml !== undefined && view === "preview";
  const warnings = useMemo(() => (html ? emailHtmlWarnings(body) : []), [html, body]);

  const openFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    // Un correo no pesa megas: algo así no es el HTML de un correo.
    if (file.size > 2 * 1024 * 1024) return void toast.error("Ese archivo pesa demasiado para ser un correo.");
    try {
      const text = (await file.text()).trim();
      if (text.length > EMAIL_MAX_HTML_CHARS) {
        return void toast.error(`Ese HTML tiene ${count(text.length)} caracteres y el tope es ${count(EMAIL_MAX_HTML_CHARS)}: Gmail recorta los correos tan largos.`);
      }
      onBody(text);
      setView("code");
    } catch {
      toast.error("No se pudo leer ese archivo.");
    }
  };

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
          <div className="mail-bodyhead__title">
            <label className="label" htmlFor="mail-body">
              Mensaje
            </label>
            {onFormat && (
              <div className="seg seg-sm" role="radiogroup" aria-label="Cómo se escribe el mensaje" data-mail-format={format}>
                <button type="button" role="radio" aria-checked={!html} className={html ? "" : "is-active"} onClick={() => onFormat("text")}>
                  Texto
                </button>
                <button type="button" role="radio" aria-checked={html} className={html ? "is-active" : ""} onClick={() => onFormat("html")} title="Pegar un diseño hecho en HTML">
                  HTML
                </button>
              </div>
            )}
          </div>
          <select
            className="field field-sm mail-varmenu"
            value=""
            aria-label="Insertar variable"
            disabled={previewing}
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
        {html && (
          <div className="mail-htmlbar">
            {previewHtml !== undefined && (
              <div className="seg seg-sm" role="tablist" aria-label="Qué ver del correo">
                <button type="button" role="tab" aria-selected={!previewing} onClick={() => setView("code")}>
                  Código
                </button>
                <button type="button" role="tab" aria-selected={previewing} onClick={() => setView("preview")} data-mail-view-preview>
                  Vista previa
                </button>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => void openFile(e.target.files?.[0])} data-mail-html-file />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              <NavIcon name="file" size={14} />
              Abrir archivo .html
            </button>
          </div>
        )}
        {previewing ? (
          body.trim() ? (
            <EmailHtmlFrame html={previewHtml ?? ""} className="mail-frame--field" />
          ) : (
            <p className="mail-frame mail-frame--field mail-frame--empty">Todavía no hay nada que ver: pega tu HTML en «Código».</p>
          )
        ) : (
          <textarea
            id="mail-body"
            ref={bodyRef}
            className={`field mail-body${html ? " is-code" : ""}`}
            rows={bodyRows}
            value={body}
            maxLength={html ? EMAIL_MAX_HTML_CHARS : EMAIL_MAX_TEXT_CHARS}
            placeholder={html ? "Pega aquí el HTML de tu correo, o ábrelo desde un archivo.\nLas imágenes tienen que estar publicadas en internet (dirección https)." : bodyPlaceholder}
            spellCheck={!html}
            onChange={(e) => onBody(e.target.value)}
            onFocus={() => (last.current = "body")}
            data-mail-body
          />
        )}
        {html && (
          <span className="mail-muted mail-count mail-htmlcount">
            {count(body.length)} de {count(EMAIL_MAX_HTML_CHARS)} caracteres
          </span>
        )}
        {warnings.map((w) => (
          <p key={w} className="mail-warn" role="status">
            {w}
          </p>
        ))}
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
 * `body` es texto o, con `format="html"`, el HTML propio ya con sus variables.
 */
export function EmailPreview({
  subject,
  body,
  format = "text",
  from,
  note,
}: {
  subject: string;
  body: string;
  format?: EmailFormat;
  from?: string;
  note?: string;
}) {
  return (
    <div className="mail-preview">
      <div className="mail-preview__meta">
        {from && <span className="mail-preview__from">{from}</span>}
        <strong className="mail-preview__subject">{subject.trim() || "(sin asunto)"}</strong>
      </div>
      {format === "html" ? (
        // HTML propio: nunca dentro de la página, siempre en su marco aislado.
        body.trim() ? (
          <EmailHtmlFrame html={body} />
        ) : (
          <div className="mail-preview__body">Tu diseño aparecerá aquí.</div>
        )
      ) : (
        // emailTextToHtml escapa todo lo que no sea su propio marcado.
        <div className="mail-preview__body" dangerouslySetInnerHTML={{ __html: emailTextToHtml(body) }} />
      )}
      {note && <p className="mail-preview__note">{note}</p>}
    </div>
  );
}
