// Familia de iconos de línea unificada (estilo lucide: trazo 1.75, 24×24,
// esquinas/uniones redondeadas). Se usa en el nav lateral y en los flujos
// para mantener una sola línea gráfica en toda la app.

export type IconName =
  // Navegación
  | "inbox"
  | "pipeline"
  | "bot"
  | "flow"
  | "megaphone"
  | "book"
  | "whatsapp"
  | "logout"
  // Bloques de flujo
  | "message"
  | "question"
  | "branch"
  | "bolt"
  | "clock"
  | "globe"
  | "user"
  | "jump"
  | "play"
  | "tag"
  | "settings"
  // Bandeja / conversación
  | "check"
  | "check-double"
  | "paperclip"
  | "sparkles"
  | "send"
  | "pause"
  | "image"
  | "file"
  | "search"
  | "arrow-down"
  | "reply"
  | "zap"
  | "x"
  | "alert"
  | "smile"
  // Plantillas y ajustes
  | "video"
  | "map-pin"
  | "link"
  | "phone"
  | "copy"
  | "expand"
  | "key"
  | "plug"
  | "antenna"
  | "puzzle"
  | "target"
  | "trophy"
  | "package"
  | "arrow-left"
  | "arrow-up"
  // Acciones del inbox
  | "template"
  | "buttons"
  | "note"
  | "plus"
  | "filter"
  | "inbox-check"
  | "hourglass"
  | "bell"
  | "bell-off"
  // Varios (sustituyen a emojis)
  | "flask"
  | "wrench"
  | "pencil"
  | "mic"
  | "chevron-down"
  // Primeros pasos y tours
  | "rocket"
  | "arrow-right"
  | "minus"
  | "lock"
  | "wand"
  | "chart";

