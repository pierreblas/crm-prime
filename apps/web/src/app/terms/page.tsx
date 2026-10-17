import Link from "next/link";

export const metadata = {
  title: "Términos y condiciones — Driony",
  description:
    "Las condiciones de uso del servicio Driony en la nube: cuenta, planes, WhatsApp y Meta, inteligencia artificial, uso aceptable, datos, responsabilidad y cancelación.",
};

/**
 * Términos y condiciones del servicio en la nube.
 *
 * Hermana de la política de privacidad: mismo formato, mismo tono y los
 * mismos datos de contacto desde el entorno, para que una instalación propia
 * pueda cambiarlos sin tocar el código. La versión autoalojada se rige por su
 * licencia (AGPL-3.0), no por esto.
 */
export default function TermsPage() {
  const company = process.env.NEXT_PUBLIC_COMPANY_NAME ?? "Driony";
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contacto@driony.com";
  const domain = (process.env.SAAS_BASE_DOMAIN ?? "driony.com").split(":")[0];

  return (
    <main style={page}>
      <header style={top}>
        <Link href="/" style={brand}>
          Driony
        </Link>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>Legal</span>
      </header>

      <h1 style={h1}>Términos y condiciones</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>Última actualización: 17 de octubre de 2026</p>

      <p style={lede}>
        Estos términos regulan el uso del servicio Driony que <strong>{company}</strong> presta en{" "}
        <strong>{domain}</strong> y en el subdominio de cada empresa (<em>tu-empresa.{domain}</em>). Al
        crear una cuenta los aceptas en nombre de tu empresa. Están escritos para leerse enteros en unos
        minutos; si algo no queda claro, escríbenos antes de usar el servicio.
      </p>

      <nav aria-label="Índice" style={toc}>
        {SECCIONES.map(([id, titulo]) => (
          <a key={id} href={`#${id}`} style={tocLink}>
            {titulo}
          </a>
        ))}
      </nav>

      <Section id="ambito" title="1. A qué aplica">
        <p>
          Aplica al servicio en la nube que operamos en {domain}: la bandeja de WhatsApp, los agentes de
          inteligencia artificial, los embudos, los flujos, las difusiones, la API y todo lo que ofrece el
          panel. Driony también se distribuye como software de código abierto bajo licencia AGPL-3.0; si lo
          instalas en tus propios servidores te rige esa licencia y no estos términos, y eres tú quien
          responde ante tus usuarios y tus clientes.
        </p>
      </Section>

      <Section id="cuenta" title="2. Tu cuenta y tu empresa">
        <ul>
          <li>
            Quien se registra crea el espacio de su empresa y es su <strong>administrador</strong>: puede
            invitar a su equipo, conectar números y configurar la operación. Declaras que tienes autoridad
            para aceptar estos términos en nombre de esa empresa.
          </li>
          <li>
            Cada persona del equipo usa su propia cuenta. Las credenciales son personales: lo que se haga
            con ellas se considera hecho por su titular. Si sospechas que alguien más tiene tu contraseña,
            cámbiala y avísanos.
          </li>
          <li>
            Tienes que ser mayor de edad y usar el servicio para una actividad profesional o empresarial.
            Driony no está pensado para uso personal ni para menores.
          </li>
          <li>Los datos de registro deben ser reales y mantenerse al día, en especial el correo de contacto.</li>
        </ul>
      </Section>

      <Section id="planes" title="3. Planes, límites y pagos">
        <ul>
          <li>
            Cada empresa tiene un <strong>plan</strong> que fija cuántos números de WhatsApp y cuántos
            usuarios puede tener y qué características incluye. Los planes vigentes y sus límites están en
            la{" "}
            <Link href="/docs/planes" style={link}>
              documentación de planes
            </Link>{" "}
            y en Ajustes › Plan de tu panel.
          </li>
          <li>
            El plan gratuito no requiere tarjeta. Los planes de pago se cobran por adelantado en cada
            periodo. Puedes subir, bajar o cancelar cuando quieras; el cambio aplica desde el siguiente
            periodo y no se devuelve la parte ya pagada del periodo en curso.
          </li>
          <li>
            Los límites se comprueban <strong>al añadir</strong> (al conectar otro número o crear otro
            usuario). Lo que ya tienes no se borra nunca por bajar de plan.
          </li>
          <li>
            Los precios de terceros no están incluidos: lo que cobra Meta por las conversaciones de WhatsApp,
            tu proveedor de inteligencia artificial por los tokens y, si lo usas, Twilio por las llamadas, lo
            pagas directamente a cada uno con tus propias cuentas.
          </li>
          <li>
            Si cambiamos un precio, te avisaremos con al menos 30 días por correo o en el panel antes de
            que aplique a tu empresa.
          </li>
        </ul>
      </Section>

      <Section id="uso-razonable" title="4. Uso razonable y retención">
        <ul>
          <li>
            No cobramos por mensaje ni por espacio en disco. Cada plan está pensado para un volumen de{" "}
            <strong>contactos activos al mes</strong> (quien envía o recibe un mensaje durante el mes, difusiones
            aparte) que se indica en la{" "}
            <Link href="/precios" style={link}>
              página de precios
            </Link>
            . Es una referencia de uso razonable, no un corte: los picos puntuales son normales y el servicio no se
            interrumpe.
          </li>
          <li>
            Si tu empresa supera esa referencia de forma sostenida, te lo diremos y te propondremos el plan que
            corresponda a tu volumen. Si no se acuerda otro plan en un plazo razonable, podremos limitar el uso
            excedente o, en último término, suspender la cuenta con aviso previo.
          </li>
          <li>
            Los <strong>adjuntos</strong> de los mensajes (fotos, audios, vídeos y documentos) se conservan durante
            el plazo de tu plan, indicado en la página de precios. Pasado ese plazo se eliminan de nuestros
            servidores; el texto de la conversación se conserva. Si quieres guardar un archivo más tiempo,
            descárgalo antes.
          </li>
          <li>
            Las cuentas sin ninguna actividad durante más de seis meses en el plan gratuito pueden eliminarse,
            avisando por correo con al menos 30 días de antelación.
          </li>
        </ul>
      </Section>

      <Section id="whatsapp" title="5. WhatsApp y Meta">
        <p>
          Driony se conecta a la <strong>API oficial de WhatsApp Business</strong> de Meta. {company} es Meta
          Business Partner y la conexión se hace con la ventana oficial de Meta desde el panel, o con tu
          propia app de Meta si así lo prefieres. Al usar WhatsApp a través de Driony aceptas también las
          condiciones de Meta que te aplican, en particular las{" "}
          <a href="https://business.whatsapp.com/policy" target="_blank" rel="noopener noreferrer" style={link}>
            políticas de WhatsApp Business
          </a>{" "}
          (comercio y mensajería). En concreto:
        </p>
        <ul>
          <li>
            Solo puedes escribir primero a personas que hayan dado su <strong>consentimiento</strong> para
            recibir mensajes de tu empresa, y debes respetar sus peticiones de no recibir más.
          </li>
          <li>
            Las difusiones usan plantillas que aprueba Meta. Lo que Meta rechace o restrinja (plantillas,
            límites de envío, calidad del número) no depende de Driony.
          </li>
          <li>
            Meta puede limitar o bloquear un número por su calidad o por incumplir sus políticas. Driony te
            muestra el estado, pero no puede revertir esas decisiones.
          </li>
          <li>
            Si activas las <strong>conversiones de anuncios</strong>, Driony envía a Meta, en tu nombre,
            los eventos que configures en tu embudo para los chats que vinieron de un anuncio de Click to
            WhatsApp. Puedes desactivarlo en cualquier momento desde Integraciones.
          </li>
        </ul>
      </Section>

      <Section id="ia" title="6. Inteligencia artificial">
        <ul>
          <li>
            Los agentes de IA funcionan con tu propia clave de OpenAI, Anthropic u otro proveedor compatible,
            y ese proveedor te cobra directamente. Driony registra el gasto y te deja ponerle un tope por
            agente.
          </li>
          <li>
            Las respuestas las genera un modelo de lenguaje a partir de tus instrucciones, tu catálogo y tu
            base de conocimiento. <strong>Pueden contener errores</strong>. Tú decides qué puede hacer cada
            agente, cuándo responde solo y cuándo pasa el chat a una persona, y eres responsable de lo que
            tu agente dice a tus clientes como si lo hubiera dicho tu equipo.
          </li>
          <li>
            No uses los agentes para dar consejo médico, legal o financiero sin supervisión humana, ni para
            tomar decisiones automatizadas que afecten derechos de las personas.
          </li>
          <li>
            Lo que envías al proveedor de IA (mensajes, catálogo, documentos) se rige también por las
            condiciones de ese proveedor y por tu contrato con él.
          </li>
        </ul>
      </Section>

      <Section id="uso" title="7. Uso aceptable">
        <p>Al usar Driony te comprometes a no:</p>
        <ul>
          <li>Enviar spam, mensajes no solicitados ni contenido engañoso, ilegal, ofensivo o que infrinja derechos de terceros.</li>
          <li>Importar o tratar datos de contactos sin una base legal para hacerlo, ni datos especialmente sensibles sin las garantías que exija la ley.</li>
          <li>Suplantar a otra empresa o persona, ni usar marcas o números que no te pertenecen.</li>
          <li>Intentar acceder a datos de otras empresas, eludir los límites de tu plan, sobrecargar el servicio o alterar su funcionamiento.</li>
          <li>Revender el servicio o cederlo a terceros sin un acuerdo con nosotros.</li>
          <li>Usar la API o los webhooks con fines distintos a operar tu propia cuenta, o compartir tus claves con quien no deba tenerlas.</li>
        </ul>
      </Section>

      <Section id="datos" title="8. Tus datos y los de tus contactos">
        <ul>
          <li>
            Lo que subes a Driony (conversaciones, contactos, catálogo, documentos, instrucciones) es tuyo.
            Nos das solo la licencia necesaria para prestarte el servicio: guardarlo, mostrarlo a tu equipo,
            enviarlo a WhatsApp y a tu proveedor de IA cuando tú lo configures, y hacer copias de seguridad.
          </li>
          <li>
            De los datos de las personas que te escriben por WhatsApp, <strong>tu empresa es la
            responsable</strong> y nosotros los tratamos por tu cuenta. Cómo lo hacemos está en la{" "}
            <Link href="/privacy" style={link}>
              política de privacidad
            </Link>
            , que forma parte de estos términos.
          </li>
          <li>
            Puedes exportar tus contactos y conversaciones desde el panel o la API en cualquier momento, y
            pedir que eliminemos tu cuenta y sus datos según indica la política de privacidad.
          </li>
          <li>
            Cada empresa está aislada de las demás, también en la base de datos. Nunca usamos tus
            conversaciones para entrenar modelos ni las compartimos con otras empresas.
          </li>
        </ul>
      </Section>

      <Section id="disponibilidad" title="9. Disponibilidad y soporte">
        <ul>
          <li>
            Hacemos lo razonable para que Driony esté disponible de forma continua, pero el servicio depende
            de terceros (Meta, proveedores de IA, infraestructura) y puede tener interrupciones. No
            garantizamos una disponibilidad concreta salvo que la pactemos por escrito en un plan Empresa.
          </li>
          <li>Los mantenimientos que requieran parar el servicio se avisan con antelación en el panel o por correo, salvo urgencias de seguridad.</li>
          <li>
            El soporte es por correo, en horario laboral, y lo da el equipo que hace el producto. El plan
            Empresa tiene soporte prioritario.
          </li>
          <li>Podemos cambiar, mejorar o retirar características; si retiramos algo que usas, te avisaremos con tiempo para que puedas adaptarte.</li>
        </ul>
      </Section>

      <Section id="propiedad" title="10. Propiedad intelectual">
        <ul>
          <li>
            El código de Driony es de código abierto bajo licencia AGPL-3.0 y está publicado en GitHub.
            Esa licencia regula el código; estos términos regulan el servicio en la nube.
          </li>
          <li>
            El nombre Driony, su logotipo y su identidad visual son de {company}. No puedes usarlos para
            dar a entender una relación que no existe. Los nombres y logotipos de Meta, WhatsApp, OpenAI,
            Anthropic y Twilio son de sus titulares.
          </li>
          <li>
            Si nos mandas ideas o sugerencias, podemos usarlas para mejorar el producto sin obligación
            hacia ti.
          </li>
        </ul>
      </Section>

      <Section id="api" title="11. API, webhooks e integraciones">
        <p>
          La API pública y los webhooks están pensados para integrar Driony con tus propios sistemas. Las
          claves son de tu empresa: guárdalas con cuidado y revócalas si se filtran. Podemos aplicar límites
          razonables de uso para proteger el servicio y avisarte si tu integración los supera de forma
          sostenida. Las integraciones con terceros (Twilio, proveedores de IA, tu app de Meta) se rigen
          por las condiciones de cada uno.
        </p>
      </Section>

      <Section id="cancelacion" title="12. Suspensión y cancelación">
        <ul>
          <li>
            Puedes dejar de usar Driony cuando quieras: cancela tu plan en Ajustes › Plan o escríbenos para
            cerrar la cuenta. Al cerrarla, tus datos se eliminan en los plazos que indica la política de
            privacidad.
          </li>
          <li>
            Podemos suspender una cuenta si incumple estos términos o las políticas de Meta, si pone en
            riesgo el servicio o a otras empresas, o si hay un impago. Salvo urgencia, te avisaremos antes
            y te daremos un plazo para corregirlo.
          </li>
          <li>Si suspendemos o cerramos tu cuenta por incumplimiento, no se devuelven los importes ya pagados.</li>
        </ul>
      </Section>

      <Section id="responsabilidad" title="13. Garantías y responsabilidad">
        <ul>
          <li>
            El servicio se presta <strong>tal cual</strong>, con el cuidado razonable de un proveedor
            profesional, pero sin garantía de que esté libre de errores o de que se ajuste a un propósito
            concreto.
          </li>
          <li>
            En la medida en que la ley lo permita, {company} no responde de pérdidas de ingresos, de
            clientes o de oportunidades, ni de daños indirectos, derivados del uso o de la imposibilidad de
            usar el servicio, de decisiones de Meta o de los proveedores de IA, ni del contenido que tu
            equipo o tus agentes envíen.
          </li>
          <li>
            Si a pesar de todo somos responsables de algo, nuestra responsabilidad total queda limitada a
            lo que tu empresa nos haya pagado en los doce meses anteriores al hecho que la origine.
          </li>
          <li>Nada de lo anterior limita la responsabilidad que la ley no permita limitar.</li>
        </ul>
      </Section>

      <Section id="cambios" title="14. Cambios en estos términos">
        <p>
          Si cambia algo relevante lo avisaremos en el panel o por correo con antelación antes de que
          entre en vigor. Si no estás de acuerdo con el cambio, puedes cerrar tu cuenta antes de esa fecha.
          Seguir usando el servicio después significa que lo aceptas. La fecha de arriba indica siempre la
          última versión.
        </p>
      </Section>

      <Section id="ley" title="15. Ley aplicable y disputas">
        <p>
          Estos términos se rigen por las leyes del país en el que {company} está constituida. Si surge una
          disputa, intentaremos primero resolverla de buena fe por correo; si no lo conseguimos, se
          someterá a los tribunales competentes de ese país, sin perjuicio de los derechos que te
          reconozca la ley de tu domicilio.
        </p>
      </Section>

      <Section id="contacto" title="16. Contacto">
        <p>
          Para cualquier consulta sobre estos términos: {company},{" "}
          <a href={`mailto:${email}`} style={link}>
            {email}
          </a>
          .
        </p>
      </Section>

      <footer style={foot}>
        <Link href="/" style={link}>
          ← Volver a Driony
        </Link>
        <span style={{ margin: "0 10px", color: "var(--muted)" }}>·</span>
        <Link href="/privacy" style={link}>
          Política de privacidad
        </Link>
      </footer>
    </main>
  );
}

