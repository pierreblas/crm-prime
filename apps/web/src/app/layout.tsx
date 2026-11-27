import type { Metadata } from "next";
import "./globals.css";
import { body, display, mono } from "./fonts";
import { Providers } from "@/providers";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getLocale, getMessages } from "@/i18n/server";
import { cookies } from "next/headers";
import { serverTheme, THEME_COOKIE, THEME_SCRIPT, themeFrom } from "@/lib/theme";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  // Con esto el canónico y la imagen al compartir llevan la dirección pública
  // completa; sin ello Next los escribe contra localhost.
  metadataBase: new URL(siteUrl()),
  title: "Driony — Sell on WhatsApp with AI agents",
  description:
    "The CRM with AI agents that replies, qualifies and books your leads in seconds, 24/7, straight from your WhatsApp number.",
  openGraph: {
    title: "Driony — Turn WhatsApp into your best salesperson",
    description:
      "AI agents that answer, qualify and book your WhatsApp leads around the clock. Real-time inbox, pipeline, broadcasts and no-code flows.",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const pref = themeFrom((await cookies()).get(THEME_COOKIE)?.value);

  return (
    // El guion corrige el tema antes de pintar: en automático y en las páginas estáticas el servidor no lo sabe.
    <html lang={locale} data-theme={serverTheme(pref)} data-theme-pref={pref} suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <I18nProvider locale={locale} messages={getMessages(locale)}>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
