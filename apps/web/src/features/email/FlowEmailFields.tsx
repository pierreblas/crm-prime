"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { EMAIL_ACCOUNT_ASSIGNEE, EMAIL_ACCOUNT_DEFAULT, type FlowNodeData } from "@crm/shared";
import { fetchEmailAccounts, fetchEmailTemplates } from "@/lib/bff";

/** Ajustes del bloque «Enviar correo» de un flujo: qué plantilla y por qué buzón. */
export function FlowEmailFields({ data, patch }: { data: FlowNodeData; patch: (p: Partial<FlowNodeData>) => void }) {
  const { data: templates } = useQuery({ queryKey: ["email-templates"], queryFn: fetchEmailTemplates });
  const { data: accounts } = useQuery({ queryKey: ["email-accounts"], queryFn: fetchEmailAccounts });
  const shared = (accounts ?? []).filter((a) => !a.owner);
  const personal = (accounts ?? []).filter((a) => a.owner);
  // Una plantilla o un buzón que ya no existen: se ve, en vez de quedar un desplegable en blanco.
  const lostTemplate = !!data.emailTemplateId && !!templates && !templates.some((t) => t.id === data.emailTemplateId);

  return (
    <div className="mail-flow">
      <label className="agenda-field">
        <span className="label">Plantilla de correo</span>
        <select
          className="field field-sm"
          value={data.emailTemplateId ?? ""}
          onChange={(e) => {
            const t = templates?.find((x) => x.id === e.target.value);
            patch({ emailTemplateId: e.target.value, emailTemplateName: t?.name ?? "" });
          }}
        >
          <option value="">Elige una plantilla…</option>
          {lostTemplate && <option value={data.emailTemplateId}>{data.emailTemplateName || "Plantilla"} (eliminada)</option>}
          {(templates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {templates && templates.length === 0 && (
        <p className="mail-flow__hint">
          Todavía no hay plantillas de correo. Se crean en <Link href="/difusiones">Difusiones › Plantillas de correo</Link>.
        </p>
      )}
      {lostTemplate && <p className="mail-warn">Esa plantilla se eliminó: elige otra o este bloque no enviará nada.</p>}

      <label className="agenda-field">
        <span className="label">Sale por</span>
        <select className="field field-sm" value={data.emailAccountId || EMAIL_ACCOUNT_DEFAULT} onChange={(e) => patch({ emailAccountId: e.target.value })}>
          <option value={EMAIL_ACCOUNT_DEFAULT}>El buzón de la empresa</option>
          <option value={EMAIL_ACCOUNT_ASSIGNEE}>El buzón del responsable del chat</option>
          {shared.length > 1 &&
            shared.map((a) => (
              <option key={a.id} value={a.id}>
                {a.address}
              </option>
            ))}
          {personal.map((a) => (
            <option key={a.id} value={a.id}>
              {a.address} ({a.owner!.name})
            </option>
          ))}
        </select>
      </label>
      {accounts && shared.length === 0 && (
        <p className="mail-warn">
          No hay un buzón compartido conectado: sin él, este bloque no puede enviar. Se conecta en{" "}
          <Link href="/settings?tab=email">Ajustes › Correo</Link>.
        </p>
      )}
      <p className="mail-flow__hint">
        Va al correo guardado del contacto, con enlace de baja. Si no tiene correo o se dio de baja, el flujo sigue y
        queda una nota en el chat. «El del responsable» usa su buzón personal y, si no tiene, el de la empresa.
      </p>
      <p className="mail-flow__hint">
        La plantilla puede usar las variables de este flujo por su nombre, por ejemplo <code>{"{{pedido}}"}</code>.
      </p>
    </div>
  );
}
