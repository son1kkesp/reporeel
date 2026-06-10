/**
 * app/lib/server-trailer.ts
 *
 * Helpers de servidor para leer un tráiler ya cacheado, usados por la página
 * pública `/r/[owner]/[repo]` (Server Component + generateMetadata).
 *
 * El jobId canónico es `${owner}/${repo}/${YYYY-MM-DD}` (UTC). Como la caché
 * se siembra por día, la página intenta el tráiler "de hoy". Si no existe,
 * la página ofrece generarlo.
 *
 * Nunca lanza: si la caché falla (sin token en local, red, JSON inválido…)
 * devuelve null y la UI degrada con elegancia.
 */

import { makeJobId } from '@/adapters/job'
import { createCacheAdapter, type Trailer } from '@/adapters/cache'
import { createVercelBlobClient } from '@/adapters/blob-client'

/** Fecha de hoy en formato YYYY-MM-DD (UTC). */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Recupera el tráiler cacheado para owner/repo del día de hoy (UTC).
 *
 * @returns El Trailer si existe, o `null` (no encontrado o error).
 */
export async function getTrailerForToday(
  owner: string,
  repo: string,
): Promise<Trailer | null> {
  try {
    const jobId = makeJobId(owner, repo, todayUtc())
    const cache = createCacheAdapter(createVercelBlobClient())
    return await cache.getTrailer(jobId)
  } catch {
    return null
  }
}
