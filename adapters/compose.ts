/**
 * adapters/compose.ts
 *
 * Adaptador de presentación: mapea (storyboard + copy) → el objeto de variables
 * que consume la plantilla HyperFrames `compositions/trailer/`.
 *
 * Contrato (claves EXACTAS de compositions/trailer/meta.json):
 *   repoName, heroKind, heroValue, lang1, lang1Pct, lang2, lang2Pct,
 *   age, tagline, line1, line2, installCmd
 *
 * NO genera HTML; solo produce el JSON plano para
 *   `hyperframes render --variables '{...}'` / `--variables-file`.
 *
 * Todos los valores son string|number (aptos para serializar a --vars).
 */

import type { Beat } from '@/core/storyboard'
import type { Copy } from '@/core/copy'

// ─── Límites de truncado (legibilidad en móvil 9:16) ──────────────────────────

const MAX_REPO_NAME = 40
const MAX_TEXT = 80

// ─── Tipo de salida ───────────────────────────────────────────────────────────

export interface TrailerVars {
  repoName: string
  heroKind: string
  heroValue: string
  lang1: string
  lang1Pct: string
  lang2: string
  lang2Pct: string
  age: string
  tagline: string
  line1: string
  line2: string
  installCmd: string
}

// ─── Helpers puros ────────────────────────────────────────────────────────────

/** Recorta una cadena a `max` caracteres (sin sufijo "…": el espacio es oro). */
function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/** Coacciona un valor desconocido a string limpio. */
function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Coacciona un porcentaje (0-100) a string entero, o '' si no aplica. */
function pctToString(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return ''
  return String(Math.round(value))
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Produce el objeto de variables de la plantilla a partir del storyboard
 * (5 beats: hook, identity, momentum, proof, cta) y el copy de respaldo.
 *
 * Determinista: misma entrada → misma salida. Sin red ni IA.
 */
export function composeVars(storyboard: Beat[], copy: Copy): TrailerVars {
  const hook = storyboard.find((b) => b.tipo === 'hook')?.data ?? {}
  const identity = storyboard.find((b) => b.tipo === 'identity')?.data ?? {}
  const momentum = storyboard.find((b) => b.tipo === 'momentum')?.data ?? {}
  const cta = storyboard.find((b) => b.tipo === 'cta')?.data ?? {}

  // installCmd: prioriza el del copy; si no, el inferido en el beat cta; si no, ''.
  const installCmd = copy.installCmd ?? asString(cta['installCmd'])

  const lines = copy.lines ?? []

  return {
    repoName: truncate(asString(hook['repoName']), MAX_REPO_NAME),
    heroKind: asString(hook['heroKind']),
    heroValue: asString(hook['heroValue']),

    lang1: asString(identity['topLanguage']),
    lang1Pct: pctToString(identity['topLanguagePct']),
    lang2: asString(identity['secondLanguage']),
    lang2Pct: pctToString(identity['secondLanguagePct']),

    age: asString(momentum['age']),

    tagline: truncate(asString(copy.tagline), MAX_TEXT),
    line1: truncate(asString(lines[0]), MAX_TEXT),
    line2: truncate(asString(lines[1]), MAX_TEXT),

    installCmd: truncate(asString(installCmd), MAX_TEXT),
  }
}
