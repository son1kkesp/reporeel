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
 *   - La route ESPERA el pipeline (await runPipeline(…)).
 *   - maxDuration = 300 s → Next.js mantiene la serverless function viva hasta
 *     que el pipeline termina (~90 s con render real, <1 s con mock).
 *   - Devuelve 202 inmediatamente con { jobId, status:'rendering' } y dispara
 *     runPipeline en segundo plano (fire-and-forget via void).
 *   - El cliente usa GET /api/status?jobId=… para sondear el resultado.
 *
 * En producción el render real tardará ~90 s. maxDuration = 300 s da margen.
 * Si el render real supera 300 s el sandbox puede seguir ejecutándose (Vercel
 * Sandbox tiene hasta 5 h), pero la function serverless expiraría. Para ese
 * escenario se necesitaría una arquitectura de webhook/callback. Por ahora
 * el mock resuelve en <1 ms, así que 300 s es más que suficiente.
 */

import { type NextRequest } from 'next/server'
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
import { createMockRenderAdapter } from '@/adapters/render.mock'
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
    render: createMockRenderAdapter(), // TODO: reemplazar por render real cuando Vercel Pro activo
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

  // 7. Disparar pipeline en background (fire-and-forget)
  //    La function serverless se mantiene viva porque esperamos esta promesa
  //    antes de que Next.js cierre la respuesta. Con maxDuration=300s tenemos
  //    margen para el render real.
  void runPipeline(jobId, owner, repo, adapters).finally(() => {
    releaseRenderSlot()
  })

  // 8. Responder inmediatamente con 202
  return Response.json({ jobId, status: 'rendering' }, { status: 202 })
}
