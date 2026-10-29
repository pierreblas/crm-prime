import Link from "next/link";

export const metadata = {
  title: "Política de privacidad — Driony",
  description:
    "Qué datos trata Driony, con qué fin, con quién los comparte y cómo ejercer tus derechos o pedir su eliminación.",
};

/**
 * Política de privacidad del servicio en la nube.
 *
 * Es la URL que se declara en la app de Meta (Política de privacidad e
 * Instrucciones de eliminación de datos, `#eliminacion`) y la que enlazan la
 * landing y la pantalla de conexión de WhatsApp. Los datos de contacto y el
 * nombre salen del entorno para que una instalación propia pueda cambiarlos
 * sin tocar el código.
 */
export default function PrivacyPage() {
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

      <h1 style={h1}>Política de privacidad</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Última actualización: 25 de septiembre de 2026
      </p>

      <p style={lede}>
        Esta política explica qué datos trata <strong>{company}</strong> al
        prestar el servicio Driony en <strong>{domain}</strong> (y en los
        subdominios de cada empresa, como <em>tu-empresa.{domain}</em>), con
        qué fin, con quién los comparte y cómo puedes ejercer tus derechos o
        pedir que se eliminen. Está escrita para leerse entera en unos minutos.
      </p>

      <nav aria-label="Índice" style={toc}>
        {SECCIONES.map(([id, titulo]) => (
          <a key={id} href={`#${id}`} style={tocLink}>
            {titulo}
          </a>
        ))}
      </nav>

      <Section id="ambito" title="1. A qué aplica esta política">
        <p>
          Aplica al servicio en la nube que operamos en {domain}. Driony también
          se distribuye como software de código abierto que cualquiera puede
          instalar en sus propios servidores; en ese caso, quien lo instala es
          quien trata los datos y quien debe publicar su propia política. Esta
          no le aplica.
        </p>
      </Section>

      <Section id="papeles" title="2. Dos papeles distintos">
        <p>
          Driony lo usan empresas para atender a sus clientes por WhatsApp. Eso
          nos coloca en dos papeles:
        </p>
        <ul>
          <li>
            <strong>Responsable</strong> de los datos de quienes tienen una
            cuenta en la plataforma: la empresa que se registra y las personas
            de su equipo que entran al panel.
          </li>
          <li>
            <strong>Encargado</strong> de los datos de los contactos de esas
            empresas —las personas que les escriben por WhatsApp—. De esos datos
            el responsable es la empresa que te atiende; nosotros los tratamos
            por su cuenta y siguiendo sus instrucciones.
          </li>
        </ul>
        <p>
          Si eres cliente de una empresa que usa Driony y quieres ejercer tus
          derechos sobre tus conversaciones, dirígete primero a esa empresa.
          Nosotros la ayudamos a atenderte.
        </p>
      </Section>

      <Section id="datos" title="3. Qué datos tratamos">
        <p>
          <strong>Cuenta de la plataforma.</strong> Nombre, correo electrónico
          y contraseña (guardada solo como hash bcrypt, nunca en claro) de cada
          usuario; nombre y subdominio de la empresa; rol de cada persona en su
          equipo; sesiones abiertas y dispositivos.
        </p>
        <p>
          <strong>Contactos y conversaciones.</strong> Nombre de perfil y número
          de teléfono de los contactos, el contenido de los mensajes
          intercambiados por WhatsApp (texto, archivos, ubicaciones), etiquetas,
          notas y etapa en el embudo de ventas que la empresa les asigne.
        </p>
        <p>
          <strong>Activos de Meta.</strong> Al conectar WhatsApp o una página de
          Facebook guardamos los identificadores de la cuenta de WhatsApp
          Business, del número y de la página, y los tokens de acceso que Meta
          emite para operar en nombre de la empresa. Los tokens se guardan
          cifrados.
        </p>
        <p>
          <strong>Inteligencia artificial.</strong> Cuando la empresa activa un
          agente de IA, el contenido de la conversación y la base de
          conocimiento que la empresa haya cargado se envían al proveedor de
          modelos que ella elija (ver sección 6). Guardamos un registro de cada
          respuesta generada: modelo usado, tokens consumidos y coste.
        </p>
        <p>
          <strong>Datos técnicos.</strong> Dirección IP, navegador y registros
          de actividad necesarios para la seguridad y el diagnóstico de fallos.
        </p>
      </Section>

      <Section id="fines" title="4. Para qué los usamos">
        <ul>
          <li>Prestar el servicio: recibir y enviar mensajes, organizar la bandeja, el embudo y las difusiones.</li>
          <li>Generar respuestas asistidas por IA cuando la empresa lo activa, en modo copiloto (una persona revisa) o autopiloto (el agente responde y escala a una persona según las reglas de la empresa).</li>
          <li>Mantener la cuenta: autenticación, permisos, avisos de servicio.</li>
          <li>Seguridad: detectar accesos indebidos, abusos y fallos.</li>
          <li>Cumplir obligaciones legales cuando existan.</li>
        </ul>
        <p>
          No usamos los datos para publicidad, no construimos perfiles con ellos
          y no los vendemos ni los cedemos con fines comerciales.
        </p>
      </Section>

      <Section id="meta" title="5. Datos obtenidos de Meta (WhatsApp, Facebook)">
        <p>
          Driony se conecta a la WhatsApp Business Platform y, si la empresa lo
          decide, a Facebook Lead Ads, mediante las APIs de Meta. Los datos que
          obtenemos por esa vía se usan únicamente para prestar el servicio a la
          empresa que conectó su cuenta, conforme a las Condiciones de la
          Plataforma de Meta y a las políticas de WhatsApp Business.
        </p>
        <ul>
          <li>Solo pedimos los permisos necesarios para gestionar la cuenta de WhatsApp Business y enviar y recibir mensajes en nombre de la empresa.</li>
          <li>Los tokens de acceso se guardan cifrados y se eliminan al desconectar el número o la página desde el panel.</li>
          <li>La empresa puede revocar el acceso en cualquier momento desde Driony (desconectar) o desde su configuración de Meta Business.</li>
        </ul>
      </Section>

      <Section id="ia" title="6. Inteligencia artificial">
        <p>
          Cada empresa elige el proveedor de modelos y el modelo con el que
          trabaja su agente: OpenAI, Anthropic o cualquier servicio compatible
          con la API de OpenAI, con su propia clave o con la de la plataforma.
          Sin clave propia, el agente usa la IA incluida en el plan, que
          funciona con OpenAI bajo la cuenta de Driony. El contenido de la
          conversación se envía a ese proveedor solo para generar la respuesta. Para la base de conocimiento usamos Voyage AI
          para convertir textos en vectores de búsqueda.
        </p>
        <p>
          Según las condiciones de uso de sus APIs, OpenAI y Anthropic no usan
          los datos enviados por API para entrenar sus modelos. Si la empresa
          configura otro proveedor con su propia clave, aplican las condiciones
          de ese proveedor.
        </p>
        <p>
          Una respuesta generada por IA siempre puede ser revisada, corregida o
          detenida por una persona del equipo, y la empresa puede fijar un
          límite de gasto mensual por agente.
        </p>
      </Section>

      <Section id="terceros" title="7. Con quién compartimos datos">
        <p>Solo con los proveedores necesarios para que el servicio funcione:</p>
        <ul>
          <li><strong>Meta Platforms</strong> — WhatsApp Business Platform y Facebook.</li>
          <li><strong>OpenAI</strong> y <strong>Anthropic</strong> — generación de respuestas de IA (cuando la empresa los elige, y OpenAI para la IA incluida en el plan).</li>
          <li><strong>Voyage AI</strong> — vectores de búsqueda para la base de conocimiento.</li>
          <li><strong>Cloudflare</strong> — DNS y protección del tráfico web.</li>
          <li>El proveedor de alojamiento donde se ejecutan los servidores y la base de datos.</li>
        </ul>
        <p>
          Cada uno actúa como encargado bajo sus propias condiciones y solo
          recibe lo imprescindible para su función. También podemos comunicar
          datos cuando una ley o una autoridad competente lo exija.
        </p>
      </Section>

      <Section id="transferencias" title="8. Transferencias internacionales">
        <p>
          Algunos de esos proveedores operan desde Estados Unidos u otros
          países. Cuando los datos salen de su país de origen nos apoyamos en
          las garantías que ofrece cada proveedor (cláusulas contractuales tipo
          u otros mecanismos reconocidos).
        </p>
      </Section>

      <Section id="conservacion" title="9. Cuánto tiempo los guardamos">
        <ul>
          <li>Los datos de la cuenta y las conversaciones, mientras la empresa mantenga su cuenta activa.</li>
          <li>Al cerrar la cuenta, o cuando la empresa lo pida, se eliminan en un plazo máximo de 30 días. Las copias de seguridad se sobrescriben en su ciclo de rotación, también dentro de 30 días.</li>
          <li>Los tokens de Meta, en cuanto se desconecta el número o la página.</li>
          <li>Los registros técnicos, el tiempo necesario para la seguridad y el diagnóstico, y nunca más de 12 meses.</li>
        </ul>
      </Section>

      <Section id="seguridad" title="10. Seguridad">
        <ul>
          <li>Cifrado en tránsito (HTTPS/TLS) en todas las conexiones.</li>
          <li>Tokens de Meta y claves de IA cifrados en la base de datos.</li>
          <li>Contraseñas con hash bcrypt; sesiones con tokens de corta vida y rotación.</li>
          <li>Aislamiento entre empresas también en la base de datos: cada consulta queda limitada a la empresa que la hace.</li>
          <li>Acceso al panel por roles, y registro de las acciones de la IA.</li>
        </ul>
      </Section>

      <Section id="cookies" title="11. Cookies">
        <p>
          Usamos únicamente cookies necesarias: la de sesión para mantener el
          acceso al panel y la preferencia de idioma. No usamos cookies de
          publicidad ni de seguimiento de terceros.
        </p>
      </Section>

      <Section id="derechos" title="12. Tus derechos">
        <p>
          Puedes pedir acceso a tus datos, corregirlos, eliminarlos, limitar u
          oponerte a su tratamiento y obtener una copia en un formato portable.
          Escríbenos a{" "}
          <a href={`mailto:${email}`} style={link}>
            {email}
          </a>{" "}
          desde el correo con el que estás registrado, o indica de qué empresa
          eres cliente si tu relación con Driony es a través de una de ellas.
          Respondemos en un plazo máximo de 30 días. Si crees que no hemos
          atendido tu solicitud, puedes acudir a la autoridad de protección de
          datos de tu país.
        </p>
      </Section>

      <Section id="eliminacion" title="13. Cómo eliminar tus datos">
        <p>
          Estas son las instrucciones de eliminación de datos, también para los
          datos obtenidos a través de Meta:
        </p>
        <ol>
          <li>
            <strong>Desconectar WhatsApp o Facebook.</strong> En el panel de tu
            empresa, en WhatsApp → Desconectar (o en Ajustes → Meta Leads para
            las páginas). Los tokens de acceso se eliminan en el acto y Driony
            deja de recibir datos de esa cuenta.
          </li>
          <li>
            <strong>Retirar la app en Meta.</strong> Desde tu configuración de
            Meta Business (Integraciones → Apps conectadas) puedes retirar el
            acceso de Driony; el resultado es el mismo.
          </li>
          <li>
            <strong>Eliminar la cuenta y todos sus datos.</strong> Escribe a{" "}
            <a href={`mailto:${email}`} style={link}>
              {email}
            </a>{" "}
            con el asunto «Eliminar cuenta» desde el correo de un administrador
            de la empresa. Eliminamos la empresa, sus usuarios, contactos,
            conversaciones y activos de Meta en un plazo máximo de 30 días y te
            lo confirmamos por correo.
          </li>
        </ol>
        <p>
          Si eres cliente de una empresa que usa Driony y quieres que se borren
          tus conversaciones con ella, pídeselo a esa empresa; puede hacerlo
          desde su panel y nosotros la ayudamos si hace falta.
        </p>
      </Section>

      <Section id="menores" title="14. Menores">
        <p>
          Driony es una herramienta para empresas y no está dirigida a menores
          de 18 años. No abrimos cuentas a menores a sabiendas.
        </p>
      </Section>

      <Section id="cambios" title="15. Cambios en esta política">
        <p>
          Si cambia algo relevante lo avisaremos en el panel o por correo antes
          de que entre en vigor. La fecha de arriba indica siempre la última
          versión.
        </p>
      </Section>

      <Section id="contacto" title="16. Contacto">
        <p>
          Para cualquier consulta sobre privacidad: {company},{" "}
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
      </footer>
    </main>
  );
}

const SECCIONES: [string, string][] = [
  ["ambito", "A qué aplica"],
  ["papeles", "Dos papeles"],
  ["datos", "Qué datos"],
  ["fines", "Para qué"],
  ["meta", "Datos de Meta"],
  ["ia", "Inteligencia artificial"],
  ["terceros", "Con quién"],
  ["transferencias", "Transferencias"],
  ["conservacion", "Conservación"],
  ["seguridad", "Seguridad"],
  ["cookies", "Cookies"],
  ["derechos", "Tus derechos"],
  ["eliminacion", "Eliminar tus datos"],
  ["menores", "Menores"],
  ["cambios", "Cambios"],
  ["contacto", "Contacto"],
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
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
