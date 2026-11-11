"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AGENT_GOAL_INFO,
  AGENT_GOALS,
  AGENT_TONE_INFO,
  AGENT_TONES,
  BUSINESS_TYPE_KEYS,
  BUSINESS_TYPES,
  welcomeMessageFor,
  type AgentGoal,
  type AgentTone,
  type BusinessType,
  type SetupDraft,
} from "@crm/shared";
import { Arrow, Check } from "./chrome";

/**
 * «Arma tu agente»: el visitante elige rubro, misión y tono, le pone nombre y
 * ve al momento cómo atendería un chat y qué haría el CRM solo. Es un ejemplo
 * escrito a mano (no corre la IA) y el pie lo dice. El botón del final lleva
 * al alta con esa configuración, y el asistente de bienvenida arranca con
 * ella rellenada: rubros, misiones y tonos son los del asistente real.
 * Datos inventados; nada de contactos reales.
 */

/** Una escena por rubro: lo que pregunta el cliente, lo que responde el agente y una cosa que el CRM hizo solo. */
type Scene = { org: string; ask: string; answer: string; does: string };

const SCENES: Record<BusinessType, Scene> = {
  tienda: {
    org: "la tienda",
    ask: "¿Tienen la zapatilla Runner en talla 40? ¿Hacen envíos a Arequipa?",
    answer: "Sí: Runner en 40, a S/ 189. Envío a Arequipa en 2 días por S/ 15.",
    does: "Cotiza desde tu catálogo importado de Excel, en la moneda del cliente",
  },
  restaurante: {
    org: "el restaurante",
    ask: "¿Hacen delivery a Surco hoy? ¿Cuánto demora?",
    answer: "Sí, llegamos a Surco en unos 45 minutos; el delivery cuesta S/ 6.",
    does: "Toma el pedido desde tu carta y lo deja listo para cocina",
  },
  salud: {
    org: "la clínica",
    ask: "¿Tienen cita con dermatología este sábado? ¿Cuánto cuesta la consulta?",
    answer: "Sí: sábado a las 9:30 o a las 11:00. La consulta cuesta S/ 120.",
    does: "Lo clínico no lo responde: pasa el chat a una persona",
  },
  belleza: {
    org: "el salón",
    ask: "¿Tienen espacio el sábado para corte y color?",
    answer: "Sí, el sábado quedan 10:00 y 15:30. Corte y color, S/ 150.",
    does: "Reserva en la agenda con servicio, hora y profesional",
  },
  inmobiliaria: {
    org: "la inmobiliaria",
    ask: "Vi el anuncio del depa en Miraflores. ¿Precio? ¿Aceptan crédito?",
    answer: "El de 2 dormitorios en Miraflores está en USD 165.000 y sí acepta crédito hipotecario.",
    does: "Guarda zona, presupuesto y forma de pago en la ficha del contacto",
  },
  educacion: {
    org: "la academia",
    ask: "Vi el anuncio del curso de marketing digital. ¿Tiene certificado y cuánto cuesta?",
    answer: "Sí, con certificado digital al terminar. Cuesta S/ 249 y empieza el lunes 10, en vivo.",
    does: "Al pagar, lee la foto del comprobante y confirma el cupo",
  },
  servicios: {
    org: "la agencia",
    ask: "Necesito una cotización para la web de mi restaurante: unas 5 páginas con reservas",
    answer: "Con gusto. Una web de 5 páginas con reservas en línea va entre S/ 2.500 y S/ 3.500 según el diseño.",
    does: "Crea la oportunidad en «Propuesta» con todo lo levantado",
  },
  automotriz: {
    org: "el taller",
    ask: "¿Cuánto cuesta el mantenimiento de 10.000 km de un Kia Rio?",
    answer: "El de 10.000 km del Rio cuesta S/ 280 con aceite y filtros, y toma unas 2 horas.",
    does: "Agenda el servicio y guarda el modelo y el kilometraje del auto",
  },
  turismo: {
    org: "la agencia de viajes",
    ask: "¿Tienen el full day a Paracas este fin de semana? ¿Qué incluye?",
    answer: "Sí, sábado y domingo. Incluye transporte, lancha a las Islas Ballestas y almuerzo, por S/ 190.",
    does: "Separa el cupo y pide los datos de los pasajeros",
  },
  otro: {
    org: "el negocio",
    ask: "Hola, quisiera más información sobre sus servicios y precios",
    answer: "Claro. Trabajamos con planes desde S/ 99 al mes y el primero incluye una asesoría.",
    does: "Guarda lo que preguntó en la ficha y etiqueta el interés",
  },
};

