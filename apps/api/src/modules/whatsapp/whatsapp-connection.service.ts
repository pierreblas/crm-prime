import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  ChannelTestResult,
  ConnectWhatsappInput,
  UpdateChannelInput,
  WhatsappChannel,
  WhatsappConnectionStatus,
  ChannelCheck,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runUnscoped, tenancyMode } from "../../infra/tenant/tenant.context";
import { IntegrationSettingsService } from "../integrations/integration-settings.service";
import { PlansService } from "../plans/plans.service";

/** Un número tal como lo lista la Graph API dentro de una WABA. */
export interface GraphPhoneNumber {
  id: string;
  display_phone_number?: string;
  /** Coexistencia: el número sigue también en la app WhatsApp Business del celular. */
  is_on_biz_app?: boolean;
  platform_type?: string;
}

/**
 * Qué número de la WABA es el recién registrado. Con uno solo, ese. Con
 * varios y coexistencia, el último que está en la app del celular (Meta
 * añade al final). Si no, el primero. Exportada para probarla sin Meta.
 */
export function pickPhoneNumber(list: GraphPhoneNumber[], mode: string): GraphPhoneNumber | null {
  if (!list.length) return null;
  if (list.length === 1) return list[0]!;
  if (mode === "coexistence") {
    const onApp = list.filter((p) => p.is_on_biz_app);
    if (onApp.length) return onApp[onApp.length - 1]!;
  }
  return list[0]!;
}

export interface WhatsappCreds {
  token: string;
  phoneNumberId: string;
  version: string;
}

@Injectable()
export class WhatsappConnectionService {
  private readonly logger = new Logger("WhatsAppConnection");
  // Graph API v24.0 (octubre de 2025, disponible hasta febrero de 2028).
  private readonly version = process.env.WHATSAPP_GRAPH_VERSION ?? "v24.0";

  constructor(
    private readonly plans: PlansService,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly settings: IntegrationSettingsService,
  ) {}

  // ── Resolución de credenciales para enviar ───────────────────
  /**
   * Credenciales para enviar.
   * - Si se indica `phoneNumberId`, usa ese canal concreto (responder por el
   *   mismo número por el que entró la conversación).
   * - Si no, cae al primer canal activo o, en su defecto, al .env.
   */
  async resolveCreds(phoneNumberId?: string): Promise<WhatsappCreds | null> {
    if (phoneNumberId) {
      const conn = await this.prisma.whatsappConnection.findFirst({
        where: { phoneNumberId, isActive: true },
      });
      if (conn?.accessToken) {
        return {
          token: conn.accessToken,
          phoneNumberId: conn.phoneNumberId,
          version: this.version,
        };
      }
      // El número pedido es el del .env. Solo con una empresa: en SaaS el
      // .env es de la plataforma y ningún cliente envía con él.
      if (
        tenancyMode !== "multi" &&
        phoneNumberId === process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_TOKEN
      ) {
        return {
          token: process.env.WHATSAPP_TOKEN,
          phoneNumberId,
          version: this.version,
        };
      }
      return null;
    }

    // Sin número específico: primer canal activo o .env.
    const conn = await this.prisma.whatsappConnection.findFirst({
      where: { isActive: true },
      orderBy: { connectedAt: "desc" },
    });
    if (conn?.accessToken && conn.phoneNumberId) {
      return {
        token: conn.accessToken,
        phoneNumberId: conn.phoneNumberId,
        version: this.version,
      };
    }
    const envToken = process.env.WHATSAPP_TOKEN;
    const envPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (tenancyMode !== "multi" && envToken && envPhone) {
      return { token: envToken, phoneNumberId: envPhone, version: this.version };
    }
    return null;
  }

  /**
   * Credenciales de la cuenta de WhatsApp Business (WABA), que es donde viven
   * las plantillas. Usa el canal indicado o el primero activo que tenga WABA.
   */
  async resolveWabaCreds(
    phoneNumberId?: string,
  ): Promise<{ wabaId: string; token: string; version: string } | null> {
    const conn = await this.prisma.whatsappConnection.findFirst({
      where: {
        isActive: true,
        wabaId: { not: null },
        ...(phoneNumberId ? { phoneNumberId } : {}),
      },
      orderBy: { connectedAt: "desc" },
    });
    if (conn?.wabaId && conn.accessToken) {
      return {
        wabaId: conn.wabaId,
        token: conn.accessToken,
        version: this.version,
      };
    }
    const envWaba = process.env.WHATSAPP_WABA_ID;
    const envToken = process.env.WHATSAPP_TOKEN;
    if (envWaba && envToken) {
      return { wabaId: envWaba, token: envToken, version: this.version };
    }
    return null;
  }

