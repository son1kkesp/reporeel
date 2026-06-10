import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Info, Sparkles } from "lucide-react";
import { Logo, CronhausBadge } from "@/app/components/Brand";
import { TrailerPlayer } from "@/app/components/TrailerPlayer";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTrailerForToday } from "@/app/lib/server-trailer";
import { TrailerActions } from "./TrailerActions";

// Next.js 16: en rutas dinámicas, `params` es una Promise que hay que await.
type PageParams = { params: Promise<{ owner: string; repo: string }> };

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Resolución absoluta de URLs (los MP4/poster pueden venir como ruta relativa
// del mock o como URL absoluta de Blob).
function toAbsolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, siteUrl).toString();
}

// ─── generateMetadata: OG video + twitter player para auto-preview en redes ────

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { owner, repo } = await params;
  const slug = `${owner}/${repo}`;
  const pageUrl = `${siteUrl}/r/${owner}/${repo}`;

  const trailer = await getTrailerForToday(owner, repo);

  // Sin tráiler todavía → OG genérico (la página ofrecerá generarlo).
  if (!trailer) {
    return {
      title: `Tráiler de ${slug}`,
      description: `Genera el tráiler vertical de ${slug} con RepoReel. En un clic.`,
      alternates: { canonical: `/r/${owner}/${repo}` },
      openGraph: {
        type: "website",
        title: `Tráiler de ${slug} · RepoReel`,
        description: `Genera el tráiler vertical de ${slug} en un clic.`,
        url: pageUrl,
        siteName: "RepoReel",
      },
      twitter: {
        card: "summary_large_image",
        title: `Tráiler de ${slug} · RepoReel`,
        description: `Genera el tráiler vertical de ${slug} en un clic.`,
      },
    };
  }

  const mp4 = toAbsolute(trailer.mp4Url);
  const poster = toAbsolute(trailer.poster);
  const title = `Tráiler de ${slug}`;
  const description = `El tráiler vertical de ${slug}, generado con RepoReel. Míralo y compártelo.`;

  return {
    title,
    description,
    alternates: { canonical: `/r/${owner}/${repo}` },
    openGraph: {
      type: "website",
      title: `${title} · RepoReel`,
      description,
      url: pageUrl,
      siteName: "RepoReel",
      images: [{ url: poster, width: 1080, height: 1920, alt: title }],
      videos: [{ url: mp4, type: "video/mp4", width: 1080, height: 1920 }],
    },
    twitter: {
      card: "player",
      title: `${title} · RepoReel`,
      description,
      images: [poster],
      players: [
        { playerUrl: pageUrl, streamUrl: mp4, width: 1080, height: 1920 },
      ],
    },
  };
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default async function TrailerPage({ params }: PageParams) {
  const { owner, repo } = await params;
  const slug = `${owner}/${repo}`;
  const pageUrl = `${siteUrl}/r/${owner}/${repo}`;

  const trailer = await getTrailerForToday(owner, repo);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border/60">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-3.5">
          <Logo />
          <CronhausBadge />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-5 py-12 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al inicio
        </Link>

        <h1 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Tráiler de <span className="text-gradient-brand">{slug}</span>
        </h1>

        {trailer ? (
          <TrailerReady
            slug={slug}
            pageUrl={pageUrl}
            mp4Url={toAbsolute(trailer.mp4Url)}
            poster={toAbsolute(trailer.poster)}
          />
        ) : (
          <TrailerMissing owner={owner} repo={repo} slug={slug} />
        )}
      </main>
    </div>
  );
}

// ─── Estados ───────────────────────────────────────────────────────────────────

function TrailerReady({
  slug,
  pageUrl,
  mp4Url,
  poster,
}: {
  slug: string;
  pageUrl: string;
  mp4Url: string;
  poster: string;
}) {
  return (
    <div className="mt-8 flex w-full flex-col items-center gap-6">
      <TrailerPlayer
        src={mp4Url}
        poster={poster}
        label={`Tráiler de ${slug}`}
        controls
        autoLoop
        className="w-full max-w-[320px]"
      />

      <TrailerActions shareUrl={pageUrl} mp4Url={mp4Url} repo={slug} />

      <p className="flex max-w-md items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        El vídeo incluye una marca de agua discreta de RepoReel · Cronhaus.
      </p>
    </div>
  );
}

function TrailerMissing({
  owner,
  repo,
  slug,
}: {
  owner: string;
  repo: string;
  slug: string;
}) {
  // Link a la home con el repo pre-rellenado para dispararlo desde allí.
  const generateHref = `/?repo=${encodeURIComponent(`${owner}/${repo}`)}#generar`;
  return (
    <div className="mt-10 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand/15 text-brand ring-1 ring-brand/30">
        <Sparkles className="size-6" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <p className="text-base font-medium">
          Aún no hay tráiler para {slug}
        </p>
        <p className="text-sm text-muted-foreground">
          Genéralo en un clic: tardará unos 30 segundos.
        </p>
      </div>
      <Link
        href={generateHref}
        className={cn(
          buttonVariants({ size: "lg" }),
          "gap-2 bg-brand text-brand-foreground hover:bg-brand/85",
        )}
      >
        <Sparkles className="size-4" aria-hidden="true" />
        Generar el tráiler
      </Link>
    </div>
  );
}
