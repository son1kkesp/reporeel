/**
 * adapters/cache.ts
 *
 * Caché de tráileres generados en Vercel Blob.
 *
 * Evita regenerar el mismo tráiler para el mismo repo/día.
 * Las funciones serverless son efímeras: la caché DEBE vivir en
 * almacenamiento externo.
 *
 * Modelo de datos:
 *   Trailer = { mp4Url, poster }
 *   Key de Blob: `trailers/<jobId>.json`
 *
 * jobId = `${owner}/${repo}/${YYYY-MM-DD}` (helper makeJobId de job.ts)
 *
 * Diseño inyectable: createCacheAdapter(client) acepta cualquier BlobClient,
 * incluido el fake en memoria para tests.
 */

import { z } from 'zod'
import type { BlobClient } from './blob-client'
import { createVercelBlobClient } from './blob-client'

// ─── Schema y tipos ────────────────────────────────────────────────────────────

export const TrailerSchema = z.object({
  mp4Url: z.string().min(1),
  poster: z.string().min(1),
})

export type Trailer = z.infer<typeof TrailerSchema>

// ─── Interfaz del adaptador ────────────────────────────────────────────────────

export interface CacheAdapter {
  /**
   * Recupera el tráiler cacheado para el jobId dado.
   * @returns El trailer si existe en caché, `null` si no.
   * @throws ZodError si el JSON almacenado no cumple el schema.
   */
  getTrailer(jobId: string): Promise<Trailer | null>
  /** Persiste (o sobreescribe) el tráiler en caché. */
  setTrailer(jobId: string, trailer: Trailer): Promise<void>
}

// ─── Fábrica inyectable ────────────────────────────────────────────────────────

/**
 * Crea un CacheAdapter con el BlobClient proporcionado.
 * - En producción: `createCacheAdapter(createVercelBlobClient())`
 * - En tests: `createCacheAdapter(createInMemoryBlobClient())`
 */
export function createCacheAdapter(client: BlobClient): CacheAdapter {
  return {
    async getTrailer(jobId: string): Promise<Trailer | null> {
      const key = `trailers/${jobId}.json`
      const raw = await client.getJson(key)
      if (raw === null) return null
      // Lanza ZodError si el JSON almacenado no cumple el schema
      return TrailerSchema.parse(raw)
    },

    async setTrailer(jobId: string, trailer: Trailer): Promise<void> {
      const key = `trailers/${jobId}.json`
      await client.putJson(key, trailer)
    },
  }
}

// ─── Exportación de conveniencia (instancia con cliente real) ──────────────────

/**
 * Instancia lista para usar en producción.
 * En tests, usa `createCacheAdapter(createInMemoryBlobClient())`.
 */
export const cacheAdapter: CacheAdapter = createCacheAdapter(createVercelBlobClient())
