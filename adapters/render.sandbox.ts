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
 * DIAGNÓSTICO DEL RENDER (el truco del log file): el comando de render se ejecuta
 * vía `sh -c 'npx … hyperframes render … > /tmp/render.log 2>&1'`. Si el comando
 * muere a media ejecución (OOM de Chromium, crash) el SDK lanza "Stream ended
 * before command finished" SIN entregar result → no se puede leer result.stderr().
 * Para no perder la causa real, tras el runCommand (resuelva con exit≠0 O lance
 * "Stream ended") leemos `/tmp/render.log` del sandbox y metemos su cola (~1500
 * chars) en el Error → así GET /api/status muestra el stderr REAL de hyperframes/
 * Chromium. Si el log tampoco se puede leer (sandbox muerto), el Error lo indica.
 *
 * MEMORIA: `--workers` ya NO es `auto` (= nº de vCPUs, que con muchos vCPUs lanzaba
 * demasiados Chromium a 1080×1920 y reventaba la RAM). Ahora es configurable por
 * env `RENDER_WORKERS` (default 2). Los vCPUs (y por tanto la RAM: 2 GB/vCPU) son
 * configurables por env `SANDBOX_VCPUS` (default 8 = máx Pro → 16 GB) en sandbox-lib.
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
  readLatestSnapshotId,
  readSnapshotId,
  runOrThrow,
  SANDBOX_OPTS,
  withRetry,
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

/**
 * Nº de workers (procesos Chromium en paralelo) del render. Configurable por env
 * `RENDER_WORKERS` (default 2).
 *
 * Antes era `--workers auto` = nº de vCPUs: con 8 vCPUs eso lanza 8 Chromium
 * renderizando 1080×1920 a la vez → pico de RAM enorme → OOM de la microVM →
 * proceso muerto → "Stream ended before command finished" a media ejecución.
 *
 * Un valor conservador (2) deja ~8 GB por worker en una microVM de 16 GB (8 vCPUs
 * en Pro), eliminando el OOM a costa de algo más de tiempo de render (los 495
 * frames se reparten en 2 colas). Subir vía env si la RAM lo permite. Se sanea a
 * un entero ≥ 1; valores inválidos caen al default 2.
 */
const RENDER_WORKERS: number = (() => {
  const raw = Number(process.env['RENDER_WORKERS'])
  return Number.isInteger(raw) && raw >= 1 ? raw : 2
})()

/** Ruta DENTRO del sandbox donde el render vuelca stdout+stderr (sobrevive al fallo). */
const SANDBOX_RENDER_LOG = '/tmp/render.log'

/**
 * Escapa un valor para incrustarlo entre comillas SIMPLES en un comando de shell
 * POSIX. En sh, dentro de '…' todo es literal salvo la propia comilla simple, que
 * se cierra y se reabre con la secuencia clásica `'\''`. Imprescindible para pasar
 * el JSON de `--variables` (lleno de comillas dobles, llaves y posibles espacios)
 * sin que la shell lo reinterprete.
 */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// ─── Render con captura de log que sobrevive al "Stream ended" ─────────────────

/**
 * Lee la cola del log de render del sandbox para incrustarla en un Error.
 *
 * Es la PIEZA CLAVE del diagnóstico: el render se ejecuta vía `sh -c '… > log 2>&1'`,
 * así que TODO el stdout/stderr de hyperframes/Chromium queda en un fichero DENTRO
 * de la microVM. Pase lo que pase con `runCommand` (resuelva con exitCode≠0 o lance
 * "Stream ended before command finished" sin devolver result), leemos ese fichero y
 * metemos su cola en el mensaje. Si la lectura falla (sandbox muerto), lo decimos.
 *
 * @returns la cola del log (≤ maxChars), o un marcador legible si no se pudo leer.
 */
async function readRenderLogTail(
  sandbox: Sandbox,
  signal: AbortSignal,
  maxChars = 1500,
): Promise<string> {
  try {
    const buf = await sandbox.readFileToBuffer(
      { path: SANDBOX_RENDER_LOG },
      { signal },
    )
    if (!buf) return '(log de render vacío o inexistente: el comando murió antes de escribir nada)'
    const text = buf.toString('utf8').trim()
    if (!text) return '(log de render vacío)'
    return text.slice(-maxChars)
  } catch (readErr: unknown) {
    const m = readErr instanceof Error ? readErr.message : String(readErr)
    return `(no se pudo leer ${SANDBOX_RENDER_LOG} del sandbox — probablemente muerto/OOM: ${m})`
  }
}

/**
 * Ejecuta el render de HyperFrames redirigiendo TODA su salida a un fichero en el
 * sandbox, y lanza un Error RICO (con la cola de ese log) en CUALQUIER fallo —
 * incluido el "Stream ended before command finished" que mata el `runCommand`
 * antes de devolver result (y que, por tanto, NO deja leer result.stderr()).
 *
 * Por qué `sh -c` con redirect en vez de `runOrThrow(npx, …)`:
 *   - `runOrThrow` asume que `runCommand` RESUELVE y lee `result.stderr()`. Pero el
 *     stream largo del render (495 frames) se corta y `runCommand` RECHAZA → no hay
 *     result que leer → perdíamos la causa real.
 *   - Redirigiendo a `/tmp/render.log 2>&1`, el stderr de Chromium/hyperframes queda
 *     persistido en disco y lo recuperamos aunque el stream se haya cortado.
 */
