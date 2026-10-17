import { getTranslator } from "@/i18n/server";
import { ConnectWhatsappHub } from "./ConnectWhatsappHub";

export const metadata = { title: "Conectar WhatsApp" };

/**
 * Conector de WhatsApp en el dominio raíz. Sin sesión: lo que autoriza es el
 * pase de la URL, emitido desde el panel de la empresa. Ver ConnectHubController.
 *
 * `embed=1`: va dentro del modal del panel (iframe), sin cabecera propia.
 */
export default async function ConnectWhatsappPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string; embed?: string; coexistence?: string }>;
}) {
  const t = await getTranslator();
  const { ticket, embed: embedParam, coexistence: coexParam } = await searchParams;
  const embed = embedParam === "1";
  // Lo pone la API en la URL según el plan de la empresa; ella lo vuelve a
  // comprobar al guardar, así que aquí solo decide qué ventana de Meta abrir.
  const coexistence = coexParam !== "0";

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: embed ? 16 : 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {!embed && (
          <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
            Driony
          </p>
        )}
        {ticket ? (
          <ConnectWhatsappHub
            ticket={ticket}
            embed={embed}
            coexistence={coexistence}
            t={{
              title: t("connect.title"),
              subtitle: coexistence ? t("connect.subtitle") : t("connect.subtitleApi"),
              loadingSdk: t("connect.loadingSdk"),
              continueWithMeta: t("connect.continueWithMeta"),
              waiting: t("connect.waiting"),
              waitingHint: t("connect.waitingHint"),
              saving: t("connect.saving"),
              done: t("connect.done"),
              notCompleted: t("connect.notCompleted"),
              notApproved: t("connect.notApproved"),
              metaError: t("connect.metaError"),
              missingConfig: t("connect.missingConfig"),
              backHint: t("connect.backHint"),
            }}
          />
        ) : (
          <div style={caja}>
            <h1 style={{ margin: 0, fontSize: 20 }}>{t("connect.expired")}</h1>
            <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>{t("connect.expiredHint")}</p>
          </div>
        )}
      </div>
    </main>
  );
}

const caja: React.CSSProperties = {
  padding: 28,
  borderRadius: 12,
  background: "var(--panel)",
  border: "1px solid var(--border)",
};
