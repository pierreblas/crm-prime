"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  PLANS,
  SIGNUP_CODE_LENGTH,
  SIGNUP_CODE_MINUTES,
  TRIAL_DAYS,
  TRIAL_PLAN,
  signupAccountStepSchema,
  signupCompanyStepSchema,
  orgSlugSchema,
  suggestSlug,
} from "@crm/shared";
import { PasswordStrength } from "@/components/PasswordStrength";
import { NavIcon } from "@/components/NavIcons";
import { AGENT_GOAL_INFO, AGENT_TONE_INFO, BUSINESS_TYPES, type SetupDraft } from "@crm/shared";
import { checkSlug, registerOrg, requestSignupCode, type Campo } from "./actions";

/**
 * Alta de empresa en tres pasos y una salida.
 *
 *   1 · Tu empresa   — nombre y subdominio, con comprobación en vivo
 *   2 · Tu cuenta    — quién administra
 *   3 · Tu correo    — el código de 6 cifras que le llega: sin él no se crea
 *                      nada (solo si el servidor tiene correo del sistema)
 *   4 · Tu IA        — ya dentro, sin volver a escribir la contraseña: el
 *                      asistente de bienvenida (/bienvenida) arma su IA
 *
 * ¿Por qué en pasos y no todo junto? Porque las dos preguntas son de
 * naturaleza distinta y una de ellas necesita ida y vuelta al servidor (¿está
 * libre el subdominio?). Resolverla antes de pedir nada más evita el caso
 * peor: rellenar cinco campos y descubrir al final que el nombre estaba
 * cogido.
 *
 * Cada paso valida con un recorte del MISMO esquema que usa el servidor, así
 * que los mensajes son idénticos y no hay dos verdades.
 */

type Paso = "empresa" | "cuenta" | "correo" | "listo";

interface Campos {
  companyName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  password: string;
}

type Errores = Partial<Record<Campo, string>>;

type EstadoSlug =
  | { tipo: "vacio" }
  | { tipo: "invalido"; motivo: string }
  | { tipo: "comprobando" }
  | { tipo: "libre" }
  | { tipo: "ocupado"; motivo: string };

const PASOS_DE: Record<Campo, Paso> = {
  companyName: "empresa",
  slug: "empresa",
  adminName: "cuenta",
  adminEmail: "cuenta",
  password: "cuenta",
  emailCode: "correo",
};

/** El correo tal como lo compara el servidor. */
const normalizar = (email: string) => email.trim().toLowerCase();

