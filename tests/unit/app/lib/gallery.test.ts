import { describe, it, expect } from 'vitest'
import { getGallery, GALLERY_INDEX_KEY } from '@/app/lib/gallery'
import { createInMemoryBlobClient } from '@/adapters/blob-client'

describe('getGallery', () => {
  it('devuelve [] cuando el índice no existe (degradación elegante)', async () => {
    const client = createInMemoryBlobClient()
    await expect(getGallery(client)).resolves.toEqual([])
  })

  it('lee un array de entradas válidas', async () => {
    const client = createInMemoryBlobClient()
    const entries = [
      { repo: 'facebook/react', mp4Url: '/r.mp4', poster: '/r.jpg' },
      { repo: 'vercel/next.js', mp4Url: '/n.mp4', poster: '/n.jpg' },
    ]
    await client.putJson(GALLERY_INDEX_KEY, entries)

    await expect(getGallery(client)).resolves.toEqual(entries)
  })

  it('acepta también la forma { items: [...] }', async () => {
    const client = createInMemoryBlobClient()
    const items = [{ repo: 'a/b', mp4Url: '/a.mp4', poster: '/a.jpg' }]
    await client.putJson(GALLERY_INDEX_KEY, { items })

    await expect(getGallery(client)).resolves.toEqual(items)
  })

  it('devuelve [] si el JSON no cumple el schema (no lanza)', async () => {
    const client = createInMemoryBlobClient()
    await client.putJson(GALLERY_INDEX_KEY, [{ repo: 'falta-urls' }])

    await expect(getGallery(client)).resolves.toEqual([])
  })

  it('devuelve [] si el cliente Blob lanza (no propaga el error)', async () => {
    const throwing = {
      async putJson() {
        /* no-op */
      },
      async getJson(): Promise<unknown> {
        throw new Error('sin token')
      },
    }
    await expect(getGallery(throwing)).resolves.toEqual([])
  })
})