/** Cómo remata la respuesta según la misión, en el tono elegido. */
const CLOSE: Record<AgentGoal, Record<AgentTone, string>> = {
  vender: {
    cercano: "¿Te lo separo? 😊",
    formal: "¿Desea que se lo reserve?",
    juvenil: "¿Te lo separo ya?",
    divertido: "¿Te lo guardo antes de que vuele? 🎉",
  },
  agendar: {
    cercano: "¿Qué día te queda mejor?",
    formal: "¿Qué día y hora le convienen?",
    juvenil: "¿Qué día te va?",
    divertido: "¿Cuándo nos vemos? 🗓️",
  },
  soporte: {
    cercano: "¿Te ayudo con algo más?",
    formal: "¿Puedo ayudarle en algo más?",
    juvenil: "¿Algo más?",
    divertido: "¿Qué más te cuento? 😄",
  },
  datos: {
    cercano: "¿Me dejas tu correo para enviarte el detalle?",
    formal: "¿Me indica su correo para enviarle el detalle?",
    juvenil: "Pásame tu correo y te mando todo.",
    divertido: "¡Dame tu correo y te mando todo! ✉️",
  },
};

/** Lo que contesta el cliente y cómo cierra el agente (en formas que valen para tú y usted), por misión. */
const REPLY: Record<AgentGoal, string> = {
  vender: "Sí, sepáramelo",
  agendar: "El jueves en la tarde",
  soporte: "No, eso era todo, gracias",
  datos: "Claro: ana@correo.com",
};
const FINAL: Record<AgentGoal, string> = {
  vender: "Listo: queda separado. El detalle del pago va por aquí.",
  agendar: "Jueves 17:00, reservado. El recordatorio llega un día antes.",
  soporte: "Perfecto. Cualquier otra cosa, por aquí.",
  datos: "Gracias. Hoy mismo escribe alguien del equipo.",
};
const TOUCH: Record<AgentTone, string> = { cercano: " 😊", formal: "", juvenil: "", divertido: " 🎉" };

/** Lo que el CRM hizo solo, por misión; la escena del rubro añade lo suyo. */
const DOES: Record<AgentGoal, string[]> = {
  vender: ["Entra al embudo como «Interesado» y, al pagar, pasa a «Ganado» solo", "Le dice a Meta que ese anuncio trajo una venta, para que traiga más"],
  agendar: ["Reserva en la agenda del equipo y manda el recordatorio", "Si el cliente se enfría, un flujo retoma la conversación"],
  soporte: ["Responde con tu base de conocimiento, no se inventa nada", "Si pide una persona o se enoja, pasa el chat a tu equipo"],
  datos: ["Guarda cada dato en los campos del contacto", "Asigna el lead al vendedor y le avisa"],
};

/** Las capacidades que el asistente real enciende para cada misión, con sus nombres de la pantalla de agentes. */
const CAPS: Record<AgentGoal, string[]> = {
  vender: ["Consultar tus productos y precios", "Responder con tu información", "Mover la oportunidad en el embudo", "Pasarte el chat cuando haga falta"],
  agendar: ["Responder con tu información", "Reservar en la agenda", "Asignar al vendedor", "Pasarte el chat cuando haga falta"],
  soporte: ["Responder con tu información", "Conocer al cliente", "Etiquetar clientes", "Pasarte el chat cuando haga falta"],
  datos: ["Conocer al cliente", "Guardar datos en la ficha", "Asignar al vendedor", "Etiquetar clientes"],
};

