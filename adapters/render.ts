/**
 * adapters/render.ts
 *
 * Interfaz del adaptador de render de tráiler.
 *
 * La implementación REAL vive en `render.sandbox.ts` (`createSandboxRenderAdapter`):
 * corre HyperFrames en Vercel Sandbox (Firecracker microVM) y sube MP4 + poster
 * a Vercel Blob. La composición llega al sandbox vía `writeFiles` (NO se clona el
 * repo → no requiere que el repo esté pusheado ni público).
 * El mock (`render.mock.ts`) devuelve URLs apuntando a __fixtures__/sample.mp4.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CONTRATO DEL FLUJO REAL CON VERCEL SANDBOX (IMPLEMENTADO en render.sandbox.ts):
 *
 *   Basado en hyperframes-vercel-template (lib/sandbox.ts + scripts/create-snapshot.ts).
 *   La lógica de sandbox compartida vive en adapters/sandbox-lib.ts.
 *
 *   1. BUILD-TIME (scripts/create-snapshot.ts, enganchado a `build`):
 *      - Crea una microVM fresca y la prepara (prepareSandbox): `dnf install` de
 *        libs de sistema de Chromium + `npm install` (hyperframes/ffmpeg/ffprobe)
 *        + symlinks + `npx hyperframes browser ensure`.
 *      - Toma el snapshot y guarda su `snapshotId` en un pointer en Blob
 *        (snapshot-cache/<VERCEL_DEPLOYMENT_ID>.json).
 *      - Esto evita descargar Chromium "en caliente" en cada render (causa del
 *        error "Stream ended before command finished").
 *
 *   2. RUNTIME (renderTrailer en render.sandbox.ts):
 *      a. Restaura el snapshot vía pointer en ~100 ms (sin descargas). Si no hay
 *         snapshot, cae a setup en caliente (mismo prepareSandbox) como fallback.
 *      b. writeFiles → vuelca compositions/trailer/ en `composition/`.
 *      c. `npx --no-install hyperframes render composition -o out.mp4
 *          --workers auto --non-interactive --variables '<json>'`.
 *      d. Extrae poster (frame ~3 s) con ffmpeg → poster.jpg.
 *      e. readFileToBuffer de ambos y `put()` a Vercel Blob (público).
 *      f. stop() de la microVM en finally.
 *      g. Retorna `{ mp4Url, poster }`.
 *      Cada paso comprueba exitCode y lanza un Error `[fase] …` con cmd+stderr,
 *      que runPipeline copia a job.error (única observabilidad fiable en after()).
 *
 *   Variables de entorno necesarias:
 *     VERCEL_OIDC_TOKEN     — autentica el Sandbox API (auto en Vercel)
 *     BLOB_READ_WRITE_TOKEN — Vercel Blob + pointer del snapshot (auto en Vercel)
 *     VERCEL_DEPLOYMENT_ID  — clave del pointer del snapshot (auto en Vercel)
 *
 *   Región: solo `iad1` (Virginia) — Vercel Sandbox no está en otras.
 *   Timeout: `export const maxDuration = 300` en la route; el pipeline corre en
 *   `after()`, que Next mantiene vivo hasta que resuelve (o hasta maxDuration).
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ─── Interfaz del adaptador ────────────────────────────────────────────────────

export interface RenderAdapter {
  /**
   * Renderiza el tráiler para el jobId dado, sustituyendo las variables
   * en la plantilla HyperFrames.
   *
   * @param jobId - Identificador del job (owner/repo/YYYY-MM-DD). Se usa
   *               como clave en Vercel Blob para el MP4 y el poster.
   * @param vars  - Variables para la composición (claves exactas de
   *               compositions/trailer/meta.json). Valores string o number.
   * @returns     URLs públicas del MP4 y del poster (JPEG del primer frame).
   *
   * @throws Si el render falla (timeout de Sandbox, error de ffmpeg, etc.).
   *         El caller (runPipeline) captura este error y marca el job como
   *         'error' en el JobAdapter.
   */
  renderTrailer(
    jobId: string,
    vars: Record<string, string | number>,
  ): Promise<{ mp4Url: string; poster: string }>
}
