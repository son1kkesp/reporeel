import { describe, it, expect } from 'vitest'
import { RepoDataSchema } from '@/core/repo-data'

const validBase = {
  owner: 'acme',
  name: 'my-project',
  description: null,
  latestRelease: null,
  stars: 42,
  forks: 5,
  contributorsCount: 3,
  languages: { TypeScript: 80, JavaScript: 20 },
  topics: ['cli', 'automation'],
  createdAt: '2023-01-01T00:00:00Z',
  pushedAt: '2024-06-01T00:00:00Z',
  topContributors: ['alice', 'bob'],
  commitActivityLast12w: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}

describe('RepoDataSchema', () => {
  it('acepta un objeto válido con description y latestRelease en null', () => {
    const result = RepoDataSchema.safeParse(validBase)
    expect(result.success).toBe(true)
  })

  it('acepta description y latestRelease como strings no vacíos', () => {
    const result = RepoDataSchema.safeParse({
      ...validBase,
      description: 'Una descripción',
      latestRelease: 'v1.2.3',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza stars no numérico', () => {
    const result = RepoDataSchema.safeParse({ ...validBase, stars: 'muchas' })
    expect(result.success).toBe(false)
  })

  it('rechaza forks no numérico', () => {
    const result = RepoDataSchema.safeParse({ ...validBase, forks: '5' })
    expect(result.success).toBe(false)
  })

  it('rechaza contributorsCount no numérico', () => {
    const result = RepoDataSchema.safeParse({ ...validBase, contributorsCount: true })
    expect(result.success).toBe(false)
  })

  it('rechaza languages con valor no numérico', () => {
    const result = RepoDataSchema.safeParse({
      ...validBase,
      languages: { TypeScript: 'mucho' },
    })
    expect(result.success).toBe(false)
  })

  it('rechaza un objeto vacío (falta owner)', () => {
    const result = RepoDataSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('acepta topics como array vacío', () => {
    const result = RepoDataSchema.safeParse({ ...validBase, topics: [] })
    expect(result.success).toBe(true)
  })

  it('acepta commitActivityLast12w como array de 12 números', () => {
    const result = RepoDataSchema.safeParse(validBase)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commitActivityLast12w).toHaveLength(12)
    }
  })
})
