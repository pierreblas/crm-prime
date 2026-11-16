"use client";

import { useState } from "react";
import type { PasswordResetLink } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";

/**
 * El enlace para elegir contraseña nueva, recién generado: se enseña una sola
 * vez (en la base solo queda su hash), con el mensaje listo para mandarlo por
 * WhatsApp. Lo usan Vendedores y la consola de plataforma.
 */
export function ResetLinkBox({ link, name, onClose }: { link: PasswordResetLink; name: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const until = new Date(link.expiresAt).toLocaleString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const message = `Hola${name ? ` ${name.split(" ")[0]}` : ""}: para elegir tu contraseña nueva abre este enlace. Vale hasta el ${until} y sirve una sola vez.\n${link.url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success("Mensaje copiado: pégalo en su chat");
    } catch {
      toast.error("No se pudo copiar: selecciona el enlace y cópialo a mano");
    }
  }

  return (
    <div className="reset-link" role="status" data-reset-link>
      <div className="reset-link__head">
        <NavIcon name="key" size={15} />
        <strong>Enlace para que {name ?? link.email} elija contraseña nueva</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar">
          <NavIcon name="x" size={14} />
        </button>
      </div>
      <p className="reset-link__text">
        Vale hasta el {until} y sirve una sola vez. Mándaselo tú (por WhatsApp, por ejemplo): solo se ve ahora. Si generas
        otro, este deja de servir.
      </p>
      <input className="reset-link__url" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace" />
      <div className="reset-link__actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void copy()} data-reset-copy>
          <NavIcon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copiado" : "Copiar mensaje"}
        </button>
        <a
          className="btn btn-ghost btn-sm"
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir en WhatsApp
        </a>
      </div>
    </div>
  );
}
