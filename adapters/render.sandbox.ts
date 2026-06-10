/**
 * adapters/render.sandbox.ts
 *
 * Implementación REAL del RenderAdapter: corre HyperFrames dentro de un
 * Vercel Sandbox (Firecracker microVM) y sube el MP4 + poster a Vercel Blob.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SANDBOX (y no una Function): HyperFrames necesita Chrome headless +
 * FFmpeg. Eso no cabe en el bundle de 50 MB ni en el runtime de una Vercel
 * Function. El Sandbox es una microVM con disco, hasta 8 vCPUs y horas de
 * ejecución → puede instalar Chromium/FFmpeg y renderizar frame a frame.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ALINEACIÓN CON EL PATRÓN OFICIAL (hyperframes-vercel-template/lib/sandbox.ts)
 *
 * La plantilla oficial de HeyGen NO instala Chromium "en caliente" en cada
 * render. En build-time hornea un SNAPSHOT con TODO ya instalado
 * (scripts/create-snapshot.ts) y en runtime restaura ese snapshot en ~100 ms.
 * La preparación del entorno (prepareSandbox) es EXACTAMENTE:
 *
 *   1. `dnf install -y` de las librerías de SISTEMA que necesita Chromium
 *      (nss, nspr, atk, cups-libs, libdrm, libxkbcommon, libX*, mesa-libgbm,
 *      alsa-lib, pango…). Sin ellas chrome-headless-shell NO arranca.   ← FALTABA
 *   2. `npm install --no-save --no-audit --no-fund hyperframes@latest
 *      ffmpeg-static ffprobe-static` (LOCAL, no `-g`).                  ← era `-g`
 *   3. symlinks de los binarios de ffmpeg/ffprobe a /usr/local/bin.     ← FALTABA
 *   4. `npx --no-install hyperframes browser ensure` (descarga
 *      chrome-headless-shell, ~90-120 s).
 *
 * El render real solo restaura el snapshot, escribe la composición y corre
 * `hyperframes render` — SIN descargas largas, por eso completa.
 *
 * DIAGNÓSTICO de "Stream ended before command finished" (fallo <15 s):
 *   Hacer `browser ensure` / `dnf` en caliente dispara una descarga larga
 *   (chrome-headless-shell) cuyo stream de salida la microVM corta antes de
 *   que el comando termine. La plantilla lo evita porque eso ya está horneado
 *   en el snapshot. Este adapter ahora:
 *     - restaura desde snapshot si hay pointer (path feliz, sin descargas);
 *     - si no hay snapshot, hace el setup completo (dnf+npm+symlinks+ensure)
 *       como FALLBACK, replicando prepareSandbox de la plantilla.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CÓMO LLEGA LA COMPOSICIÓN AL SANDBOX:
 *   Empaquetamos `compositions/trailer/` (index.html + meta.json + assets/) y
 *   los escribimos DENTRO del sandbox con `sandbox.writeFiles(...)` en UNA sola
 *   llamada, bajo `composition/`. NO se clona el repo. `process.cwd()` apunta a
 *   la raíz del bundle; `outputFileTracingIncludes` fuerza que la carpeta entre.
 *
 * OBSERVABILIDAD (clave): el render corre en `after()`, los `console.*` NO se
 * ven en los logs de Vercel. La ÚNICA observabilidad fiable es el campo `error`
 * del job (leído por GET /api/status). Por eso CADA fallo aquí lanza un Error
 * cuyo `message` empieza por `[fase] …` e incluye comando + exitCode + los
 * últimos chars de stderr/stdout. runPipeline copia ese `message` a `job.error`.
 *
 * ENV NECESARIAS (ver REQUISITOS DE DEPLOY en el README):
 *   - En Vercel: VERCEL_OIDC_TOKEN (auto) → autentica el Sandbox API.
 *   - Fuera de Vercel: VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID.
 *   - BLOB_READ_WRITE_TOKEN (auto en Vercel) → subida a Blob y pointer del snapshot.
 *   - VERCEL_DEPLOYMENT_ID (auto en Vercel) → clave del pointer del snapshot.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Sandbox } from '@vercel/sandbox'
import { put } from '@vercel/blob'
import type { RenderAdapter } from './render'
import {
  COMPOSITION_DIR,
  SANDBOX_COMPOSITION_DIR,
  collectCompositionFiles,
  prepareSandbox,
  readSnapshotId,
  runOrThrow,
  SANDBOX_OPTS,
} from './sandbox-lib'

// ─── Constantes de configuración ───────────────────────────────────────────────

/** Nombres de los artefactos generados dentro del sandbox. */
const SANDBOX_MP4 = 'out.mp4'
const SANDBOX_POSTER = 'poster.jpg'

