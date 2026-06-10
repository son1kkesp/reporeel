import { describe, it, expect } from 'vitest'
import { buildFallbackCopy } from '@/core/copy'
import { buildStoryboard } from '@/core/storyboard'
import type { RepoData } from '@/core/repo-data'

// ─── Fixture ──────────────────────────────────────────────────────────────────

const baseRepo: RepoData = {
  owner: 'acme',
  name: 'my-project',
  description: 'A great project',
  latestRelease: 'v1.0.0',
  stars: 220_000,
  forks: 10,
  contributorsCount: 5,
  languages: { TypeScript: 70, JavaScript: 30 },
  topics: ['nodejs', 'cli'],
  createdAt: '2020-01-01T00:00:00Z',
  pushedAt: '2024-06-01T00:00:00Z',
  topContributors: ['alice', 'bob'],
  commitActivityLast12w: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
}

describe('buildFallbackCopy', () => {
  it('produce un objeto Copy con tagline, lines e installCmd no vacíos (caso stars)', () => {
    const storyboard = buildStoryboard(baseRepo)
    const copy = buildFallbackCopy(storyboard, baseRepo.name)

    expect(copy.tagline).toBeTruthy()
    expect(copy.tagline.length).toBeGreaterThan(0)
    expect(copy.lines).toBeDefined()
    expect(copy.lines.length).toBeGreaterThan(0)
    copy.lines.forEach((line) => {
      expect(line.length).toBeGreaterThan(0)
    })
  })

  it('tagline incluye el nombre del repo', () => {
    const storyboard = buildStoryboard(baseRepo)
    const copy = buildFallbackCopy(storyboard, baseRepo.name)
    expect(copy.tagline.toLowerCase()).toContain('my-project')
  })

  it('tagline incluye el top lenguaje', () => {
    const storyboard = buildStoryboard(baseRepo)
    const copy = buildFallbackCopy(storyboard, baseRepo.name)
    expect(copy.tagline).toContain('TypeScript')
  })

  it('tagline incluye heroValue cuando heroKind es stars', () => {
    const storyboard = buildStoryboard(baseRepo)
    const copy = buildFallbackCopy(storyboard, baseRepo.name)
    // heroValue = "220k"
    expect(copy.tagline).toContain('220k')
  })

  it('installCmd está presente cuando el storyboard tiene cta con installCmd', () => {
    const storyboard = buildStoryboard(baseRepo)
    const copy = buildFallbackCopy(storyboard, baseRepo.name)
    expect(copy.installCmd).toBeDefined()
    expect(copy.installCmd).toContain('npm install')
  })

  it('installCmd es undefined cuando no hay installCmd en cta', () => {
    const repoSinInstall: RepoData = {
      ...baseRepo,
      latestRelease: null,
      topics: ['awesome'],
    }
    const storyboard = buildStoryboard(repoSinInstall)
    const copy = buildFallbackCopy(storyboard, repoSinInstall.name)
    expect(copy.installCmd).toBeUndefined()
  })

  it('funciona con heroKind momentum (repo con pocas estrellas y tendencia creciente)', () => {
    const repoMomentum: RepoData = {
      ...baseRepo,
      stars: 50,
      latestRelease: null,
      topics: ['awesome'],
      commitActivityLast12w: [1, 1, 1, 1, 2, 2, 2, 2, 10, 10, 10, 10],
    }
    const storyboard = buildStoryboard(repoMomentum)
    const copy = buildFallbackCopy(storyboard, repoMomentum.name)

    expect(copy.tagline).toBeTruthy()
    expect(copy.lines.length).toBeGreaterThan(0)
  })

  it('funciona con heroKind fresh (repo nuevo)', () => {
    const repoFresh: RepoData = {
      ...baseRepo,
      stars: 10,
      latestRelease: null,
      topics: ['awesome'],
      commitActivityLast12w: [5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0],
      createdAt: '2024-01-01T00:00:00Z',
      pushedAt: '2024-02-01T00:00:00Z',
    }
    const storyboard = buildStoryboard(repoFresh)
    const copy = buildFallbackCopy(storyboard, repoFresh.name)

    expect(copy.tagline).toBeTruthy()
    expect(copy.lines.length).toBeGreaterThan(0)
  })
})
