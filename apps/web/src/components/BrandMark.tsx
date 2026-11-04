/**
 * La «O» de Driony: los tres colores de la marca en franjas dentro de un círculo.
 * Son trazados sueltos, sin clipPath, para no repetir ids si sale varias veces.
 */
export function BrandMark({ size = 24, className }: { size?: number | string; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M1.01 10.4A16 16 0 0 1 30.99 10.4Z" fill="#9ab9c2" />
      <path d="M.62 11.6H31.38A16 16 0 0 1 31.38 20.4H.62A16 16 0 0 1 .62 11.6Z" fill="#fefd14" />
      <path d="M1.01 21.6H30.99A16 16 0 0 1 1.01 21.6Z" fill="#0b6cd8" />
    </svg>
  );
}

/** El nombre en mayúsculas con la «O» de la marca. Se lee como «Driony». */
export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span className="wordmark" role="img" aria-label="Driony" style={{ fontSize: size }}>
      DRI
      <BrandMark className="wordmark__o" size="0.76em" />
      NY
    </span>
  );
}
