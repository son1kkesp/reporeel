/**
 * scripts/create-snapshot.ts
 *
 * Hornea un SNAPSHOT de Vercel Sandbox en BUILD-TIME con HyperFrames + ffmpeg +
 * chrome-headless-shell ya instalados, y guarda su `snapshotId` en un pointer en
 * Blob. En runtime, render.sandbox.ts restaura ese snapshot en ~100 ms en lugar
 * de instalar/descargar todo "en caliente" (que es lo que provoca el error
 * "Stream ended before command finished").
 *
 * Réplica de scripts/create-snapshot.ts de hyperframes-vercel-template (HeyGen).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CÓMO SE EJECUTA
 *
 *   Se engancha al build de Vercel:  package.json → "build": "next build && tsx scripts/create-snapshot.ts"
 *
 *   - En el deploy de Vercel: VERCEL_DEPLOYMENT_ID y BLOB_READ_WRITE_TOKEN están
 *     presentes → crea la microVM, la prepara (dnf+npm+symlinks+browser ensure,
 *     ~2-3 min), toma el snapshot y escribe el pointer. El build tarda más, pero
 *     CADA render posterior arranca en ~100 ms y completa.
 *   - En build LOCAL (sin esas env): se salta silenciosamente (no rompe el build).
 *
 *   Requisitos para que funcione en Vercel:
 *     - El proyecto debe tener acceso a Vercel Sandbox (plan Pro) y a Blob.
 *     - VERCEL_OIDC_TOKEN (auto) autentica el Sandbox API en el build.
 *
 *   Manual (debug, fuera de Vercel):
 *     VERCEL_TOKEN=… VERCEL_TEAM_ID=… VERCEL_PROJECT_ID=… \
 *     VERCEL_DEPLOYMENT_ID=local-test BLOB_READ_WRITE_TOKEN=… \
 *     npx tsx scripts/create-snapshot.ts
 *
 *   NOTA sobre TTL: el snapshot expira (SNAPSHOT_TTL_MS = 7 días). Como el pointer
 *   se reescribe en cada deploy, mientras despliegues con normalidad siempre habrá
 *   un snapshot fresco. Si un deployment vive > TTL sin re-deploy, el render caerá
 *   al fallback de setup en caliente (y job.error lo dejará claro con [browser]).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Sandbox } from '@vercel/sandbox'
import {
  prepareSandbox,
  SANDBOX_OPTS,
  SNAPSHOT_TTL_MS,
  withRetry,
  writeSnapshotPointer,
} from '../adapters/sandbox-lib'

/** Timeout amplio para el setup completo (incluye descarga de Chromium). */
const SETUP_TIMEOUT_MS = 15 * 60 * 1000

/** Número de reintentos del ciclo completo de horneado. */
const BAKE_ATTEMPTS = 3

async function main(): Promise<void> {
  const token = process.env['BLOB_READ_WRITE_TOKEN']
  const deploymentId = process.env['VERCEL_DEPLOYMENT_ID']

  if (!token || !deploymentId) {
    console.log(
      '[create-snapshot] BLOB_READ_WRITE_TOKEN o VERCEL_DEPLOYMENT_ID ausentes — se omite (build local).',
    )
    return
  }

  const t0 = Date.now()

  /**
   * Ciclo completo de horneado envuelto en withRetry.
   *
   * CLAVE: cada intento crea un sandbox NUEVO. Un sandbox cuyo stream murió no
   * es recuperable; hay que recrearlo desde cero. Por eso el `Sandbox.create()`
   * está DENTRO del callback (no fuera), y el sandbox fallido se limpia con
   * stop() entre intentos (también dentro del callback, en el finally).
   */
  await withRetry(
    async () => {
      const controller = new AbortController()

      console.log('[create-snapshot] creando microVM fresca…')
      const sandbox = await Sandbox.create({
        runtime: SANDBOX_OPTS.runtime,
        resources: SANDBOX_OPTS.resources,
        timeout: SETUP_TIMEOUT_MS,
      })

      try {
        console.log(
          '[create-snapshot] preparando (dnf + npm + symlinks + browser ensure)…',
        )
        await prepareSandbox(sandbox, controller.signal)

        console.log('[create-snapshot] tomando snapshot…')
        const snapshot = await sandbox.snapshot({ expiration: SNAPSHOT_TTL_MS })
        const mb = Math.round(snapshot.sizeBytes / 1024 / 1024)
        console.log(
          `[create-snapshot] snapshotId=${snapshot.snapshotId} size=${mb}MB`,
        )

        await writeSnapshotPointer({
          deploymentId,
          snapshotId: snapshot.snapshotId,
          token,
        })

        const s = Math.round((Date.now() - t0) / 1000)
        console.log(`[create-snapshot] hecho en ${s}s`)
      } finally {
        // snapshot() ya detiene la microVM; stop() es idempotente y barato.
        // Si el intento falló, libera la microVM antes del próximo reintento.
        await sandbox.stop().catch(() => {})
      }
    },
    { attempts: BAKE_ATTEMPTS, label: 'create-snapshot' },
  )
}

main().catch((err: unknown) => {
  // Tras agotar todos los reintentos el horneado sigue fallando.
  // Salimos con 0 para que `next build && tsx create-snapshot` NO tumbe el deploy.
  // El runtime usará el snapshot anterior (readLatestSnapshotId) o el fallback en caliente.
  console.warn(
    '[create-snapshot] snapshot NO horneado tras',
    BAKE_ATTEMPTS,
    'intentos; el runtime usará fallback en caliente o un snapshot previo.',
    err,
  )
  process.exit(0)
})
