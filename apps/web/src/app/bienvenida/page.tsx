import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SetupWizard } from "@/features/onboarding/SetupWizard";

export const metadata = { title: "Arma tu IA" };

/**
 * Asistente de bienvenida: adonde llega el administrador recién dado de alta
 * (y desde Primeros pasos mientras no lo haya completado). Configura la
 * empresa entera, así que solo para administradores.
 */
export default async function BienvenidaPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;
  if (role !== "ADMIN") redirect("/");

  return <SetupWizard userName={session.user?.name ?? null} />;
}