/**
 * Timeout global del render (ms). Configurable por env. Con snapshot el render
 * baja a ~90-120 s; sin snapshot (fallback con setup en caliente) sube a ~3 min,
 * por eso el default es generoso. Default 280 000 ms (dentro de maxDuration=300).
 */
const RENDER_TIMEOUT_MS = Number(process.env['RENDER_TIMEOUT_MS'] ?? 280_000)

/** Holgura del timeout de la microVM por encima del nuestro para un stop() limpio. */
const SANDBOX_TIMEOUT_MS = RENDER_TIMEOUT_MS + 30_000

/** Segundo del que se extrae el poster (la escena "identity" ya está montada). */
const POSTER_SECOND = 3

// ─── Implementación del adaptador ───────────────────────────────────────────────

/**
 * Crea (o restaura) el sandbox para el render.
 *
 * Path feliz: restaura desde el snapshot pre-horneado (pointer en Blob) → ~100 ms,
 * SIN descargas en caliente. Si no hay snapshot (o falla la restauración), cae a
 * crear una microVM fresca y prepararla en caliente (prepareSandbox), que replica
 * el setup de la plantilla oficial. Etiqueta la fase como `create` para el job.error.
 */
async function createOrRestoreSandbox(signal: AbortSignal): Promise<Sandbox> {
  const snapshotId = await readSnapshotId().catch(() => undefined)

  if (snapshotId) {
    try {
      // Restaurar desde snapshot: NO se pasa `runtime` (se hereda del snapshot).
      return await Sandbox.create({
        source: { type: 'snapshot', snapshotId },
        resources: SANDBOX_OPTS.resources,
        timeout: SANDBOX_TIMEOUT_MS,
        signal,
      })
    } catch (err: unknown) {
      // En producción NO enmascaramos: si hay snapshot y no restaura, queremos
      // verlo en job.error (no degradar silenciosamente a setup en caliente, que
      // es justo lo que provoca el "Stream ended").
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `[create] restauración de snapshot ${snapshotId} falló: ${msg}`,
      )
    }
  }

  // Sin snapshot: microVM fresca + setup completo en caliente (fallback).
  const sandbox = await Sandbox.create({
    runtime: SANDBOX_OPTS.runtime,
    resources: SANDBOX_OPTS.resources,
    timeout: SANDBOX_TIMEOUT_MS,
    signal,
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`[create] no se pudo crear la microVM: ${msg}`)
  })

  // prepareSandbox lanza errores ya etiquetados ([install]/[browser]).
  await prepareSandbox(sandbox, signal)
  return sandbox
}

/**
 * Crea el RenderAdapter REAL respaldado por Vercel Sandbox + Vercel Blob.
 *
 * La firma es idéntica al mock: se inyecta en producción sin tocar tipos
 * (`runPipeline` y los tests son agnósticos a la implementación).
 */
