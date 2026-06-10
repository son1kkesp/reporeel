/**
 * app/v/[owner]/[repo]/route.ts
 *
 * Proxy de vídeo MP4: sirve el tráiler de hoy a través del dominio de la app.
 *
 * Por qué: las redes corporativas/restrictivas filtran *.public.blob.vercel-storage.com
 * pero permiten *.vercel.app. Al proxear desde nuestro propio dominio, el vídeo
 * carga dondequiera que cargue la web.
 *
 * Seguridad:
 *   - Valida owner/repo con regex simple (evita path-traversal).
 *   - Solo proxea URLs cuyo host termina en .blob.vercel-storage.com (evita SSRF/open-proxy).
 *
 * Range:
 *   - Reenvía el header Range entrante al fetch del Blob.
 *   - Propaga 206 Partial Content + Content-Range/Accept-Ranges/Content-Length.
 *   - Necesario para <video> seekable y players de redes.
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
  request: NextRequest,
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

  const { mp4Url } = trailer

  // 3. Validar que el host de destino sea Vercel Blob (anti-SSRF)
  let targetUrl: URL
  try {
    targetUrl = new URL(mp4Url)
  } catch {
    return new Response('Bad Gateway', { status: 502 })
  }
  if (!targetUrl.hostname.endsWith(ALLOWED_BLOB_HOST_SUFFIX)) {
    return new Response('Forbidden', { status: 403 })
  }

  // 4. Construir headers del fetch hacia Blob
  //    Reenviamos Range si el cliente lo incluye (Range requests necesarios para <video>)
  const fetchHeaders: HeadersInit = {}
  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    fetchHeaders['range'] = rangeHeader
  }

  // 5. Fetch desde el servidor (la Function SÍ alcanza *.blob.vercel-storage.com)
  let blobResponse: Response
  try {
    blobResponse = await fetch(mp4Url, { headers: fetchHeaders })
  } catch {
    return new Response('Bad Gateway', { status: 502 })
  }

  // 6. Propagar error del Blob upstream
  if (!blobResponse.ok && blobResponse.status !== 206) {
    return new Response('Bad Gateway', { status: 502 })
  }

  // 7. Construir headers de respuesta
  const responseHeaders = new Headers()
  responseHeaders.set('Content-Type', 'video/mp4')
  responseHeaders.set('Cache-Control', CACHE_CONTROL)
  responseHeaders.set('Accept-Ranges', 'bytes')

  // Propagar Content-Length si lo da el Blob (necesario para el player)
  const contentLength = blobResponse.headers.get('content-length')
  if (contentLength) {
    responseHeaders.set('Content-Length', contentLength)
  }

  // Propagar Content-Range cuando es respuesta parcial (206)
  const contentRange = blobResponse.headers.get('content-range')
  if (contentRange) {
    responseHeaders.set('Content-Range', contentRange)
  }

  // 8. Stream de vuelta al cliente (sin bufferizar el MP4 completo en memoria)
  return new Response(blobResponse.body, {
    status: blobResponse.status,
    headers: responseHeaders,
  })
}
