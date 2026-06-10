/**
 * adapters/sandbox-lib.ts
 *
 * Lógica compartida de Vercel Sandbox entre:
 *   - el render real (render.sandbox.ts), que RESTAURA el snapshot, y
 *   - el script de build (scripts/create-snapshot.ts), que lo HORNEA.
 *
 * Replica `lib/sandbox.ts` de la plantilla oficial hyperframes-vercel-template
 * (HeyGen), adaptado a nuestra estructura:
 *   - runOrThrow         → comprueba exitCode y lanza error RICO (fase+cmd+stderr).
 *   - prepareSandbox     → dnf install (libs Chromium) + npm install + symlinks
 *                          + browser ensure. SOLO en el path de setup en caliente
 *                          (snapshot frío). Es lo que el snapshot pre-hornea.
 *   - readSnapshotId /   → pointer del snapshot en Blob (snapshot-cache/<dep>.json).
 *     writeSnapshotPointer
 *   - collectCompositionFiles → empaqueta compositions/trailer/ para writeFiles.
 *
 * Por qué un módulo aparte: el script de build (Node puro, fuera de Next) y el
 * adapter de runtime necesitan EXACTAMENTE el mismo prepareSandbox para que el
 * snapshot horneado y el fallback en caliente sean idénticos.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep, posix } from 'node:path'
import { Sandbox } from '@vercel/sandbox'
import { get, put } from '@vercel/blob'

// ─── Opciones base de la microVM ───────────────────────────────────────────────

/**
 * vCPUs de la microVM, configurable por env `SANDBOX_VCPUS` (default 8).
 *
 * Vercel asigna 2 GB de RAM por vCPU (doc oficial /docs/sandbox/pricing). El render
 * de HyperFrames lanza Chromium headless a 1080×1920 (frames pesados en RAM); con
 * pocos vCPUs/poca RAM el navegador revienta la memoria de la microVM y el proceso
 * muere a media ejecución → el SDK lanza "Stream ended before command finished".
 *
 * Límites de Vercel Sandbox por plan (doc oficial, actualizada 2026-05-29):
 *   - Hobby:      máx 4 vCPUs / 8 GB
 *   - Pro:        máx 8 vCPUs / 16 GB   ← nuestro plan
 *   - Enterprise: máx 32 vCPUs / 64 GB
 * Permitido: 1 vCPU o nº PAR entre 2 y 32 (el default de Vercel es 2).
 *
 * Elegimos el MÁXIMO de Pro (8 vCPUs → 16 GB) por defecto: el coste se factura por
 * Active-CPU (tiempo de CPU realmente usado) + memoria provisionada por minuto, así
 * que más vCPUs no encarece linealmente un render corto, pero sí duplica la RAM
 * disponible (8 → 16 GB) y reduce drásticamente el riesgo de OOM de Chromium. El
 * rate-limit de Pro (200 vCPUs/min) cubre de sobra una microVM de 8 vCPUs.
 *
 * Se sanea a un entero ≥ 1; valores inválidos caen al default 8.
 */
const SANDBOX_VCPUS: number = (() => {
  const raw = Number(process.env['SANDBOX_VCPUS'])
  return Number.isInteger(raw) && raw >= 1 ? raw : 8
})()

/**
 * Runtime + recursos comunes. node22 e iad1 (única región con Sandbox).
 * vCPUs configurables (ver `SANDBOX_VCPUS`); 2 GB de RAM por vCPU.
 */
export const SANDBOX_OPTS = {
  runtime: 'node22',
  resources: { vcpus: SANDBOX_VCPUS },
} as const

/** Directorio destino DENTRO del sandbox donde se vuelca la composición. */
export const SANDBOX_COMPOSITION_DIR = 'composition'

/**
 * Carpeta de la composición HyperFrames en el repo, resuelta con `process.cwd()`
 * (raíz del bundle en una Vercel Function; `outputFileTracingIncludes` la fuerza
 * a incluir). En el script de build, cwd es la raíz del repo → también funciona.
 */
export const COMPOSITION_DIR = join(process.cwd(), 'compositions', 'trailer')

/** TTL del snapshot (ms). Los snapshots expiran; el build lo refresca en cada deploy. */
export const SNAPSHOT_TTL_MS = 7 * 24 * 3600 * 1000

/** Clave del pointer del snapshot en Blob, namespaced por deployment. */
const pointerKey = (deploymentId: string): string =>
  `snapshot-cache/${deploymentId}.json`

// ─── Tipos ──────────────────────────────────────────────────────────────────────

/** Opciones de un comando del sandbox (sin signal: lo inyecta runOrThrow). */
type RunCommandOpts = Omit<Parameters<Sandbox['runCommand']>[0], 'signal'>

/** Un archivo de la composición listo para `writeFiles`. */
export interface SandboxFile {
  /** Ruta relativa POSIX dentro del sandbox (p. ej. `composition/assets/...`). */
  path: string
  /** Contenido binario del archivo. */
  content: Buffer
}

// ─── Ejecución de comandos (patrón oficial: await + exitCode + stderr) ──────────

/**
 * Ejecuta un comando en el sandbox y lanza un Error RICO si el exit code ≠ 0.
 *
 * Patrón EXACTO de la plantilla oficial (runSandboxCommand):
 *   - `await sandbox.runCommand(opts)` (NO detached → el SDK espera al exitCode).
 *   - comprueba `result.exitCode !== 0`.
 *   - en fallo, lee `await result.stderr()` y lanza.
 *
 * El error incluye: fase (label) + comando + exitCode + últimos ~600 chars de
 * stderr (y stdout como respaldo). Ese message acaba en `job.error`, que es la
 * única observabilidad fiable del render (corre en after(), sin logs visibles).
 */
