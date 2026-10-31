"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  signupAccountStepSchema,
  signupCompanyStepSchema,
  orgSlugSchema,
  suggestSlug,
} from "@crm/shared";
import { PasswordStrength } from "@/components/PasswordStrength";
import { NavIcon } from "@/components/NavIcons";
import { checkSlug, registerOrg, type Campo } from "./actions";

/**
 * Alta de empresa en dos pasos y una salida.
 *
 *   1 · Tu empresa   — nombre y subdominio, con comprobación en vivo
 *   2 · Tu cuenta    — quién administra
 *   3 · Tu IA        — ya dentro, sin volver a escribir la contraseña: el
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

type Paso = 1 | 2 | 3;

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

const PASOS_DE = {
  companyName: 1,
  slug: 1,
  adminName: 2,
  adminEmail: 2,
  password: 2,
} as const;

export function SignupForm({ baseDomain }: { baseDomain: string }) {
  const [paso, setPaso] = useState<Paso>(1);
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
        setPaso(2);
      });
      return;
    }
    setPaso(2);
  }

  function crear() {
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
    startTransition(async () => {
      const r = await registerOrg(campos);
      if (!r.ok) {
        if (r.field) {
          setErrores({ [r.field]: r.error });
          // El error puede ser de un campo del paso anterior (el subdominio
          // se lo llevó alguien mientras rellenabas la cuenta): se vuelve
          // allí, con el campo marcado, en vez de enseñarlo lejos de la causa.
          setPaso(PASOS_DE[r.field]);
        } else {
          setErrorGeneral(r.error);
        }
        return;
      }
      setResultado({ url: r.url, token: r.handoffToken });
      setPaso(3);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (paso === 1) continuar();
    else if (paso === 2) crear();
  }

  const host = `${campos.slug || "tu-empresa"}.${baseDomain}`;

  return (
    <form onSubmit={onSubmit} style={caja} noValidate aria-busy={enviando}>
      <style>{css}</style>

      <Progreso paso={paso} />

      {paso === 1 && (
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

      {paso === 2 && (
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
              onClick={() => setPaso(1)}
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
        </section>
      )}

      {paso === 3 && resultado && (
        <section key="p3" className="signup-paso" aria-labelledby="t3" aria-live="polite">
          <div style={sello} aria-hidden="true">
            <NavIcon name="check" size={24} />
          </div>
          <h1 id="t3" style={{ ...titulo, textAlign: "center" }}>
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
            Guarda esa dirección: es por donde entrará tu equipo.
            <br />
            Si no te lleva solo,{" "}
            <a href={`${resultado.url}/login`} style={{ color: "var(--accent)" }}>
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

function Progreso({ paso }: { paso: Paso }) {
  // El tercer paso, la IA, se hace ya dentro de la empresa (/bienvenida).
  const etiquetas = ["Tu empresa", "Tu cuenta", "Tu IA"];
  return (
    <div style={{ marginBottom: 22 }} aria-label={`Paso ${paso} de ${etiquetas.length}`}>
      <div style={{ display: "flex", gap: 6 }}>
        {etiquetas.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 999,
              background: i < paso ? "var(--accent)" : "var(--border)",
              transition: "background 0.25s ease",
            }}
          />
        ))}
      </div>
      <div style={{ ...overline, marginTop: 8 }}>
        {`Paso ${paso} de ${etiquetas.length} · ${etiquetas[paso - 1]}`}
      </div>
    </div>
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

const DANGER = "#e08a8a";
const POSITIVE = "#7ee2a8";

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

const caja: React.CSSProperties = {
  width: "100%",
  maxWidth: 400,
  padding: 28,
  borderRadius: 12,
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
  textTransform: "uppercase",
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
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  font: "inherit",
};
const campoError: React.CSSProperties = { borderColor: DANGER };
const grupoSlug: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  borderRadius: 8,
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
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  font: "inherit",
  cursor: "pointer",
};
const botonFantasma: React.CSSProperties = {
  padding: "11px 14px",
  borderRadius: 8,
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
  color: "var(--accent)",
  fontSize: 22,
  fontWeight: 700,
};
