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
  title: "Driony — Atiende cada lead de WhatsApp en segundos, las 24 horas",
  description:
    "CRM para WhatsApp con un agente de IA en tu propio número: responde, cotiza, califica y agenda a tus leads en segundos, también de noche. 15 días de Pro gratis, sin tarjeta. Precio por empresa, no por usuario.",
  openGraph: {
    title: "Driony — Atiende cada lead de WhatsApp en segundos, las 24 horas",
    description:
      "Un agente de IA en tu WhatsApp que responde, cotiza, califica y agenda, también a las 11 de la noche. Bandeja en tiempo real, embudo y difusiones. 15 días de Pro gratis, sin tarjeta.",
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
