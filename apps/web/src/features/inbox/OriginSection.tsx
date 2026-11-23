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
  // Si volvió por otra campaña: la que usan el agente y los flujos.
  const lastUtms = Object.entries(contact?.attribution.lastUtms ?? {});
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
        {lastUtms.length > 0 && <Utms label={t("inbox.originLastTime")} utms={lastUtms} last />}
        {utms.length > 0 && <Utms label={lastUtms.length > 0 ? t("inbox.originFirstTime") : null} utms={utms} />}
        {!ad && !first && !form && utms.length === 0 && (
          <p className="cp-empty">{contact ? contactOriginLabels[contact.origin] : "—"}</p>
        )}
      </div>
    </section>
  );
}

function Utms({ label, utms, last = false }: { label: string | null; utms: [string, string][]; last?: boolean }) {
  return (
    <div data-origin-utms={last ? "last" : "first"}>
      {label && <span className="origin__label">{label}</span>}
      <div className="origin__utms">
        {utms.map(([k, v]) => (
          <span key={k} className="origin__utm" title={k}>
            {k.replace("utm_", "")}: {v}
          </span>
        ))}
      </div>
    </div>
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
