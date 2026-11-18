import { SIGNUP_CODE_MINUTES } from "@crm/shared";
import { renderSystemEmail, type SystemEmailLocale as Locale } from "../auth/system-email";

// El correo con el código del alta. Aparte del servicio para poder verlo y
// probarlo sin base ni Nest, como los de «recuperar contraseña».
//
// Va a una dirección que todavía nadie ha demostrado que es suya, así que no
// lleva nada que escriba quien se registra: ni su nombre ni el de la empresa.
// Si no, el formulario serviría para mandar desde Driony un texto cualquiera a
// cualquier correo («Acme: llama ya al 555…»).

export function signupCodeEmail(locale: Locale, d: { email: string; code: string }) {
  const minutes = SIGNUP_CODE_MINUTES;
  if (locale === "en") {
    return renderSystemEmail({
      locale,
      subject: `${d.code} is your Driony code`,
      preheader: `Type it on the sign-up screen. It works for ${minutes} minutes.`,
      title: "Confirm your email",
      paragraphs: ["Hi,", `To finish creating your company on Driony with ${d.email}, type this code on the sign-up screen.`],
      code: { value: d.code, facts: `Works for ${minutes} minutes · Only once` },
      note: "If you aren't creating a Driony account, ignore this email: nothing is created without the code.",
      reason: `You're getting this email because someone entered ${d.email} while creating a company on Driony.`,
    });
  }
  return renderSystemEmail({
    locale,
    subject: `${d.code} es tu código de Driony`,
    preheader: `Escríbelo en la pantalla del alta. Vale ${minutes} minutos.`,
    title: "Confirma tu correo",
    paragraphs: ["Hola:", `Para terminar de crear tu empresa en Driony con ${d.email}, escribe este código en la pantalla del alta.`],
    code: { value: d.code, facts: `Vale ${minutes} minutos · Sirve una sola vez` },
    note: "Si no estás creando una cuenta en Driony, ignora este correo: sin el código no se crea nada.",
    reason: `Te llega este correo porque alguien escribió ${d.email} al crear una empresa en Driony.`,
  });
}
