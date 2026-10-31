import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { Inbox } from "@/features/inbox/Inbox";
import { Landing } from "@/features/marketing/Landing";
import { currentOrgSlug } from "@/lib/org";

// La raíz sirve la landing pública (en español) al visitante sin sesión del
// dominio principal; la bandeja, ya dentro, pone su propio título en el cliente.
export const metadata: Metadata = {
  title: "Driony — Convierte WhatsApp en tu mejor vendedor",
  description:
    "CRM para WhatsApp con agentes de IA que responden, califican y agendan a tus leads en segundos, las 24 horas, desde tu propio número. Bandeja en tiempo real, embudo, difusiones y flujos sin código.",
  openGraph: {
    title: "Driony — Convierte WhatsApp en tu mejor vendedor",
    description:
      "Agentes de IA que atienden tu WhatsApp las 24 horas: responden, califican y agendan. Bandeja en tiempo real, embudo, difusiones y flujos sin código. Código abierto.",
    type: "website",
    locale: "es_ES",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Driony: convierte WhatsApp en tu mejor vendedor" }],
  },
};

export default async function Home() {
  const session = await auth();

  if (!session) {
    // En el subdominio de una empresa (acme.driony.com) quien llega es de esa
    // empresa: va directo a su acceso, no a la portada de ventas. Si el
    // subdominio no existe, el login ya lo dice.
    if (await currentOrgSlug()) redirect("/login");
    // Dominio principal → landing pública de ventas.
    return <Landing />;
  }

  // Usuario logueado → la app (bandeja).
  const role = (session.user as { role?: string })?.role;
  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="inbox">
      <Inbox />
    </AppShell>
  );
}
