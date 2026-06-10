import type { RepoData } from '@/core/repo-data'

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type HeroKind = 'stars' | 'momentum' | 'fresh'

export type BeatTipo = 'hook' | 'identity' | 'momentum' | 'proof' | 'cta'

export interface Beat {
  tipo: BeatTipo
  data: Record<string, unknown>
}

// ─── Helpers puros ────────────────────────────────────────────────────────────

/**
 * Formatea un número de estrellas en formato compacto.
 * Ejemplos: 42 → "42", 1200 → "1.2k", 220000 → "220k", 1100000 → "1.1M"
 */
export function formatStars(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `${parseFloat(v.toFixed(1))}M`
  }
  if (n >= 1_000) {
    const v = n / 1_000
    return `${parseFloat(v.toFixed(1))}k`
  }
  return String(n)
}

export interface LangEntry {
  name: string
  pct: number
}

/**
 * Devuelve los lenguajes ordenados de mayor a menor porcentaje.
 */
export function topLanguages(languages: Record<string, number>): LangEntry[] {
  return Object.entries(languages)
    .map(([name, pct]) => ({ name, pct }))
    .sort((a, b) => b.pct - a.pct)
}

// ─── Selección de héroe ───────────────────────────────────────────────────────

/**
 * Determina el "heroKind" según las características del repo.
 *
 * DECISIÓN DE DETERMINISMO:
 * No usamos Date.now() en ningún lugar de este módulo.
 * Para la comparación de novedad (repo "fresh"), usamos `pushedAt` como fecha
 * de referencia "ahora", calculando el delta en días entre `createdAt` y
 * `pushedAt`. Si ese delta < 90 días, el repo se considera "fresh".
 * Esto garantiza resultados 100% deterministas independientemente de cuándo
 * se ejecute el código.
 */
function selectHeroKind(repo: RepoData): { heroKind: HeroKind; heroValue: string } {
  // Prioridad 1: estrellas altas
  if (repo.stars > 5000) {
    return { heroKind: 'stars', heroValue: formatStars(repo.stars) }
  }

  // Prioridad 2: tendencia creciente en commits (últimas 4 semanas > primeras 4)
  const activity = repo.commitActivityLast12w
  const first4 = activity.slice(0, 4).reduce((a, b) => a + b, 0)
  const last4 = activity.slice(-4).reduce((a, b) => a + b, 0)
  if (last4 > first4) {
    return { heroKind: 'momentum', heroValue: `+${last4 - first4}` }
  }

  // Prioridad 3: repo nuevo (createdAt y pushedAt con < 90 días de diferencia)
  const createdMs = new Date(repo.createdAt).getTime()
  const pushedMs = new Date(repo.pushedAt).getTime()
  const diffDays = (pushedMs - createdMs) / (1000 * 60 * 60 * 24)
  if (diffDays < 90) {
    const year = new Date(repo.createdAt).getFullYear()
    return { heroKind: 'fresh', heroValue: String(year) }
  }

  // Fallback: stars por defecto
  return { heroKind: 'stars', heroValue: formatStars(repo.stars) }
}

// ─── Construcción del storyboard ──────────────────────────────────────────────

/**
 * Construye un storyboard de 5 beats fijos: hook, identity, momentum, proof, cta.
 * Los datos derivados se calculan de forma determinista a partir del RepoData.
 *
 * DECISIÓN DE DETERMINISMO (fechas):
 * - La "edad" del repo se expresa como año de creación ("vivo desde 20XX"),
 *   calculado directamente desde createdAt (sin Date.now()).
 * - La novedad ("fresh") compara createdAt con pushedAt (ver selectHeroKind).
 * - installCmd se infiere de latestRelease o topics, sin red ni IA.
 */
export function buildStoryboard(repo: RepoData): Beat[] {
  const { heroKind, heroValue } = selectHeroKind(repo)
  const langs = topLanguages(repo.languages)
  const topLang = langs[0] ?? { name: 'código', pct: 0 }
  const secondLang = langs[1] ?? null

  const createdYear = new Date(repo.createdAt).getFullYear()
  const age = `vivo desde ${createdYear}`

  // installCmd: si hay latestRelease lo usamos, si no buscamos en topics
  const installCmd = inferInstallCmd(repo)

  return [
    {
      tipo: 'hook',
      data: {
        heroKind,
        heroValue,
        repoName: repo.name,
        owner: repo.owner,
      },
    },
    {
      tipo: 'identity',
      data: {
        topLanguage: topLang.name,
        topLanguagePct: topLang.pct,
        secondLanguage: secondLang?.name ?? null,
        secondLanguagePct: secondLang?.pct ?? null,
        topics: repo.topics,
        description: repo.description,
      },
    },
    {
      tipo: 'momentum',
      data: {
        commitActivityLast12w: repo.commitActivityLast12w,
        forks: repo.forks,
        contributorsCount: repo.contributorsCount,
        age,
      },
    },
    {
      tipo: 'proof',
      data: {
        stars: repo.stars,
        topContributors: repo.topContributors,
        latestRelease: repo.latestRelease,
      },
    },
    {
      tipo: 'cta',
      data: {
        repoName: repo.name,
        owner: repo.owner,
        installCmd,
      },
    },
  ]
}

// ─── Inferencia de installCmd ─────────────────────────────────────────────────

/**
 * Infiere un comando de instalación candidato a partir de latestRelease o topics.
 * Devuelve undefined si no hay suficiente información.
 */
function inferInstallCmd(repo: RepoData): string | undefined {
  if (repo.latestRelease) {
    // Si hay release, asumimos que se puede instalar vía npm o pip según topics
    if (repo.topics.some((t) => ['npm', 'nodejs', 'javascript', 'typescript'].includes(t))) {
      return `npm install ${repo.name}@${repo.latestRelease}`
    }
    if (repo.topics.some((t) => ['python', 'pip', 'pypi'].includes(t))) {
      return `pip install ${repo.name}`
    }
    // Genérico
    return `# ${repo.name} ${repo.latestRelease}`
  }

  if (repo.topics.includes('npm')) {
    return `npm install ${repo.name}`
  }
  if (repo.topics.includes('pip') || repo.topics.includes('pypi')) {
    return `pip install ${repo.name}`
  }

  return undefined
}
