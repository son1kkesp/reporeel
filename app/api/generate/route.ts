/**
 * app/api/generate/route.ts
 *
 * POST /api/generate
 *
 * Body: { owner: string, repo: string }
 *
 * Respuestas:
 *   200 { status: 'ready', url, poster }           — cache hit
 *   202 { jobId, status: 'rendering' }             — pipeline disparado
 *   400 { error }                                   — validación fallida
 *   429 { error }                                   — rate-limit
 *   503 { error }                                   — sin slot de render
 *
 * Flujo async:
 *   - Devuelve 202 inmediatamente con { jobId, status:'rendering' }.
 *   - El pipeline se dispara con `after()` de Next 16: registra trabajo
 *     post-respuesta y, en Vercel, extiende la vida de la invocación vía
 *     `waitUntil` hasta que la promesa resuelve (o se alcanza maxDuration).
 *     Esto sustituye al antiguo `void runPipeline(...)`, que podía cortarse
 *     tras el 202 y dejar el job colgado en 'rendering'.
 *   - El cliente usa GET /api/status?jobId=… para sondear el resultado.
 *
 * En producción el render real tardará ~90 s. maxDuration = 300 s da margen
 * para GitHub + Copy + render. Si algún día el render superase 300 s, el
 * sandbox puede seguir vivo (hasta 5 h) pero la invocación expiraría; ese
 * escenario requeriría una arquitectura de webhook/callback.
 */

import { type NextRequest, after } from 'next/server'
import { z } from 'zod'
import {
  checkRateLimit,
  acquireRenderSlot,
  releaseRenderSlot,
} from '@/app/lib/limits'
import { runPipeline } from '@/app/lib/pipeline'
import { makeJobId } from '@/adapters/job'
import { createJobAdapter } from '@/adapters/job'
import { createCacheAdapter } from '@/adapters/cache'
import { createVercelBlobClient } from '@/adapters/blob-client'
import { fetchRepoData } from '@/adapters/github'
import { generateCopy } from '@/adapters/script'
import { createSandboxRenderAdapter } from '@/adapters/render.sandbox'
import type { PipelineAdapters } from '@/app/lib/pipeline'

// ─── Configuración de route segment ──────────────────────────────────────────

/**
 * 300 s da margen para el render real (~90 s) más los pasos de GitHub y Copy.
 * Declarado a nivel de módulo (export const) según la API de Next.js.
 */
export const maxDuration = 300

// ─── Schema de validación del body ───────────────────────────────────────────

const GenerateBodySchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extrae la IP del cliente del NextRequest.
 * Prioriza el header x-forwarded-for (proxies/CDN), luego x-real-ip.
 * Fallback: 'unknown'.
 */
function extractIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // x-forwarded-for puede contener múltiples IPs separadas por coma; la primera es la del cliente
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/**
 * Construye la fecha de hoy en formato YYYY-MM-DD (UTC).
 * Se pasa como argumento a makeJobId para garantizar determinismo.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Crea los adapters de producción.
 * En tests se inyectan mocks pasando adapters directamente a runPipeline.
 */
function buildProductionAdapters(): PipelineAdapters {
  const blobClient = createVercelBlobClient()
  return {
    github: { fetchRepoData },
    script: { generateCopy },
    cache: createCacheAdapter(blobClient),
    job: createJobAdapter(blobClient),
    // Render REAL: corre HyperFrames en Vercel Sandbox y sube a Blob.
    // Requiere Vercel Pro + OIDC/token de Sandbox (ver REQUISITOS DE DEPLOY).
    // En tests se inyecta el mock pasando adapters directamente a runPipeline.
    render: createSandboxRenderAdapter(),
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Validar body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body JSON inválido' }, { status: 400 })
  }

  const parsed = GenerateBodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'owner y repo son obligatorios (string, max 100 caracteres)' },
      { status: 400 },
    )
  }

  const { owner, repo } = parsed.data

  // 2. Rate-limit por IP
  const ip = extractIp(request)
  if (!checkRateLimit(ip)) {
    return Response.json(
      { error: 'Rate limit alcanzado. Máximo 3 requests por 10 minutos.' },
      { status: 429 },
    )
  }

  // 3. Construir jobId
  const jobId = makeJobId(owner, repo, todayUtc())

  // 4. Cache hit → devolver inmediatamente
  const adapters = buildProductionAdapters()
  const cached = await adapters.cache.getTrailer(jobId)
  if (cached) {
    return Response.json({ status: 'ready', url: cached.mp4Url, poster: cached.poster })
  }

  // 5. Adquirir slot de render
  if (!acquireRenderSlot()) {
    return Response.json(
      { error: 'Todos los slots de render están ocupados. Inténtalo de nuevo en unos segundos.' },
      { status: 503 },
    )
  }

  // 6. Marcar job como rendering
  await adapters.job.set(jobId, {
    status: 'rendering',
    updatedAt: new Date().toISOString(),
  })

  // 7. Disparar pipeline DESPUÉS de enviar la respuesta con `after()` (Next 16).
  //    `after()` registra trabajo post-respuesta y, en Vercel, extiende la vida
  //    de la invocación vía `waitUntil` hasta que la promesa resuelve (o se
  //    alcanza maxDuration=300s). Esto corrige el bug del `void runPipeline(...)`:
  //    sin `after()`, la plataforma podía cortar la invocación tras el 202 y
  //    dejar el job en 'rendering' para siempre. `after()` también se ejecuta
  //    aunque la respuesta falle, así que el render arranca de forma fiable.
  after(() =>
    runPipeline(jobId, owner, repo, adapters).finally(() => {
      releaseRenderSlot()
    }),
  )

  // 8. Responder inmediatamente con 202
  return Response.json({ jobId, status: 'rendering' }, { status: 202 })
}
