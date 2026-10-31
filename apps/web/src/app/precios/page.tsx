import type { Metadata } from "next";
import { Pricing } from "@/features/marketing/Pricing";

export const metadata: Metadata = {
  title: "Precios — Driony",
  description:
    "Planes de Driony, el CRM para WhatsApp con agentes de IA: 15 días de Pro gratis y sin tarjeta, plan Gratis que no caduca, Pro y Empresa según números y equipo, o instálalo gratis en tu servidor.",
  alternates: { canonical: "/precios" },
};

/** Página pública de precios. Los planes salen del catálogo compartido con la API. */
export default function PreciosPage() {
  return <Pricing />;
}