  /**
   * Resuelve el id de la conexión (canal) a partir del phone_number_id que
   * Meta envía en el webhook. Devuelve null si es el del .env o no se conoce.
   */
  /**
   * De qué canal —y de qué organización— es un `phone_number_id` de Meta.
   *
   * El webhook de WhatsApp es el único punto de entrada que no trae un JWT:
   * Meta no sabe nada de nuestras organizaciones. El número que recibió el
   * mensaje es lo único que permite saber de quién es, y por eso
   * `phoneNumberId` sigue siendo único de forma global y no por organización.
   *
   * La consulta es deliberadamente sin filtrar por organización: es el único
   * sitio del CRM donde eso es correcto.
   */
  /**
   * De qué organización es una WhatsApp Business Account.
   *
   * Hace falta para los eventos que llegan a nivel de WABA y no de número —el
   * estado de una plantilla, por ejemplo—, donde Meta no manda
   * `phone_number_id`. Se coge el primer canal de esa WABA: todos pertenecen a
   * la misma empresa, que es lo único que se está preguntando.
   */
  async resolveOrgByWaba(wabaId: string): Promise<{ orgId: string } | null> {
    return runUnscoped("webhook: resolver empresa por wabaId", () =>
      this.prisma.whatsappConnection.findFirst({
        where: { wabaId },
        select: { orgId: true },
      }),
    );
  }

  async resolveChannel(
    phoneNumberId: string,
  ): Promise<{ id: string; orgId: string } | null> {
    // Agujero 2/4: esta consulta produce el orgId, así que no puede usarlo.
    return runUnscoped("webhook: resolver empresa por phone_number_id", () =>
      this.prisma.whatsappConnection.findUnique({
        where: { phoneNumberId },
        select: { id: true, orgId: true },
      }),
    );
  }

