/**
 * La «O» de Driony: una O de píxeles (anillo de doce bloques con el centro
 * vacío) en lima, con la esquina de arriba a la derecha en cian, el color que
 * mide. Es el mismo motivo que los píxeles de la landing y del menú. Trazados
 * sueltos, sin clipPath, para no repetir ids si sale varias veces.
 */
export function BrandMark({ size = 24, className }: { size?: number | string; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M0 0h24v8H0zM0 8h8v16H0zM24 8h8v16h-8zM0 24h32v8H0z" fill="#e2f80d" />
      <path d="M24 0h8v8h-8z" fill="#00e5ff" />
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
