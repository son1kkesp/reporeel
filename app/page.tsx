import type { Metadata } from "next";
import { GitBranch, Zap } from "lucide-react";
import { Logo, CronhausBadge } from "@/app/components/Brand";
import { Generator } from "@/app/components/Generator";
import { Gallery } from "@/app/components/Gallery";

export const metadata: Metadata = {
  title: "Convierte cualquier repo de GitHub en un tráiler. En un clic.",
  description:
    "RepoReel transforma cualquier repositorio de GitHub en un tráiler vertical 9:16, listo para TikTok, Reels y Shorts. Pega el repo y listo. Open source, por Cronhaus.",
  alternates: { canonical: "/" },
};

const REPO_URL = "https://github.com/cronhaus/reporeel";

// Next.js 16: `searchParams` es una Promise en Server Components.
type HomeProps = { searchParams: Promise<{ repo?: string | string[] }> };

export default async function Home({ searchParams }: HomeProps) {
  const { repo } = await searchParams;
  const initialRepo = Array.isArray(repo) ? (repo[0] ?? "") : (repo ?? "");

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ── Hero + generador ─────────────────────────────────────────── */}
        <section
          id="generar"
          className="bg-aurora relative isolate overflow-hidden"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 pt-16 pb-20 text-center sm:pt-24 sm:pb-28">
            <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Zap className="size-3.5 text-brand" aria-hidden="true" />
              Open source · vídeo vertical 9:16
            </span>

            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Convierte cualquier repo de GitHub en un{" "}
              <span className="text-gradient-brand">tráiler</span>.
              <br className="hidden sm:block" /> En un clic.
            </h1>

            <p className="mt-5 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
              Pega un repositorio y RepoReel monta un tráiler vertical listo para
              TikTok, Reels y Shorts. Sin editar nada.
            </p>

            <div className="mt-9 w-full max-w-xl">
              <Generator initialRepo={initialRepo} />
              <p className="mt-3 text-xs text-muted-foreground">
                Prueba con{" "}
                <span className="font-medium text-foreground/80">
                  facebook/react
                </span>{" "}
                o{" "}
                <span className="font-medium text-foreground/80">
                  vercel/next.js
                </span>
                .
              </p>
            </div>
          </div>
        </section>

        {/* ── Galería ──────────────────────────────────────────────────── */}
        <Gallery />
      </main>

      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-3.5">
        <Logo />
        <div className="flex items-center gap-4">
          <CronhausBadge className="hidden sm:inline-flex" />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/50 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface"
          >
            <GitBranch className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Código</span>
            <span className="sm:hidden">GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <Logo />
        </div>
        <div className="flex items-center gap-4">
          <CronhausBadge />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Open source
          </a>
        </div>
      </div>
    </footer>
  );
}
