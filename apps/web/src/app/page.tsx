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
  title: "Driony — Agentes de IA que venden por tu WhatsApp. Tú mandas.",
  description:
    "Driony es ARM (Agentic Relationship Management): agentes de IA en tu propio número de WhatsApp que responden en segundos, cotizan, leen comprobantes y retoman al que se enfrió, con tu equipo al mando. IA incluida en el plan o tu propia clave. 15 días de Pro gratis, sin tarjeta.",
  openGraph: {
    title: "Driony — Agentes de IA que venden por tu WhatsApp. Tú mandas.",
    description:
      "Agentes de IA que atienden, cotizan y cierran en tu WhatsApp, también a las 11 de la noche. Bandeja en tiempo real, embudo y difusiones. 15 días de Pro gratis, sin tarjeta.",
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