export function SignupForm({
  baseDomain,
  setup = null,
  emailCode = false,
}: {
  baseDomain: string;
  setup?: SetupDraft | null;
  /** ¿Confirma el correo con un código? Solo si el servidor tiene correo del sistema. */
  emailCode?: boolean;
}) {
  const [paso, setPaso] = useState<Paso>("empresa");
  // Puede pasar a true si el servidor lo pide aunque la pantalla no lo supiera.
  const [pideCodigo, setPideCodigo] = useState(emailCode);
  const [codigo, setCodigo] = useState("");
  /** A qué correo se mandó el último código: si vuelve atrás sin cambiarlo, no se manda otro. */
  const [codigoEnviadoA, setCodigoEnviadoA] = useState<string | null>(null);
  /** Segundos hasta poder pedir otro código. */
  const [reenviarEn, setReenviarEn] = useState(0);
  /** Lo que pasó al reenviar el código: enviado (positivo) o el motivo por el que no. */
  const [avisoCodigo, setAvisoCodigo] = useState<{ ok: boolean; texto: string } | null>(null);
  const [campos, setCampos] = useState<Campos>({
    companyName: "",
    slug: "",
    adminName: "",
    adminEmail: "",
    password: "",
  });
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [slugTocado, setSlugTocado] = useState(false);
  const [estadoSlug, setEstadoSlug] = useState<EstadoSlug>({ tipo: "vacio" });
  const [resultado, setResultado] = useState<{ url: string; token: string } | null>(null);
  const [enviando, startTransition] = useTransition();
  const primerCampo = useRef<HTMLInputElement>(null);

  const set = (k: keyof Campos, v: string) => {
    setCampos((c) => ({ ...c, [k]: v }));
    // El error de un campo se retira en cuanto se vuelve a escribir en él.
    if (errores[k]) setErrores((e) => ({ ...e, [k]: undefined }));
  };

  // Al cambiar de paso, el foco va al primer campo: quien usa teclado no
  // tiene que buscar dónde está.
  useEffect(() => {
    primerCampo.current?.focus();
  }, [paso]);

  // Comprobación del subdominio con retardo. Si el esquema local ya lo
  // rechaza, se dice al momento y no se molesta al servidor.
  useEffect(() => {
    const s = campos.slug;
    if (!s) {
      setEstadoSlug({ tipo: "vacio" });
      return;
    }
    const local = orgSlugSchema.safeParse(s);
    if (!local.success) {
      setEstadoSlug({
        tipo: "invalido",
        motivo: local.error.issues[0]?.message ?? "No válido",
      });
      return;
    }
    setEstadoSlug({ tipo: "comprobando" });
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await checkSlug(s);
      // Si mientras tanto cambió el valor, esta respuesta ya no cuenta.
      if (!vigente) return;
      setEstadoSlug(
        r.available
          ? { tipo: "libre" }
          : { tipo: "ocupado", motivo: r.reason ?? "No disponible" },
      );
    }, 400);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [campos.slug]);

  // Cuenta atrás para «Reenviar código».
  useEffect(() => {
    if (reenviarEn <= 0) return;
    const t = setTimeout(() => setReenviarEn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [reenviarEn]);

  // Salida: al panel de la empresa nueva, ya con sesión.
  useEffect(() => {
    if (!resultado) return;
    const t = setTimeout(() => {
      window.location.assign(
        `${resultado.url}/handoff?token=${encodeURIComponent(resultado.token)}`,
      );
    }, 900);
    return () => clearTimeout(t);
  }, [resultado]);

  function continuar() {
    const v = signupCompanyStepSchema.safeParse({
      companyName: campos.companyName,
      slug: campos.slug,
    });
    if (!v.success) {
      const e: Errores = {};
      for (const i of v.error.issues) e[i.path[0] as Campo] ??= i.message;
      setErrores(e);
      return;
    }
    if (estadoSlug.tipo === "ocupado") {
      setErrores({ slug: estadoSlug.motivo });
      return;
    }
    if (estadoSlug.tipo === "comprobando") {
      // Se está comprobando: se espera la respuesta antes de avanzar, no se
      // avanza "a ver".
      startTransition(async () => {
        const r = await checkSlug(campos.slug);
        if (!r.available) {
          const motivo = r.reason ?? "No disponible";
          setEstadoSlug({ tipo: "ocupado", motivo });
          setErrores({ slug: motivo });
          return;
        }
        setEstadoSlug({ tipo: "libre" });
        setPaso("cuenta");
      });
      return;
    }
    setPaso("cuenta");
  }

  /** Paso 2: con código, primero se confirma el correo; sin código, se crea ya. */
  function confirmarCuenta() {
    const v = signupAccountStepSchema.safeParse({
      adminName: campos.adminName,
      adminEmail: campos.adminEmail,
      password: campos.password,
    });
    if (!v.success) {
      const e: Errores = {};
      for (const i of v.error.issues) e[i.path[0] as Campo] ??= i.message;
      setErrores(e);
      return;
    }
    setErrorGeneral(null);
    if (!pideCodigo) {
      crear();
      return;
    }
    // Ya hay un código para este mismo correo (volvió atrás a mirar algo):
    // no se manda otro, que el anterior sigue valiendo.
    if (codigoEnviadoA === normalizar(campos.adminEmail)) {
      setPaso("correo");
      return;
    }
    enviarCodigo(true);
  }

  /**
   * Manda (o reenvía) el código al correo de la cuenta. `irAlPaso`: desde el
   * paso 2, al salir bien se pasa a pedirlo; desde el 3, solo se avisa.
   */
  function enviarCodigo(irAlPaso: boolean) {
    setAvisoCodigo(null);
    startTransition(async () => {
      const r = await requestSignupCode(campos.adminEmail);
      if (!r.ok) {
        if (irAlPaso) setErrorGeneral(r.error);
        else setAvisoCodigo({ ok: false, texto: r.error });
        return;
      }
      setCodigoEnviadoA(normalizar(campos.adminEmail));
      setReenviarEn(r.resendInSeconds);
      setCodigo("");
      setErrores((e) => ({ ...e, emailCode: undefined }));
      setErrorGeneral(null);
      if (irAlPaso) setPaso("correo");
      else setAvisoCodigo({ ok: true, texto: "Te mandamos un código nuevo; el anterior ya no sirve." });
    });
  }

  /** Crea la empresa. `valorCodigo` llega cuando se envía solo al escribir la última cifra. */
  function crear(valorCodigo?: string) {
    const valor = valorCodigo ?? codigo;
    if (pideCodigo && valor.length !== SIGNUP_CODE_LENGTH) {
      setErrores({ emailCode: `El código tiene ${SIGNUP_CODE_LENGTH} cifras` });
      return;
    }
    setErrorGeneral(null);
    setAvisoCodigo(null);
    startTransition(async () => {
      const datos = { ...campos, ...(pideCodigo ? { emailCode: valor } : {}), ...(setup ? { setup } : {}) };
      const r = await registerOrg(datos);
      if (!r.ok) {
        if (r.field === "emailCode" && !pideCodigo) {
          // La pantalla creía que no hacía falta y el servidor dice que sí:
          // se manda el código y se pasa a pedirlo.
          setPideCodigo(true);
          enviarCodigo(true);
          return;
        }
        if (r.field) {
          setErrores({ [r.field]: r.error });
          // El error puede ser de un campo de un paso anterior (el subdominio
          // se lo llevó alguien mientras rellenabas la cuenta): se vuelve
          // allí, con el campo marcado, en vez de enseñarlo lejos de la causa.
          setPaso(PASOS_DE[r.field]);
        } else {
          setErrorGeneral(r.error);
        }
        return;
      }
      setResultado({ url: r.url, token: r.handoffToken });
      setPaso("listo");
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (paso === "empresa") continuar();
    else if (paso === "cuenta") confirmarCuenta();
    else if (paso === "correo") crear();
  }

  const host = `${campos.slug || "tu-empresa"}.${baseDomain}`;

  return (
    <form onSubmit={onSubmit} style={caja} noValidate aria-busy={enviando}>
      <style>{css}</style>

      <Progreso paso={paso} pideCodigo={pideCodigo} />

      {setup && paso === "empresa" && (
        <p style={notaAgente} data-signup-setup>
          Con la cuenta queda listo tu agente <b>{setup.agentName || "Asistente"}</b>: {BUSINESS_TYPES[setup.businessType].label.toLowerCase()}, misión «
          {AGENT_GOAL_INFO[setup.goal].title.toLowerCase()}», tono {AGENT_TONE_INFO[setup.tone].title.toLowerCase()}. Lo ajustas al entrar.
        </p>
      )}

      {paso === "empresa" && (
        <section key="p1" className="signup-paso" aria-labelledby="t1">
          <h1 id="t1" style={titulo}>
            Tu empresa
          </h1>
          <p style={subtitulo}>Elige cómo se llama y dónde va a vivir.</p>

          <CampoTexto
            id="companyName"
            label="Nombre de la empresa"
            value={campos.companyName}
            error={errores.companyName}
            inputRef={primerCampo}
            autoComplete="organization"
            placeholder="Acme S.A."
            onChange={(v) => {
              set("companyName", v);
              if (!slugTocado) set("slug", suggestSlug(v));
            }}
          />

          <label htmlFor="slug" style={etiqueta}>
            Dirección de tu panel
          </label>
          <div style={grupoSlug} data-error={!!errores.slug}>
            <span style={afijo}>https://</span>
            <input
              id="slug"
              name="slug"
              value={campos.slug}
              onChange={(e) => {
                setSlugTocado(true);
                set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"));
              }}
              placeholder="acme"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={!!errores.slug}
              aria-describedby="slug-estado"
              style={{
                ...campo,
                border: "none",
                background: "transparent",
                flex: 1,
                minWidth: 0,
                padding: "10px 0",
              }}
            />
            <span style={afijo}>.{baseDomain}</span>
          </div>
          <p
            id="slug-estado"
            role="status"
            aria-live="polite"
            style={{ ...pista, color: colorSlug(estadoSlug, errores.slug) }}
          >
            {errores.slug ?? textoSlug(estadoSlug)}
          </p>

          <button type="submit" style={botonPrimario} disabled={enviando}>
            Continuar
          </button>
        </section>
      )}

      {paso === "cuenta" && (
        <section key="p2" className="signup-paso" aria-labelledby="t2">
          <h1 id="t2" style={titulo}>
            Tu cuenta
          </h1>
          <p style={subtitulo}>
            Serás quien administre{" "}
            <strong style={{ color: "var(--text)" }}>{host}</strong>.
          </p>

          <CampoTexto
            id="adminName"
            label="Tu nombre"
            value={campos.adminName}
            error={errores.adminName}
            inputRef={primerCampo}
            autoComplete="name"
            placeholder="Ana Pérez"
            onChange={(v) => set("adminName", v)}
          />
          <CampoTexto
            id="adminEmail"
            label="Tu correo"
            type="email"
            value={campos.adminEmail}
            error={errores.adminEmail}
            autoComplete="email"
            placeholder="ana@acme.com"
            onChange={(v) => set("adminEmail", v)}
          />

          <label htmlFor="password" style={etiqueta}>
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={campos.password}
            onChange={(e) => set("password", e.target.value)}
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
            aria-invalid={!!errores.password}
            aria-describedby={errores.password ? "password-error" : undefined}
            style={{ ...campo, ...(errores.password ? campoError : {}) }}
          />
          {errores.password ? (
            <p id="password-error" style={{ ...pista, color: DANGER }}>
              {errores.password}
            </p>
          ) : (
            <div style={{ marginTop: 6 }}>
              <PasswordStrength value={campos.password} />
            </div>
          )}

          {errorGeneral && (
            <p role="alert" style={{ ...pista, color: DANGER, marginTop: 14 }}>
              {errorGeneral}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button
              type="button"
              onClick={() => setPaso("empresa")}
              style={botonFantasma}
              disabled={enviando}
            >
              Volver
            </button>
            <button
              type="submit"
              style={{ ...botonPrimario, marginTop: 0, flex: 1 }}
              disabled={enviando}
            >
              {textoBotonCuenta(pideCodigo, enviando)}
            </button>
          </div>
          {pideCodigo ? (
            <p style={{ ...pista, textAlign: "center", marginTop: 14 }}>
              Te mandaremos un código a tu correo para confirmar que es tuyo.
            </p>
          ) : (
            <NotaPrueba />
          )}
        </section>
      )}

      {paso === "correo" && (
        <section key="p3" className="signup-paso" aria-labelledby="t3" data-signup-code>
          <h1 id="t3" style={titulo}>
            Confirma tu correo
          </h1>
          <p style={subtitulo}>
            Te mandamos un código de {SIGNUP_CODE_LENGTH} cifras a{" "}
            <strong style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{campos.adminEmail.trim()}</strong>.
            Escríbelo aquí para crear tu empresa.
          </p>

          <label htmlFor="emailCode" style={etiqueta}>
            Código
          </label>
          <input
            ref={primerCampo}
            id="emailCode"
            name="emailCode"
            value={codigo}
            onChange={(e) => {
              // Al pegar «123 456» o «123-456» quedan solo las cifras.
              const v = e.target.value.replace(/\D/g, "").slice(0, SIGNUP_CODE_LENGTH);
              const completo = v.length === SIGNUP_CODE_LENGTH && codigo.length !== SIGNUP_CODE_LENGTH;
              setCodigo(v);
              if (errores.emailCode) setErrores((er) => ({ ...er, emailCode: undefined }));
              // Con la última cifra se envía solo: no queda nada más que rellenar.
              if (completo && !enviando) crear(v);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={"0".repeat(SIGNUP_CODE_LENGTH)}
            aria-invalid={!!errores.emailCode}
            aria-describedby={errores.emailCode ? "emailCode-error" : "emailCode-pista"}
            style={{ ...campo, ...campoCodigo, ...(errores.emailCode ? campoError : {}) }}
          />
          {errores.emailCode ? (
            <p id="emailCode-error" role="alert" style={{ ...pista, color: DANGER }}>
              {errores.emailCode}
            </p>
          ) : (
            <p id="emailCode-pista" style={pista}>
              Vale {SIGNUP_CODE_MINUTES} minutos. Si no lo ves, revisa la carpeta de spam o de promociones.
            </p>
          )}

          {errorGeneral && (
            <p role="alert" style={{ ...pista, color: DANGER, marginTop: 14 }}>
              {errorGeneral}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button
              type="button"
              onClick={() => setPaso("cuenta")}
              style={botonFantasma}
              disabled={enviando}
            >
              Volver
            </button>
            <button
              type="submit"
              style={{ ...botonPrimario, marginTop: 0, flex: 1 }}
              disabled={enviando}
            >
              {enviando ? "Creando…" : "Crear empresa"}
            </button>
          </div>

          <p role="status" aria-live="polite" style={{ ...pista, textAlign: "center", marginTop: 14 }}>
            {avisoCodigo && (
              <span style={{ display: "block", marginBottom: 4, color: avisoCodigo.ok ? POSITIVE : DANGER }}>
                {avisoCodigo.texto}
              </span>
            )}
            {reenviarEn > 0 ? (
              <>¿No te llegó? Puedes pedir otro en {reenviarEn} s.</>
            ) : (
              <>
                ¿No te llegó?{" "}
                <button type="button" onClick={() => enviarCodigo(false)} style={enlaceBoton} disabled={enviando}>
                  Reenviar código
                </button>
                {" · "}
                <button type="button" onClick={() => setPaso("cuenta")} style={enlaceBoton} disabled={enviando}>
                  Cambiar correo
                </button>
              </>
            )}
          </p>
          <NotaPrueba />
        </section>
      )}

      {paso === "listo" && resultado && (
        <section key="p4" className="signup-paso" aria-labelledby="t4" aria-live="polite">
          <div style={sello} aria-hidden="true">
            <NavIcon name="check" size={24} />
          </div>
          <h1 id="t4" style={{ ...titulo, textAlign: "center" }}>
            Tu empresa está creada
          </h1>
          <p style={{ ...subtitulo, textAlign: "center" }}>
            Ahora armamos tu IA de WhatsApp en{" "}
            <strong style={{ color: "var(--text)" }}>
              {resultado.url.replace(/^https?:\/\//, "")}
            </strong>
            …
          </p>
          <p style={{ ...pista, textAlign: "center", marginTop: 18 }}>
            Tu prueba de {PLANS[TRIAL_PLAN].name} de {TRIAL_DAYS} días ya está en marcha.
            <br />
            Guarda esa dirección: es por donde entrará tu equipo.
            <br />
            Si no te lleva solo,{" "}
            <a href={`${resultado.url}/login`} style={{ color: "var(--accent-text)" }}>
              entra aquí
            </a>
            .
          </p>
        </section>
      )}
    </form>
  );
}

// ── Piezas ───────────────────────────────────────────────────

const ETIQUETA_PASO: Record<Paso, string> = {
  empresa: "Tu empresa",
  cuenta: "Tu cuenta",
  correo: "Tu correo",
  listo: "Tu IA",
};

function Progreso({ paso, pideCodigo }: { paso: Paso; pideCodigo: boolean }) {
  // El último paso, la IA, se hace ya dentro de la empresa (/bienvenida).
  // «Tu correo» solo existe si el servidor manda el código.
  const pasos: Paso[] = pideCodigo ? ["empresa", "cuenta", "correo", "listo"] : ["empresa", "cuenta", "listo"];
  const n = pasos.indexOf(paso) + 1;
  return (
    <div style={{ marginBottom: 22 }} aria-label={`Paso ${n} de ${pasos.length}`}>
      <div style={{ display: "flex", gap: 6 }}>
        {pasos.map((p, i) => (
          <div
            key={p}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 999,
              background: i < n ? "var(--accent)" : "var(--border)",
              transition: "background 0.25s ease",
            }}
          />
        ))}
      </div>
      <div style={{ ...overline, marginTop: 8 }}>{`Paso ${n} de ${pasos.length} · ${ETIQUETA_PASO[paso]}`}</div>
    </div>
  );
}

function textoBotonCuenta(pideCodigo: boolean, enviando: boolean): string {
  if (pideCodigo) return enviando ? "Enviando código…" : "Continuar";
  return enviando ? "Creando…" : "Crear empresa";
}

/** La prueba gratis, debajo del botón que crea la empresa. */
function NotaPrueba() {
  return (
    <p style={{ ...pista, textAlign: "center", marginTop: 14 }}>
      Empiezas con {TRIAL_DAYS} días de {PLANS[TRIAL_PLAN].name} gratis, sin tarjeta. Al terminar
      sigues en el plan Gratis sin perder nada.
    </p>
  );
}

function CampoTexto({
  id,
  label,
  value,
  error,
  onChange,
  inputRef,
  type = "text",
  autoComplete,
  placeholder,
}: {
  id: Campo;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <>
      <label htmlFor={id} style={etiqueta}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        style={{ ...campo, ...(error ? campoError : {}) }}
      />
      {error && (
        <p id={`${id}-error`} style={{ ...pista, color: DANGER }}>
          {error}
        </p>
      )}
    </>
  );
}

function textoSlug(e: EstadoSlug): string {
  switch (e.tipo) {
    case "vacio":
      return "Minúsculas, números y guiones. Mínimo 3 caracteres.";
    case "invalido":
      return e.motivo;
    case "comprobando":
      return "Comprobando…";
    case "libre":
      return "Disponible";
    case "ocupado":
      return e.motivo;
  }
}

function colorSlug(e: EstadoSlug, error?: string): string {
  if (error || e.tipo === "ocupado" || e.tipo === "invalido") return DANGER;
  if (e.tipo === "libre") return POSITIVE;
  return "var(--muted)";
}

// ── Estilo: los tokens del sistema (La Sala de Control) ──────
// Peligro y positivo salen de DESIGN.md; no existen aún como variables CSS.

const DANGER = "var(--danger)";
const POSITIVE = "var(--positive)";

const css = `
.signup-paso { animation: signup-entrar 0.18s ease-out; }
@keyframes signup-entrar {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}
[data-error="true"] { border-color: ${DANGER} !important; }
@media (prefers-reduced-motion: reduce) {
  .signup-paso { animation: none; }
}
`;

/** Lo que viene del simulador de la landing: se ve en el primer paso y se manda con el alta. */
const notaAgente: React.CSSProperties = {
  margin: "0 0 16px",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  background: "var(--surface-2, rgba(255,255,255,0.04))",
  color: "var(--muted)",
  fontSize: 13,
  lineHeight: 1.5,
};

const caja: React.CSSProperties = {
  width: "100%",
  maxWidth: 400,
  padding: 28,
  borderRadius: "var(--r-lg)",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  boxShadow: "var(--shadow-card)",
};
const titulo: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: "-0.01em",
};
const subtitulo: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 14,
  margin: "6px 0 0",
};
const overline: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.6px",
  color: "var(--muted)",
};
const etiqueta: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  marginTop: 16,
  marginBottom: 6,
};
const campo: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "var(--r-sm)",
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  font: "inherit",
};
const campoError: React.CSSProperties = { borderColor: DANGER };
/** El código, grande y en monoespaciada: se lee de un vistazo y se compara con el del correo. */
const campoCodigo: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 24,
  letterSpacing: "0.4em",
  textAlign: "center",
  padding: "12px 12px",
};
/** Acción secundaria dentro de una frase («Reenviar código»). */
const enlaceBoton: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--accent-text)",
  font: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
};
const grupoSlug: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  borderRadius: "var(--r-sm)",
  border: "1px solid var(--border)",
  background: "var(--field)",
  overflow: "hidden",
};
const afijo: React.CSSProperties = {
  padding: "10px 10px",
  color: "var(--muted)",
  fontSize: 13,
  whiteSpace: "nowrap",
  userSelect: "none",
};
const pista: React.CSSProperties = {
  fontSize: 12,
  margin: "6px 0 0",
  color: "var(--muted)",
  lineHeight: 1.5,
};
const botonPrimario: React.CSSProperties = {
  width: "100%",
  marginTop: 22,
  padding: "11px 14px",
  borderRadius: "var(--r-sm)",
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  font: "inherit",
  cursor: "pointer",
};
const botonFantasma: React.CSSProperties = {
  padding: "11px 14px",
  borderRadius: "var(--r-sm)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  font: "inherit",
  cursor: "pointer",
};
const sello: React.CSSProperties = {
  width: 44,
  height: 44,
  margin: "0 auto 14px",
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  background: "var(--accent-soft)",
  color: "var(--accent-text)",
  fontSize: 22,
  fontWeight: 700,
};