export function NavIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "rocket":
      return (
        <svg {...p}>
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...p}>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case "minus":
      return (
        <svg {...p}>
          <path d="M5 12h14" />
        </svg>
      );
    case "chart":
      return (
        <svg {...p}>
          <path d="M3 3v18h18" />
          <path d="m7 15 4-4 3 3 5-6" />
        </svg>
      );
    case "wand":
      return (
        <svg {...p}>
          <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
          <path d="m14 7 3 3" />
          <path d="M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9" />
        </svg>
      );
    case "lock":
      return (
        <svg {...p}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...p}>
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
        </svg>
      );
    case "pipeline":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="5" height="16" rx="1.5" />
          <rect x="9.5" y="4" width="5" height="10" rx="1.5" />
          <rect x="16" y="4" width="5" height="13" rx="1.5" />
        </svg>
      );
    case "bot":
      return (
        <svg {...p}>
          <rect x="4" y="8" width="16" height="11" rx="3" />
          <path d="M12 8V5" />
          <circle cx="12" cy="3.6" r="1.1" />
          <path d="M2 14h1.5M20.5 14H22M9 13v1.5M15 13v1.5" />
        </svg>
      );
    case "flow":
      return (
        <svg {...p}>
          <rect x="3.5" y="3.5" width="6" height="5" rx="1.5" />
          <rect x="14.5" y="15.5" width="6" height="5" rx="1.5" />
          <path d="M6.5 8.5v4a2 2 0 0 0 2 2h9" />
        </svg>
      );
    case "megaphone":
      return (
        <svg {...p}>
          <path d="m3 11 16-5v12L3 14z" />
          <path d="M6 14v3a2 2 0 0 0 4 0" />
          <path d="M19 9a3 3 0 0 1 0 6" />
        </svg>
      );
    case "book":
      return (
        <svg {...p}>
          <path d="M12 7v14" />
          <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...p}>
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2.5 21.5z" />
          <path d="M9.3 9.2c-.2 0-.4.1-.6.3-.3.3-.6.7-.6 1.4 0 .8.6 1.6.7 1.7.1.2 1.1 1.9 2.8 2.6 1.4.6 1.7.5 2 .4.3 0 .9-.4 1-.7.2-.4.2-.7.1-.8l-.6-.3c-.3-.1-.6-.3-.8-.3-.2 0-.3-.1-.5.1l-.4.5c-.1.1-.2.1-.4 0-.2-.1-.7-.3-1.3-.8-.5-.4-.8-1-.9-1.1-.1-.2 0-.3.1-.4l.3-.4c.1-.1.1-.2.2-.4 0-.1 0-.3 0-.4l-.5-1.1c-.1-.3-.2-.3-.4-.3z" />
        </svg>
      );
    case "logout":
      return (
        <svg {...p}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5M21 12H9" />
        </svg>
      );
    case "message":
      return (
        <svg {...p}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "question":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.1 9.2a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case "branch":
      return (
        <svg {...p}>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...p}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
        </svg>
      );
    case "clock":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "globe":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
        </svg>
      );
    case "user":
      return (
        <svg {...p}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "jump":
      return (
        <svg {...p}>
          <path d="M4 5v6a3 3 0 0 0 3 3h12" />
          <path d="m15 10 5 4-5 4" />
        </svg>
      );
    case "play":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5 16 12l-6 3.5z" />
        </svg>
      );
    case "tag":
      return (
        <svg {...p}>
          <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9z" />
          <circle cx="7.5" cy="7.5" r="1.3" />
        </svg>
      );
    // Un tick: enviado. Dos: entregado (y en azul, leído).
    case "check":
      return (
        <svg {...p}>
          <path d="M4 12.5 9 17.5 20 6.5" />
        </svg>
      );
    case "check-double":
      return (
        <svg {...p}>
          <path d="M2 12.5 6.5 17 15.5 8" />
          <path d="M9 15.2 11 17.2 21 7" />
        </svg>
      );
    case "paperclip":
      return (
        <svg {...p}>
          <path d="M20.4 11.5 12 19.9a5 5 0 0 1-7.1-7.1l8.5-8.4a3.3 3.3 0 1 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.8-7.7" />
        </svg>
      );
    // Chispa: la IA. Sustituye al emoji ✨.
    case "sparkles":
      return (
        <svg {...p}>
          <path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7 10.4 11.2 6 9.6 10.4 8z" />
          <path d="M18.5 15.5l.7 1.9 1.8.7-1.8.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
        </svg>
      );
    case "send":
      return (
        <svg {...p}>
          <path d="M21.5 2.5 10.8 13.2" />
          <path d="M21.5 2.5 14.7 21.5l-3.9-8.3-8.3-3.9z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...p}>
          <rect x="7" y="5" width="3.6" height="14" rx="1.2" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" />
        </svg>
      );
    case "image":
      return (
        <svg {...p}>
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <circle cx="8.6" cy="10" r="1.6" />
          <path d="M3.5 17.5 9 12.4l4 3.6 3-2.4 4.5 3.9" />
        </svg>
      );
    case "file":
      return (
        <svg {...p}>
          <path d="M14 2.8v4.4a1.5 1.5 0 0 0 1.5 1.5h4.4" />
          <path d="M19.9 8.7V19a2.5 2.5 0 0 1-2.5 2.5H6.6A2.5 2.5 0 0 1 4.1 19V5A2.5 2.5 0 0 1 6.6 2.5h7.2z" />
        </svg>
      );
    case "search":
      return (
        <svg {...p}>
          <circle cx="10.8" cy="10.8" r="7" />
          <path d="M15.9 15.9 21 21" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg {...p}>
          <path d="M12 4.5v15" />
          <path d="M5.8 13.2 12 19.5l6.2-6.3" />
        </svg>
      );
    case "reply":
      return (
        <svg {...p}>
          <path d="M9 5.5 3 11l6 5.5" />
          <path d="M3.4 11h9.1a8 8 0 0 1 8 8v0.5" />
        </svg>
      );
    case "zap":
      return (
        <svg {...p}>
          <path d="M13.2 2.5 4.5 13.4h6.2l-.9 8.1 8.7-10.9h-6.2z" />
        </svg>
      );
    case "smile":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9.2" />
          <path d="M8.2 14.2a4.6 4.6 0 0 0 7.6 0" />
          <circle cx="9.1" cy="9.8" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="14.9" cy="9.8" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "x":
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "bell":
      return (
        <svg {...p}>
          <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
      );
    case "bell-off":
      return (
        <svg {...p}>
          <path d="M8.6 5.4A6 6 0 0 1 18 11v5.5l1.5 2H9" />
          <path d="M6 11v5.5l-1.5 2H5" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
          <path d="M3 3l18 18" />
        </svg>
      );
    case "alert":
      return (
        <svg {...p}>
          <path d="M12 8.5v5" />
          <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
          <path d="M10.3 3.6 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
        </svg>
      );
    case "video":
      return (
        <svg {...p}>
          <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
          <path d="m15.5 10.5 5-2.7v8.4l-5-2.7z" />
        </svg>
      );
    case "map-pin":
      return (
        <svg {...p}>
          <path d="M19 10.2c0 5-7 11-7 11s-7-6-7-11a7 7 0 1 1 14 0z" />
          <circle cx="12" cy="10" r="2.6" />
        </svg>
      );
    case "link":
      return (
        <svg {...p}>
          <path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1.7 1.7" />
          <path d="M13.8 10.2a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6l1.7-1.7" />
        </svg>
      );
    case "phone":
      return (
        <svg {...p}>
          <path d="M21.5 16.9v2.8a2 2 0 0 1-2.2 2 19.6 19.6 0 0 1-8.5-3 19.3 19.3 0 0 1-6-6 19.6 19.6 0 0 1-3-8.6A2 2 0 0 1 3.8 2h2.8a2 2 0 0 1 2 1.7c.1 1 .3 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.6 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
        </svg>
      );
    case "expand":
      return (
        <svg {...p}>
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </svg>
      );
    case "copy":
      return (
        <svg {...p}>
          <rect x="9" y="9" width="12" height="12" rx="2.5" />
          <path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" />
        </svg>
      );
    case "key":
      return (
        <svg {...p}>
          <circle cx="7.5" cy="15.5" r="4" />
          <path d="m10.4 12.6 8.6-8.6" />
          <path d="m16.5 6.5 2.3 2.3" />
          <path d="m13.8 9.2 2.3 2.3" />
        </svg>
      );
    case "plug":
      return (
        <svg {...p}>
          <path d="M9 2.5v6" />
          <path d="M15 2.5v6" />
          <path d="M6.5 8.5h11v3a5.5 5.5 0 0 1-11 0z" />
          <path d="M12 17v4.5" />
        </svg>
      );
    case "antenna":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="2.2" />
          <path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8" />
          <path d="M15.9 15.9a5.5 5.5 0 0 0 0-7.8" />
          <path d="M5.3 5.3a9.5 9.5 0 0 0 0 13.4" />
          <path d="M18.7 18.7a9.5 9.5 0 0 0 0-13.4" />
        </svg>
      );
    case "puzzle":
      return (
        <svg {...p}>
          <path d="M10.3 3.5a2 2 0 0 1 3.4 1.4v1.4h1.4a2 2 0 0 1 2 2v1.4h1.4a2 2 0 0 1 0 4h-1.4v3.4a2 2 0 0 1-2 2h-3.4v-1.4a2 2 0 0 0-4 0v1.4H4.3a2 2 0 0 1-2-2v-3.4h1.4a2 2 0 0 0 0-4H2.3V6.3a2 2 0 0 1 2-2h5.4z" />
        </svg>
      );
    case "target":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...p}>
          <path d="M19.5 12h-15" />
          <path d="M10.8 5.8 4.5 12l6.3 6.2" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...p}>
          <path d="M12 19.5v-15" />
          <path d="M5.8 10.8 12 4.5l6.2 6.3" />
        </svg>
      );
    case "trophy":
      return (
        <svg {...p}>
          <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
          <path d="M7 5.5H4.5v1A3.5 3.5 0 0 0 8 10" />
          <path d="M17 5.5h2.5v1A3.5 3.5 0 0 1 16 10" />
          <path d="M12 14v3.5" />
          <path d="M8.5 21h7l-.8-3.5H9.3z" />
        </svg>
      );
    case "package":
      return (
        <svg {...p}>
          <path d="m12 2.8 8.5 4.6v9.2L12 21.2 3.5 16.6V7.4z" />
          <path d="m3.7 7.3 8.3 4.5 8.3-4.5" />
          <path d="M12 11.8v9.4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    // Plantilla aprobada: una hoja con su cabecera reservada. Antes esto
    // usaba el icono de archivo, el mismo que adjuntar, y no se distinguian.
    case "template":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
          <path d="M7.5 13h6" />
          <path d="M7.5 16.5h9" />
        </svg>
      );
    // Mensaje con botones: la burbuja y el puntero que los pulsa.
    case "buttons":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="10" rx="2" />
          <path d="M7 8.5h5" />
          <path d="M11.5 16.5 21 20l-3.2 1.1L16.7 24z" />
        </svg>
      );
    case "note":
      return (
        <svg {...p}>
          <path d="M20 4v10.5L14.5 20H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
          <path d="M20 14.5h-4a1.5 1.5 0 0 0-1.5 1.5v4" />
          <path d="M8 7.5h8" />
          <path d="M8 11.5h5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...p}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "filter":
      return (
        <svg {...p}>
          <path d="M3 5h18l-7 8v6l-4 2v-8z" />
        </svg>
      );
    case "inbox-check":
      return (
        <svg {...p}>
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
          <path d="m9.5 9 1.8 1.8L15 7" />
        </svg>
      );
    // Ventana de 24 h a punto de cerrarse.
    case "hourglass":
      return (
        <svg {...p}>
          <path d="M6 2h12" />
          <path d="M6 22h12" />
          <path d="M6.5 2v3.8c0 1 .4 2 1.2 2.7L12 12l-4.3 3.5c-.8.7-1.2 1.7-1.2 2.7V22" />
          <path d="M17.5 2v3.8c0 1-.4 2-1.2 2.7L12 12l4.3 3.5c.8.7 1.2 1.7 1.2 2.7V22" />
        </svg>
      );
    case "flask":
      // Matraz: probar el agente. Sustituye al emoji 🧪.
      return (
        <svg {...p}>
          <path d="M10 2v7.3L4.3 19.2A1.5 1.5 0 0 0 5.6 21.5h12.8a1.5 1.5 0 0 0 1.3-2.3L14 9.3V2" />
          <path d="M8.5 2h7" />
          <path d="M7.2 15h9.6" />
        </svg>
      );
    case "pencil":
      return (
        <svg {...p}>
          <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      );
    case "wrench":
      return (
        <svg {...p}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9L6.7 20.3a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z" />
        </svg>
      );
    case "mic":
      return (
        <svg {...p}>
          <rect x="9" y="2.5" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3.5M8.5 21.5h7" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...p}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
  }
}
