import type { CampaignAudience } from "@crm/shared";

/**
 * Para abrir el asistente de difusiones ya rellenado desde otra pantalla (el
 * embudo). Va por sessionStorage y no por la URL: una selección puede tener
 * miles de contactos.
 */
export type CampaignPreset = {
  name: string;
  audience: Partial<CampaignAudience>;
  /** Cómo se llama esta audiencia para el usuario («Etapa Propuesta», «12 seleccionadas»). */
  label: string;
};

const KEY = "driony.campaign-preset";

export function setCampaignPreset(p: CampaignPreset): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: el asistente se abrirá vacío */
  }
}

/** Lo lee y lo borra: solo sirve para la siguiente apertura. */
export function takeCampaignPreset(): CampaignPreset | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as CampaignPreset;
  } catch {
    return null;
  }
}
