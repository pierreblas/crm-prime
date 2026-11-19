"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, GITHUB, IconGit } from "./chrome";

// Lo que hace Driony contado como un LÉEME: un índice numerado al lado y, en
// cada punto, un título dicho como lo diría el cliente, dos o tres frases y
// una muestra concreta (el chat, la traza, la fila del panel). Cada muestra
// copia lo que de verdad enseña el panel; los textos de ejemplo son inventados.

type Line = { at: string; who: "in" | "out"; text: string };

/** Un trozo de chat: hora, quién habla y qué dice; abajo, lo que hizo la IA. */
function Chat({ lines, note }: { lines: Line[]; note?: string }) {
  return (
    <div className="lp-doc__chat" aria-hidden="true">
      {lines.map((l, i) => (
        <div className={`lp-doc__msg lp-doc__msg--${l.who}`} key={i}>
          <span className="lp-doc__at">{l.at}</span>
          <span className="lp-doc__bubble">{l.text}</span>
        </div>
      ))}
      {note && <div className="lp-doc__note">{note}</div>}
    </div>
  );
}

/** Filas «rótulo · valor», como el panel «¿Por qué?» de la bandeja. */
function Trace({ title, rows, foot }: { title?: string; rows: [string, ReactNode][]; foot?: string }) {
  return (
    <div className="lp-doc__trace" aria-hidden="true">
      {title && <div className="lp-doc__trace-title">{title}</div>}
      <dl>
        {rows.map(([k, v], i) => (
          <div key={i}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {foot && <div className="lp-doc__trace-foot">{foot}</div>}
    </div>
  );
}

/** Texto de consola: órdenes con «$» y su resultado. */
function Code({ lines }: { lines: string[] }) {
  return (
    <pre className="lp-doc__code" aria-hidden="true">
      {lines.map((l, i) => (
        <span key={i} className={/^(\$ | )/.test(l) ? "lp-doc__cmd" : l.startsWith("✔") ? "lp-doc__done" : undefined}>
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/** `toc`: el título corto del índice; `title`, el del documento. */
/** Las etapas del embudo (una marcada) y lo que pasa en ella, como en Ajustes › Embudos. */
function Flow({ stages, at, rules }: { stages: string[]; at: string; rules: [string, string][] }) {
  return (
    <div className="lp-doc__trace lp-doc__trace--wide" aria-hidden="true">
      <div className="lp-doc__stages">
        {stages.map((st, i) => (
          <span key={st}>
            {i > 0 && <span className="lp-doc__arrow">→</span>}
            <span className={st === at ? "lp-doc__stage lp-doc__stage--at" : "lp-doc__stage"}>{st}</span>
          </span>
        ))}
      </div>
      <div className="lp-doc__trace-title">En «{at}»</div>
      <dl>
        {rules.map(([when, what]) => (
          <div key={when}>
            <dt>{when}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type Item = { id: string; toc: string; title: string; text: ReactNode; art: ReactNode };

const ITEMS: Item[] = [
  {
    id: "leeme-atiende",
    toc: "Atiende de noche",
    title: "Atiende aunque cierres el celular",
    text: (
      <>
        Responde desde tu número en segundos, también a las 11 de la noche y en feriado. Cotiza con tu catálogo, agenda,
        entiende audios y fotos de comprobantes, y escribe como una persona. Cuando el caso lo pide, pasa el chat a tu equipo
        y dice por qué.
      </>
    ),
    art: (
      <Chat
        lines={[
          { at: "23:14", who: "in", text: "Hola, ¿cuánto está el curso de Python? ¿Cuándo empieza?" },
          { at: "23:14", who: "out", text: "¡Hola, Marco! 👋 Está S/ 199 y empieza el lunes 3, en vivo por Zoom. ¿Te separo un cupo?" },
          { at: "23:16", who: "in", text: "📷 Foto del comprobante" },
          { at: "23:16", who: "out", text: "¡Listo, Marco! Recibí tu comprobante. Ana te confirma la inscripción en un momento." },
        ]}
        note="→ Pasó el chat a Ana · llegó un comprobante"
      />
    ),
  },
  {
    id: "leeme-datos",
    toc: "No inventa",
    title: "Responde con tus datos. Lo que no sabe, no lo inventa.",
    text: (
      <>
        Antes de responder busca en tu catálogo y en tu base de conocimiento, y da el precio en la moneda del cliente. Si le
        piden un dato que el producto no tiene, lo dice en vez de rellenarlo.
      </>
    ),
    art: (
      <Trace
        rows={[
          ["Cliente", "«¿Dan certificado?»"],
          ["Consultó", <>Catálogo · «excel avanzado» · pide «Certificado»</>],
          ["Encontró", <>Excel avanzado. «Certificado» no está en los campos del producto.</>],
          ["Respondió", <>«Sobre el certificado no tengo esa información ahora; lo confirmo y te escribo.»</>],
        ]}
      />
    ),
  },
  {
    id: "leeme-prueba",
    toc: "La pruebas antes",
    title: "La pruebas antes que tus clientes",
    text: (
      <>
        En «Probar conversación» le escribes como si fueras un cliente de Lima o de Ciudad de México y ves qué consultó en
        cada respuesta. Con «Simular clientes», clientes hechos por IA conversan con tu agente de principio a fin.
      </>
    ),
    art: (
      <Chat
        lines={[
          { at: "Tú", who: "in", text: "¿Cuánto está Excel avanzado?" },
          { at: "IA", who: "out", text: "¡Hola, Ana! Está S/ 149 y empieza el 10 de marzo. ¿Te separo un cupo?" },
        ]}
        note="Probar como Ana · Perú → consultó el catálogo «excel avanzado» · encontró 1"
      />
    ),
  },
  {
    id: "leeme-mando",
    toc: "Tú decides",
    title: "Tú decides cuánto hace sola",
    text: (
      <>
        En cada conversación eliges: <b>Autopilot</b> responde sola, <b>Copilot</b> redacta y tu equipo envía, <b>Off</b> no
        interviene. En Copilot, lo que propone hacer con el lead espera hasta que alguien envía la respuesta.
      </>
    ),
    art: (
      <div className="lp-suggest" aria-hidden="true">
        <div className="lp-doc__modes">
          <span>Off</span>
          <b>Copilot</b>
          <span>Autopilot</span>
        </div>
        <div className="lp-suggest__text">Hola, Marco. El curso cuesta S/ 199 y la próxima fecha es el lunes 3. ¿Te separo un cupo?</div>
        <div className="lp-suggest__acts">
          <span>Pendiente:</span>
          <span className="lp-chip">Etiqueta «interesado»</span>
          <span className="lp-chip">Etapa → Calificado</span>
        </div>
        <div className="lp-suggest__btns">
          <b>Enviar</b>
          <span>Editar</span>
          <span>Descartar</span>
        </div>
      </div>
    ),
  },
  {
    id: "leeme-porque",
    toc: "Te dice por qué",
    title: "Te dice por qué respondió eso",
    text: (
      <>
        Bajo cada respuesta de la IA, «¿Por qué?» muestra qué entendió, qué consultó, qué hizo y cuánto costó. Si respondió
        sin consultar nada, te avisa para que lo revises. Y si administras la cuenta, al copiloto le preguntas por qué no
        entró un lead.
      </>
    ),
    art: (
      <Trace
        title="Cómo escribió la IA esta respuesta · Agente Ventas"
        rows={[
          ["Entendió", "consulta de precio · neutral · confianza 85 %"],
          ["Consultó", <>Catálogo · «python» → Encontró 1: Curso de Python.</>],
          ["Hizo", <>Etapa → Calificado · espera a que se envíe la respuesta</>],
        ]}
        foot="gpt-4.1-mini · 9.120 tokens · $0,004 · 3,4 seg"
      />
    ),
  },
  {
    id: "leeme-falta",
    toc: "Lo que falta",
    title: "Te avisa qué le falta a tu catálogo",
    text: (
      <>
        Cuenta los datos que tus clientes piden y tus productos no tienen. Lo completas con un clic y la próxima vez responde.
        Con tu base de conocimiento, igual: las preguntas que nadie respondió, con una respuesta propuesta.
      </>
    ),
    art: (
      <div className="lp-doc__gaps" aria-hidden="true">
        <div className="lp-doc__trace-title">Lo que preguntan y falta · 2</div>
        {(
          [
            ["Horario", "Curso de Python", "3 clientes · hace 2 días"],
            ["Certificado", "Excel avanzado", "2 clientes · hoy"],
          ] as const
        ).map(([field, product, meta]) => (
          <div className="lp-doc__gap" key={field}>
            <span>
              <b>«{field}»</b> de {product}
            </span>
            <span className="lp-doc__gap-meta">{meta}</span>
            <span className="lp-doc__gap-btn">Completar</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "leeme-embudo",
    toc: "Ningún lead se enfría",
    title: "Ningún lead se enfría",
    text: (
      <>
        Cada conversación nueva entra sola al embudo. En cada etapa decides qué pasa: un flujo al entrar, un seguimiento si
        pasan días sin respuesta. Los flujos se arman arrastrando bloques, y con difusiones vuelves a escribirle a quien ya
        te compró.
      </>
    ),
    art: (
      <Flow
        stages={["Nuevo", "Contactado", "Calificado", "Propuesta", "Ganado"]}
        at="Calificado"
        rules={[
          ["Al entrar", "Flujo «Enviar temario»"],
          ["Si escribe", "Responde el agente"],
          ["2 días sin respuesta", "El agente lo retoma"],
        ]}
      />
    ),
  },
  {
    id: "leeme-anuncios",
    toc: "Anuncios que aprenden",
    title: "Tus anuncios aprenden de tus ventas",
    text: (
      <>
        Si el cliente llegó por un anuncio de Click to WhatsApp, Driony le cuenta a Meta cuándo se volvió potencial y cuándo
        compró. Tus campañas buscan gente que compra, no que hace clic. Lo eliges etapa por etapa.
      </>
    ),
    art: (
      <div className="lp-trace" aria-hidden="true">
        <div className="lp-trace__row">
          <span>Calificado</span>
          <span className="lp-trace__ev">LeadSubmitted</span>
          <b className="lp-trace__ok">
            <Check /> enviado
          </b>
        </div>
        <div className="lp-trace__row">
          <span>Ganado · S/ 250</span>
          <span className="lp-trace__ev">Purchase</span>
          <b className="lp-trace__ok">
            <Check /> enviado
          </b>
        </div>
      </div>
    ),
  },
  {
    id: "leeme-tuyo",
    toc: "Es tuyo",
    title: "Es tuyo",
    text: (
      <>
        Código abierto (AGPL-3.0). Lo instalas en tu servidor con Docker y el mismo esquema de datos que la nube: te mudas sin
        rehacer nada. La IA, la incluida en tu plan o tu propia clave de OpenAI o Anthropic.{" "}
        <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="lp-doc__link">
          <IconGit /> Ver en GitHub
        </a>
      </>
    ),
    art: (
      <Code
        lines={[
          "$ docker compose -f docker-compose.prod.yml \\",
          "    up -d",
          "✔ Base de datos, Redis, API y panel en tu servidor",
        ]}
      />
    ),
  },
];

/**
 * El LÉEME de Driony: índice fijo a la izquierda (marca el punto que se está
 * leyendo) y los puntos a la derecha. En pantallas estrechas el índice va
 * arriba, entero, y no se queda fijo.
 */
export function FeatureDoc() {
  const [active, setActive] = useState(ITEMS[0]!.id);

  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-35% 0px -55% 0px", threshold: 0 },
    );
    for (const it of ITEMS) {
      const el = document.getElementById(it.id);
      if (el) seen.observe(el);
    }
    return () => seen.disconnect();
  }, []);

  const n = (i: number) => String(i + 1).padStart(2, "0");

  return (
    <div className="lp-doc">
      <nav className="lp-doc__toc" aria-label="Índice: lo que hace Driony">
        <p className="lp-doc__file" aria-hidden="true">
          LÉEME.md
        </p>
        <ol>
          {ITEMS.map((it, i) => (
            <li key={it.id}>
              <a href={`#${it.id}`} aria-current={active === it.id ? "true" : undefined}>
                <span className="lp-doc__n">{n(i)}</span>
                {it.toc}
              </a>
            </li>
          ))}
          <li>
            <a href="#preguntas">
              <span className="lp-doc__n">{n(ITEMS.length)}</span>
              Preguntas
            </a>
          </li>
        </ol>
      </nav>

      <div className="lp-doc__body">
        <div className="lp-doc__bar" aria-hidden="true">
          <span>driony</span>
          <span className="lp-doc__sep">/</span>
          <b>LÉEME.md</b>
        </div>
        {ITEMS.map((it, i) => (
          <article className="lp-doc__item lp-reveal" id={it.id} key={it.id}>
            <h3>
              <span className="lp-doc__n" aria-hidden="true">
                {n(i)}
              </span>
              {it.title}
            </h3>
            <p>{it.text}</p>
            <div className="lp-doc__art">{it.art}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
