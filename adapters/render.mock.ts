/**
 * adapters/render.mock.ts
 *
 * Mock del adaptador de render para tests y desarrollo sin Vercel Pro.
 *
 * Devuelve URLs que apuntan a __fixtures__/sample.mp4 (vídeo negro 1080x1920
 * de 1 segundo generado con ffmpeg).
 * La firma es idéntica a la real: se puede inyectar en runPipeline sin
 * cambiar tipos.
 */

import type { RenderAdapter } from './render'

/** URL base de los fixtures para tests y desarrollo local. */
const FIXTURE_BASE = '/__fixtures__'

/**
 * Crea un RenderAdapter mock que devuelve URLs de fixture.
 * Cada llamada es instantánea (no hace I/O ni spawn de proceso).
 */
export function createMockRenderAdapter(): RenderAdapter {
  return {
    async renderTrailer(
      _jobId: string,
      _vars: Record<string, string | number>,
    ): Promise<{ mp4Url: string; poster: string }> {
      return {
        mp4Url: `${FIXTURE_BASE}/sample.mp4`,
        poster: `${FIXTURE_BASE}/sample-poster.jpg`,
      }
    },
  }
}
