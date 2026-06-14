import { describe, it, expect } from 'vitest'
import { getGallery, GALLERY_INDEX_KEY } from '@/app/lib/gallery'
import { createInMemoryBlobClient } from '@/adapters/blob-client'

describe('getGallery', () => {
  it('devuelve [] cuando el índice no existe (degradación elegante)', async () => {
    const client = createInMemoryBlobClient()
    await expect(getGallery(client)).resolves.toEqual([])
  })

  it('lee el formato nuevo { items: [{ owner, repo }] }', async () => {
    const client = createInMemoryBlobClient()
    const items = [
      { owner: 'facebook', repo: 'react' },
      { owner: 'vercel', repo: 'next.js' },
    ]
    await client.putJson(GALLERY_INDEX_KEY, { items })

    await expect(getGallery(client)).resolves.toEqual(items)
  })

  it('lee un array plano en formato nuevo [{ owner, repo }]', async () => {
    const client = createInMemoryBlobClient()
    const entries = [
      { owner: 'facebook', repo: 'react' },
      { owner: 'vercel', repo: 'next.js' },
    ]
    await client.putJson(GALLERY_INDEX_KEY, entries)

    await expect(getGallery(client)).resolves.toEqual(entries)
  })

  it('tolera el formato legado [{ repo: "owner/repo", mp4Url, poster }] y lo normaliza', async () => {
    const client = createInMemoryBlobClient()
    const legacy = [
      { repo: 'facebook/react', mp4Url: '/r.mp4', poster: '/r.jpg' },
      { repo: 'vercel/next.js', mp4Url: '/n.mp4', poster: '/n.jpg' },
    ]
    await client.putJson(GALLERY_INDEX_KEY, legacy)

    // El formato legado se normaliza a { owner, repo }
    await expect(getGallery(client)).resolves.toEqual([
      { owner: 'facebook', repo: 'react' },
      { owner: 'vercel', repo: 'next.js' },
    ])
  })

  it('tolera el formato legado en forma { items: [...] } y lo normaliza', async () => {
    const client = createInMemoryBlobClient()
    const items = [{ repo: 'a/b', mp4Url: '/a.mp4', poster: '/a.jpg' }]
    await client.putJson(GALLERY_INDEX_KEY, { items })

    await expect(getGallery(client)).resolves.toEqual([
      { owner: 'a', repo: 'b' },
    ])
  })

  it('devuelve [] si el JSON no cumple el schema (no lanza)', async () => {
    const client = createInMemoryBlobClient()
    // No cumple ni el formato nuevo (falta owner) ni el legado (falta mp4Url/poster)
    await client.putJson(GALLERY_INDEX_KEY, [{ repo: 'falta-campos' }])

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
