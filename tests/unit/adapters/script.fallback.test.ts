/**
 * tests/unit/adapters/script.fallback.test.ts
 *
 * Task 4.2 — Verifica el comportamiento de fallback de generateCopy (real).
 *
 * La IA se mockea con vi.stubGlobal('fetch', ...) para simular:
 *   - Error de red / excepción
 *   - Timeout (AbortError)
 *   - Respuesta que no valida contra CopySchema
 *   - Respuesta HTTP 500
 *   - JSON inválido (no parseable)
 *
 * En todos los casos, generateCopy debe devolver buildFallbackCopy(storyboard, repoName),
 * que es siempre un Copy determinista válido.
 *
 * La llamada a la IA real NO se testea aquí (no determinista, cuesta dinero).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateCopy } from '@/adapters/script'
import { buildFallbackCopy } from '@/core/copy'
import { buildStoryboard } from '@/core/storyboard'
import type { RepoData } from '@/core/repo-data'

// ─── Fixture: repo react (misma que en compose.test.ts) ─────────────────────

const reactRepo: RepoData = {
  owner: 'facebook',
  name: 'react',
  description: 'The library for web and native user interfaces.',
  latestRelease: 'v19.1.0',
  stars: 228_000,
  forks: 46_700,
  contributorsCount: 1523,
  languages: { JavaScript: 68.2, TypeScript: 31.1, HTML: 0.5, CSS: 0.2 },
  topics: ['javascript', 'library', 'react', 'ui', 'declarative'],
  createdAt: '2013-05-24T16:15:54Z',
  pushedAt: '2025-06-09T17:45:00Z',
  topContributors: ['sophiebits', 'sebmarkbage', 'gaearon'],
  commitActivityLast12w: [12, 18, 9, 22, 15, 7, 31, 14, 19, 28, 11, 16],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Construye el Copy de fallback esperado para el fixture react */
function expectedFallback() {
  const storyboard = buildStoryboard(reactRepo)
  return buildFallbackCopy(storyboard, reactRepo.name)
}

/** Stub de fetch que lanza un error de red */
function stubFetchNetworkError() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
}

/** Stub de fetch que simula AbortError (timeout) */
function stubFetchAbort() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
  )
}

/** Stub de fetch que devuelve HTTP 500 */
function stubFetch500() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'server error' }),
    }),
  )
}

/** Stub de fetch que devuelve JSON válido pero content vacío */
function stubFetchEmptyContent() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    }),
  )
}

/** Stub de fetch que devuelve JSON no parseable como objeto */
function stubFetchBadJson() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'esto no es json {}{}' } }] }),
    }),
  )
}

/** Stub de fetch que devuelve un Copy con schema inválido (lines no es array) */
function stubFetchInvalidSchema() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                tagline: 'El mejor repo del mundo',
                lines: 'esto debería ser un array, no un string',
              }),
            },
          },
        ],
      }),
    }),
  )
}

/** Stub de fetch que devuelve un Copy con tagline vacío (falla validación min(1)) */
function stubFetchEmptyTagline() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                tagline: '',
                lines: ['línea válida'],
              }),
            },
          },
        ],
      }),
    }),
  )
}

// ─── Setup/Teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  // Asegurar que hay una API key no vacía para que generateCopy intente la IA
  // (si no hay key, cae en fallback inmediato sin llamar a fetch)
  vi.stubEnv('OPENROUTER_API_KEY', 'sk-test-fake-key-for-testing')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateCopy — fallback al core determinista', () => {
  it('cae en fallback cuando fetch lanza un error de red', async () => {
    stubFetchNetworkError()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(copy).toEqual(expectedFallback())
  })

  it('cae en fallback cuando fetch es abortado (timeout)', async () => {
    stubFetchAbort()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(copy).toEqual(expectedFallback())
  })

  it('cae en fallback cuando la API devuelve HTTP 500', async () => {
    stubFetch500()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(copy).toEqual(expectedFallback())
  })

  it('cae en fallback cuando content está vacío (respuesta degenerada)', async () => {
    stubFetchEmptyContent()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(copy).toEqual(expectedFallback())
  })

  it('cae en fallback cuando el content no es JSON parseable', async () => {
    stubFetchBadJson()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(copy).toEqual(expectedFallback())
  })

  it('cae en fallback cuando el JSON no cumple el schema (lines no es array)', async () => {
    stubFetchInvalidSchema()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(copy).toEqual(expectedFallback())
  })

  it('cae en fallback cuando el tagline es cadena vacía (violación min(1))', async () => {
    stubFetchEmptyTagline()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(copy).toEqual(expectedFallback())
  })

  it('cae en fallback inmediato cuando no hay OPENROUTER_API_KEY', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    // fetch NO debería llamarse: fallback antes de la petición
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(copy).toEqual(expectedFallback())
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('el Copy del fallback siempre tiene tagline string no vacío', async () => {
    stubFetchNetworkError()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(typeof copy.tagline).toBe('string')
    expect(copy.tagline.length).toBeGreaterThan(0)
  })

  it('el Copy del fallback siempre tiene lines array no vacío de strings', async () => {
    stubFetchNetworkError()
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)
    expect(Array.isArray(copy.lines)).toBe(true)
    expect(copy.lines.length).toBeGreaterThan(0)
    for (const line of copy.lines) {
      expect(typeof line).toBe('string')
      expect(line.length).toBeGreaterThan(0)
    }
  })
})
