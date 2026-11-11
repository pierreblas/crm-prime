/**
 * Reproduce una pieza ASCII de texto en un `<pre>`: la versión mínima del
 * `mount()` de ascii.rest (MIT, bas3line), solo para piezas de texto en una
 * tinta. Dibuja un fotograma al montar; después anima con requestAnimationFrame
 * al ritmo de la pieza, solo mientras el elemento está en pantalla y la
 * pestaña visible, y se queda en el fotograma `still` para quien prefiere
 * menos movimiento (y vuelve a moverse si cambia esa preferencia).
 */
export interface TextPiece {
  meta: { fps: number; still?: number };
  default(): (t: number) => string;
}

export function mountText(el: HTMLElement, piece: TextPiece): () => void {
  const frame = piece.default();
  const fps = piece.meta.fps || 20;
  const still = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const quiet = () => !!still?.matches;
  // Arranca en el fotograma quieto que ya pintó el servidor y sigue desde ahí: sin parpadeo al hidratar.
  let t = piece.meta.still ?? 0;
  const draw = () => {
    el.textContent = frame(t);
  };
  draw();

  let raf = 0;
  let last = 0;
  let seen = false;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = now - last;
    if (dt < 1000 / fps - 2) return;
    last = now;
    t += Math.min(dt, 100) / 1000;
    draw();
  };
  const run = () => {
    const go = seen && !document.hidden && !quiet();
    if (go && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    } else if (!go && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      if (quiet()) {
        t = piece.meta.still ?? 0;
        draw();
      }
    }
  };
  const io = new IntersectionObserver((entries) => {
    seen = entries[entries.length - 1]!.isIntersecting;
    run();
  });
  io.observe(el);
  document.addEventListener("visibilitychange", run);
  still?.addEventListener("change", run);
  return () => {
    io.disconnect();
    cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener("visibilitychange", run);
    still?.removeEventListener("change", run);
  };
}
