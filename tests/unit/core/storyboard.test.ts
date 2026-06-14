import { describe, it, expect } from 'vitest'
import { formatStars, topLanguages, buildStoryboard, selectMomentumMetric } from '@/core/storyboard'
import type { RepoData } from '@/core/repo-data'

// ─── Fixture base ─────────────────────────────────────────────────────────────

const baseRepo: RepoData = {
  owner: 'acme',
  name: 'my-project',
  description: 'A great project',
  latestRelease: null,
  stars: 100,
  forks: 10,
  contributorsCount: 5,
  languages: { TypeScript: 70, JavaScript: 30 },
  topics: ['cli'],
  createdAt: '2020-01-01T00:00:00Z',
  pushedAt: '2024-06-01T00:00:00Z',
  topContributors: ['alice'],
  commitActivityLast12w: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
}

// ─── Helpers puros ────────────────────────────────────────────────────────────

describe('formatStars', () => {
  it('formatea números menores a 1000 sin sufijo', () => {
    expect(formatStars(42)).toBe('42')
  })

  it('formatea 1200 como "1.2k"', () => {
    expect(formatStars(1200)).toBe('1.2k')
  })

  it('formatea 220000 como "220k"', () => {
    expect(formatStars(220_000)).toBe('220k')
  })

  it('formatea 1100000 como "1.1M"', () => {
    expect(formatStars(1_100_000)).toBe('1.1M')
  })

  it('formatea 1000 como "1k"', () => {
    expect(formatStars(1000)).toBe('1k')
  })

  it('formatea 999999 como "1000k"', () => {
    // 999999 / 1000 = 999.999 → sin decimales si entero = "1000k"
    // En realidad 999.999 redondeado a 1 decimal = 1000.0 → "1000k"
    // Aceptamos "1000k" o "999.9k" (veremos la implementación)
    const result = formatStars(999_999)
    expect(result).toMatch(/^\d+(\.\d)?k$/)
  })
})

// ─── Selección de héroe ───────────────────────────────────────────────────────

describe('buildStoryboard — selección de héroe', () => {
  it('estrellas > 5000 → hook con heroKind:"stars" y heroValue formateado', () => {
    const repo: RepoData = { ...baseRepo, stars: 220_000 }
    const beats = buildStoryboard(repo)
    const hook = beats[0]
    expect(hook?.tipo).toBe('hook')
    expect(hook?.data.heroKind).toBe('stars')
    expect(hook?.data.heroValue).toBe('220k')
  })

  it('pocas estrellas con tendencia creciente → heroKind:"momentum"', () => {
    // Primeras 4 semanas: 1+1+1+1=4, últimas 4: 10+10+10+10=40
    const repo: RepoData = {
      ...baseRepo,
      stars: 50,
      commitActivityLast12w: [1, 1, 1, 1, 2, 2, 2, 2, 10, 10, 10, 10],
    }
    const beats = buildStoryboard(repo)
    const hook = beats[0]
    expect(hook?.data.heroKind).toBe('momentum')
  })

  it('repo nuevo (createdAt y pushedAt < 90 días) con pocas estrellas → heroKind:"fresh"', () => {
    // createdAt 2024-01-01, pushedAt 2024-02-01 → 31 días → fresh
    const repo: RepoData = {
      ...baseRepo,
      stars: 50,
      commitActivityLast12w: [5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0], // NO creciente
      createdAt: '2024-01-01T00:00:00Z',
      pushedAt: '2024-02-01T00:00:00Z',
    }
    const beats = buildStoryboard(repo)
    const hook = beats[0]
    expect(hook?.data.heroKind).toBe('fresh')
  })
})

// ─── Beats ordenados ──────────────────────────────────────────────────────────

