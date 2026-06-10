import { cn } from "@/lib/utils";

interface TrailerPlayerProps {
  src: string;
  poster?: string;
  /** Etiqueta accesible del vídeo. */
  label: string;
  /** Muestra controles nativos (resultado del generador). */
  controls?: boolean;
  /** Autoplay muteado en loop (rejilla de la galería). */
  autoLoop?: boolean;
  className?: string;
}

/**
 * Reproductor de tráiler vertical 9:16 con encuadre fijo (aspect-[9/16]).
 *
 * Server-safe: es un <video> plano sin estado. La galería lo usa en
 * autoplay/muted/loop; el generador con controles.
 */
export function TrailerPlayer({
  src,
  poster,
  label,
  controls = false,
  autoLoop = false,
  className,
}: TrailerPlayerProps) {
  return (
    <div
      className={cn(
        "relative aspect-[9/16] overflow-hidden rounded-2xl border border-border bg-black shadow-2xl shadow-black/40",
        "ring-1 ring-white/5",
        className,
      )}
    >
      <video
        className="size-full object-cover"
        src={src}
        poster={poster}
        controls={controls}
        autoPlay={autoLoop}
        muted={autoLoop}
        loop={autoLoop}
        playsInline
        preload={autoLoop ? "metadata" : "auto"}
        aria-label={label}
      />
    </div>
  );
}
