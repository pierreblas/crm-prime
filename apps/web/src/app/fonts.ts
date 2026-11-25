import { Gabarito, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

// Tres familias con oficio propio para toda la web: Gabarito titula (geométrica y
// redonda, como las letras del logo), Hanken Grotesk trabaja (cuerpo neutro y
// legible) y JetBrains Mono queda para código y claves. Las variables las recoge
// globals.css (--font-display / --font-sans / --font-mono); si la descarga falla
// en el build, el CSS cae al stack del sistema sin romper nada.
export const display = Gabarito({
  subsets: ["latin"],
  weight: "variable",
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
