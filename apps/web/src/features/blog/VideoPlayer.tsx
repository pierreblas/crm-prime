"use client";

import { useState } from "react";
import { clock, type PostVideo } from "./video";

/**
 * El video de una entrada. El de YouTube no se carga hasta que se pulsa: mientras
 * tanto se ve la portada con su botón, así quien solo lee no carga el reproductor
 * ni recibe sus cookies (sin portada propia, solo se pide la miniatura). Un
 * archivo de video usa el reproductor del navegador, con subtítulos si los hay.
 */
export function VideoPlayer({
  video,
  title,
  poster,
  duration,
  captions,
}: {
  video: PostVideo;
  title: string;
  poster?: string | null;
  duration?: number | null;
  captions?: string | null;
}) {
  const [playing, setPlaying] = useState(false);

  if (video.type === "file") {
    return (
      <div className="bl-video">
        <video controls playsInline preload="metadata" poster={poster ?? undefined} aria-label={title}>
          <source src={video.src} />
          {captions && <track kind="captions" src={captions} srcLang="es" label="Español" default />}
        </video>
      </div>
    );
  }

  return (
    <div className="bl-video">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <button type="button" className="bl-video__start" onClick={() => setPlaying(true)} aria-label={`Reproducir el video: ${title}`}>
          <img src={poster ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" decoding="async" />
          <span className="bl-video__play" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
          {duration ? <span className="bl-video__time">{clock(duration)}</span> : null}
        </button>
      )}
    </div>
  );
}