const DEFAULT_NAME = "Nova";

export function AgentSimulator() {
  const [type, setType] = useState<BusinessType>("tienda");
  const [goal, setGoal] = useState<AgentGoal>("vender");
  const [tone, setTone] = useState<AgentTone>("cercano");
  const [name, setName] = useState("");

  const agent = name.trim() || DEFAULT_NAME;
  const scene = SCENES[type];
  const chat: { side: "in" | "out"; text: string }[] = [
    { side: "out", text: welcomeMessageFor(tone, agent, scene.org) },
    { side: "in", text: scene.ask },
    { side: "out", text: `${scene.answer} ${CLOSE[goal][tone]}` },
    { side: "in", text: REPLY[goal] },
    { side: "out", text: `${FINAL[goal]}${TOUCH[tone]}` },
  ];
  const draft: SetupDraft = { businessType: type, goal, tone, ...(name.trim() ? { agentName: name.trim().slice(0, 60) } : {}) };
  const signupHref = `/signup?setup=${encodeURIComponent(JSON.stringify(draft))}`;

  return (
    <div className="lp-sim" data-agent-sim>
      <div className="lp-sim__build">
        <fieldset className="lp-sim__group">
          <legend>Tu rubro</legend>
          <div className="lp-sec__tabs" role="radiogroup" aria-label="Tu rubro">
            {BUSINESS_TYPE_KEYS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={k === type} className="lp-sec__tab" onClick={() => setType(k)} data-sim-type={k}>
                {BUSINESS_TYPES[k].label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="lp-sim__group">
          <legend>Su misión</legend>
          <div className="lp-sim__goals" role="radiogroup" aria-label="Su misión">
            {AGENT_GOALS.map((g) => (
              <button key={g} type="button" role="radio" aria-checked={g === goal} className="lp-sim__goal" onClick={() => setGoal(g)} data-sim-goal={g}>
                <strong>{AGENT_GOAL_INFO[g].title}</strong>
                <small>{AGENT_GOAL_INFO[g].desc}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="lp-sim__group">
          <legend>Su tono</legend>
          <div className="lp-sec__tabs" role="radiogroup" aria-label="Su tono">
            {AGENT_TONES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={t === tone} className="lp-sec__tab" title={AGENT_TONE_INFO[t].sample} onClick={() => setTone(t)} data-sim-tone={t}>
                {AGENT_TONE_INFO[t].title}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="lp-sim__name">
          <span>Nombre del agente</span>
          <input value={name} maxLength={40} placeholder={DEFAULT_NAME} onChange={(e) => setName(e.target.value)} data-sim-name />
        </label>
      </div>

      {/* La clave reinicia el fundido al cambiar algo: se nota que el chat es otro. */}
      <div className="lp-sim__result" key={`${type}-${goal}-${tone}`} aria-live="polite">
        <ol className="lp-sec__chat" aria-label="Ejemplo de conversación con tu agente" data-sim-chat>
          {chat.map((m, i) => (
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

        <div className="lp-sim__does">
          <p className="lp-sim__label">Lo que hizo solo</p>
          <ul className="lp-sec__does">
            {[...DOES[goal], scene.does].map((d) => (
              <li key={d}>
                <Check />
                <span>{d}</span>
              </li>
            ))}
          </ul>
          <p className="lp-sim__label" style={{ marginTop: 14 }}>
            Con estas capacidades
          </p>
          <ul className="lp-sim__caps" aria-label="Capacidades del agente">
            {CAPS[goal].map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>

        <div className="lp-sim__cta">
          <Link href={signupHref} className="lp-btn lp-btn--primary" data-sim-cta>
            Crear mi cuenta con este agente <Arrow />
          </Link>
          <small>
            Ejemplo escrito a mano. En tu cuenta responde la IA con tus precios, tus horarios y tus reglas, y el asistente de bienvenida arranca con esta misma configuración.
          </small>
        </div>
      </div>
    </div>
  );
}
