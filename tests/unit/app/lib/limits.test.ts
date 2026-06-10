/**
 * tests/unit/app/lib/limits.test.ts
 *
 * Tests TDD para checkRateLimit, acquireRenderSlot, releaseRenderSlot.
 * Todos los tests son deterministas: el reloj y los contadores se inyectan/resetean.
 * Sin I/O, sin red, sin dependencias externas.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkRateLimit,
  acquireRenderSlot,
  releaseRenderSlot,
  _resetRateLimitStore,
  _resetSlots,
  _getOccupiedSlots,
} from '@/app/lib/limits'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const IP = '1.2.3.4'
const IP_B = '5.6.7.8'
const LIMIT_3_10MIN = { limit: 3, windowMs: 600_000 }
const NOW = 1_000_000 // timestamp fijo arbitrario

// ─── Rate-limit ────────────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  beforeEach(() => {
    _resetRateLimitStore()
  })

  it('primera request siempre se permite', () => {
    expect(checkRateLimit(IP, LIMIT_3_10MIN, NOW)).toBe(true)
  })

  it('permite hasta el límite (3 requests)', () => {
    expect(checkRateLimit(IP, LIMIT_3_10MIN, NOW)).toBe(true)
    expect(checkRateLimit(IP, LIMIT_3_10MIN, NOW + 1)).toBe(true)
    expect(checkRateLimit(IP, LIMIT_3_10MIN, NOW + 2)).toBe(true)
  })

  it('bloquea la cuarta request dentro de la ventana', () => {
    checkRateLimit(IP, LIMIT_3_10MIN, NOW)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 1)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 2)
    // cuarta → bloqueada
    expect(checkRateLimit(IP, LIMIT_3_10MIN, NOW + 3)).toBe(false)
  })

  it('permite de nuevo tras expirar la ventana', () => {
    // Registrar 3 requests al inicio de la ventana
    checkRateLimit(IP, LIMIT_3_10MIN, NOW)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 1)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 2)
    // La cuarta, exactamente cuando la ventana (10 min) ha expirado
    const afterWindow = NOW + LIMIT_3_10MIN.windowMs + 1
    expect(checkRateLimit(IP, LIMIT_3_10MIN, afterWindow)).toBe(true)
  })

  it('IPs distintas tienen contadores independientes', () => {
    checkRateLimit(IP, LIMIT_3_10MIN, NOW)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 1)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 2)
    // La IP_B todavía no tiene requests → permitida
    expect(checkRateLimit(IP_B, LIMIT_3_10MIN, NOW + 3)).toBe(true)
    // IP sigue bloqueada
    expect(checkRateLimit(IP, LIMIT_3_10MIN, NOW + 3)).toBe(false)
  })

  it('límite configurable: limit=1 bloquea la segunda request', () => {
    const config = { limit: 1, windowMs: 60_000 }
    expect(checkRateLimit(IP, config, NOW)).toBe(true)
    expect(checkRateLimit(IP, config, NOW + 1)).toBe(false)
  })

  it('la request bloqueada no consume slot (no cuenta hacia el límite)', () => {
    checkRateLimit(IP, LIMIT_3_10MIN, NOW)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 1)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 2)
    // bloqueadas — no deben acumular
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 3)
    checkRateLimit(IP, LIMIT_3_10MIN, NOW + 4)
    // tras expirar la ventana, el contador vuelve a 0 (no tiene 5 requests antiguas)
    const afterWindow = NOW + LIMIT_3_10MIN.windowMs + 1
    expect(checkRateLimit(IP, LIMIT_3_10MIN, afterWindow)).toBe(true)
  })
})

// ─── Semáforo de render ────────────────────────────────────────────────────────

describe('acquireRenderSlot / releaseRenderSlot', () => {
  beforeEach(() => {
    _resetSlots()
  })

  it('adquiere el primer slot (→ true)', () => {
    expect(acquireRenderSlot({ maxSlots: 3 })).toBe(true)
    expect(_getOccupiedSlots()).toBe(1)
  })

  it('adquiere hasta el máximo configurado (3)', () => {
    expect(acquireRenderSlot({ maxSlots: 3 })).toBe(true)
    expect(acquireRenderSlot({ maxSlots: 3 })).toBe(true)
    expect(acquireRenderSlot({ maxSlots: 3 })).toBe(true)
    expect(_getOccupiedSlots()).toBe(3)
  })

  it('el cuarto intento devuelve false (sin slot)', () => {
    acquireRenderSlot({ maxSlots: 3 })
    acquireRenderSlot({ maxSlots: 3 })
    acquireRenderSlot({ maxSlots: 3 })
    expect(acquireRenderSlot({ maxSlots: 3 })).toBe(false)
    // El contador no aumenta al no adquirir
    expect(_getOccupiedSlots()).toBe(3)
  })

  it('releaseRenderSlot decrementa el contador', () => {
    acquireRenderSlot({ maxSlots: 3 })
    acquireRenderSlot({ maxSlots: 3 })
    releaseRenderSlot({ maxSlots: 3 })
    expect(_getOccupiedSlots()).toBe(1)
  })

  it('tras liberar un slot, el siguiente acquire tiene éxito', () => {
    acquireRenderSlot({ maxSlots: 3 })
    acquireRenderSlot({ maxSlots: 3 })
    acquireRenderSlot({ maxSlots: 3 })
    // lleno → release
    releaseRenderSlot({ maxSlots: 3 })
    // ahora hay un slot libre
    expect(acquireRenderSlot({ maxSlots: 3 })).toBe(true)
  })

  it('releaseRenderSlot en 0 no va a negativo', () => {
    expect(_getOccupiedSlots()).toBe(0)
    releaseRenderSlot({ maxSlots: 3 }) // no debe lanzar ni ir a -1
    expect(_getOccupiedSlots()).toBe(0)
  })

  it('maxSlots configurable: maxSlots=1 bloquea el segundo acquire', () => {
    expect(acquireRenderSlot({ maxSlots: 1 })).toBe(true)
    expect(acquireRenderSlot({ maxSlots: 1 })).toBe(false)
  })
})
