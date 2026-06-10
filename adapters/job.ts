/**
 * adapters/job.ts
 *
 * Persistencia del estado de un job de renderizado en Vercel Blob.
 *
 * Las funciones serverless son efímeras: el estado del job DEBE vivir
 * en almacenamiento externo. Este adaptador lo gestiona.
 *
 * Modelo de datos:
 *   Job = { status, url?, poster?, error?, updatedAt }
 *   Key de Blob: `jobs/<jobId>.json`
 *
 * jobId = `${owner}/${repo}/${YYYY-MM-DD}` (helper makeJobId)
 *   La fecha se pasa como argumento (no Date.now() interno) para
 *   mantener el helper determinista y testeable.
 *
 * Diseño inyectable: createJobAdapter(client) acepta cualquier BlobClient,
 * incluido el fake en memoria para tests.
 */

import { z } from 'zod'
import type { BlobClient } from './blob-client'
import { createVercelBlobClient } from './blob-client'

// ─── Schema y tipos ────────────────────────────────────────────────────────────

export const JobSchema = z.object({
  status: z.enum(['rendering', 'ready', 'error']),
  url: z.string().optional(),
  poster: z.string().optional(),
  error: z.string().optional(),
  updatedAt: z.string(),
})

export type Job = z.infer<typeof JobSchema>

// ─── Helper: construye el jobId ────────────────────────────────────────────────

/**
 * Construye el jobId canónico.
 * @param owner - Propietario del repositorio (login de GitHub).
 * @param repo  - Nombre del repositorio.
 * @param date  - Fecha en formato YYYY-MM-DD. Se pasa como argumento
 *                (NO se llama Date.now() aquí) para garantizar determinismo.
 */
export function makeJobId(owner: string, repo: string, date: string): string {
  return `${owner}/${repo}/${date}`
}

// ─── Interfaz del adaptador ────────────────────────────────────────────────────

export interface JobAdapter {
  /**
   * Recupera el estado de un job.
   * @returns El job si existe, `null` si la clave no está en Blob.
   * @throws ZodError si el JSON almacenado no cumple el schema.
   */
  get(jobId: string): Promise<Job | null>
  /** Persiste (o sobreescribe) el estado de un job. */
  set(jobId: string, job: Job): Promise<void>
}

// ─── Fábrica inyectable ────────────────────────────────────────────────────────

/**
 * Crea un JobAdapter con el BlobClient proporcionado.
 * - En producción: `createJobAdapter(createVercelBlobClient())`
 * - En tests: `createJobAdapter(createInMemoryBlobClient())`
 */
export function createJobAdapter(client: BlobClient): JobAdapter {
  return {
    async get(jobId: string): Promise<Job | null> {
      const key = `jobs/${jobId}.json`
      const raw = await client.getJson(key)
      if (raw === null) return null
      // Lanza ZodError si el JSON almacenado no cumple el schema
      return JobSchema.parse(raw)
    },

    async set(jobId: string, job: Job): Promise<void> {
      const key = `jobs/${jobId}.json`
      await client.putJson(key, job)
    },
  }
}

// ─── Exportación de conveniencia (instancia con cliente real) ──────────────────

/**
 * Instancia lista para usar en producción.
 * En tests, usa `createJobAdapter(createInMemoryBlobClient())`.
 */
export const jobAdapter: JobAdapter = createJobAdapter(createVercelBlobClient())
