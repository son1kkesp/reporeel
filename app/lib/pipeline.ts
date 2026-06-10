/**
 * app/lib/pipeline.ts
 *
 * Orquestación del pipeline completo: GitHub → Storyboard → Copy → Vars → Render → Cache → Job.
 *
 * Todos los adapters se inyectan como parámetros → testeable sin red ni IA real.
 *
 * Contrato de runPipeline:
 *   1. github.fetchRepoData(owner, repo)         → RepoData
 *   2. core.buildStoryboard(repoData)             → Beat[]
 *   3. script.generateCopy(storyboard, repoData)  → Copy (ya trae fallback interno)
 *   4. compose.composeVars(storyboard, copy)       → TrailerVars
 *   5. render.renderTrailer(jobId, vars)            → { mp4Url, poster }
 *   6. cache.setTrailer(jobId, { mp4Url, poster })  → void
 *   7. job.set(jobId, { status:'ready', url, poster, updatedAt }) → void
 *
 * En cualquier error de los pasos 1-7:
 *   - job.set(jobId, { status:'error', error: message, updatedAt }) → void
 *
 * Adapters inyectados:
 *   - github  : { fetchRepoData(owner, repo): Promise<RepoData> }
 *   - script  : { generateCopy(storyboard, repo): Promise<Copy> }
 *   - cache   : CacheAdapter
 *   - job     : JobAdapter
 *   - render  : RenderAdapter
 *
 * Las funciones puras (buildStoryboard, composeVars) NO se inyectan porque
 * son deterministas y no tienen dependencias externas.
 */

import { buildStoryboard } from '@/core/storyboard'
import { composeVars } from '@/adapters/compose'
import type { RepoData } from '@/core/repo-data'
import type { Copy } from '@/core/copy'
import type { Beat } from '@/core/storyboard'
import type { CacheAdapter } from '@/adapters/cache'
import type { JobAdapter } from '@/adapters/job'
import type { RenderAdapter } from '@/adapters/render'

// ─── Interfaces de adapters inyectados ─────────────────────────────────────────

export interface GithubAdapter {
  fetchRepoData(owner: string, repo: string): Promise<RepoData>
}

export interface ScriptAdapter {
  generateCopy(storyboard: Beat[], repo: RepoData): Promise<Copy>
}

export interface PipelineAdapters {
  github: GithubAdapter
  script: ScriptAdapter
  cache: CacheAdapter
  job: JobAdapter
  render: RenderAdapter
}

// ─── Pipeline principal ────────────────────────────────────────────────────────

/**
 * Ejecuta el pipeline completo de generación de tráiler.
 *
 * Precondición: el job ya está en estado 'rendering' cuando se llama.
 * Al terminar (éxito o error) actualiza el job con el estado final.
 *
 * @param jobId    - Identificador del job (owner/repo/YYYY-MM-DD).
 * @param owner    - Propietario del repositorio.
 * @param repo     - Nombre del repositorio.
 * @param adapters - Adapters inyectados (todos reemplazables en tests).
 */
export async function runPipeline(
  jobId: string,
  owner: string,
  repo: string,
  adapters: PipelineAdapters,
): Promise<void> {
  const now = () => new Date().toISOString()

  try {
    // 1. Datos del repo (puede lanzar RepoNotFoundError, RateLimitedError)
    const repoData = await adapters.github.fetchRepoData(owner, repo)

    // 2. Storyboard (puro, nunca lanza)
    const storyboard = buildStoryboard(repoData)

    // 3. Copy con IA (ya tiene fallback interno, prácticamente nunca lanza)
    const copy = await adapters.script.generateCopy(storyboard, repoData)

    // 4. Variables de composición (puro, nunca lanza)
    const vars = composeVars(storyboard, copy)

    // 5. Render del tráiler
    // TrailerVars tiene todas sus propiedades string pero carece de index signature.
    // El cast double (via unknown) es seguro: todos los valores son string.
    const { mp4Url, poster } = await adapters.render.renderTrailer(
      jobId,
      vars as unknown as Record<string, string | number>,
    )

    // 6. Cachear el tráiler para futuros requests del mismo jobId
    await adapters.cache.setTrailer(jobId, { mp4Url, poster })

    // 7. Marcar job como ready
    await adapters.job.set(jobId, {
      status: 'ready',
      url: mp4Url,
      poster,
      updatedAt: now(),
    })
  } catch (err: unknown) {
    // Cualquier error en el pipeline → marcar job como error
    const message = err instanceof Error ? err.message : String(err)
    try {
      await adapters.job.set(jobId, {
        status: 'error',
        error: message,
        updatedAt: now(),
      })
    } catch {
      // Si no podemos persistir el error, no hay mucho más que hacer.
      // El job quedará en 'rendering' y expirará.
    }
  }
}
