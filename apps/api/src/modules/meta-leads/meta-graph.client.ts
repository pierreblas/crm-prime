import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { MetaLeadField } from "@crm/shared";
import { IntegrationSettingsService } from "../integrations/integration-settings.service";
import { i18n } from "../../i18n/i18n";

// Llamadas a la Graph API para Lead Ads:
//   code            -> token de usuario (larga duración)
//   /me/accounts    -> páginas del usuario, con su token de página
//   /{page}/subscribed_apps?subscribed_fields=leadgen
//   /{leadgen_id}   -> respuestas del formulario
//   /{form_id}?fields=questions -> preguntas del formulario
//   /{form_id}/leads -> los leads que Meta guarda del formulario (90 días)
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

  /**
   * Suscribe la página a los avisos indicados (leads y, si la empresa encendió
   * Messenger o Instagram, los de mensajes). Sin esto no llega ningún webhook.
   * Meta reemplaza la lista entera en cada llamada: hay que mandar siempre todo.
   */
  async subscribePage(pageId: string, pageToken: string, fields: readonly string[] = ["leadgen"]): Promise<void> {
    const { graphVersion } = await this.requireApp();
    const res = await fetch(
      `${this.baseUrl}/${graphVersion}/${pageId}/subscribed_apps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields: fields.join(","),
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

  /**
   * La cuenta profesional de Instagram vinculada a la página, si la hay y el
   * permiso (instagram_basic) lo deja. Es la que recibe los mensajes directos.
   */
  async pageInstagram(pageId: string, pageToken: string): Promise<{ id: string; username: string | null } | null> {
    const { graphVersion } = await this.requireApp();
    const res = await fetch(
      `${this.baseUrl}/${graphVersion}/${pageId}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(pageToken)}`,
    );
    if (!res.ok) return this.denied(res, "leer la cuenta de Instagram de la página");
    const data = (await res.json().catch(() => null)) as { instagram_business_account?: { id?: string | number; username?: string } } | null;
    const ig = data?.instagram_business_account;
    return ig?.id ? { id: String(ig.id), username: ig.username ?? null } : null;
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

  /**
   * Anuncio, campaña y plataforma del lead. Llamada aparte y sin errores: según
   * los permisos del token de la página, Meta puede negar estos campos, y eso
   * no debe impedir guardar el lead. null si no los da.
   */
  async getLeadAdInfo(
    leadgenId: string,
    pageToken: string,
  ): Promise<{ adName: string | null; campaignName: string | null; platform: string | null } | null> {
    try {
      const { graphVersion } = await this.requireApp();
      const res = await fetch(
        `${this.baseUrl}/${graphVersion}/${leadgenId}` +
          `?fields=ad_name,campaign_name,platform&access_token=${encodeURIComponent(pageToken)}`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { ad_name?: string; campaign_name?: string; platform?: string };
      return { adName: data.ad_name ?? null, campaignName: data.campaign_name ?? null, platform: data.platform ?? null };
    } catch {
      return null;
    }
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

  /**
   * Los formularios de la página. Meta puede negarlo según los permisos del
   * token (pide pages_manage_ads, que las páginas conectadas antes de pedirlo
   * no tienen hasta volver a conectarlas): null entonces, sin error, y el CRM
   * se queda con los formularios de los que ya llegó algún lead.
   */
  async listForms(
    pageId: string,
    pageToken: string,
  ): Promise<{ id: string; name: string; status: string | null }[] | null> {
    try {
      const { graphVersion } = await this.requireApp();
      const res = await fetch(
        `${this.baseUrl}/${graphVersion}/${pageId}/leadgen_forms` +
          `?fields=id,name,status&limit=200&access_token=${encodeURIComponent(pageToken)}`,
      );
      if (!res.ok) return this.denied(res, `listar los formularios de la página ${pageId}`);
      const data = (await res.json()) as { data?: { id: string; name?: string; status?: string }[] };
      return (data.data ?? []).map((f) => ({ id: f.id, name: f.name ?? f.id, status: f.status ?? null }));
    } catch {
      return null;
    }
  }

  /**
   * Las preguntas del formulario (clave con la que llegan en los leads y su
   * texto). Como listForms: null si Meta no lo deja con este token.
   */
  async getFormQuestions(
    formId: string,
    pageToken: string,
  ): Promise<{ key: string; label: string; type: string | null; options: string[] }[] | null> {
    try {
      const { graphVersion } = await this.requireApp();
      const res = await fetch(
        `${this.baseUrl}/${graphVersion}/${formId}?fields=questions&access_token=${encodeURIComponent(pageToken)}`,
      );
      if (!res.ok) return this.denied(res, `leer las preguntas del formulario ${formId}`);
      const data = (await res.json()) as {
        questions?: { key?: string; label?: string; type?: string; options?: { key?: string; value?: string }[] }[];
      };
      return (data.questions ?? [])
        .filter((q) => q.key)
        .map((q) => ({
          key: q.key!,
          label: q.label || q.key!,
          type: q.type ?? null,
          options: (q.options ?? []).map((o) => o.value ?? o.key ?? "").filter(Boolean),
        }));
    } catch {
      return null;
    }
  }

  /**
   * Los leads que Meta todavía guarda de un formulario (los de los últimos 90
   * días), solo id y fecha: cada uno se lee después por su id, como los que
   * llegan por webhook. Aquí sí se avisa del error: lo pide una persona.
   */
  async listFormLeads(formId: string, pageToken: string, max = 5000): Promise<{ id: string; createdTime: string | null }[]> {
    const { graphVersion } = await this.requireApp();
    const out: { id: string; createdTime: string | null }[] = [];
    let url: string | null =
      `${this.baseUrl}/${graphVersion}/${formId}/leads?fields=id,created_time&limit=100&access_token=${encodeURIComponent(pageToken)}`;
    while (url && out.length < max) {
      const data: { data?: { id: string; created_time?: string }[]; paging?: { next?: string } } = await this.getJson(
        url,
        "leer los leads del formulario en Meta",
      );
      for (const l of data.data ?? []) out.push({ id: String(l.id), createdTime: l.created_time ?? null });
      url = data.paging?.next ?? null;
    }
    return out;
  }

  /** Deja en el log por qué Meta negó una lectura opcional (casi siempre, un permiso) y sigue sin ella. */
  private async denied(res: Response, what: string): Promise<null> {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    this.logger.warn(`Meta no deja ${what}: ${data?.error?.message ?? `HTTP ${res.status}`}`);
    return null;
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
