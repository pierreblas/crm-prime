"use client";

import { contactOriginLabels, type AdSummary, type ContactListItem } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";

/**
 * De dónde vino el cliente, en el panel de la bandeja: el anuncio de este chat
 * (el último clic), el primer anuncio que lo trajo si fue otro, el formulario
 * de Meta que llenó (con su campaña si Meta la dio) y los utm_* de un enlace.
 * Sin nada de eso, solo la vía por la que entró.
 */
export function OriginSection({ ad, contact }: { ad: AdSummary | null; contact: ContactListItem | null }) {
  const t = useT();
  const first = contact?.attribution.ad ?? null;
  const fields = contact?.fields ?? {};
  const form = fields.formulario;
  const utms = Object.entries(contact?.attribution.utms ?? {});
  const firstIsOther = !!first && (!ad || first.sourceId !== ad.sourceId);

  return (
    <section className="cp-section" data-origin>
      <div className="cp-section__title">{t("inbox.origin")}</div>
      <div className="origin">
        {ad && <AdLine label={t("inbox.originThisChat")} ad={ad} viewLabel={t("inbox.viewAd")} />}
        {firstIsOther && <AdLine label={t("inbox.originFirstAd")} ad={{ ...first!, sourceType: null }} viewLabel={t("inbox.viewAd")} />}
        {form && (
          <div className="origin__row">
            <NavIcon name="file" size={13} />
            <span>
              <span className="origin__label">{t("inbox.originForm")}</span>
              <strong>{form}</strong>
              {(fields.campana || fields.anuncio) && (
                <span className="origin__sub">
                  {[fields.campana && `${t("inbox.originCampaign")}: ${fields.campana}`, fields.anuncio && `${t("inbox.originAd")}: ${fields.anuncio}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </span>
          </div>
        )}
        {utms.length > 0 && (
          <div className="origin__utms">
            {utms.map(([k, v]) => (
              <span key={k} className="origin__utm" title={k}>
                {k.replace("utm_", "")}: {v}
              </span>
            ))}
          </div>
        )}
        {!ad && !first && !form && utms.length === 0 && (
          <p className="cp-empty">{contact ? contactOriginLabels[contact.origin] : "—"}</p>
        )}
      </div>
    </section>
  );
}

function AdLine({
  label,
  ad,
  viewLabel,
}: {
  label: string;
  ad: Pick<AdSummary, "headline" | "sourceId" | "sourceUrl" | "sourceType">;
  viewLabel: string;
}) {
  return (
    <div className="origin__row">
      <NavIcon name="megaphone" size={13} />
      <span>
        <span className="origin__label">{label}</span>
        <strong>{ad.headline || ad.sourceId || "—"}</strong>
        {ad.headline && ad.sourceId && <span className="origin__sub">ID {ad.sourceId}</span>}
        {ad.sourceUrl && (
          <a className="origin__link" href={ad.sourceUrl} target="_blank" rel="noopener noreferrer">
            {viewLabel}
          </a>
        )}
      </span>
    </div>
  );
}
