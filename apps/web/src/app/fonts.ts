import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

// Tres familias con oficio propio para toda la web: Bricolage Grotesque titula
// (variable, con eje de anchura: la landing la usa condensada y en mayúsculas),
// Hanken Grotesk trabaja (cuerpo neutro y legible) y JetBrains Mono es la
// telemetría (etiquetas, horas, estados y cifras pequeñas, en mayúsculas con
// tracking). Las variables las recoge globals.css (--font-display / --font-sans /
// --font-mono); si la descarga falla en el build, el CSS cae al stack del sistema.
export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz", "wdth"],
  display: "swap",
  variable: "--font-display-face",
});

export const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-body-face",
});

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-mono-face",
});
