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
 * CÓMO LLEGA LA COMPOSICIÓN AL SANDBOX (decisión clave):
 *   Empaquetamos `compositions/trailer/` (index.html + meta.json + assets/ con
 *   fuentes y GSAP vendorizados + las sub-composiciones HTML) y los escribimos
 *   DENTRO del sandbox con `sandbox.writeFiles(...)` en UNA sola llamada.
 *
 *   → NO se clona el repo. → NO hace falta que el repo esté pusheado ni público.
 *   Los archivos viajan por el SDK desde el filesystem de la Function (la
 *   carpeta `compositions/trailer/` se versiona en el repo y, por tanto, está
 *   presente en el bundle del despliegue). Es exactamente el patrón de la
 *   plantilla oficial `hyperframes-vercel-template` (`writeFiles` con rutas
 *   `composition/<rel>`), adaptado a que aquí leemos la composición de disco.
 *
 * FLUJO (renderTrailer):
 *   1. Leer recursivamente `compositions/trailer/` → lista de { path, content }.
 *   2. Crear el Sandbox (runtime node22, iad1).
 *   3. Instalar hyperframes en el sandbox (`npm i -g hyperframes ffmpeg-static`)
 *      + `npx hyperframes browser ensure` (chrome-headless-shell).
 *   4. writeFiles → vuelca la composición en `composition/`.
 *   5. `npx hyperframes render composition -o out.mp4 --workers auto
 *       --non-interactive --variables '<json>'`.
 *   6. Extraer poster (frame ~3 s) con ffmpeg DENTRO del sandbox → poster.jpg.
 *   7. readFileToBuffer de out.mp4 y poster.jpg.
 *   8. put() ambos a Vercel Blob (acceso público).
 *   9. stop() del sandbox (en finally).
 *   → { mp4Url, poster }.
 *
 * TIMEOUT: 90 s globales con AbortController. Si se supera, se aborta el
 * comando, se intenta parar el sandbox y se lanza un error claro.
 *
 * ENV NECESARIAS (ver REQUISITOS DE DEPLOY en el README):
 *   - En Vercel: VERCEL_OIDC_TOKEN (auto) → autentica el Sandbox API.
 *   - Fuera de Vercel: VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID.
 *   - BLOB_READ_WRITE_TOKEN (auto en Vercel) → subida a Blob.
 *   El SDK de @vercel/sandbox lee estas variables del entorno automáticamente;
 *   no se pasan credenciales explícitas aquí.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep, posix } from 'node:path'
import { Sandbox } from '@vercel/sandbox'
import { put } from '@vercel/blob'
import type { RenderAdapter } from './render'

// ─── Constantes de configuración ───────────────────────────────────────────────

/** Carpeta de la composición HyperFrames en el repo (relativa a cwd del proceso). */
const COMPOSITION_DIR = join(process.cwd(), 'compositions', 'trailer')

/** Directorio destino DENTRO del sandbox donde se vuelca la composición. */
const SANDBOX_COMPOSITION_DIR = 'composition'

/** Nombres de los artefactos generados dentro del sandbox. */
const SANDBOX_MP4 = 'out.mp4'
const SANDBOX_POSTER = 'poster.jpg'

/** Timeout global del render (aborto + error claro si se supera). */
const RENDER_TIMEOUT_MS = 90_000

/**
 * Holgura del timeout del propio sandbox por encima del nuestro: si nuestro
 * AbortController dispara a los 90 s, el sandbox sigue vivo lo justo para que
 * el stop() ordenado funcione. La microVM se factura por uso, así que el
 * margen extra no es gratis pero sí pequeño.
 */
const SANDBOX_TIMEOUT_MS = RENDER_TIMEOUT_MS + 30_000

/** Segundo del que se extrae el poster (la escena "identity" ya está montada). */
const POSTER_SECOND = 3

// ─── Utilidades de filesystem ──────────────────────────────────────────────────

/** Un archivo de la composición listo para `writeFiles`. */
interface SandboxFile {
  /** Ruta relativa POSIX dentro del sandbox (p. ej. `composition/assets/...`). */
  path: string
  /** Contenido binario del archivo. */
  content: Buffer
}

/**
 * Lee recursivamente todos los archivos de `dir` y los devuelve con su ruta
 * relativa normalizada a POSIX y prefijada por `prefix` (para escribirlos
 * dentro del sandbox preservando la estructura de carpetas).
 */
async function collectCompositionFiles(
  dir: string,
  prefix: string,
): Promise<SandboxFile[]> {
  const out: SandboxFile[] = []

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile()) {
        // Ruta relativa a la raíz de la composición, normalizada a POSIX.
        const rel = relative(dir, abs).split(sep).join(posix.sep)
        out.push({
          path: posix.join(prefix, rel),
          content: await readFile(abs),
        })
      }
    }
  }

  await walk(dir)
  return out
}