async function runRenderWithLog(
  sandbox: Sandbox,
  signal: AbortSignal,
  variablesJson: string,
): Promise<void> {
  // Comando real, con --variables y salida redirigida al log dentro del sandbox.
  // Solo el JSON de --variables necesita escaparse (el resto son tokens fijos).
  const renderCmd = [
    'npx',
    '--no-install',
    'hyperframes',
    'render',
    SANDBOX_COMPOSITION_DIR,
    '-o',
    SANDBOX_MP4,
    '--workers',
    String(RENDER_WORKERS),
    '--non-interactive',
    '--variables',
    shSingleQuote(variablesJson),
  ].join(' ')

  const script = `${renderCmd} > ${SANDBOX_RENDER_LOG} 2>&1`

  let result: Awaited<ReturnType<Sandbox['runCommand']>> | undefined
  try {
    result = await sandbox.runCommand({ cmd: 'sh', args: ['-c', script], signal })
  } catch (runErr: unknown) {
    // Caso "Stream ended before command finished" (u otro throw de runCommand):
    // NO hay result → la única causa real está en el log del sandbox. Lo leemos.
    const runMsg = runErr instanceof Error ? runErr.message : String(runErr)
    const logTail = await readRenderLogTail(sandbox, signal)
    throw new Error(
      `[render] runCommand falló sin entregar resultado (${runMsg}). ` +
        `workers=${RENDER_WORKERS}. Cola de ${SANDBOX_RENDER_LOG}:\n${logTail}`,
    )
  }

  // runCommand resolvió: si exit≠0, el log tiene el stderr real de hyperframes.
  if (result.exitCode !== 0) {
    const logTail = await readRenderLogTail(sandbox, signal)
    throw new Error(
      `[render] hyperframes render falló (exit ${result.exitCode}). ` +
        `workers=${RENDER_WORKERS}. Cola de ${SANDBOX_RENDER_LOG}:\n${logTail}`,
    )
  }
}

// ─── Implementación del adaptador ───────────────────────────────────────────────

/**
 * Crea (o restaura) el sandbox para el render.
 *
 * Estrategia de resolución de snapshot (en orden):
 *   1. Pointer del deployment actual (`readSnapshotId`): horneado en este build.
 *   2. Snapshot más reciente disponible en Blob (`readLatestSnapshotId`): reutiliza
 *      el último snapshot bueno cuando el horneado del build se saltó o falló.
 *   3. Hot-prepare: microVM fresca + `prepareSandbox` con `withRetry` (3 intentos)
 *      como último recurso (sin ningún snapshot previo).
 *
 * Etiqueta la fase como `create` para job.error.
 */
async function createOrRestoreSandbox(signal: AbortSignal): Promise<Sandbox> {
  // 1. Snapshot del deployment actual.
  const currentSnapshotId = await readSnapshotId().catch(() => undefined)

  // 2. Si no hay snapshot actual, intentar el más reciente disponible.
  const snapshotId =
    currentSnapshotId ?? (await readLatestSnapshotId().catch(() => undefined))

  if (snapshotId) {
    const source = currentSnapshotId ? 'deployment actual' : 'snapshot previo más reciente'
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
        `[create] restauración de snapshot ${snapshotId} (${source}) falló: ${msg}`,
      )
    }
  }

  // 3. Sin ningún snapshot disponible: microVM fresca + setup en caliente con reintentos.
  //    withRetry crea un sandbox nuevo en cada intento (ver create-snapshot.ts para el patrón).
  return withRetry(
    async () => {
      const sandbox = await Sandbox.create({
        runtime: SANDBOX_OPTS.runtime,
        resources: SANDBOX_OPTS.resources,
        timeout: SANDBOX_TIMEOUT_MS,
        signal,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`[create] no se pudo crear la microVM: ${msg}`)
      })

      try {
        // prepareSandbox lanza errores ya etiquetados ([install]/[browser]).
        await prepareSandbox(sandbox, signal)
        return sandbox
      } catch (err: unknown) {
        // Liberar la microVM fallida antes de que withRetry vuelva a intentarlo.
        await sandbox.stop().catch(() => {})
        throw err
      }
    },
    { attempts: 3, label: 'hot-prepare' },
  )
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
        //    Se ejecuta vía `sh -c '… > /tmp/render.log 2>&1'` para capturar la
        //    causa REAL del fallo incluso cuando el comando muere a media ejecución
        //    (OOM/crash) y el SDK lanza "Stream ended before command finished".
        phase = 'render'
        await runRenderWithLog(sandbox, signal, variablesJson)

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
