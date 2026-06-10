/**
 * adapters/blob-client.ts
 *
 * Helper Blob compartido con cliente inyectable.
 *
 * Diseño:
 *   - BlobClient es una interfaz mínima con putJson / getJson.
 *   - createVercelBlobClient()  → implementación real (usa @vercel/blob).
 *   - createInMemoryBlobClient() → fake en memoria para tests (sin red).
 *
 * Claves de Blob siguen el patrón:
 *   jobs/<jobId>.json
 *   trailers/<jobId>.json
 *
 * La lógica de put/get no se duplica en cache.ts ni job.ts.
 */

import { put, list } from '@vercel/blob'

// ─── Interfaz pública ─────────────────────────────────────────────────────────

export interface BlobClient {
  /** Serializa `obj` a JSON y lo guarda con la clave `key`. */
  putJson(key: string, obj: unknown): Promise<void>
  /**
   * Lee la clave `key` y la parsea como JSON.
   * Devuelve `null` si la clave no existe.
   */
  getJson(key: string): Promise<unknown>
}

// ─── Implementación real (Vercel Blob) ────────────────────────────────────────

/**
 * Implementación real que usa @vercel/blob.
 *
 * - putJson: sube el JSON con `put()`, `access: 'public'`, `allowOverwrite: true`.
 * - getJson: busca la clave con `list({ prefix })` y descarga con fetch nativo.
 *   Si no hay blobs que coincidan devuelve null.
 *
 * NOTA: acceso 'public' es el único modo que soporta fetch sin token.
 * Los datos de estado/caché no son secretos (son internos de la app).
 */
export function createVercelBlobClient(): BlobClient {
  return {
    async putJson(key: string, obj: unknown): Promise<void> {
      const body = JSON.stringify(obj)
      await put(key, body, {
        access: 'public',
        contentType: 'application/json',
        allowOverwrite: true,
        addRandomSuffix: false,
      })
    },

    async getJson(key: string): Promise<unknown> {
      // Buscamos la clave exacta usando list() con prefix = key
      const result = await list({ prefix: key, limit: 1 })
      const blob = result.blobs.find((b) => b.pathname === key)
      if (!blob) return null

      const res = await fetch(blob.url)
      if (!res.ok) return null
      return res.json() as Promise<unknown>
    },
  }
}

// ─── Implementación fake en memoria (para tests) ──────────────────────────────

/**
 * Cliente Blob en memoria.
 * Cada instancia tiene su propio store aislado.
 * Ideal para inyectar en tests: sin red, sin token.
 */
export function createInMemoryBlobClient(): BlobClient & {
  /** Acceso directo al store interno (útil para seedear datos en tests). */
  _store: Map<string, unknown>
} {
  const store = new Map<string, unknown>()

  return {
    _store: store,

    async putJson(key: string, obj: unknown): Promise<void> {
      // Round-trip JSON para simular serialización (detecta valores no serializables)
      store.set(key, JSON.parse(JSON.stringify(obj)))
    },

    async getJson(key: string): Promise<unknown> {
      if (!store.has(key)) return null
      return store.get(key) ?? null
    },
  }
}