const SECCIONES: [string, string][] = [
  ["ambito", "A qué aplica"],
  ["cuenta", "Tu cuenta"],
  ["planes", "Planes y pagos"],
  ["uso-razonable", "Uso razonable"],
  ["whatsapp", "WhatsApp y Meta"],
  ["ia", "Inteligencia artificial"],
  ["uso", "Uso aceptable"],
  ["datos", "Tus datos"],
  ["disponibilidad", "Disponibilidad"],
  ["propiedad", "Propiedad intelectual"],
  ["api", "API e integraciones"],
  ["cancelacion", "Cancelación"],
  ["responsabilidad", "Responsabilidad"],
  ["cambios", "Cambios"],
  ["ley", "Ley aplicable"],
  ["contacto", "Contacto"],
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 32, scrollMarginTop: 24 }}>
      <h2 style={h2}>{title}</h2>
      <div style={{ color: "var(--muted)" }}>{children}</div>
    </section>
  );
}

const page: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "32px 24px 64px",
  color: "var(--text)",
  lineHeight: 1.7,
  fontSize: 15.5,
};
const top: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 36,
};
const brand: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 17,
  letterSpacing: "-0.01em",
  color: "var(--text)",
  textDecoration: "none",
};
const h1: React.CSSProperties = { fontSize: 30, margin: "0 0 4px", letterSpacing: "-0.02em" };
const h2: React.CSSProperties = { fontSize: 18, margin: "0 0 8px", color: "var(--text)" };
const lede: React.CSSProperties = { fontSize: 16.5, color: "var(--text)", marginTop: 20 };
const toc: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 22,
  padding: 14,
  borderRadius: 12,
  background: "var(--panel)",
  border: "1px solid var(--border)",
};
const tocLink: React.CSSProperties = {
  fontSize: 13,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  color: "var(--muted)",
  textDecoration: "none",
};
const link: React.CSSProperties = { color: "var(--accent)" };
const foot: React.CSSProperties = {
  marginTop: 48,
  paddingTop: 20,
  borderTop: "1px solid var(--border)",
  fontSize: 14,
};
