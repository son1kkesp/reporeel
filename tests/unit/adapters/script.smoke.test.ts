/**
 * tests/unit/adapters/script.smoke.test.ts
 *
 * Smoke test manual — llama a la IA real con la key de .env.local.
 * NO está en CI: solo se ejecuta localmente cuando OPENROUTER_API_KEY está presente.
 * Si la key no está, el test se salta (skipIf).
 */

import { describe, it, expect } from 'vitest'
import { generateCopy } from '@/adapters/script'
import { buildStoryboard } from '@/core/storyboard'
import type { RepoData } from '@/core/repo-data'

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

const hasKey = !!process.env['OPENROUTER_API_KEY']?.replace(/^﻿/, '').trim()

describe.skipIf(!hasKey)('generateCopy — smoke test IA real (salta si no hay key)', () => {
  it('genera un Copy válido para facebook/react usando OpenRouter', { timeout: 30_000 }, async () => {
    const storyboard = buildStoryboard(reactRepo)
    const copy = await generateCopy(storyboard, reactRepo)

    // Validación estructural básica
    expect(typeof copy.tagline).toBe('string')
    expect(copy.tagline.length).toBeGreaterThan(0)
    expect(Array.isArray(copy.lines)).toBe(true)
    expect(copy.lines.length).toBeGreaterThan(0)

    // Log del resultado para inspección manual
    console.log('\n=== COPY GENERADO POR IA (smoke test) ===')
    console.log('tagline:', copy.tagline)
    console.log('lines:', copy.lines)
    if (copy.installCmd) console.log('installCmd:', copy.installCmd)
    console.log('=========================================\n')
  })
})
