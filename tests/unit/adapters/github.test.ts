import { describe, it, expect } from 'vitest'
import { mapRepoData, parseLinkHeaderLastPage } from '@/adapters/github'
import type { RawGitHubPayload } from '@/adapters/github'
import reactFixture from '@/__fixtures__/repos/react.json'
import ripgrepFixture from '@/__fixtures__/repos/ripgrep.json'
import { RepoDataSchema } from '@/core/repo-data'

// ─── helper: tipa los fixtures como RawGitHubPayload ───────────────────────
function toRaw(f: typeof reactFixture): RawGitHubPayload {
  return {
    repo: f.repo as RawGitHubPayload['repo'],
    languages: f.languages,
    contributorsLinkHeader: f.contributorsLinkHeader ?? null,
    topContributors: (f.contributors ?? []).map((c) => c.login),
    commitActivity: f.commitActivity as RawGitHubPayload['commitActivity'],
    latestRelease: f.latestRelease as RawGitHubPayload['latestRelease'],
    topics: f.topics.names,
  }
}

// ─── parseLinkHeaderLastPage ────────────────────────────────────────────────
describe('parseLinkHeaderLastPage', () => {
  it('extrae el número de la última página del header Link', () => {
    const header =
      '<https://api.github.com/repos/facebook/react/contributors?per_page=1&anon=false&page=2>; rel="next", <https://api.github.com/repos/facebook/react/contributors?per_page=1&anon=false&page=1523>; rel="last"'
    expect(parseLinkHeaderLastPage(header)).toBe(1523)
  })

  it('devuelve 1 si no hay rel="last" (un único contribuidor)', () => {
    expect(parseLinkHeaderLastPage(null)).toBe(1)
  })

  it('devuelve 1 si header está vacío', () => {
    expect(parseLinkHeaderLastPage('')).toBe(1)
  })

  it('maneja página "last" = 1 (solo hay una página)', () => {
    const header =
      '<https://api.github.com/repos/foo/bar/contributors?per_page=1&page=1>; rel="last"'
    expect(parseLinkHeaderLastPage(header)).toBe(1)
  })
})

// ─── mapRepoData — facebook/react ──────────────────────────────────────────
describe('mapRepoData — facebook/react', () => {
  const raw = toRaw(reactFixture)
  const data = mapRepoData(raw)

  it('owner y name son correctos', () => {
    expect(data.owner).toBe('facebook')
    expect(data.name).toBe('react')
  })

  it('description no es null', () => {
    expect(data.description).toBe('The library for web and native user interfaces.')
  })

  it('latestRelease es el tag_name', () => {
    expect(data.latestRelease).toBe('v19.1.0')
  })

  it('stars y forks son numéricos', () => {
    expect(data.stars).toBe(228000)
    expect(data.forks).toBe(46700)
  })

  it('contributorsCount viene del header Link (última página)', () => {
    // header tiene page=1523 con per_page=1 → 1523 contribuidores
    expect(data.contributorsCount).toBe(1523)
  })

  it('languages se convierten a porcentajes que suman ~100', () => {
    const sum = Object.values(data.languages).reduce((a, b) => a + b, 0)
    // la suma debe ser 100 ± 1 (redondeo)
    expect(sum).toBeGreaterThanOrEqual(99)
    expect(sum).toBeLessThanOrEqual(101)
  })

  it('TypeScript es el segundo lenguaje más usado (JavaScript primero)', () => {
    expect(data.languages['JavaScript']).toBeDefined()
    expect(data.languages['TypeScript']).toBeDefined()
    expect(data.languages['JavaScript']!).toBeGreaterThan(data.languages['TypeScript']!)
  })

  it('topics contiene react y javascript', () => {
    expect(data.topics).toContain('react')
    expect(data.topics).toContain('javascript')
  })

  it('createdAt y pushedAt son ISO 8601', () => {
    expect(data.createdAt).toBe('2013-05-24T16:15:54Z')
    expect(data.pushedAt).toBe('2025-06-09T17:45:00Z')
  })

  it('topContributors son logins correctos', () => {
    expect(data.topContributors).toContain('sophiebits')
    expect(data.topContributors).toContain('gaearon')
  })

  it('commitActivityLast12w tiene exactamente 12 semanas', () => {
    expect(data.commitActivityLast12w).toHaveLength(12)
  })

  it('commitActivityLast12w contiene las 12 últimas semanas del fixture (índices 40-51)', () => {
    // las últimas 12 semanas del fixture (índices 40-51)
    const expectedLast12 = reactFixture.commitActivity.slice(-12).map((w) => w.total)
    expect(data.commitActivityLast12w).toEqual(expectedLast12)
  })

  it('pasa validación RepoDataSchema (objeto completo válido)', () => {
    const result = RepoDataSchema.safeParse(data)
    expect(result.success).toBe(true)
  })
})

// ─── mapRepoData — BurntSushi/ripgrep ─────────────────────────────────────
describe('mapRepoData — BurntSushi/ripgrep', () => {
  const raw = toRaw(ripgrepFixture as unknown as typeof reactFixture)
  const data = mapRepoData(raw)

  it('latestRelease es null cuando no hay release', () => {
    expect(data.latestRelease).toBeNull()
  })

  it('languages están en porcentajes (Rust domina)', () => {
    expect(data.languages['Rust']).toBeDefined()
    expect(data.languages['Rust']!).toBeGreaterThan(90)
  })

  it('contributorsCount = 89 desde el Link header', () => {
    expect(data.contributorsCount).toBe(89)
  })

  it('commitActivityLast12w tiene exactamente 12 elementos', () => {
    expect(data.commitActivityLast12w).toHaveLength(12)
  })

  it('pasa validación RepoDataSchema', () => {
    const result = RepoDataSchema.safeParse(data)
    expect(result.success).toBe(true)
  })
})

// ─── mapRepoData — casos borde ─────────────────────────────────────────────
describe('mapRepoData — casos borde', () => {
  const minimalRaw: RawGitHubPayload = {
    repo: {
      owner: { login: 'acme' },
      name: 'tool',
      description: null,
      created_at: '2022-01-01T00:00:00Z',
      pushed_at: '2024-01-01T00:00:00Z',
      stargazers_count: 0,
      forks_count: 0,
    },
    languages: {},
    contributorsLinkHeader: null,
    topContributors: [],
    commitActivity: [],
    latestRelease: null,
    topics: [],
  }

  it('commitActivityLast12w es array de 12 ceros si commitActivity está vacío', () => {
    const data = mapRepoData(minimalRaw)
    expect(data.commitActivityLast12w).toHaveLength(12)
    expect(data.commitActivityLast12w.every((v) => v === 0)).toBe(true)
  })

  it('contributorsCount = 1 si no hay Link header', () => {
    const data = mapRepoData(minimalRaw)
    expect(data.contributorsCount).toBe(1)
  })

  it('languages vacío queda como objeto vacío (no explota)', () => {
    const data = mapRepoData(minimalRaw)
    expect(data.languages).toEqual({})
  })

  it('pasa RepoDataSchema aunque todo sea mínimo', () => {
    const data = mapRepoData(minimalRaw)
    expect(RepoDataSchema.safeParse(data).success).toBe(true)
  })
})