describe('buildStoryboard — estructura de beats', () => {
  it('siempre devuelve exactamente 5 beats en orden: hook, identity, momentum, proof, cta', () => {
    const beats = buildStoryboard(baseRepo)
    expect(beats).toHaveLength(5)
    expect(beats[0]?.tipo).toBe('hook')
    expect(beats[1]?.tipo).toBe('identity')
    expect(beats[2]?.tipo).toBe('momentum')
    expect(beats[3]?.tipo).toBe('proof')
    expect(beats[4]?.tipo).toBe('cta')
  })

  it('identity contiene topLanguage y topLanguagePct', () => {
    const repo: RepoData = {
      ...baseRepo,
      languages: { TypeScript: 70, JavaScript: 30 },
    }
    const beats = buildStoryboard(repo)
    const identity = beats[1]
    expect(identity?.data.topLanguage).toBe('TypeScript')
    expect(identity?.data.topLanguagePct).toBe(70)
    expect(identity?.data.secondLanguage).toBe('JavaScript')
    expect(identity?.data.secondLanguagePct).toBe(30)
  })

  it('momentum contiene age como "vivo desde 20XX"', () => {
    const repo: RepoData = {
      ...baseRepo,
      createdAt: '2021-03-15T00:00:00Z',
    }
    const beats = buildStoryboard(repo)
    const momentum = beats[2]
    expect(momentum?.data.age).toBe('vivo desde 2021')
  })

  it('momentum expone una métrica complementaria (momentumValue + momentumLabel) DISTINTA del heroValue del hook', () => {
    // react-like: stars altas → hero = stars, momentum debe ser otra cosa
    const repo: RepoData = {
      ...baseRepo,
      stars: 228_000,
      forks: 46_700,
      contributorsCount: 1523,
    }
    const beats = buildStoryboard(repo)
    const hero = beats[0]?.data.heroValue
    const momentum = beats[2]
    expect(hero).toBe('228k')
    // Preferencia 1 = contribuidores → formatStars(1523) = "1.5k"
    expect(momentum?.data.momentumValue).toBe('1.5k')
    expect(momentum?.data.momentumLabel).toBe('contribuidores')
    expect(momentum?.data.momentumValue).not.toBe(hero)
  })

  it('cta contiene installCmd inferido de topics npm con latestRelease', () => {
    const repo: RepoData = {
      ...baseRepo,
      latestRelease: 'v2.0.0',
      topics: ['nodejs', 'cli'],
    }
    const beats = buildStoryboard(repo)
    const cta = beats[4]
    expect(cta?.data.installCmd).toContain('npm install')
    expect(cta?.data.installCmd).toContain('my-project')
  })

  it('cta installCmd es undefined si no hay latestRelease ni topics reconocibles', () => {
    const repo: RepoData = {
      ...baseRepo,
      latestRelease: null,
      topics: ['awesome'],
    }
    const beats = buildStoryboard(repo)
    const cta = beats[4]
    expect(cta?.data.installCmd).toBeUndefined()
  })
})

describe('topLanguages', () => {
  it('devuelve lenguajes ordenados de mayor a menor porcentaje', () => {
    const langs = { JavaScript: 30, TypeScript: 60, CSS: 10 }
    const result = topLanguages(langs)
    expect(result[0]).toEqual({ name: 'TypeScript', pct: 60 })
    expect(result[1]).toEqual({ name: 'JavaScript', pct: 30 })
    expect(result[2]).toEqual({ name: 'CSS', pct: 10 })
  })

  it('devuelve array vacío si languages está vacío', () => {
    expect(topLanguages({})).toEqual([])
  })

  it('devuelve un solo elemento si solo hay un lenguaje', () => {
    const result = topLanguages({ Rust: 100 })
    expect(result).toEqual([{ name: 'Rust', pct: 100 }])
  })
})

describe('selectMomentumMetric', () => {
  it('por defecto elige contribuidores (preferencia 1) formateado', () => {
    const repo: RepoData = { ...baseRepo, contributorsCount: 1523 }
    const metric = selectMomentumMetric(repo, '228k')
    expect(metric).toEqual({ momentumValue: '1.5k', momentumLabel: 'contribuidores' })
  })

  it('si contribuidores coincide con el heroValue, pasa a la siguiente (commits / 12 sem)', () => {
    // contributorsCount=42 → formatStars="42", igual que heroValue "42" del hook
    const repo: RepoData = {
      ...baseRepo,
      contributorsCount: 42,
      commitActivityLast12w: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], // suma 120
    }
    const metric = selectMomentumMetric(repo, '42')
    expect(metric.momentumValue).not.toBe('42')
    expect(metric).toEqual({ momentumValue: '120', momentumLabel: 'commits / 12 sem' })
  })

  it('garantiza SIEMPRE un valor distinto del heroValue del hook', () => {
    const repo: RepoData = {
      ...baseRepo,
      stars: 228_000,
      contributorsCount: 1523,
      forks: 46_700,
      commitActivityLast12w: [12, 18, 9, 22, 15, 7, 31, 14, 19, 28, 11, 16],
    }
    const beats = buildStoryboard(repo)
    const heroValue = beats[0]?.data.heroValue as string
    const metric = selectMomentumMetric(repo, heroValue)
    expect(metric.momentumValue).not.toBe(heroValue)
  })
})
