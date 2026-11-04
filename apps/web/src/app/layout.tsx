import type { Metadata } from "next";
import "./globals.css";
import { body, display, mono } from "./fonts";
import { Providers } from "@/providers";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getLocale, getMessages } from "@/i18n/server";

export const metadata: Metadata = {
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

  return (
    <html lang={locale} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <I18nProvider locale={locale} messages={getMessages(locale)}>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
