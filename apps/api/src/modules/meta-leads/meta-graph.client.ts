import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { MetaLeadField } from "@crm/shared";
import { IntegrationSettingsService } from "../integrations/integration-settings.service";
import { i18n } from "../../i18n/i18n";

// Llamadas a la Graph API para Lead Ads:
//   code            -> token de usuario (larga duración)
//   /me/accounts    -> páginas del usuario, con su token de página
//   /{page}/subscribed_apps?subscribed_fields=leadgen
//   /{leadgen_id}   -> respuestas del formulario
//
// META_GRAPH_URL permite apuntar a un servidor de pruebas; por defecto va a
// graph.facebook.com.

export interface MetaPageAccount {
  pageId: string;
  name: string;
  accessToken: string;
}

export interface MetaLeadDetail {
  leadgenId: string;
  formId: string | null;
  adId: string | null;
  createdTime: string | null;
  fields: MetaLeadField[];
}

@Injectable()
export class MetaGraphClient {
  private readonly logger = new Logger("MetaGraph");

  constructor(private readonly settings: IntegrationSettingsService) {}

  private get baseUrl(): string {
    return process.env.META_GRAPH_URL ?? "https://graph.facebook.com";
  }

  /**
   * Canjea el código del login por un token de usuario de larga duración.
   *
   * El código lo emite el SDK de JavaScript (FB.login con response_type
   * "code"). Meta exige que el redirect_uri del canje sea idéntico al del
   * diálogo, y el del SDK no es el de la página: según la variante del login
   * el canje vale sin redirect_uri (como el registro de WhatsApp), con uno
   * vacío, o con la URL de la ventana. Se prueban en ese orden y se deja en
   * el log cuál valió; si ninguno, el error exacto de Meta.
   */
  async exchangeCode(code: string, redirectUri?: string): Promise<string> {
    const { appId, appSecret, graphVersion } = await this.requireApp();
    const base =
      `${this.baseUrl}/${graphVersion}/oauth/access_token` +
      `?client_id=${appId}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
    const variants: Array<[string, string]> = [
      ["sin redirect_uri", ""],
      ["redirect_uri vacío", "&redirect_uri="],
      ...(redirectUri ? [[`redirect_uri=${redirectUri}`, `&redirect_uri=${encodeURIComponent(redirectUri)}`] as [string, string]] : []),
    ];
    let lastError = "";
    let shortLived: { access_token?: string } | null = null;
    for (const [label, suffix] of variants) {
      const res = await fetch(base + suffix);
      const data = (await res.json().catch(() => null)) as
        | { access_token?: string; error?: { message?: string; error_user_msg?: string; code?: number } }
        | null;
      if (res.ok && data?.access_token) {
        if (suffix) this.logger.log(`Canje del código de Facebook: valió ${label}`);
        shortLived = data;
        break;
      }
      lastError = data?.error?.error_user_msg ?? data?.error?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`Canje del código de Facebook (${label}) falló: ${lastError}`);
      // Un código solo se canjea una vez: si Meta dice que ya se usó o caducó, no hay más intentos que hacer.
      if (/already been used|expired/i.test(lastError)) break;
    }
    if (!shortLived?.access_token) {
      throw new BadRequestException(`No se pudo canjear el código de Facebook: ${lastError}`);
    }

    // El token corto caduca en horas; el largo dura ~60 días y de él salen
    // tokens de página que no caducan.
    const longLived = await this.getJson<{ access_token?: string }>(
      `${this.baseUrl}/${graphVersion}/oauth/access_token` +
        `?grant_type=fb_exchange_token&client_id=${appId}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(shortLived.access_token)}`,
      "alargar el token de Facebook",
    );
    return longLived.access_token ?? shortLived.access_token;
  }

  /**
   * Token corto del login en el navegador → token de usuario de larga duración.
   *
   * Antes se comprueba con debug_token que el token sea de NUESTRA app y
   * esté vivo: lo manda el navegador del administrador y no hay que fiarse
   * de él sin más. Luego se alarga (~60 días): de él salen los tokens de
   * página, que no caducan.
   */
  async tokenFromLogin(shortToken: string): Promise<string> {
    const { appId, appSecret, graphVersion } = await this.requireApp();
    const dbg = await this.getJson<{ data?: { app_id?: string | number; is_valid?: boolean } }>(
      `${this.baseUrl}/${graphVersion}/debug_token?input_token=${encodeURIComponent(shortToken)}` +
        `&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
      "comprobar el token de Facebook",
    );
    if (!dbg.data?.is_valid || String(dbg.data.app_id) !== String(appId)) {
      throw new BadRequestException("El token de Facebook no es de esta app o ya caducó. Vuelve a entrar con Facebook.");
    }
    const longLived = await this.getJson<{ access_token?: string }>(
      `${this.baseUrl}/${graphVersion}/oauth/access_token` +
        `?grant_type=fb_exchange_token&client_id=${appId}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(shortToken)}`,
      "alargar el token de Facebook",
    );
    return longLived.access_token ?? shortToken;
  }

  /** Páginas que administra el usuario, con el token de cada una. */
  async listPages(userToken: string): Promise<MetaPageAccount[]> {
    const { graphVersion } = await this.requireApp();
    const pages: MetaPageAccount[] = [];
    let url =
      `${this.baseUrl}/${graphVersion}/me/accounts` +
      `?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`;

    for (let page = 0; page < 10 && url; page++) {
      const data = await this.getJson<{
        data?: { id: string; name: string; access_token: string }[];
        paging?: { next?: string };
      }>(url, "leer tus páginas de Facebook");
      for (const p of data.data ?? []) {
        pages.push({ pageId: p.id, name: p.name, accessToken: p.access_token });
      }
      url = data.paging?.next ?? "";
    }
    return pages;
  }

  /** Suscribe la página al aviso de leads. Sin esto no llega ningún webhook. */
  async subscribePage(pageId: string, pageToken: string): Promise<void> {
    const { graphVersion } = await this.requireApp();
    const res = await fetch(
      `${this.baseUrl}/${graphVersion}/${pageId}/subscribed_apps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields: "leadgen",
          access_token: pageToken,
        }),
      },
    );
    const data = (await res.json().catch(() => null)) as {
      success?: boolean;
      error?: { message?: string };
    } | null;
    if (!res.ok || data?.success === false) {
      throw new BadRequestException(
        i18n("meta.subscribeFailed", { reason: data?.error?.message ?? `HTTP ${res.status}` }),
      );
    }
  }

  async unsubscribePage(pageId: string, pageToken: string): Promise<void> {
    const { graphVersion } = await this.requireApp();
    await fetch(
      `${this.baseUrl}/${graphVersion}/${pageId}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`,
      { method: "DELETE" },
    ).catch(() => undefined);
  }

  /** Respuestas de un lead concreto. Requiere el token de su página. */
  async getLead(leadgenId: string, pageToken: string): Promise<MetaLeadDetail> {
    const { graphVersion } = await this.requireApp();
    const data = await this.getJson<{
      id?: string;
      created_time?: string;
      ad_id?: string;
      form_id?: string;
      field_data?: { name: string; values?: string[] }[];
    }>(
      `${this.baseUrl}/${graphVersion}/${leadgenId}` +
        `?fields=id,created_time,ad_id,form_id,field_data&access_token=${encodeURIComponent(pageToken)}`,
      "leer el lead en Meta",
    );

    return {
      leadgenId: data.id ?? leadgenId,
      formId: data.form_id ?? null,
      adId: data.ad_id ?? null,
      createdTime: data.created_time ?? null,
      fields: (data.field_data ?? []).map((f) => ({
        name: f.name,
        value: (f.values ?? []).join(", "),
      })),
    };
  }

  /** Nombre del formulario, solo para mostrarlo en el CRM. */
  async getFormName(formId: string, pageToken: string): Promise<string | null> {
    const { graphVersion } = await this.requireApp();
    try {
      const data = await this.getJson<{ name?: string }>(
        `${this.baseUrl}/${graphVersion}/${formId}?fields=name&access_token=${encodeURIComponent(pageToken)}`,
        "leer el formulario",
      );
      return data.name ?? null;
    } catch {
      return null;
    }
  }

  private async getJson<T>(url: string, what: string): Promise<T> {
    const res = await fetch(url);
    const data = (await res.json().catch(() => null)) as
      | (T & { error?: { message?: string; error_user_msg?: string } })
      | null;
    if (!res.ok || !data) {
      const msg =
        data?.error?.error_user_msg ?? data?.error?.message ?? `HTTP ${res.status}`;
      this.logger.error(i18n("meta.requestFailed", { what, reason: msg }));
      throw new BadRequestException(`No se pudo ${what}: ${msg}`);
    }
    return data;
  }

  private async requireApp() {
    const app = await this.settings.whatsappApp();
    if (!app.appId || !app.appSecret) {
      throw new BadRequestException(
        "Faltan el App ID y el App secret de Meta. Configúralos en Ajustes › Integraciones.",
      );
    }
    return {
      appId: app.appId,
      appSecret: app.appSecret,
      graphVersion: app.graphVersion,
    };
  }
}
