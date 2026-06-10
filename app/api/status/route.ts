/**
 * app/api/status/route.ts
 *
 * GET /api/status?jobId=owner/repo/YYYY-MM-DD
 *
 * Respuestas:
 *   200 { status: 'rendering' | 'ready' | 'error', url?, poster?, error? }
 *   400 { error }  — jobId ausente
 *   404 { error }  — jobId no encontrado en Blob
 */

import { type NextRequest } from 'next/server'
import { createJobAdapter } from '@/adapters/job'
import { createVercelBlobClient } from '@/adapters/blob-client'

export async function GET(request: NextRequest): Promise<Response> {
  const jobId = request.nextUrl.searchParams.get('jobId')

  if (!jobId) {
    return Response.json({ error: 'jobId es obligatorio' }, { status: 400 })
  }

  const jobAdapter = createJobAdapter(createVercelBlobClient())
  const job = await jobAdapter.get(jobId)

  if (!job) {
    return Response.json({ error: `Job no encontrado: ${jobId}` }, { status: 404 })
  }

  return Response.json(job)
}
