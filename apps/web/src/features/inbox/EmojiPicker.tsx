"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NavIcon } from "@/components/NavIcons";

/**
 * Selector de emojis del cuadro de redacción.
 *
 * Sin dependencias a propósito: una librería completa de emojis son cientos de
 * KB y varios miles de entradas que este oficio no usa. Aquí hay un juego
 * curado para venta por WhatsApp, con búsqueda en español y una fila de
 * recientes que aprende de lo que el vendedor usa de verdad.
 */

const RECENT_KEY = "crm.emoji.recent";
const RECENT_MAX = 24;

interface Group {
  id: string;
  label: string;
  icon: "smile" | "user" | "tag" | "bolt" | "check";
  emojis: [string, string][]; // [emoji, palabras de búsqueda]
}

const GROUPS: Group[] = [
  {
    id: "caras",
    label: "Caras",
    icon: "smile",
    emojis: [
      ["😀", "sonrisa feliz contento"],
      ["😃", "sonrisa alegre"],
      ["😄", "risa feliz"],
      ["😁", "risa dientes"],
      ["😅", "risa sudor nervios"],
      ["😂", "risa llorar carcajada"],
      ["🤣", "carcajada suelo risa"],
      ["🙂", "sonrisa leve"],
      ["😊", "sonrojo amable contento"],
      ["😇", "angel inocente"],
      ["😉", "guiño"],
      ["😍", "amor corazones encanta"],
      ["🥰", "cariño amor"],
      ["😘", "beso"],
      ["🤗", "abrazo"],
      ["🤔", "pensar duda"],
      ["🤨", "ceja duda escepticismo"],
      ["😐", "neutral"],
      ["😴", "dormir sueño"],
      ["😌", "alivio tranquilo"],
      ["😎", "gafas guay cool"],
      ["🥳", "fiesta celebrar"],
      ["😢", "triste llorar"],
      ["😭", "llanto muy triste"],
      ["😥", "alivio preocupado"],
      ["😳", "sorpresa verguenza"],
      ["😱", "susto miedo grito"],
      ["😡", "enfado enojado molesto"],
      ["🙄", "ojos hartazgo"],
      ["😬", "incomodo mueca"],
      ["🤝", "acuerdo trato apreton"],
      ["🙏", "gracias favor por favor rezar"],
    ],
  },
  {
    id: "gestos",
    label: "Gestos",
    icon: "user",
    emojis: [
      ["👍", "bien ok pulgar aprobado"],
      ["👎", "mal no pulgar"],
      ["👌", "perfecto ok vale"],
      ["✌️", "paz victoria"],
      ["🤞", "suerte dedos cruzados"],
      ["👏", "aplauso bravo felicidades"],
      ["🙌", "celebrar manos arriba"],
      ["💪", "fuerza animo"],
      ["👋", "hola saludo adios"],
      ["✋", "alto espera mano"],
      ["👉", "señalar derecha mira"],
      ["👇", "señalar abajo aqui"],
      ["☝️", "atencion importante"],
      ["🤙", "llamame"],
      ["✍️", "escribir firma"],
      ["🫰", "dinero precio dedos"],
    ],
  },
  {
    id: "negocio",
    label: "Negocio",
    icon: "tag",
    emojis: [
      ["💰", "dinero plata precio pago"],
      ["💵", "billete dinero efectivo"],
      ["💳", "tarjeta pago credito"],
      ["🧾", "recibo factura boleta"],
      ["🛒", "carrito compra pedido"],
      ["🛍️", "bolsa compra tienda"],
      ["📦", "paquete envio caja pedido"],
      ["🚚", "envio reparto camion delivery"],
      ["🏷️", "etiqueta precio oferta"],
      ["🎁", "regalo promocion obsequio"],
      ["📈", "subida crecimiento ventas"],
      ["🏪", "tienda local negocio"],
      ["🧿", "producto articulo"],
      ["💼", "trabajo maletin negocio"],
      ["🤑", "ganancia dinero"],
      ["🔥", "oferta caliente promocion"],
      ["⭐", "estrella calidad favorito"],
      ["💯", "cien perfecto total"],
    ],
  },
  {
    id: "utiles",
    label: "Útiles",
    icon: "bolt",
    emojis: [
      ["📱", "celular telefono movil whatsapp"],
      ["📞", "llamada telefono"],
      ["📲", "llamame celular"],
      ["✉️", "correo email mensaje"],
      ["📧", "email correo"],
      ["📍", "ubicacion direccion lugar"],
      ["🗺️", "mapa ubicacion"],
      ["🕐", "hora reloj tiempo"],
      ["📅", "calendario fecha cita"],
      ["⏰", "alarma recordatorio hora"],
      ["📸", "foto camara imagen"],
      ["🎥", "video camara"],
      ["📎", "adjunto archivo clip"],
      ["📄", "documento archivo pdf"],
      ["🔗", "enlace link url"],
      ["💬", "mensaje chat comentario"],
      ["🌐", "web internet sitio"],
      ["🏠", "casa domicilio direccion"],
    ],
  },
  {
    id: "simbolos",
    label: "Símbolos",
    icon: "check",
    emojis: [
      ["✅", "listo hecho correcto confirmado"],
      ["☑️", "marcado check"],
      ["❌", "no error cancelado"],
      ["⚠️", "aviso cuidado advertencia"],
      ["❗", "importante atencion"],
      ["❓", "duda pregunta"],
      ["💡", "idea sugerencia consejo"],
      ["🔔", "aviso notificacion recordatorio"],
      ["❤️", "amor corazon rojo"],
      ["💚", "corazon verde"],
      ["🎉", "celebracion fiesta felicidades"],
      ["🎊", "celebracion confeti"],
      ["✨", "brillo nuevo especial"],
      ["🚀", "rapido lanzamiento crecer"],
      ["👀", "mirar atencion ojos"],
      ["🆕", "nuevo novedad"],
      ["🆗", "ok vale"],
      ["🔝", "top mejor arriba"],
    ],
  },
];

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]).slice(0, RECENT_MAX) : [];
  } catch {
    // Ventana privada o almacenamiento bloqueado: sin recientes, sin drama.
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* no pasa nada si no se puede guardar */
  }
}

