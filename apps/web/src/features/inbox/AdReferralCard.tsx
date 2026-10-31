"use client";

import { useState } from "react";
import type { AdSummary } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";

/**
 * El anuncio de Meta que trajo el mensaje, encima del texto del cliente: lo
 * mismo que enseña WhatsApp Business en el primer mensaje tras el clic. Las
 * imágenes de Meta caducan con el tiempo; si ya no cargan, queda el texto.
 */
export function AdReferralCard({ ad }: { ad: AdSummary }) {
  const t = useT();
  const [imgOk, setImgOk] = useState(true);
  const img = ad.thumbnailUrl ?? ad.imageUrl;
  const label = ad.sourceType === "post" ? t("inbox.fromPost") : t("inbox.fromAd");

  return (
    <div className="ad-ref" data-ad-ref>
      {img && imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen externa de Meta, sin optimizar
        <img className="ad-ref__img" src={img} alt="" loading="lazy" onError={() => setImgOk(false)} />
      ) : (
        <span className="ad-ref__icon" aria-hidden="true">
          <NavIcon name="megaphone" size={16} />
        </span>
      )}
      <span className="ad-ref__text">
        <span className="ad-ref__label">{label}</span>
        {ad.headline && <strong className="ad-ref__headline">{ad.headline}</strong>}
        {ad.body && <span className="ad-ref__body">{ad.body}</span>}
        {ad.welcomeMessage && (
          <span className="ad-ref__welcome" title={t("inbox.adWelcomeHint")}>
            {t("inbox.adWelcome")}: «{ad.welcomeMessage}»
          </span>
        )}
        {ad.sourceUrl && (
          <a className="ad-ref__link" href={ad.sourceUrl} target="_blank" rel="noopener noreferrer">
            {t("inbox.viewAd")}
          </a>
        )}
      </span>
    </div>
  );
}
