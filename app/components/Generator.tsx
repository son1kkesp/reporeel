"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseRepoInput } from "@/app/lib/parse-repo";
import { TrailerPlayer } from "@/app/components/TrailerPlayer";

// ─── Tipos del flujo ─────────────────────────────────────────────────────────

type Phase =
  | "idle"
  | "submitting"
  | "rendering"
  | "ready"
  | "error";

interface Result {
  url: string;
  poster?: string;
  repo: string;
}

// Sondeo de /api/status: cada 2.5 s, hasta ~3 min.
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 72;

// ─── Componente ──────────────────────────────────────────────────────────────

export function Generator({ initialRepo = "" }: { initialRepo?: string }) {
  const [value, setValue] = useState(initialRepo);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Refs para cancelar el sondeo si el componente se desmonta o se reinicia.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  // Ref a la última versión de `poll`, para que el sondeo recursivo
  // (vía setTimeout) no dependa del orden de declaración ni capture closures
  // obsoletas.
  const pollRef = useRef<
    (jobId: string, repo: string, attempt: number) => void
  >(() => {});

  const clearPolling = useCallback(() => {
    cancelled.current = true;
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => clearPolling, [clearPolling]);

  const fail = useCallback(
    (msg: string) => {
      clearPolling();
      setPhase("error");
      setMessage(msg);
    },
    [clearPolling],
  );

  // Sondea /api/status hasta ready/error o agotar reintentos.
  const poll = useCallback(
    async (jobId: string, repo: string, attempt: number) => {
      if (cancelled.current) return;
      if (attempt > MAX_POLLS) {
        fail("El render está tardando más de lo normal. Vuelve a intentarlo en un momento.");
        return;
      }

      try {
        const res = await fetch(
          `/api/status?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );

        if (res.status === 404) {
          // Aún no persistido; reintenta.
          pollTimer.current = setTimeout(
            () => pollRef.current(jobId, repo, attempt + 1),
            POLL_INTERVAL_MS,
          );
          return;
        }

        const data = (await res.json()) as {
          status?: "rendering" | "ready" | "error";
          url?: string;
          poster?: string;
          error?: string;
        };

        if (cancelled.current) return;

        if (data.status === "ready" && data.url) {
          clearPolling();
          setResult({ url: data.url, poster: data.poster, repo });
          setPhase("ready");
          return;
        }

        if (data.status === "error") {
          fail(
            data.error?.trim()
              ? `No se pudo generar el tráiler: ${data.error}`
              : "No se pudo generar el tráiler. Revisa que el repo exista y sea público.",
          );
          return;
        }

        // 'rendering' → seguimos sondeando.
        pollTimer.current = setTimeout(
          () => pollRef.current(jobId, repo, attempt + 1),
          POLL_INTERVAL_MS,
        );
      } catch {
        // Error de red puntual → reintenta sin abortar.
        pollTimer.current = setTimeout(
          () => pollRef.current(jobId, repo, attempt + 1),
          POLL_INTERVAL_MS,
        );
      }
    },
    [clearPolling, fail],
  );

  // Mantén el ref apuntando a la última `poll`.
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (phase === "submitting" || phase === "rendering") return;

      const parsed = parseRepoInput(value);
      if (!parsed) {
        setPhase("error");
        setMessage(
          "Formato no válido. Usa owner/repo (p. ej. facebook/react) o una URL de GitHub.",
        );
        return;
      }

      const repo = `${parsed.owner}/${parsed.repo}`;
      cancelled.current = false;
      setResult(null);
      setMessage(null);
      setPhase("submitting");

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });

        if (res.status === 429) {
          fail("Has alcanzado el límite de generaciones. Prueba en un rato.");
          return;
        }
        if (res.status === 503) {
          fail("Ahora mismo hay cola de renders. Vuelve en un momento.");
          return;
        }

        const data = (await res.json()) as {
          jobId?: string;
          status?: "rendering" | "ready";
          url?: string;
          poster?: string;
          error?: string;
        };

        if (res.status === 400) {
          fail(data.error?.trim() || "La petición no es válida.");
          return;
        }

        if (data.status === "ready" && data.url) {
          // Cache hit: resultado inmediato.
          setResult({ url: data.url, poster: data.poster, repo });
          setPhase("ready");
          return;
        }

        if (data.status === "rendering" && data.jobId) {
          setPhase("rendering");
          poll(data.jobId, repo, 0);
          return;
        }

        fail("Respuesta inesperada del servidor. Inténtalo de nuevo.");
      } catch {
        fail("No se pudo conectar con el servidor. Revisa tu conexión.");
      }
    },
    [fail, phase, poll, value],
  );

  const reset = useCallback(() => {
    clearPolling();
    cancelled.current = false;
    setResult(null);
    setMessage(null);
    setPhase("idle");
  }, [clearPolling]);

  const busy = phase === "submitting" || phase === "rendering";

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="w-full">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="repo-input" className="sr-only">
            Repositorio de GitHub
          </label>
          <Input
            id="repo-input"
            name="repo"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            placeholder="pega un repo: owner/repo o una URL de GitHub"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={phase === "error"}
            className="h-12 flex-1 text-base sm:h-13"
          />
          <Button
            type="submit"
            size="lg"
            disabled={busy}
            className="h-12 gap-2 bg-brand px-5 text-brand-foreground hover:bg-brand/85 sm:h-13 sm:w-auto"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Generando…
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden="true" />
                Generar tráiler
                <ArrowRight className="size-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Región viva: anuncia estado a lectores de pantalla */}
      <div aria-live="polite" className="mt-5">
        {phase === "submitting" && (
          <StatusCard tone="info">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Preparando tu tráiler…
          </StatusCard>
        )}

        {phase === "rendering" && (
          <RenderingCard />
        )}

        {phase === "error" && message && (
          <StatusCard tone="error">
            <span>{message}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              className="ml-auto gap-1.5"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Reintentar
            </Button>
          </StatusCard>
        )}

        {phase === "ready" && result && (
          <div className="mt-2 flex flex-col items-center gap-4">
            <TrailerPlayer
              src={result.url}
              poster={result.poster}
              label={`Tráiler de ${result.repo}`}
              controls
              className="w-full max-w-[300px]"
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reset}
                className="gap-1.5"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Generar otro
              </Button>
              <a
                href={`/r/${result.repo}`}
                className="text-sm font-medium text-brand-text underline-offset-4 hover:underline"
              >
                Abrir página del tráiler →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponentes de estado ──────────────────────────────────────────────────

function StatusCard({
  tone,
  children,
}: {
  tone: "info" | "error";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-border bg-surface/60 text-muted-foreground";
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm ${toneClass}`}
    >
      {children}
    </div>
  );
}

function RenderingCard() {
  return (
    <div className="overflow-hidden rounded-xl border border-brand/30 bg-surface/60 px-4 py-4">
      <div className="flex items-center gap-2.5 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-brand" aria-hidden="true" />
        Renderizando tu tráiler… <span className="text-muted-foreground">~30 s</span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full w-2/5 animate-pulse rounded-full bg-gradient-to-r from-brand to-brand-2" />
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        Estamos analizando el repo, escribiendo el guion y montando el vídeo.
        Puedes dejar esta pestaña abierta.
      </p>
    </div>
  );
}
