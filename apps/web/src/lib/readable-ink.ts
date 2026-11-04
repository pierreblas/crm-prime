const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/**
 * La tinta que se lee sobre un fondo de color: las insignias y etiquetas llevan
 * colores que elige el usuario (o que trae la fuente, como el verde de WhatsApp),
 * así que el texto no puede ser fijo. Un fondo que no es un hexadecimal es un
 * tinte translúcido del tema, y sobre él se lee la tinta normal.
 */
export function readableInk(bg: string): string {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(bg.trim())?.[1];
  if (!hex) return "var(--text)";
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  // Blanco frente a noir (#0a0b10, luminancia 0,004): gana el de más contraste.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.054 ? "#ffffff" : "#0a0b10";
}