export async function runOrThrow(
  sandbox: Sandbox,
  label: string,
  signal: AbortSignal,
  opts: RunCommandOpts,
): Promise<void> {
  const result = await sandbox.runCommand({ ...opts, signal })
  if (result.exitCode !== 0) {
    const stderr = await result.stderr().catch(() => '')
    const stdout = stderr ? '' : await result.stdout().catch(() => '')
    const cmdline = [opts.cmd, ...(opts.args ?? [])].join(' ')
    const tail = (stderr || stdout).slice(-600)
    throw new Error(
      `[${label}] "${cmdline}" falló (exit ${result.exitCode}): ${tail}`,
    )
  }
}

// ─── Preparación del entorno (lo que el snapshot pre-hornea) ────────────────────

/**
 * Instala TODO lo que HyperFrames necesita en una microVM fresca.
 *
 * Replica `prepareSandbox` de la plantilla oficial, paso a paso:
 *   1. `dnf install` de las librerías de SISTEMA de Chromium (sin ellas
 *      chrome-headless-shell no arranca) + `npm install` LOCAL en paralelo.
 *   2. symlinks de ffmpeg/ffprobe a /usr/local/bin.
 *   3. `npx --no-install hyperframes browser ensure` (descarga el navegador).
 *
 * IMPORTANTE: el paso 3 es una descarga larga (~90-120 s). Hacerlo "en caliente"
 * en cada render es lo que provoca "Stream ended before command finished". Por
 * eso esta función SOLO se usa para HORNEAR el snapshot (build) o como fallback
 * cuando no hay snapshot; el render normal restaura el snapshot y la salta.
 */
export async function prepareSandbox(
  sandbox: Sandbox,
  signal: AbortSignal,
): Promise<void> {
  // 1. Libs de sistema de Chromium + instalación local de hyperframes/ffmpeg.
  await Promise.all([
    runOrThrow(sandbox, 'install', signal, {
      cmd: 'dnf',
      args: [
        'install',
        '-y',
        '--setopt=install_weak_deps=False',
        'nss',
        'nspr',
        'atk',
        'at-spi2-atk',
        'cups-libs',
        'libdrm',
        'libxkbcommon',
        'libXcomposite',
        'libXdamage',
        'libXext',
        'libXfixes',
        'libXrandr',
        'mesa-libgbm',
        'alsa-lib',
        'pango',
      ],
      sudo: true,
    }),
    runOrThrow(sandbox, 'install', signal, {
      cmd: 'npm',
      args: [
        'install',
        '--no-save',
        '--no-audit',
        '--no-fund',
        'hyperframes@latest',
        'ffmpeg-static',
        'ffprobe-static',
      ],
    }),
  ])

  // 2. Symlinks de los binarios de ffmpeg/ffprobe instalados por npm.
  await Promise.all([
    runOrThrow(sandbox, 'install', signal, {
      cmd: 'ln',
      args: [
        '-sf',
        '/vercel/sandbox/node_modules/ffmpeg-static/ffmpeg',
        '/usr/local/bin/ffmpeg',
      ],
      sudo: true,
    }),
    runOrThrow(sandbox, 'install', signal, {
      cmd: 'ln',
      args: [
        '-sf',
        '/vercel/sandbox/node_modules/ffprobe-static/bin/linux/x64/ffprobe',
        '/usr/local/bin/ffprobe',
      ],
      sudo: true,
    }),
  ])

  // 3. Descargar chrome-headless-shell (lo que el snapshot evita en caliente).
  await runOrThrow(sandbox, 'browser', signal, {
    cmd: 'npx',
    args: ['--no-install', 'hyperframes', 'browser', 'ensure'],
  })
}

// ─── Pointer del snapshot en Blob ───────────────────────────────────────────────

/**
 * Persiste el `snapshotId` del snapshot recién horneado en un blob público,
 * namespaced por VERCEL_DEPLOYMENT_ID. El render lo lee con readSnapshotId.
 */
export async function writeSnapshotPointer(params: {
  deploymentId: string
  snapshotId: string
  token?: string
}): Promise<void> {
  await put(
    pointerKey(params.deploymentId),
    JSON.stringify({ snapshotId: params.snapshotId }),
    {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      ...(params.token ? { token: params.token } : {}),
    },
  )
}

/**
 * Lee el `snapshotId` del pointer del deployment actual.
 * @returns el snapshotId, o `undefined` si no hay deployment/pointer (→ fallback
 *          a setup en caliente). NO lanza por ausencia: la ausencia es esperable
 *          en local o en el primer deploy antes de que corra create-snapshot.
 */
export async function readSnapshotId(): Promise<string | undefined> {
  const deploymentId = process.env['VERCEL_DEPLOYMENT_ID']
  if (!deploymentId) return undefined

  const token = process.env['BLOB_READ_WRITE_TOKEN']
  const result = await get(pointerKey(deploymentId), {
    access: 'public',
    ...(token ? { token } : {}),
  })
  if (!result || result.statusCode !== 200) return undefined

  const { snapshotId } = (await new Response(result.stream).json()) as {
    snapshotId?: string
  }
  return snapshotId
}

// ─── Empaquetado de la composición ──────────────────────────────────────────────

/**
 * Lee recursivamente todos los archivos de `dir` y los devuelve con su ruta
 * relativa normalizada a POSIX y prefijada por `prefix`, listos para writeFiles.
 */
export async function collectCompositionFiles(
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