// ─── Helpers de Sandbox ─────────────────────────────────────────────────────────

/**
 * Ejecuta un comando en el sandbox y lanza un error legible si el exit code
 * no es 0 (incluyendo stderr para diagnóstico). Respeta el AbortSignal global.
 */
async function runOrThrow(
  sandbox: Sandbox,
  label: string,
  cmd: string,
  args: string[],
  signal: AbortSignal,
): Promise<void> {
  const result = await sandbox.runCommand({ cmd, args, signal })
  if (result.exitCode !== 0) {
    const stderr = await result.stderr().catch(() => '')
    throw new Error(
      `[render:sandbox] paso "${label}" falló (exit ${result.exitCode}): ${stderr.slice(0, 500)}`,
    )
  }
}

// ─── Implementación del adaptador ───────────────────────────────────────────────

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
      // Aborto global a los 90 s. timeoutMs por comando refuerza el aborto a
      // nivel de microVM (SIGKILL del proceso) además del AbortSignal del SDK.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS)
      const { signal } = controller

      // 1. Empaquetar la composición desde disco (no requiere repo pusheado).
      const files = await collectCompositionFiles(
        COMPOSITION_DIR,
        SANDBOX_COMPOSITION_DIR,
      )
      if (files.length === 0) {
        clearTimeout(timer)
        throw new Error(
          `[render:sandbox] no se encontraron archivos de composición en ${COMPOSITION_DIR}`,
        )
      }

      // Serializamos las variables a JSON una sola vez (todas son string/number).
      const variablesJson = JSON.stringify(vars)

      let sandbox: Sandbox | undefined
      try {
        // 2. Crear la microVM. Solo región iad1 (única con Sandbox).
        sandbox = await Sandbox.create({
          runtime: 'node22',
          resources: { vcpus: 4 },
          timeout: SANDBOX_TIMEOUT_MS,
          signal,
        })

        // 3. Instalar HyperFrames + ffmpeg-static y asegurar el navegador.
        //    `npm i -g` deja `hyperframes` resoluble por `npx --no-install`.
        await runOrThrow(
          sandbox,
          'install-hyperframes',
          'npm',
          ['install', '-g', 'hyperframes', 'ffmpeg-static', 'ffprobe-static'],
          signal,
        )
        await runOrThrow(
          sandbox,
          'browser-ensure',
          'npx',
          ['--no-install', 'hyperframes', 'browser', 'ensure'],
          signal,
        )

        // 4. Volcar la composición dentro del sandbox (una sola llamada).
        await sandbox.writeFiles(files)

        // 5. Renderizar. `--variables` aplica a la composición raíz; el
        //    index.html re-propaga las vars fusionadas a las sub-escenas.
        await runOrThrow(
          sandbox,
          'render',
          'npx',
          [
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
          signal,
        )

        // 6. Extraer el poster (frame ~3 s) con el ffmpeg que trae el sandbox.
        //    `-y` sobreescribe, `-frames:v 1` un único frame, calidad alta.
        await runOrThrow(
          sandbox,
          'poster',
          'ffmpeg',
          [
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
          signal,
        )

        // 7. Recoger los artefactos del sandbox como Buffers.
        const [mp4Buffer, posterBuffer] = await Promise.all([
          sandbox.readFileToBuffer({ path: SANDBOX_MP4 }, { signal }),
          sandbox.readFileToBuffer({ path: SANDBOX_POSTER }, { signal }),
        ])
        if (!mp4Buffer) {
          throw new Error('[render:sandbox] el render no produjo out.mp4')
        }
        if (!posterBuffer) {
          throw new Error('[render:sandbox] no se pudo extraer el poster')
        }

        // 8. Subir ambos a Vercel Blob (acceso público, sin sufijo aleatorio
        //    para que la clave sea estable por jobId).
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
        // Distinguir el timeout (aborto) de otros fallos para un error claro.
        if (signal.aborted) {
          throw new Error(
            `[render:sandbox] timeout de render (${RENDER_TIMEOUT_MS / 1000}s) superado para job ${jobId}`,
          )
        }
        throw err instanceof Error
          ? err
          : new Error(`[render:sandbox] error desconocido: ${String(err)}`)
      } finally {
        clearTimeout(timer)
        // Parar la microVM siempre (se factura por uso). Errores aquí no deben
        // enmascarar el error real del render.
        if (sandbox) {
          await sandbox.stop().catch(() => {})
        }
      }
    },
  }
}
