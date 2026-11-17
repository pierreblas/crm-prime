import { PASSWORD_RESET_EMAIL_MINUTES } from "@crm/shared";
import { renderSystemEmail, type SystemEmailLocale as Locale } from "./system-email";

// Los dos correos de «recuperar contraseña»: el enlace y el aviso de que cambió.
// Aparte del servicio para poder verlos y probarlos sin base ni Nest.

/** «Hola Ana:» o «Hola:». */
const hello = (locale: Locale, name: string | null) =>
  locale === "en" ? `Hi${name ? ` ${name}` : ""},` : `Hola${name ? ` ${name}` : ""}:`;

export function resetEmail(locale: Locale, d: { name: string | null; email: string; orgName: string; url: string }) {
  const minutes = PASSWORD_RESET_EMAIL_MINUTES;
  if (locale === "en") {
    return renderSystemEmail({
      locale,
      subject: "Choose a new password for Driony",
      preheader: `The link works for ${minutes} minutes and only once.`,
      context: d.orgName,
      title: "Choose a new password",
      paragraphs: [
        hello(locale, d.name),
        `Someone (probably you) asked to change the password of ${d.email} at ${d.orgName}. To choose a new one, open this link.`,
      ],
      action: { url: d.url, label: "Choose a new password", facts: `Works for ${minutes} minutes · Only once` },
      note: "If you didn't ask for it, ignore this email: your password stays the same.",
      reason: `You're getting this email because someone asked to change the password of ${d.email} at ${d.orgName}.`,
    });
  }
  return renderSystemEmail({
    locale,
    subject: "Elige una contraseña nueva para Driony",
    preheader: `El enlace vale ${minutes} minutos y sirve una sola vez.`,
    context: d.orgName,
    title: "Elige una contraseña nueva",
    paragraphs: [
      hello(locale, d.name),
      `Alguien (seguramente tú) pidió cambiar la contraseña de ${d.email} en ${d.orgName}. Para elegir una nueva, abre este enlace.`,
    ],
    action: { url: d.url, label: "Elegir contraseña nueva", facts: `Vale ${minutes} minutos · Sirve una sola vez` },
    note: "Si no lo pediste, ignora este correo: tu contraseña sigue igual.",
    reason: `Te llega este correo porque se pidió cambiar la contraseña de ${d.email} en ${d.orgName}.`,
  });
}

export function changedEmail(
  locale: Locale,
  d: { name: string | null; email: string; orgName: string; forgotUrl: string },
) {
  if (locale === "en") {
    return renderSystemEmail({
      locale,
      subject: "Your Driony password was changed",
      preheader: "If it wasn't you, you can get your account back from this email.",
      context: d.orgName,
      title: "Your password was changed",
      paragraphs: [
        hello(locale, d.name),
        `The password of ${d.email} at ${d.orgName} was just changed.`,
        "To keep your account safe, every device signed in with the old one was signed out: sign in again with the new one.",
      ],
      callout: {
        title: "Wasn't you?",
        text: "Ask for a link to choose another password. It arrives at this email address and, once used, signs out whoever got in. Then tell whoever manages your company's account.",
        action: { url: d.forgotUrl, label: "Get my account back" },
      },
      reason: "We always let you know when your account's password changes.",
    });
  }
  return renderSystemEmail({
    locale,
    subject: "Se cambió tu contraseña de Driony",
    preheader: "Si no fuiste tú, puedes recuperar tu cuenta desde este correo.",
    context: d.orgName,
    title: "Tu contraseña cambió",
    paragraphs: [
      hello(locale, d.name),
      `Se acaba de cambiar la contraseña de ${d.email} en ${d.orgName}.`,
      "Para cuidar tu cuenta, se cerró la sesión en todos los dispositivos que entraban con la anterior: vuelve a entrar con la nueva.",
    ],
    callout: {
      title: "¿No fuiste tú?",
      text: "Pide un enlace para elegir otra contraseña. Llega a este correo y, al usarlo, se cierra la sesión de quien haya entrado. Después avísale a quien administra tu empresa.",
      action: { url: d.forgotUrl, label: "Recuperar mi cuenta" },
    },
    reason: "Te avisamos siempre que cambia la contraseña de tu cuenta.",
  });
}
