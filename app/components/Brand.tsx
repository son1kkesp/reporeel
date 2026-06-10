import Link from "next/link";
import { Clapperboard } from "lucide-react";

const CRONHAUS_URL = "https://cronhaus.com";

/** Logotipo de RepoReel: isotipo + wordmark. Enlaza al inicio. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2 ${className ?? ""}`}
      aria-label="RepoReel, inicio"
    >
      <span className="grid size-8 place-items-center rounded-lg bg-brand/15 text-brand ring-1 ring-brand/30 transition-colors group-hover:bg-brand/25">
        <Clapperboard className="size-4.5" aria-hidden="true" />
      </span>
      <span className="text-base font-semibold tracking-tight">
        Repo<span className="text-gradient-brand">Reel</span>
      </span>
    </Link>
  );
}

/** Sello discreto "por Cronhaus" con enlace a la marca. */
export function CronhausBadge({ className }: { className?: string }) {
  return (
    <a
      href={CRONHAUS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground ${
        className ?? ""
      }`}
    >
      <span>por</span>
      <span className="font-medium tracking-tight text-foreground/80">
        Cronhaus
      </span>
    </a>
  );
}
