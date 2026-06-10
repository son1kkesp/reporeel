/**
 * app/lib/gallery.ts
 *
 * Helper de servidor para la galería de tráileres pre-renderizados.
 *
 * Lee `gallery-index.json` de Vercel Blob: una lista de entradas
 * `{ repo, mp4Url, poster }`. Este índice AÚN NO EXISTE (se siembra en una
 * fase posterior con Vercel Pro), por lo que la función DEBE degradar con
 * elegancia a una lista vacía si:
 *   - la clave no está en Blob,
 *   - el JSON está corrupto o no cumple el schema,
 *   - el cliente Blob falla (sin token en local, error de red, etc.).
 *
 * Nunca lanza: la UI decide qué mostrar a partir de un array (vacío o no).
 *
 * Diseño inyectable: getGallery(client?) acepta cualquier BlobClient,
 * incluido el fake en memoria para tests.
 */

import { z } from 'zod'
import {
  createVercelBlobClient,
  type BlobClient,
} from '@/adapters/blob-client'

// ─── Clave en Blob ─────────────────────────────────────────────────────────────

export const GALLERY_INDEX_KEY = 'gallery-index.json'

// ─── Schema y tipos ────────────────────────────────────────────────────────────

export const GalleryEntrySchema = z.object({
  /** Identificador legible del repo, p. ej. "facebook/react". */
  repo: z.string().min(1),
  /** URL del MP4 vertical 9:16. */
  mp4Url: z.string().min(1),
  /** URL del póster (primer frame) para el atributo `poster` del vídeo. */
  poster: z.string().min(1),
})

export type GalleryEntry = z.infer<typeof GalleryEntrySchema>

/** El índice es un array de entradas (toleramos también `{ items: [...] }`). */
const GalleryIndexSchema = z.union([
  z.array(GalleryEntrySchema),
  z.object({ items: z.array(GalleryEntrySchema) }).transform((o) => o.items),
])

// ─── Helper público ────────────────────────────────────────────────────────────

/**
 * Devuelve la galería de tráileres pre-renderizados.
 *
 * @param client - BlobClient a usar. Por defecto, el cliente real de Vercel.
 *                 En tests, inyecta `createInMemoryBlobClient()`.
 * @returns Array de entradas válidas. SIEMPRE un array; vacío si no hay índice
 *          o si algo falla (degradación elegante, nunca lanza).
 */
export async function getGallery(
  client: BlobClient = createVercelBlobClient(),
): Promise<GalleryEntry[]> {
  try {
    const raw = await client.getJson(GALLERY_INDEX_KEY)
    if (raw === null || raw === undefined) return []

    const parsed = GalleryIndexSchema.safeParse(raw)
    if (!parsed.success) return []

    return parsed.data
  } catch {
    // Sin token en local, error de red, JSON ilegible… → galería vacía.
    return []
  }
}
