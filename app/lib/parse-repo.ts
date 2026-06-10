/**
 * app/lib/parse-repo.ts
 *
 * Parser tolerante de la entrada del usuario hacia { owner, repo }.
 *
 * Acepta:
 *   - "owner/repo"
 *   - "https://github.com/owner/repo"
 *   - "github.com/owner/repo"
 *   - "https://github.com/owner/repo/" (barra final)
 *   - "https://github.com/owner/repo/tree/main/..." (rutas extra, se ignoran)
 *   - con o sin ".git" final
 *
 * Devuelve null si no puede extraer un par válido.
 *
 * Sin dependencias del DOM ni de Next → reutilizable en cliente y servidor.
 */

export interface ParsedRepo {
  owner: string
  repo: string
}

// owner/repo de GitHub: letras, números, guion, guion bajo y punto.
const SEGMENT = /^[A-Za-z0-9._-]+$/

export function parseRepoInput(input: string): ParsedRepo | null {
  if (!input) return null
  let value = input.trim()
  if (!value) return null

  // Quitar esquema y dominio si es una URL de GitHub.
  value = value
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^github\.com\//i, '')

  // Quitar query/hash.
  value = value.split('?')[0]!.split('#')[0]!

  // Dividir por "/" y quedarnos con los dos primeros segmentos no vacíos.
  const parts = value.split('/').filter(Boolean)
  if (parts.length < 2) return null

  const owner = parts[0]!
  let repo = parts[1]!
  repo = repo.replace(/\.git$/i, '')

  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null
  if (owner.length > 100 || repo.length > 100) return null

  return { owner, repo }
}