export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(GROUPS[0]!.id);
  const [recent, setRecent] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setRecent(loadRecent()), []);

  // Cerrar al pulsar fuera o con Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return GROUPS.flatMap((g) => g.emojis)
      .filter(([, words]) => words.includes(q) || words.split(" ").some((w) => w.startsWith(q)))
      .map(([e]) => e)
      .slice(0, 40);
  }, [query]);

  function pick(emoji: string) {
    onPick(emoji);
    const next = [emoji, ...recent.filter((e) => e !== emoji)];
    setRecent(next);
    saveRecent(next);
  }

  const current = GROUPS.find((g) => g.id === group) ?? GROUPS[0]!;

  return (
    <div ref={panelRef} style={panel} role="dialog" aria-label="Emojis">
      <div style={head}>
        <NavIcon name="search" size={14} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar: gracias, precio, envío…"
          style={input}
        />
      </div>

      {!results && recent.length > 0 && (
        <>
          <div style={sectionLabel}>Recientes</div>
          <div style={grid}>
            {recent.map((e) => (
              <button key={`r-${e}`} onClick={() => pick(e)} style={cell}>
                {e}
              </button>
            ))}
          </div>
        </>
      )}

      {results ? (
        results.length === 0 ? (
          <div style={empty}>Ningún emoji para «{query.trim()}».</div>
        ) : (
          <div style={grid}>
            {results.map((e) => (
              <button key={`s-${e}`} onClick={() => pick(e)} style={cell}>
                {e}
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <div style={sectionLabel}>{current.label}</div>
          <div style={{ ...grid, maxHeight: 168, overflowY: "auto" }}>
            {current.emojis.map(([e]) => (
              <button key={`g-${e}`} onClick={() => pick(e)} style={cell}>
                {e}
              </button>
            ))}
          </div>
        </>
      )}

      {!results && (
        <div style={tabs}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              title={g.label}
              style={tab(g.id === group)}
            >
              <NavIcon name={g.icon} size={15} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  bottom: "100%",
  left: 16,
  marginBottom: 8,
  width: 300,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface, var(--panel))",
  boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
  overflow: "hidden",
  zIndex: 30,
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
};

const input: React.CSSProperties = {
  flex: 1,
  border: "none",
  background: "transparent",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
};

const sectionLabel: React.CSSProperties = {
  padding: "8px 12px 4px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--muted)",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(8, 1fr)",
  gap: 2,
  padding: "0 8px 8px",
};

const cell: React.CSSProperties = {
  border: "none",
  background: "transparent",
  borderRadius: 7,
  padding: "5px 0",
  fontSize: 20,
  lineHeight: 1.2,
  cursor: "pointer",
  transition: "background 120ms",
};

const empty: React.CSSProperties = {
  padding: "14px 12px",
  fontSize: 12.5,
  color: "var(--muted)",
};

const tabs: React.CSSProperties = {
  display: "flex",
  borderTop: "1px solid var(--border)",
};

function tab(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "9px 0",
    border: "none",
    background: active ? "rgba(37,211,102,0.12)" : "transparent",
    color: active ? "var(--positive, var(--positive))" : "var(--muted)",
    cursor: "pointer",
    transition: "background 140ms, color 140ms",
  };
}
