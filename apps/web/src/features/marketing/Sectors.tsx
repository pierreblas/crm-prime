"use client";

import { useState } from "react";
import { Check } from "./chrome";

/**
 * «¿Y esto sirve para mi negocio?» Un rubro a la vez: el cliente pregunta como
 * pregunta de verdad, el agente contesta con datos del negocio, y al lado lo
 * que el CRM hizo solo. Datos inventados; nada de contactos reales.
 */
type Sector = {
  key: string;
  label: string;
  title: string;
  chat: { side: "in" | "out"; text: string }[];
  does: string[];
};

const SECTORS: Sector[] = [
  {
    key: "cursos",
    label: "Cursos y academias",
    title: "Cotiza, separa el cupo y confirma el pago sin que nadie esté despierto.",
    chat: [
      { side: "in", text: "Hola, vi el anuncio del curso de marketing digital. ¿Tiene certificado y cuánto cuesta?" },
      { side: "out", text: "¡Hola, Lucía! Sí, con certificado digital al terminar. Cuesta S/ 249 y empieza el lunes 10, en vivo. ¿Te separo un cupo?" },
      { side: "in", text: "Sí, ya te hice el Yape 📷" },
      { side: "out", text: "Recibido: S/ 249. Tu cupo queda confirmado; el enlace te llega el domingo." },
    ],
    does: [
      "Entra al embudo como «Interesado» y, al pagar, pasa a «Ganado» solo",
      "Lee la foto del comprobante y deja el chat marcado para tu equipo",
      "Le dice a Meta que ese anuncio trajo una compra, para que traiga más",
    ],
  },
  {
    key: "clinicas",
    label: "Clínicas y consultorios",
    title: "Agenda la cita y deja lo clínico a las personas.",
    chat: [
      { side: "in", text: "¿Tienen cita con dermatología este sábado? ¿Cuánto cuesta la consulta?" },
      { side: "out", text: "Sí: sábado a las 9:30 o a las 11:00. La consulta cuesta S/ 120. ¿Cuál te reservo?" },
      { side: "in", text: "A las 11, por favor. Es por unas manchas que me salieron" },
      { side: "out", text: "Listo, sábado 11:00 a tu nombre. Lo de las manchas te lo revisa el especialista en la consulta; si quieres, te paso con alguien del equipo ahora." },
    ],
    does: [
      "Reserva en la agenda del equipo con servicio, horario y profesional",
      "Cuando el paciente pregunta algo médico, pasa el chat a una persona",
      "Cada paciente con su historial de conversación y sus datos en el CRM",
    ],
  },
  {
    key: "tiendas",
    label: "Tiendas y e-commerce",
    title: "Responde por tu catálogo, confirma el pago y arma el pedido.",
    chat: [
      { side: "in", text: "¿Tienen la zapatilla Runner en talla 40? ¿Hacen envíos a Arequipa?" },
      { side: "out", text: "Sí: Runner en 40, a S/ 189. Envío a Arequipa en 2 días por S/ 15. ¿Te la separo?" },
      { side: "in", text: "Dale, ¿me pasas tu Yape?" },
      { side: "out", text: "Claro: 987 654 321, a nombre de la tienda. Cuando pagues, mándame la captura y te confirmo el envío." },
    ],
    does: [
      "Cotiza desde tu catálogo importado de Excel, en la moneda del cliente",
      "Entiende la captura del pago y pasa el pedido a tu equipo para despachar",
      "Etiqueta, agrupa por ciudad y envía la difusión de la próxima campaña",
    ],
  },
  {
    key: "inmobiliarias",
    label: "Inmobiliarias",
    title: "Califica el presupuesto y agenda la visita antes de que se enfríe.",
    chat: [
      { side: "in", text: "Vi el anuncio del depa en Miraflores. ¿Precio? ¿Aceptan crédito?" },
      { side: "out", text: "Hola, Carlos. El de 2 dormitorios en Miraflores está en USD 165.000 y sí acepta crédito hipotecario. ¿Lo buscas para vivir o para invertir?" },
      { side: "in", text: "Para vivir, tengo la inicial del 20 %" },
      { side: "out", text: "Perfecto. ¿Visita este jueves a las 6 o el sábado a las 11? Te confirmo con el asesor." },
    ],
    does: [
      "Guarda zona, presupuesto y forma de pago en los campos del contacto",
      "Asigna el lead al asesor de la zona y agenda la visita",
      "Avisa a Meta que el lead calificó: tus anuncios buscan compradores, no curiosos",
    ],
  },
  {
    key: "servicios",
    label: "Servicios y agencias",
    title: "Levanta el pedido completo y entrega una oportunidad lista para cotizar.",
    chat: [
      { side: "in", text: "Necesito una cotización para la web de mi restaurante" },
      { side: "out", text: "Con gusto. ¿Cuántas páginas tienes en mente y necesitas reservas o carta en línea?" },
      { side: "in", text: "Unas 5 páginas, con reservas" },
      { side: "out", text: "Anotado: 5 páginas con reservas. Hoy mismo te escribe alguien del equipo con la propuesta. ¿Me dejas tu correo para enviártela?" },
    ],
    does: [
      "Hace las preguntas que tú defines y las guarda en el contacto",
      "Crea la oportunidad en «Propuesta» con todo lo levantado",
      "Si pasan dos días sin respuesta, un flujo retoma la conversación",
    ],
  },
];

export function Sectors() {
  const [active, setActive] = useState(SECTORS[0]!.key);
  const sector = SECTORS.find((s) => s.key === active) ?? SECTORS[0]!;

  return (
    <div className="lp-sec" data-sectors>
      <div className="lp-sec__tabs" role="tablist" aria-label="Elige tu rubro">
        {SECTORS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            id={`lp-sec-tab-${s.key}`}
            aria-selected={s.key === active}
            aria-controls="lp-sec-panel"
            className="lp-sec__tab"
            onClick={() => setActive(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="lp-sec__panel" role="tabpanel" id="lp-sec-panel" aria-labelledby={`lp-sec-tab-${sector.key}`} key={sector.key}>
        <div className="lp-sec__copy">
          <h3>{sector.title}</h3>
          <ul className="lp-sec__does">
            {sector.does.map((d) => (
              <li key={d}>
                <Check />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
        <ol className="lp-sec__chat" aria-label={`Ejemplo de conversación: ${sector.label}`}>
          {sector.chat.map((m, i) => (
            <li key={i} className={`lp-msg lp-msg--${m.side}`}>
              <div className="lp-msg__bubble">
                {m.text}
                {m.side === "out" && (
                  <span className="lp-msg__meta">
                    <span className="lp-msg__ai">IA</span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