  /**
   * Configuración del número desde su ficha: alias, embudo de entrada y agente
   * de IA. El agente se ata al número (y se suelta del que tuviera): un bot
   * atiende un solo número, y un número lo atiende un solo bot.
   */
  async updateChannel(id: string, input: UpdateChannelInput): Promise<WhatsappChannel[]> {
    const existing = await this.prisma.whatsappConnection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Número no encontrado");
    if (input.pipelineId) {
      const p = await this.prisma.pipeline.findUnique({ where: { id: input.pipelineId }, select: { id: true } });
      if (!p) throw new BadRequestException("Embudo no encontrado");
    }
    await this.prisma.whatsappConnection.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label?.trim() || null } : {}),
        ...(input.pipelineId !== undefined ? { pipelineId: input.pipelineId } : {}),
      },
    });
    if (input.botId !== undefined) {
      await this.prisma.agentConfig.updateMany({ where: { channelId: id }, data: { channelId: null } });
      if (input.botId) {
        const bot = await this.prisma.agentConfig.findUnique({ where: { id: input.botId }, select: { id: true } });
        if (!bot) throw new BadRequestException("Agente no encontrado");
        await this.prisma.agentConfig.update({ where: { id: bot.id }, data: { channelId: id } });
      }
    }
    return this.listChannels();
  }

  // ── Listado de canales (multi-número) ────────────────────────
  async listChannels(): Promise<WhatsappChannel[]> {
    const rows = await this.prisma.whatsappConnection.findMany({
      orderBy: { connectedAt: "desc" },
      include: { bot: { select: { id: true, name: true } } },
    });
    const channels: WhatsappChannel[] = rows.map((c) => ({
      id: c.id,
      phoneNumberId: c.phoneNumberId,
      displayPhoneNumber: c.displayPhoneNumber,
      label: c.label,
      wabaId: c.wabaId,
      mode: c.mode,
      status: c.status,
      statusReason: c.statusReason,
      source: "embedded",
      isActive: c.isActive,
      connectedAt: c.connectedAt.toISOString(),
      pipelineId: c.pipelineId,
      bot: c.bot ? { id: c.bot.id, name: c.bot.name } : null,
    }));

    // El número del .env aparece como canal extra si no está ya en la BD.
    const envPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const envToken = process.env.WHATSAPP_TOKEN;
    if (
      envPhone &&
      envToken &&
      !rows.some((r) => r.phoneNumberId === envPhone)
    ) {
      channels.push({
        statusReason: null,
        pipelineId: null,
        bot: null,
        id: "env",
        phoneNumberId: envPhone,
        displayPhoneNumber: null,
        label: ".env",
        wabaId: null,
        mode: "api",
        status: "connected",
        source: "env",
        isActive: true,
        connectedAt: null,
      });
    }
    return channels;
  }

  // ── Estado agregado (compatibilidad) ─────────────────────────
  async status(): Promise<WhatsappConnectionStatus> {
    const conn = await this.prisma.whatsappConnection.findFirst({
      where: { isActive: true },
      orderBy: { connectedAt: "desc" },
    });
    if (conn) {
      return {
        connected: true,
        phoneNumberId: conn.phoneNumberId,
        displayPhoneNumber: conn.displayPhoneNumber,
        wabaId: conn.wabaId,
        mode: conn.mode,
        source: "embedded",
      };
    }
    const envToken = process.env.WHATSAPP_TOKEN;
    const envPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (tenancyMode !== "multi" && envToken && envPhone) {
      return {
        connected: true,
        phoneNumberId: envPhone,
        displayPhoneNumber: null,
        wabaId: null,
        mode: "api",
        source: "env",
      };
    }
    return {
      connected: false,
      phoneNumberId: null,
      displayPhoneNumber: null,
      wabaId: null,
      mode: null,
      source: null,
    };
  }

  // ── Conectar un número (desde el Embedded Signup) ────────────
  async connect(input: ConnectWhatsappInput): Promise<WhatsappChannel[]> {
    const token = input.code
      ? await this.exchangeCode(input.code)
      : input.accessToken!;

    // En coexistencia Meta no devuelve el número al terminar, solo la cuenta
    // (WABA): se busca ahí el que acaba de registrarse.
    let phoneNumberId = input.phoneNumberId;
    let displayPhoneNumber = input.displayPhoneNumber;
    if (!phoneNumberId) {
      if (!input.wabaId) {
        throw new BadRequestException(
          "Meta no devolvió ni el número ni la cuenta de WhatsApp. Vuelve a conectar.",
        );
      }
      const found = await this.findPhoneNumber(input.wabaId, token, input.mode);
      phoneNumberId = found.id;
      displayPhoneNumber ??= found.display_phone_number;
    }

    // Plan: reconectar un número que ya está no cuenta; uno nuevo sí. La
    // coexistencia (seguir usando el celular) es una característica de plan.
    const yaConectado = await this.prisma.whatsappConnection.findFirst({
      where: { phoneNumberId },
      select: { isActive: true },
    });
    if (!yaConectado?.isActive) await this.plans.assertCanAdd("numbers");
    if (input.mode === "coexistence") await this.plans.assertFeature("coexistence");

    // Lo pedido puede no ser lo que Meta dejó: si el número no quedó también
    // en la app del celular, se guarda como API para no mentir en el panel.
    let mode: ConnectWhatsappInput["mode"] = input.mode;
    if (mode === "coexistence" && input.code) {
      const onBizApp = await this.isOnBizApp(phoneNumberId, token);
      if (onBizApp === false) {
        this.logger.warn(
          `Número ${phoneNumberId} no quedó en la app del celular: se guarda en modo API`,
        );
        mode = "api";
      }
    }

    // Upsert por phoneNumberId: reconectar el mismo número actualiza su token
    // sin tocar a los demás canales (ya no se desactiva nada).
    await this.prisma.whatsappConnection.upsert({
      where: { phoneNumberId: phoneNumberId },
      create: {
        orgId: this.tenant.orgId(),
        wabaId: input.wabaId ?? null,
        phoneNumberId: phoneNumberId,
        displayPhoneNumber: displayPhoneNumber ?? null,
        label: input.label ?? null,
        accessToken: token,
        mode: mode,
        isActive: true,
        status: "connected",
      },
      update: {
        wabaId: input.wabaId ?? undefined,
        displayPhoneNumber: displayPhoneNumber ?? undefined,
        label: input.label ?? undefined,
        accessToken: token,
        mode: mode,
        isActive: true,
        status: "connected",
        statusReason: null,
      },
    }).catch((e: { code?: string }) => {
      // La extensión acota el upsert a la empresa en curso: si el número es
      // de otra, no encuentra la fila y pasa a crear, y el índice único global
      // de phoneNumberId lo rechaza. Sin esto el usuario vería un 500 opaco.
      if (e.code === "P2002") {
        throw new ConflictException(
          "Ese número de WhatsApp ya está conectado en otra empresa",
        );
      }
      throw e;
    });
    this.logger.log(`WhatsApp conectado (${mode}) ${phoneNumberId}`);

    // Sin suscribir la app a la WABA, Meta no entrega los webhooks de ese número.
    if (input.wabaId) {
      const err = await this.graphPost(`${input.wabaId}/subscribed_apps`, token);
      if (err) {
        await this.markError(
          phoneNumberId,
          `No se pudo suscribir la app a los webhooks de la WABA: ${err}`,
        );
      }
    } else if (input.code) {
      await this.markError(
        phoneNumberId,
        "Meta no envió el waba_id, así que no se suscribió a los webhooks. Vuelve a conectar el número.",
      );
    }

    // Contactos e historial del celular: Meta solo acepta pedirlos en las 24 h
    // siguientes a conectar, y una sola vez (al reconectar fallan sin más).
    if (mode === "coexistence") {
      for (const syncType of ["smb_app_state_sync", "history"]) {
        const err = await this.graphPost(
          `${phoneNumberId}/smb_app_data`,
          token,
          { messaging_product: "whatsapp", sync_type: syncType },
        );
        if (err) {
          this.logger.warn(
            `Sincronización ${syncType} de ${phoneNumberId} falló: ${err}`,
          );
        }
      }
    }

    return this.listChannels();
  }

  private lastWebhookCheck(lastWebhookAt: string | null): ChannelCheck {
    return {
      key: "webhook",
      label: "Último evento recibido de Meta",
      ok: lastWebhookAt ? true : null,
      detail: lastWebhookAt
        ? `hace ${Math.max(1, Math.round((Date.now() - new Date(lastWebhookAt).getTime()) / 60_000))} min`
        : "nunca: Meta no ha enviado ningún evento de este número a este servidor",
    };
  }

  /** GET a la Graph API: el JSON, o el mensaje de error de Meta. */
  private async graphGet<T extends object>(
    path: string,
    token: string,
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
      const res = await fetch(`https://graph.facebook.com/${this.version}/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => null)) as
        | (T & { error?: { message?: string } })
        | null;
      if (!res.ok || !data || data.error) {
        return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` };
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 200) };
    }
  }

  /**
   * El número que acaba de registrarse en una WABA. Con varios, en
   * coexistencia manda el que está en la app del celular; si no, el primero.
   */
  private async findPhoneNumber(
    wabaId: string,
    token: string,
    mode: string,
  ): Promise<GraphPhoneNumber> {
    const r = await this.graphGet<{ data?: GraphPhoneNumber[] }>(
      `${wabaId}/phone_numbers?fields=id,display_phone_number,is_on_biz_app,platform_type`,
      token,
    );
    if (!r.ok) {
      throw new BadRequestException(
        `No se pudieron leer los números de la cuenta de WhatsApp: ${r.error}`,
      );
    }
    const pick = pickPhoneNumber(r.data.data ?? [], mode);
    if (!pick) {
      throw new BadRequestException(
        "La cuenta de WhatsApp no tiene ningún número. Vuelve a conectar y termina el registro con un número.",
      );
    }
    this.logger.log(
      `Número resuelto desde la WABA ${wabaId}: ${pick.id} (${pick.display_phone_number ?? "sin formato"})`,
    );
    return pick;
  }

  /** Si el número sigue en la app del celular; null si Meta no lo dice. */
  private async isOnBizApp(phoneNumberId: string, token: string): Promise<boolean | null> {
    const r = await this.graphGet<{ is_on_biz_app?: boolean; platform_type?: string }>(
      `${phoneNumberId}?fields=is_on_biz_app,platform_type`,
      token,
    );
    if (!r.ok || typeof r.data.is_on_biz_app !== "boolean") return null;
    return r.data.is_on_biz_app;
  }

  /** POST a la Graph API. Devuelve el mensaje de error de Meta, o null si fue bien. */
  private async graphPost(
    path: string,
    token: string,
    body?: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      const res = await fetch(`https://graph.facebook.com/${this.version}/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return null;
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      return data?.error?.message ?? `HTTP ${res.status}`;
    } catch (e) {
      return (e as Error).message.slice(0, 200);
    }
  }

  /**
   * Marca un canal como caído. Se llama cuando Meta rechaza el token
   * (OAuthException 190): sin esto el canal seguía figurando "conectado" y
   * los envíos fallaban en silencio, solo visibles en el log.
   */
  async markError(phoneNumberId: string, reason: string): Promise<void> {
    await this.prisma.whatsappConnection
      .updateMany({
        where: { phoneNumberId },
        data: { status: "error", statusReason: reason.slice(0, 300) },
      })
      .catch(() => undefined);
    this.logger.error(`Canal ${phoneNumberId} en error: ${reason}`);
  }

  /** Comprueba contra Meta que el token del canal sigue sirviendo. */
  /**
   * Diagnóstico de un número, de fuera adentro: ¿vale el token?, ¿está el
   * número en la API (y en el celular, si es coexistencia)?, ¿está la cuenta
   * suscrita a nuestra app?, ¿tiene la app el webhook y los campos?, y ¿ha
   * llegado algún evento? Cada paso dice qué falta, para no adivinar.
   */
  async testChannel(phoneNumberId: string): Promise<ChannelTestResult> {
    const creds = await this.resolveCreds(phoneNumberId);
    const conn = await this.prisma.whatsappConnection.findFirst({
      where: { phoneNumberId },
      select: { wabaId: true, mode: true, lastWebhookAt: true },
    });
    const lastWebhookAt = conn?.lastWebhookAt?.toISOString() ?? null;
    if (!creds) {
      return { ok: false, message: "El canal no tiene credenciales configuradas.", displayPhoneNumber: null, checks: [], lastWebhookAt };
    }
    const checks: ChannelCheck[] = [];
    const coex = conn?.mode === "coexistence";

    // 1. Token y datos del número.
    const info = await this.graphGet<{
      display_phone_number?: string;
      verified_name?: string;
      platform_type?: string;
      is_on_biz_app?: boolean;
    }>(`${creds.phoneNumberId}?fields=display_phone_number,verified_name,platform_type,is_on_biz_app`, creds.token);
    if (!info.ok) {
      await this.markError(phoneNumberId, info.error);
      checks.push({ key: "token", label: "Token de acceso", ok: false, detail: info.error });
      checks.push(this.lastWebhookCheck(lastWebhookAt));
      return { ok: false, message: info.error, displayPhoneNumber: null, checks, lastWebhookAt };
    }
    await this.prisma.whatsappConnection
      .updateMany({ where: { phoneNumberId }, data: { status: "connected", statusReason: null } })
      .catch(() => undefined);
    checks.push({ key: "token", label: "Token de acceso", ok: true, detail: info.data.verified_name ?? "sin nombre verificado" });

    // 2. Plataforma: el número tiene que estar en la Cloud API (y en el celular, si es coexistencia).
    const onApi = info.data.platform_type === "CLOUD_API";
    const onApp = info.data.is_on_biz_app === true;
    checks.push({
      key: "platform",
      label: coex ? "Número en la API y en la app del celular" : "Número en la API de WhatsApp",
      ok: coex ? onApi && onApp : onApi,
      detail: `plataforma: ${info.data.platform_type ?? "desconocida"}${coex ? ` · app del celular: ${onApp ? "sí" : "no"}` : ""}${!onApi ? " · hasta que Meta lo pase a CLOUD_API no llegan mensajes" : ""}`,
    });

    // 3. La cuenta de WhatsApp Business (WABA) suscrita a nuestra app: sin esto Meta no manda webhooks de ese número.
    const app = await this.settings.whatsappApp();
    if (conn?.wabaId) {
      const subs = await this.graphGet<{ data?: { id?: string; name?: string }[] }>(`${conn.wabaId}/subscribed_apps`, creds.token);
      let ok: boolean | null = null;
      let detail: string;
      if (subs.ok) {
        const apps = subs.data.data ?? [];
        ok = app.appId ? apps.some((a) => a.id === app.appId) : apps.length > 0;
        detail = apps.length ? `apps suscritas: ${apps.map((a) => a.name ?? a.id).join(", ")}` : "ninguna app suscrita";
        if (!ok) {
          const err = await this.graphPost(`${conn.wabaId}/subscribed_apps`, creds.token);
          if (!err) {
            ok = true;
            detail = "no estaba suscrita: suscrita ahora mismo";
          } else detail += ` · no se pudo suscribir: ${err}`;
        }
      } else detail = `no se pudo consultar: ${subs.error}`;
      checks.push({ key: "waba", label: "Cuenta de WhatsApp suscrita a la app", ok, detail });
    } else {
      checks.push({ key: "waba", label: "Cuenta de WhatsApp suscrita a la app", ok: null, detail: "este número no tiene WABA guardada: vuelve a conectarlo" });
    }

    // 4. El webhook de la app en Meta: URL y campos. Se lee con el token de app (id|secreto).
    if (app.appId && app.appSecret) {
      const subs = await this.graphGet<{
        data?: { object?: string; callback_url?: string; active?: boolean; fields?: { name?: string }[] }[];
      }>(`${app.appId}/subscriptions`, `${app.appId}|${app.appSecret}`);
      if (subs.ok) {
        const wa = (subs.data.data ?? []).find((s) => s.object === "whatsapp_business_account");
        const fields = (wa?.fields ?? []).map((f) => f.name ?? "").filter(Boolean);
        const required = ["messages", ...(coex ? ["smb_message_echoes", "smb_app_state_sync", "history"] : [])];
        const missing = required.filter((f) => !fields.includes(f));
        const url = wa?.callback_url ?? null;
        const urlOk = !!url && (url.includes("/whatsapp/webhook") || url.includes("/webhooks/whatsapp"));
        checks.push({
          key: "app",
          label: "Webhook de la app en Meta",
          ok: !!wa?.active && urlOk && missing.length === 0,
          detail: `URL: ${url ?? "sin configurar"}${url && !urlOk ? " (no apunta a Driony)" : ""} · campos: ${fields.join(", ") || "ninguno"}${missing.length ? ` · faltan: ${missing.join(", ")}` : ""}`,
        });
      } else {
        checks.push({ key: "app", label: "Webhook de la app en Meta", ok: null, detail: `no se pudo leer: ${subs.error}` });
      }
    } else {
      checks.push({ key: "app", label: "Webhook de la app en Meta", ok: null, detail: "sin id o secreto de la app en el servidor: no se puede comprobar" });
    }

    // 5. ¿Ha llegado algo? Separa «Meta no envía» de «llega y no se procesa».
    checks.push(this.lastWebhookCheck(lastWebhookAt));

    const failing = checks.find((c) => c.ok === false);
    return {
      ok: !failing,
      message: failing ? `Falla: ${failing.label.toLowerCase()}` : `Todo en orden · ${info.data.verified_name ?? "sin nombre verificado"}`,
      displayPhoneNumber: info.data.display_phone_number ?? null,
      checks,
      lastWebhookAt,
    };
  }

  // ── Desconectar un número concreto ───────────────────────────
  async disconnect(phoneNumberId: string): Promise<WhatsappChannel[]> {
    await this.prisma.whatsappConnection.updateMany({
      where: { phoneNumberId },
      data: { isActive: false, status: "disconnected" },
    });
    this.logger.log(`WhatsApp desconectado ${phoneNumberId}`);
    return this.listChannels();
  }

  // Canjea el code del Embedded Signup por un token de acceso.
  private async exchangeCode(code: string): Promise<string> {
    // App ID y secret salen de Ajustes › Integraciones (respaldo en .env).
    const { appId, appSecret, graphVersion } = await this.settings.whatsappApp();
    if (!appId || !appSecret) {
      throw new BadRequestException(
        "Faltan el App ID o el App secret de Meta. Configúralos en Ajustes › Integraciones.",
      );
    }
    const url =
      `https://graph.facebook.com/${graphVersion}/oauth/access_token` +
      `?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`Canje de code falló ${res.status}: ${err}`);
      throw new BadRequestException("No se pudo canjear el código de Meta");
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new BadRequestException("Meta no devolvió un access_token");
    }
    return data.access_token;
  }
}
