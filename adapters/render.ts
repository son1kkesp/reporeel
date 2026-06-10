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
 * CONTRATO DEL FLUJO REAL CON VERCEL SANDBOX (para implementar cuando se tenga
 * Vercel Pro activo):
 *
 *   Basado en hyperframes-vercel-template (lib/sandbox.ts + app/api/render/route.ts)
 *   y la documentación en MI-PERFIL/hyperframes-docs/02-despliegue-y-agentes.md.
 *
 *   1. PRE-BUILD (scripts/create-snapshot.ts):
 *      - Crear una Vercel Sandbox vacía con `@vercel/sandbox`.
 *      - Dentro: instalar libs Chromium (libnss3, libxcomposite1, pango…) +
 *        `npm install hyperframes ffmpeg-static ffprobe-static` +
 *        `npx hyperframes browser ensure` (descarga chrome-headless-shell).
 *      - Guardar snapshot (~1.1 GB). Cold start en producción: ~100 ms.
 *        Los snapshots expiran a 30 días — hay que refrescarlos periódicamente.
 *
 *   2. RUNTIME (en renderTrailer):
 *      a. Restaurar snapshot con `@vercel/sandbox`.
 *      b. Copiar los archivos de la composición al Sandbox
 *         (`public/compositions/trailer/` → `/tmp/composition/`).
 *      c. Escribir `variables.json` con los valores de `vars`.
 *      d. Ejecutar dentro del Sandbox:
 *         ```
 *         npx hyperframes render /tmp/composition \
 *           --workers auto \
 *           --non-interactive \
 *           --json \
 *           --variables-file /tmp/variables.json \
 *           --output /tmp/out.mp4
 *         ```
 *         Tiempo estimado: ~90 s para una composición de 15 s a 1080×1920.
 *      e. Leer `/tmp/out.mp4` del Sandbox y subir a Vercel Blob
 *         (`put(key, stream, { access: 'public', contentType: 'video/mp4' })`).
 *      f. Generar poster: capturar primer frame con ffmpeg (ya disponible en Sandbox)
 *         y subirlo a Blob como JPEG.
 *      g. Destruir el Sandbox.
 *      h. Retornar `{ mp4Url, poster }`.
 *
 *   Variables de entorno necesarias:
 *     VERCEL_OIDC_TOKEN  — token de OIDC para autenticar con el Sandbox API
 *     BLOB_READ_WRITE_TOKEN — token de Vercel Blob (auto en Vercel Deploy)
 *
 *   Región: solo `iad1` (Virginia) — Vercel Sandbox no está disponible en otras.
 *   Timeout: declarar `export const maxDuration = 300` en la route (5 min).
 *   La route NO espera este nivel de detalle; `runPipeline` se ejecuta como
 *   fire-and-forget dentro de la request, que Next.js mantiene viva hasta
 *   que la promesa resuelve (o hasta maxDuration).
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
