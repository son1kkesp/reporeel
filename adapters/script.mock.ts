/**
 * adapters/script.mock.ts
 *
 * Mock de generateCopy para tests y desarrollo sin coste de IA.
 * Devuelve un Copy fijo y válido. Útil para:
 *   - Tests unitarios (sin red ni key)
 *   - Desarrollo local rápido
 *   - CI
 */

import type { Beat } from '@/core/storyboard'
import type { RepoData } from '@/core/repo-data'
import type { Copy } from '@/core/copy'

export const MOCK_COPY: Copy = {
  tagline: 'El repo que todo developer necesita conocer',
  lines: [
    'Código limpio. Resultados reales.',
    'Miles de devs confían en él cada día.',
  ],
  installCmd: 'npm install example-package',
}

/**
 * Versión mock de generateCopy. Ignora los argumentos y devuelve MOCK_COPY.
 * La firma es idéntica a la real para poder intercambiarse sin cambiar tipos.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function generateCopy(_storyboard: Beat[], _repo: RepoData): Promise<Copy> {
  return { ...MOCK_COPY }
}
