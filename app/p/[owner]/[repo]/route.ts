/**
 * app/p/[owner]/[repo]/route.ts
 *
 * Proxy de póster JPEG: sirve la imagen de preview del tráiler a través del
 * dominio de la app.
 *
 * Por qué: mismo motivo que /v — las redes corporativas filtran el host de Blob
 * pero permiten el dominio propio.
 *
 * Seguridad:
 *   - Valida owner/repo con regex simple (evita path-traversal).
 *   - Solo proxea URLs cuyo host termina en .blob.vercel-storage.com (evita SSRF/open-proxy).
 *
 * Range: no es crítico para imágenes JPEG estáticas; no se implementa.
 *
 * Caché edge:
 *   - Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable
 *   - Vercel CDN cachea la respuesta → la Function solo se invoca una vez por
 *     combinación owner/repo/día.
 */

import type { NextRequest } from 'next/server'
import { getTrailerForToday } from '@/app/lib/server-trailer'

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Regex de validación de owner/repo. */
const SLUG_RE = /^[A-Za-z0-9._-]+$/

/** Host permitido para proxear (evita SSRF/open-proxy). */
const ALLOWED_BLOB_HOST_SUFFIX = '.blob.vercel-storage.com'

/** Cache-Control de larga duración para el edge de Vercel. */
const CACHE_CONTROL = 'public, max-age=31536000, s-maxage=31536000, immutable'

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params

  // 1. Validar owner/repo
  if (!SLUG_RE.test(owner) || !SLUG_RE.test(repo)) {
    return new Response('Bad Request', { status: 400 })
  }

  // 2. Resolver el tráiler de hoy desde la caché
  const trailer = await getTrailerForToday(owner, repo)
  if (!trailer) {
    return new Response('Not Found', { status: 404 })
  }

  const { poster } = trailer

  // 3. Validar que el host de destino sea Vercel Blob (anti-SSRF)
  let targetUrl: URL
  try {
    targetUrl = new URL(poster)
  } catch {
    return new Response('Bad Gateway', { status: 502 })
  }
  if (!targetUrl.hostname.endsWith(ALLOWED_BLOB_HOST_SUFFIX)) {
    return new Response('Forbidden', { status: 403 })
  }

  // 4. Fetch desde el servidor (la Function SÍ alcanza *.blob.vercel-storage.com)
  let blobResponse: Response
  try {
    blobResponse = await fetch(poster)
  } catch {
    return new Response('Bad Gateway', { status: 502 })
  }

  // 5. Propagar error del Blob upstream
  if (!blobResponse.ok) {
    return new Response('Bad Gateway', { status: 502 })
  }

  // 6. Construir headers de respuesta
  const responseHeaders = new Headers()
  responseHeaders.set('Content-Type', 'image/jpeg')
  responseHeaders.set('Cache-Control', CACHE_CONTROL)

  // Propagar Content-Length si lo da el Blob
  const contentLength = blobResponse.headers.get('content-length')
  if (contentLength) {
    responseHeaders.set('Content-Length', contentLength)
  }

  // 7. Stream de vuelta al cliente
  return new Response(blobResponse.body, {
    status: 200,
    headers: responseHeaders,
  })
}
