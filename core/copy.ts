import type { Beat, HeroKind } from '@/core/storyboard'

// ─── Tipo público ─────────────────────────────────────────────────────────────

export interface Copy {
  tagline: string
  lines: string[]
  installCmd?: string
}

// ─── Plantillas por heroKind ──────────────────────────────────────────────────

const taglineTemplates: Record<HeroKind, (repoName: string, lang: string, value: string) => string> = {
  stars: (repoName, lang, value) =>
    `${repoName} — ${value} estrellas de confianza · Hecho en ${lang}`,
  momentum: (repoName, lang, _value) =>
    `${repoName} — Momentum imparable · Construido en ${lang}`,
  fresh: (repoName, lang, value) =>
    `${repoName} — Recién lanzado en ${value} · Hecho en ${lang}`,
}

const linesTemplates: Record<HeroKind, (data: Record<string, unknown>) => string[]> = {
  stars: (data) => [
    `${data.heroValue as string} developers ya confían en él`,
    `Top lenguaje: ${data.topLanguage as string}`,
    `${data.forks as number} forks · ${data.contributorsCount as number} contribuidores`,
  ],
  momentum: (data) => [
    'Actividad en crecimiento semana a semana',
    `Top lenguaje: ${data.topLanguage as string}`,
    `${data.forks as number} forks · ${data.contributorsCount as number} contribuidores`,
  ],
  fresh: (data) => [
    `Lanzado en ${data.heroValue as string} · Todavía caliente`,
    `Construido con ${data.topLanguage as string}`,
    `${data.stars as number} estrellas y subiendo`,
  ],
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Construye copy de respaldo determinista a partir del storyboard.
 * No requiere IA ni red. Siempre devuelve tagline y lines no vacíos.
 *
 * @param storyboard - Array de beats generado por buildStoryboard
 * @param repoName - Nombre del repo (para el tagline)
 */
export function buildFallbackCopy(storyboard: Beat[], repoName: string): Copy {
  // Extraemos los datos de los beats relevantes
  const hook = storyboard.find((b) => b.tipo === 'hook')
  const identity = storyboard.find((b) => b.tipo === 'identity')
  const momentum = storyboard.find((b) => b.tipo === 'momentum')
  const cta = storyboard.find((b) => b.tipo === 'cta')

  const heroKind = (hook?.data.heroKind as HeroKind) ?? 'stars'
  const heroValue = (hook?.data.heroValue as string) ?? ''
  const topLanguage = (identity?.data.topLanguage as string) ?? 'código'

  // Tagline templado
  const taglineFn = taglineTemplates[heroKind]
  const tagline = taglineFn(repoName, topLanguage, heroValue)

  // Lines de contexto
  const linesFn = linesTemplates[heroKind]
  const templateData: Record<string, unknown> = {
    heroValue,
    topLanguage,
    forks: (momentum?.data.forks as number) ?? 0,
    contributorsCount: (momentum?.data.contributorsCount as number) ?? 0,
    stars: (hook?.data.stars as number) ?? 0,
  }
  const lines = linesFn(templateData)

  // installCmd desde beat cta
  const installCmd = cta?.data.installCmd as string | undefined

  return {
    tagline,
    lines,
    ...(installCmd !== undefined ? { installCmd } : {}),
  }
}
