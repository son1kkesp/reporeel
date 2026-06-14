import { describe, it, expect } from 'vitest'
import { composeVars } from '@/adapters/compose'
import { buildStoryboard } from '@/core/storyboard'
import { buildFallbackCopy } from '@/core/copy'
import type { RepoData } from '@/core/repo-data'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

// Las 14 claves EXACTAS declaradas en compositions/trailer/meta.json
const EXPECTED_KEYS = [
  'repoName',
  'heroKind',
  'heroValue',
  'lang1',
  'lang1Pct',
  'lang2',
  'lang2Pct',
  'age',
  'momentumValue',
  'momentumLabel',
  'tagline',
  'line1',
  'line2',
  'installCmd',
] as const

function compose(repo: RepoData) {
  const storyboard = buildStoryboard(repo)
  const copy = buildFallbackCopy(storyboard, repo.name)
  return composeVars(storyboard, copy)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('composeVars', () => {
  it('produce EXACTAMENTE las 14 claves del contrato meta.json (ni más ni menos)', () => {
    const vars = compose(reactRepo)
    expect(Object.keys(vars).sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('todas las claves del contrato están presentes', () => {
    const vars = compose(reactRepo)
    for (const key of EXPECTED_KEYS) {
      expect(vars).toHaveProperty(key)
    }
  })

  it('todos los valores son string o number (aptos para --vars)', () => {
    const vars = compose(reactRepo)
    for (const value of Object.values(vars)) {
      expect(['string', 'number']).toContain(typeof value)
    }
  })

  it('mapea correctamente el héroe (caso stars de react)', () => {
    const vars = compose(reactRepo)
    expect(vars.repoName).toBe('react')
    expect(vars.heroKind).toBe('stars')
    expect(vars.heroValue).toBe('228k')
  })

  it('mapea los dos lenguajes principales con sus porcentajes', () => {
    const vars = compose(reactRepo)
    expect(vars.lang1).toBe('JavaScript')
    expect(vars.lang2).toBe('TypeScript')
    // Porcentajes redondeados a entero, como string
    expect(vars.lang1Pct).toBe('68')
    expect(vars.lang2Pct).toBe('31')
  })

  it('momentumValue/momentumLabel mapean la métrica complementaria y difieren del heroValue', () => {
    const vars = compose(reactRepo)
    expect(vars.momentumValue).toBe('1.5k') // contribuidores: formatStars(1523)
    expect(vars.momentumLabel).toBe('contribuidores')
    expect(vars.momentumValue).not.toBe(vars.heroValue) // distinto del hook ("228k")
  })

  it('incluye age, tagline, line1, line2 e installCmd no vacíos', () => {
    const vars = compose(reactRepo)
    expect(String(vars.age)).toContain('2013')
    expect(String(vars.tagline).length).toBeGreaterThan(0)
    expect(String(vars.line1).length).toBeGreaterThan(0)
    expect(String(vars.line2).length).toBeGreaterThan(0)
    expect(String(vars.installCmd).length).toBeGreaterThan(0)
  })

  it('trunca repoName a 40 caracteres como máximo', () => {
    const longName = 'a'.repeat(120)
    const vars = compose({ ...reactRepo, name: longName })
    expect(String(vars.repoName).length).toBeLessThanOrEqual(40)
  })

  it('trunca tagline a 80 caracteres como máximo', () => {
    const vars = compose(reactRepo)
    expect(String(vars.tagline).length).toBeLessThanOrEqual(80)
  })

  it('trunca line1 y line2 a 80 caracteres como máximo', () => {
    const vars = compose(reactRepo)
    expect(String(vars.line1).length).toBeLessThanOrEqual(80)
    expect(String(vars.line2).length).toBeLessThanOrEqual(80)
  })

  it('cuando no hay segundo lenguaje, lang2 y lang2Pct quedan como cadena vacía', () => {
    const oneLang: RepoData = { ...reactRepo, languages: { Rust: 100 } }
    const vars = compose(oneLang)
    expect(vars.lang1).toBe('Rust')
    expect(vars.lang2).toBe('')
    expect(vars.lang2Pct).toBe('')
  })

  it('cuando no hay installCmd derivable, installCmd queda como cadena vacía', () => {
    const noInstall: RepoData = { ...reactRepo, latestRelease: null, topics: ['awesome'] }
    const vars = compose(noInstall)
    expect(vars.installCmd).toBe('')
  })

  it('snapshot del objeto completo para react (contrato estable)', () => {
    const vars = compose(reactRepo)
    expect(vars).toMatchInlineSnapshot(`
      {
        "age": "vivo desde 2013",
        "heroKind": "stars",
        "heroValue": "228k",
        "installCmd": "npm install react@v19.1.0",
        "lang1": "JavaScript",
        "lang1Pct": "68",
        "lang2": "TypeScript",
        "lang2Pct": "31",
        "line1": "228k developers ya confían en él",
        "line2": "Top lenguaje: JavaScript",
        "momentumLabel": "contribuidores",
        "momentumValue": "1.5k",
        "repoName": "react",
        "tagline": "react — 228k estrellas de confianza · Hecho en JavaScript",
      }
    `)
  })
})
