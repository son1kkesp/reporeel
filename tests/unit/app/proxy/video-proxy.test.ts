/**
 * tests/unit/app/proxy/video-proxy.test.ts
 *
 * Tests unitarios para las rutas proxy /v y /p.
 *
 * Estrategia:
 *   - Se mockea `@/app/lib/server-trailer` para aislar completamente la lógica
 *     de las rutas (sin red, sin Blob).
 *   - Se mockea el `fetch` global para simular las respuestas del Blob upstream.
 *   - Se construye `NextRequest` con la Web API y se llama directamente al
 *     handler importado (patrón canónico de Next.js App Router).
 *
 * Cobertura:
 *   (1) /v → 404 si no hay tráiler de hoy
 *   (2) /v → 200 + video/mp4 + Cache-Control si existe el tráiler
 *   (3) /v → propaga 206 + Content-Range cuando el cliente envía Range
 *   (4) /v → 400 si owner/repo tiene caracteres inválidos
 *   (5) /v → 403 si mp4Url apunta a un host no permitido (anti-SSRF)
 *   (6) /p → 404 si no hay tráiler de hoy
 *   (7) /p → 200 + image/jpeg + Cache-Control si existe el tráiler
 *   (8) /p → 400 si owner/repo tiene caracteres inválidos
 *   (9) /p → 403 si poster apunta a un host no permitido (anti-SSRF)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Constantes de fixtures ────────────────────────────────────────────────────

const OWNER = 'facebook'
const REPO = 'react'
const BLOB_MP4 = 'https://abc123.public.blob.vercel-storage.com/trailers/facebook/react/2026-06-10.mp4'
const BLOB_POSTER = 'https://abc123.public.blob.vercel-storage.com/trailers/facebook/react/2026-06-10.jpg'
const CACHE_CONTROL_EXPECTED = 'public, max-age=31536000, s-maxage=31536000, immutable'

// ─── Mock de server-trailer ────────────────────────────────────────────────────

vi.mock('@/app/lib/server-trailer', () => ({
  getTrailerForToday: vi.fn(),
}))

// ─── Helper: construir NextRequest ─────────────────────────────────────────────

function makeRequest(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    headers,
  })
}

// ─── Helper: params promise ────────────────────────────────────────────────────

function makeParams(owner: string, repo: string) {
  return { params: Promise.resolve({ owner, repo }) }
}

// ─── Tests: /v (video proxy) ──────────────────────────────────────────────────

describe('GET /v/[owner]/[repo] — proxy de vídeo', () => {
  // Importamos dinámicamente para que el mock esté activo
  let GET: typeof import('@/app/v/[owner]/[repo]/route').GET
  let getTrailerForToday: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetAllMocks()
    const trailerModule = await import('@/app/lib/server-trailer')
    getTrailerForToday = trailerModule.getTrailerForToday as ReturnType<typeof vi.fn>

    const routeModule = await import('@/app/v/[owner]/[repo]/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('(1) 404 si no hay tráiler de hoy', async () => {
    getTrailerForToday.mockResolvedValue(null)

    const req = makeRequest(`/v/${OWNER}/${REPO}`)
    const res = await GET(req, makeParams(OWNER, REPO))

    expect(res.status).toBe(404)
  })

  it('(2) 200 + video/mp4 + Cache-Control si existe el tráiler', async () => {
    getTrailerForToday.mockResolvedValue({ mp4Url: BLOB_MP4, poster: BLOB_POSTER })

    const mockBody = new ReadableStream()
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(mockBody, {
        status: 200,
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': '12345' },
      }),
    )

    const req = makeRequest(`/v/${OWNER}/${REPO}`)
    const res = await GET(req, makeParams(OWNER, REPO))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(res.headers.get('Cache-Control')).toBe(CACHE_CONTROL_EXPECTED)
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Length')).toBe('12345')

    // Debe haber hecho fetch al blob URL exacto
    expect(mockFetch).toHaveBeenCalledWith(BLOB_MP4, expect.any(Object))
  })

  it('(3) propaga 206 + Content-Range cuando el cliente envía Range', async () => {
    getTrailerForToday.mockResolvedValue({ mp4Url: BLOB_MP4, poster: BLOB_POSTER })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new ReadableStream(), {
        status: 206,
        headers: {
          'Content-Range': 'bytes 0-1023/12345',
          'Content-Length': '1024',
        },
      }),
    )

    const req = makeRequest(`/v/${OWNER}/${REPO}`, { range: 'bytes=0-1023' })
    const res = await GET(req, makeParams(OWNER, REPO))

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 0-1023/12345')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
  })

  it('(3) pasa el header Range al fetch del Blob', async () => {
    getTrailerForToday.mockResolvedValue({ mp4Url: BLOB_MP4, poster: BLOB_POSTER })

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new ReadableStream(), { status: 206 }),
    )

    const req = makeRequest(`/v/${OWNER}/${REPO}`, { range: 'bytes=500-999' })
    await GET(req, makeParams(OWNER, REPO))

    expect(mockFetch).toHaveBeenCalledWith(
      BLOB_MP4,
      expect.objectContaining({ headers: expect.objectContaining({ range: 'bytes=500-999' }) }),
    )
  })

  it('(4) 400 si owner contiene caracteres inválidos (barra)', async () => {
    const req = makeRequest('/v/owner%2Fevil/repo')
    // Simulamos que Next.js decodifica el param (improbable, pero hay que testar la ruta)
    const res = await GET(req, makeParams('owner/evil', REPO))

    expect(res.status).toBe(400)
  })

  it('(4) 400 si repo contiene caracteres inválidos (espacio)', async () => {
    const req = makeRequest('/v/owner/re%20po')
    const res = await GET(req, makeParams(OWNER, 're po'))

    expect(res.status).toBe(400)
  })

  it('(5) 403 si mp4Url apunta a un host no permitido (anti-SSRF)', async () => {
    getTrailerForToday.mockResolvedValue({
      mp4Url: 'https://evil.example.com/steal.mp4',
      poster: BLOB_POSTER,
    })

    const req = makeRequest(`/v/${OWNER}/${REPO}`)
    const res = await GET(req, makeParams(OWNER, REPO))

    expect(res.status).toBe(403)
  })
})

// ─── Tests: /p (poster proxy) ─────────────────────────────────────────────────

describe('GET /p/[owner]/[repo] — proxy de póster', () => {
  let GET: typeof import('@/app/p/[owner]/[repo]/route').GET
  let getTrailerForToday: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetAllMocks()
    const trailerModule = await import('@/app/lib/server-trailer')
    getTrailerForToday = trailerModule.getTrailerForToday as ReturnType<typeof vi.fn>

    const routeModule = await import('@/app/p/[owner]/[repo]/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('(6) 404 si no hay tráiler de hoy', async () => {
    getTrailerForToday.mockResolvedValue(null)

    const req = makeRequest(`/p/${OWNER}/${REPO}`)
    const res = await GET(req, makeParams(OWNER, REPO))

    expect(res.status).toBe(404)
  })

  it('(7) 200 + image/jpeg + Cache-Control si existe el tráiler', async () => {
    getTrailerForToday.mockResolvedValue({ mp4Url: BLOB_MP4, poster: BLOB_POSTER })

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new ReadableStream(), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '55000' },
      }),
    )

    const req = makeRequest(`/p/${OWNER}/${REPO}`)
    const res = await GET(req, makeParams(OWNER, REPO))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(res.headers.get('Cache-Control')).toBe(CACHE_CONTROL_EXPECTED)
    expect(res.headers.get('Content-Length')).toBe('55000')

    expect(mockFetch).toHaveBeenCalledWith(BLOB_POSTER)
  })

  it('(8) 400 si owner contiene caracteres inválidos (barra)', async () => {
    const req = makeRequest('/p/owner%2Fevil/repo')
    const res = await GET(req, makeParams('owner/evil', REPO))

    expect(res.status).toBe(400)
  })

  it('(9) 403 si poster apunta a un host no permitido (anti-SSRF)', async () => {
    getTrailerForToday.mockResolvedValue({
      mp4Url: BLOB_MP4,
      poster: 'https://evil.example.com/steal.jpg',
    })

    const req = makeRequest(`/p/${OWNER}/${REPO}`)
    const res = await GET(req, makeParams(OWNER, REPO))

    expect(res.status).toBe(403)
  })
})
