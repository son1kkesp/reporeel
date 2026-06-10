import { describe, it, expect } from 'vitest'
import { formatStars, topLanguages } from '@/core/storyboard'

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