export function createSandboxRenderAdapter(): RenderAdapter {
  return {
    async renderTrailer(
      jobId: string,
      vars: Record<string, string | number>,
    ): Promise<{ mp4Url: string; poster: string }> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS)
      const { signal } = controller

      // Fase actual: se incluye en el error si algo peta de forma inesperada.
      let phase = 'writeFiles'

      // 1. Empaquetar la composición desde disco (no requiere repo pusheado).
      const files = await collectCompositionFiles(
        COMPOSITION_DIR,
        SANDBOX_COMPOSITION_DIR,
      )
      if (files.length === 0) {
        clearTimeout(timer)
        throw new Error(
          `[writeFiles] no se encontraron archivos de composición en ${COMPOSITION_DIR}`,
        )
      }

      // Serializamos las variables a JSON una sola vez (todas son string/number).
      const variablesJson = JSON.stringify(vars)

      let sandbox: Sandbox | undefined
      try {
        // 2. Crear/restaurar la microVM (fase `create` interna).
        phase = 'create'
        sandbox = await createOrRestoreSandbox(signal)

        // 3. Volcar la composición dentro del sandbox (una sola llamada).
        phase = 'writeFiles'
        await sandbox.writeFiles(files)

        // 4. Renderizar. `--variables` aplica a la composición raíz; el
        //    index.html re-propaga las vars fusionadas a las sub-escenas.
        phase = 'render'
        await runOrThrow(sandbox, 'render', signal, {
          cmd: 'npx',
          args: [
            '--no-install',
            'hyperframes',
            'render',
            SANDBOX_COMPOSITION_DIR,
            '-o',
            SANDBOX_MP4,
            '--workers',
            'auto',
            '--non-interactive',
            '--variables',
            variablesJson,
          ],
        })

        // 5. Extraer el poster (frame ~3 s) con el ffmpeg del sandbox.
        phase = 'poster'
        await runOrThrow(sandbox, 'poster', signal, {
          cmd: 'ffmpeg',
          args: [
            '-y',
            '-ss',
            String(POSTER_SECOND),
            '-i',
            SANDBOX_MP4,
            '-frames:v',
            '1',
            '-q:v',
            '3',
            SANDBOX_POSTER,
          ],
        })

        // 6. Recoger los artefactos del sandbox como Buffers.
        phase = 'read'
        const [mp4Buffer, posterBuffer] = await Promise.all([
          sandbox.readFileToBuffer({ path: SANDBOX_MP4 }, { signal }),
          sandbox.readFileToBuffer({ path: SANDBOX_POSTER }, { signal }),
        ])
        if (!mp4Buffer) {
          throw new Error('[read] el render no produjo out.mp4')
        }
        if (!posterBuffer) {
          throw new Error('[read] no se pudo extraer el poster')
        }

        // 7. Subir ambos a Vercel Blob (acceso público, clave estable por jobId).
        phase = 'blob'
        const [mp4Blob, posterBlob] = await Promise.all([
          put(`trailers/${jobId}.mp4`, mp4Buffer, {
            access: 'public',
            contentType: 'video/mp4',
            allowOverwrite: true,
            addRandomSuffix: false,
          }),
          put(`trailers/${jobId}.jpg`, posterBuffer, {
            access: 'public',
            contentType: 'image/jpeg',
            allowOverwrite: true,
            addRandomSuffix: false,
          }),
        ])

        return { mp4Url: mp4Blob.url, poster: posterBlob.url }
      } catch (err: unknown) {
        // El timeout (aborto) tiene prioridad: deja claro que fue por tiempo.
        if (signal.aborted) {
          const e = new Error(
            `[${phase}] timeout de render (${Math.round(RENDER_TIMEOUT_MS / 1000)}s) superado para job ${jobId}`,
          )
          console.error(e.message)
          throw e
        }

        // Si el error ya viene etiquetado ([fase] …) lo respetamos; si no,
        // lo prefijamos con la fase actual para que job.error sea diagnosticable.
        const rawMsg = err instanceof Error ? err.message : String(err)
        const message = /^\[[a-z]+\]/.test(rawMsg)
          ? rawMsg
          : `[${phase}] ${rawMsg}`
        console.error(message)
        throw new Error(message)
      } finally {
        clearTimeout(timer)
        // Parar la microVM SIEMPRE (se factura por uso). Un fallo aquí NO debe
        // enmascarar el error real del render: se traga en su propio try/catch.
        if (sandbox) {
          try {
            await sandbox.stop()
          } catch (stopErr: unknown) {
            const m = stopErr instanceof Error ? stopErr.message : String(stopErr)
            console.error(`[stop] fallo al parar el sandbox (no fatal): ${m}`)
          }
        }
      }
    },
  }
}
