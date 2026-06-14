/**
 * app/lib/gallery.ts
 *
 * Helper de servidor para la galería de tráileres pre-renderizados.
 *
 * Lee `gallery-index.json` de Vercel Blob. Soporta dos formatos:
 *
 *   Formato nuevo (seed): `{ items: [{ owner, repo }, ...] }`
 *   Formato legado:       `[{ repo, mp4Url, poster }, ...]`
 *                         o `{ items: [{ repo, mp4Url, poster }, ...] }`
 *
 * Las URLs de vídeo/póster se derivan en tiempo de render a través del proxy
 * de la app (`/v/{owner}/{repo}` y `/p/{owner}/{repo}`), de modo que la
 * galería funciona bajo cualquier dominio sin re-sembrar el índice.
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

/**
 * Entrada normalizada de galería.
 * Las URLs se construyen por el componente a través de las rutas proxy:
 *   vídeo  → /v/{owner}/{repo}
 *   póster → /p/{owner}/{repo}
 */
export const GalleryEntrySchema = z.object({
  /** Propietario del repo, p. ej. "facebook". */
  owner: z.string().min(1),
  /** Nombre del repo, p. ej. "react". */
  repo: z.string().min(1),
})

export type GalleryEntry = z.infer<typeof GalleryEntrySchema>

// ─── Schemas de entrada (toleran ambos formatos) ───────────────────────────────

/**
 * Entrada en formato legado: `{ repo: "owner/repo", mp4Url, poster }`.
 * La transforma al formato normalizado extrayendo owner y repo del campo `repo`.
 */
const LegacyEntrySchema = z
  .object({
    repo: z.string().min(1),
    mp4Url: z.string().min(1),
    poster: z.string().min(1),
  })
  .transform((e) => {
    const parts = e.repo.split('/')
    const owner = parts[0] ?? e.repo
    const repo = parts[1] ?? e.repo
    return { owner, repo }
  })

/** Acepta entrada nueva o legada y devuelve `GalleryEntry`. */
const AnyEntrySchema = z.union([GalleryEntrySchema, LegacyEntrySchema])

/** El índice puede ser un array plano o `{ items: [...] }`, en cualquier formato. */
const GalleryIndexSchema = z.union([
  z.array(AnyEntrySchema),
  z
    .object({ items: z.array(AnyEntrySchema) })
    .transform((o) => o.items),
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
