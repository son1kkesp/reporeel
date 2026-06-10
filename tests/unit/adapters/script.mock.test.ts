/**
 * tests/unit/adapters/script.mock.test.ts
 *
 * Task 4.1 — Verifica que el mock de generateCopy devuelve un Copy válido.
 * Sin red, sin key de IA, sin coste.
 */

import { describe, it, expect } from 'vitest'
import { generateCopy, MOCK_COPY } from '@/adapters/script.mock'
import type { Copy } from '@/core/copy'
import type { Beat } from '@/core/storyboard'
import type { RepoData } from '@/core/repo-data'

// ─── Fixtures mínimos ─────────────────────────────────────────────────────────

const minimalStoryboard: Beat[] = [
  { tipo: 'hook', data: { heroKind: 'stars', heroValue: '10k', repoName: 'test', owner: 'acme' } },
  { tipo: 'identity', data: { topLanguage: 'TypeScript', topLanguagePct: 90 } },
  { tipo: 'momentum', data: { forks: 100, contributorsCount: 5, age: 'vivo desde 2022' } },
  { tipo: 'proof', data: { stars: 10000 } },
  { tipo: 'cta', data: { repoName: 'test', owner: 'acme', installCmd: 'npm install test' } },
]

const minimalRepo: RepoData = {
  owner: 'acme',
  name: 'test',
  description: 'A test repo',
  latestRelease: 'v1.0.0',
  stars: 10000,
  forks: 100,
  contributorsCount: 5,
  languages: { TypeScript: 90, JavaScript: 10 },
  topics: ['typescript'],
  createdAt: '2022-01-01T00:00:00Z',
  pushedAt: '2024-06-01T00:00:00Z',
  topContributors: ['alice'],
  commitActivityLast12w: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateCopy (mock)', () => {
  it('devuelve una promesa que resuelve a un Copy válido', async () => {
    const copy = await generateCopy(minimalStoryboard, minimalRepo)

    // Satisface el tipo Copy: tagline (string), lines (string[])
    expect(typeof copy.tagline).toBe('string')
    expect(copy.tagline.length).toBeGreaterThan(0)
    expect(Array.isArray(copy.lines)).toBe(true)
    expect(copy.lines.length).toBeGreaterThan(0)
    for (const line of copy.lines) {
      expect(typeof line).toBe('string')
      expect(line.length).toBeGreaterThan(0)
    }
  })

  it('installCmd, si está presente, es un string no vacío', async () => {
    const copy = await generateCopy(minimalStoryboard, minimalRepo)
    if (copy.installCmd !== undefined) {
      expect(typeof copy.installCmd).toBe('string')
      expect(copy.installCmd.length).toBeGreaterThan(0)
    }
  })

  it('no tiene propiedades extra fuera del tipo Copy', async () => {
    const copy = await generateCopy(minimalStoryboard, minimalRepo)
    const allowedKeys: (keyof Copy)[] = ['tagline', 'lines', 'installCmd']
    for (const key of Object.keys(copy)) {
      expect(allowedKeys).toContain(key)
    }
  })

  it('MOCK_COPY exportado coincide con lo que devuelve generateCopy', async () => {
    const copy = await generateCopy(minimalStoryboard, minimalRepo)
    // El mock devuelve una copia del objeto, no la referencia
    expect(copy).toEqual(MOCK_COPY)
  })

  it('es idempotente: misma entrada → misma salida', async () => {
    const copy1 = await generateCopy(minimalStoryboard, minimalRepo)
    const copy2 = await generateCopy(minimalStoryboard, minimalRepo)
    expect(copy1).toEqual(copy2)
  })

  it('ignora los argumentos (siempre devuelve MOCK_COPY sin importar el storyboard)', async () => {
    const emptyStoryboard: Beat[] = []
    const copy = await generateCopy(emptyStoryboard, minimalRepo)
    expect(copy).toEqual(MOCK_COPY)
  })
})
