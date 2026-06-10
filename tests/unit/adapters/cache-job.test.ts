/**
 * tests/unit/adapters/cache-job.test.ts
 *
 * Tests TDD para CacheAdapter y JobAdapter.
 * El cliente Blob se inyecta como fake en memoria → sin red ni token real.
 *
 * Cobertura:
 *   - set → get roundtrip para Job
 *   - set → get roundtrip para Trailer (cache)
 *   - get de clave inexistente → null
 *   - makeJobId genera el id correcto
 *   - Zod rechaza un Job con status inválido
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { makeJobId } from '@/adapters/job'
import { createJobAdapter } from '@/adapters/job'
import { createCacheAdapter } from '@/adapters/cache'
import type { Job } from '@/adapters/job'
import type { Trailer } from '@/adapters/cache'
import { createInMemoryBlobClient } from '@/adapters/blob-client'

// ─── makeJobId ─────────────────────────────────────────────────────────────────

describe('makeJobId', () => {
  it('genera el id correcto con owner/repo/fecha', () => {
    expect(makeJobId('vercel', 'next.js', '2025-06-10')).toBe('vercel/next.js/2025-06-10')
  })

  it('el separador es siempre /', () => {
    const id = makeJobId('foo', 'bar', '2024-01-01')
    expect(id.split('/')).toHaveLength(3)
  })
})

// ─── Helpers de fixture ────────────────────────────────────────────────────────

function validJob(): Job {
  return {
    status: 'rendering',
    updatedAt: '2025-06-10T12:00:00.000Z',
  }
}

function readyJob(): Job {
  return {
    status: 'ready',
    url: 'https://blob.vercel.com/trailers/foo.mp4',
    poster: 'https://blob.vercel.com/posters/foo.jpg',
    updatedAt: '2025-06-10T12:05:00.000Z',
  }
}

function validTrailer(): Trailer {
  return {
    mp4Url: 'https://blob.vercel.com/trailers/react.mp4',
    poster: 'https://blob.vercel.com/posters/react.jpg',
  }
}

// ─── JobAdapter ────────────────────────────────────────────────────────────────

describe('JobAdapter', () => {
  let jobAdapter: ReturnType<typeof createJobAdapter>
  const JOB_ID = 'facebook/react/2025-06-10'

  beforeEach(() => {
    // Cliente fake en memoria, vacío antes de cada test
    jobAdapter = createJobAdapter(createInMemoryBlobClient())
  })

  it('get de clave inexistente devuelve null', async () => {
    const result = await jobAdapter.get(JOB_ID)
    expect(result).toBeNull()
  })

  it('set + get roundtrip — job rendering', async () => {
    const job = validJob()
    await jobAdapter.set(JOB_ID, job)
    const result = await jobAdapter.get(JOB_ID)
    expect(result).toEqual(job)
  })

  it('set + get roundtrip — job ready con url y poster', async () => {
    const job = readyJob()
    await jobAdapter.set(JOB_ID, job)
    const result = await jobAdapter.get(JOB_ID)
    expect(result).toEqual(job)
  })

  it('set sobreescribe el valor anterior', async () => {
    await jobAdapter.set(JOB_ID, validJob())
    const updated = readyJob()
    await jobAdapter.set(JOB_ID, updated)
    const result = await jobAdapter.get(JOB_ID)
    expect(result?.status).toBe('ready')
    expect(result?.url).toBe(updated.url)
  })

  it('keys distintas son independientes', async () => {
    const idA = 'owner/repoA/2025-06-10'
    const idB = 'owner/repoB/2025-06-10'
    await jobAdapter.set(idA, validJob())
    const resultB = await jobAdapter.get(idB)
    expect(resultB).toBeNull()
  })

  it('Zod rechaza un job con status inválido (lanza ZodError)', async () => {
    const fakeClient = createInMemoryBlobClient()
    // Escribimos a mano un JSON inválido para simular corrupción
    await fakeClient.putJson('jobs/bad/key.json', { status: 'INVALID_STATUS', updatedAt: '2025-06-10T00:00:00.000Z' })
    const adapter = createJobAdapter(fakeClient)
    await expect(adapter.get('bad/key')).rejects.toThrow()
  })
})

// ─── CacheAdapter ──────────────────────────────────────────────────────────────

describe('CacheAdapter', () => {
  let cacheAdapter: ReturnType<typeof createCacheAdapter>
  const TRAILER_ID = 'facebook/react/2025-06-10'

  beforeEach(() => {
    cacheAdapter = createCacheAdapter(createInMemoryBlobClient())
  })

  it('getTrailer de clave inexistente devuelve null', async () => {
    const result = await cacheAdapter.getTrailer(TRAILER_ID)
    expect(result).toBeNull()
  })

  it('setTrailer + getTrailer roundtrip', async () => {
    const trailer = validTrailer()
    await cacheAdapter.setTrailer(TRAILER_ID, trailer)
    const result = await cacheAdapter.getTrailer(TRAILER_ID)
    expect(result).toEqual(trailer)
  })

  it('setTrailer sobreescribe el valor anterior', async () => {
    await cacheAdapter.setTrailer(TRAILER_ID, validTrailer())
    const updated: Trailer = {
      mp4Url: 'https://blob.vercel.com/trailers/react-v2.mp4',
      poster: 'https://blob.vercel.com/posters/react-v2.jpg',
    }
    await cacheAdapter.setTrailer(TRAILER_ID, updated)
    const result = await cacheAdapter.getTrailer(TRAILER_ID)
    expect(result?.mp4Url).toBe(updated.mp4Url)
  })

  it('keys distintas son independientes', async () => {
    const idA = 'owner/repoA/2025-06-10'
    const idB = 'owner/repoB/2025-06-10'
    await cacheAdapter.setTrailer(idA, validTrailer())
    const resultB = await cacheAdapter.getTrailer(idB)
    expect(resultB).toBeNull()
  })

  it('Zod rechaza un trailer con mp4Url ausente (lanza ZodError)', async () => {
    const fakeClient = createInMemoryBlobClient()
    // JSON corrupto: falta mp4Url
    await fakeClient.putJson('trailers/bad/key.json', { poster: 'https://example.com/p.jpg' })
    const adapter = createCacheAdapter(fakeClient)
    await expect(adapter.getTrailer('bad/key')).rejects.toThrow()
  })
})
