import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getGallery, type GalleryEntry } from "@/app/lib/gallery";
import { TrailerPlayer } from "@/app/components/TrailerPlayer";

/**
 * Galería de tráileres pre-renderizados (Server Component).
 *
 * Si el índice está vacío (caso inicial, antes de Vercel Pro) degrada con
 * elegancia a un estado "pronto" que reorienta hacia el generador.
 */
export async function Gallery() {
  const entries = await getGallery();

  return (
    <section
      aria-labelledby="gallery-heading"
      className="mx-auto w-full max-w-5xl px-5 py-16 sm:py-20"
    >
      <div className="mb-8 flex flex-col gap-2 text-center sm:mb-10">
        <h2
          id="gallery-heading"
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {entries.length > 0 ? "Tráileres recién montados" : "Galería"}
        </h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
          {entries.length > 0
            ? "Una muestra de lo que sale al pegar un repo. Tócalos y compártelos."
            : "Pronto: tráileres de repos famosos, listos para compartir."}
        </p>
      </div>

      {entries.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {entries.map((entry) => (
            <ReelCard key={`${entry.owner}/${entry.repo}`} entry={entry} />
          ))}
        </ul>
      ) : (
        <EmptyGallery />
      )}
    </section>
  );
}

function ReelCard({ entry }: { entry: GalleryEntry }) {
  const slug = `${entry.owner}/${entry.repo}`;
  return (
    <li>
      <Link
        href={`/r/${slug}`}
        className="group block focus-visible:outline-none"
        aria-label={`Ver el tráiler de ${slug}`}
      >
        <TrailerPlayer
          src={`/v/${slug}`}
          poster={`/p/${slug}`}
          label={`Tráiler de ${slug}`}
          autoLoop
          className="transition-transform duration-300 group-hover:-translate-y-1 group-focus-visible:ring-3 group-focus-visible:ring-brand/50"
        />
        <span className="mt-2 block truncate text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          {slug}
        </span>
      </Link>
    </li>
  );
}

function EmptyGallery() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 rounded-2xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand/15 text-brand ring-1 ring-brand/30">
        <Sparkles className="size-6" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <p className="text-base font-medium">Aún no hay tráileres aquí</p>
        <p className="text-sm text-muted-foreground">
          Sé el primero: pega un repo arriba y monta su tráiler en un clic.
        </p>
      </div>
      <a
        href="#generar"
        className="text-sm font-medium text-brand-text underline-offset-4 hover:underline"
      >
        Probar ahora ↑
      </a>
    </div>
  );
}
