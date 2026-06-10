/**
 * app/lib/limits.ts
 *
 * Límites de la API: rate-limit por IP y semáforo de slots de render.
 *
 * ── Rate-limit ─────────────────────────────────────────────────────────────────
 * 3 requests / 10 minutos por IP. Best-effort en memoria (no cross-instance).
 * Coste máximo acotado: si hay N instancias, cada una permite 3 req/10 min por IP.
 * Para tráfico bajo/medio es suficiente. En producción con alto tráfico se puede
 * reemplazar por Redis / Upstash con la misma interfaz.
 *
 * ── Semáforo de render ─────────────────────────────────────────────────────────
 * Máximo 3 renders simultáneos (limitado por Chromium workers + memoria).
 * acquireRenderSlot() devuelve true si hay slot libre (y lo ocupa).
 * releaseRenderSlot() libera un slot.
 * Si se llama al slot 4, acquireRenderSlot() devuelve false (→ 503).
 *
 * ── Inyección del reloj ────────────────────────────────────────────────────────
 * Las funciones aceptan un parámetro `_clock` (milisegundos) opcional.
 * En producción se omite (usa Date.now()). En tests se pasa un valor fijo
 * para garantizar determinismo absoluto sin `vi.setSystemTime`.
 */

// ─── Tipos de configuración (inyectables en tests) ─────────────────────────────

export interface RateLimitConfig {
  /** Máximo de requests permitidos en la ventana. Default: 3. */
  limit: number
  /** Duración de la ventana en milisegundos. Default: 600_000 (10 min). */
  windowMs: number
}

export interface SemaphoreConfig {
  /** Máximo de slots de render simultáneos. Default: 3. */
  maxSlots: number
}

// ─── Estado compartido (module-level singleton) ────────────────────────────────

// Map: ip → lista de timestamps de las requests en la ventana activa
const rateLimitStore = new Map<string, number[]>()

// Contador de slots ocupados
let occupiedSlots = 0

// ─── Rate-limit ────────────────────────────────────────────────────────────────

const DEFAULT_RATE_LIMIT: RateLimitConfig = { limit: 3, windowMs: 600_000 }

/**
 * Comprueba y registra un intento de request para la IP dada.
 *
 * @param ip       IP del cliente (puede ser IPv4 o IPv6).
 * @param config   Configuración inyectable (útil en tests).
 * @param nowMs    Timestamp en ms (Date.now() por defecto). Inyectable en tests.
 * @returns        `true` si la request está dentro del límite, `false` si excede.
 */
export function checkRateLimit(
  ip: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  nowMs: number = Date.now(),
): boolean {
  const { limit, windowMs } = config
  const windowStart = nowMs - windowMs

  // Obtener timestamps del store, filtrar los que han expirado
  const timestamps = (rateLimitStore.get(ip) ?? []).filter((t) => t > windowStart)

  if (timestamps.length >= limit) {
    // Ya superó el límite — NO registramos este intento
    return false
  }

  // Registrar el nuevo intento
  timestamps.push(nowMs)
  rateLimitStore.set(ip, timestamps)
  return true
}

/**
 * Limpia todas las entradas del store de rate-limit.
 * SOLO para tests (resetear estado entre tests).
 */
export function _resetRateLimitStore(): void {
  rateLimitStore.clear()
}

// ─── Semáforo de render ────────────────────────────────────────────────────────

const DEFAULT_SEMAPHORE: SemaphoreConfig = { maxSlots: 3 }

/**
 * Intenta adquirir un slot de render.
 *
 * @param config  Configuración inyectable (útil en tests).
 * @returns       `true` si el slot fue adquirido, `false` si ya hay maxSlots ocupados.
 */
export function acquireRenderSlot(config: SemaphoreConfig = DEFAULT_SEMAPHORE): boolean {
  if (occupiedSlots >= config.maxSlots) {
    return false
  }
  occupiedSlots++
  return true
}

/**
 * Libera un slot de render previamente adquirido.
 * Es seguro llamarlo aunque occupiedSlots ya sea 0 (no va a negativo).
 *
 * @param config  Configuración inyectable (útil en tests).
 */
export function releaseRenderSlot(config: SemaphoreConfig = DEFAULT_SEMAPHORE): void {
  void config // satisface el parámetro aunque no se use en la implementación
  if (occupiedSlots > 0) {
    occupiedSlots--
  }
}

/**
 * Devuelve el número de slots actualmente ocupados.
 * SOLO para tests/observabilidad.
 */
export function _getOccupiedSlots(): number {
  return occupiedSlots
}

/**
 * Resetea el contador de slots a 0.
 * SOLO para tests (resetear estado entre tests).
 */
export function _resetSlots(): void {
  occupiedSlots = 0
}
