/**
 * adapters/github.ts
 *
 * Dos responsabilidades:
 *   1. mapRepoData(raw)  — función PURA: transforma respuestas crudas de la
 *      GitHub REST API en un objeto RepoData validado con RepoDataSchema.
 *   2. fetchRepoData(owner, repo) — función con red: orquesta las llamadas
 *      paralelas a Octokit y delega la transformación a mapRepoData.
 *
 * Endpoints usados:
 *   GET /repos/{owner}/{repo}
 *   GET /repos/{owner}/{repo}/languages
 *   GET /repos/{owner}/{repo}/contributors?per_page=1&anon=false  (solo header Link)
 *   GET /repos/{owner}/{repo}/stats/commit_activity  (52 semanas, tomamos las últimas 12)
 *   GET /repos/{owner}/{repo}/releases/latest
 *   GET /repos/{owner}/{repo}/topics
 */

import { Octokit } from '@octokit/rest'
import { RepoDataSchema, type RepoData } from '@/core/repo-data'

// ─── Tipos para el payload crudo ────────────────────────────────────────────

export interface RawGitHubPayload {
  repo: {
    owner: { login: string }
    name: string
    description: string | null | undefined
    created_at: string
    pushed_at: string
    stargazers_count: number
    forks_count: number
  }
  /** bytes por lenguaje, tal como devuelve GET /repos/{o}/{r}/languages */
  languages: Record<string, number>
  /** valor del header Link de la petición de contributors con per_page=1 */
  contributorsLinkHeader: string | null
  /** logins de los primeros contribuidores (GET /contributors?per_page=5) */
  topContributors: string[]
  /** array de 52 objetos { total: number } de GET /stats/commit_activity */
  commitActivity: Array<{ total: number; [k: string]: unknown }>
  /** tag_name del último release, o null */
  latestRelease: { tag_name: string } | null
  /** array de topic strings de GET /topics */
  topics: string[]
}

// ─── Errores de dominio ──────────────────────────────────────────────────────

export class RepoNotFoundError extends Error {
  constructor(owner: string, repo: string) {
    super(`Repositorio no encontrado: ${owner}/${repo}`)
    this.name = 'RepoNotFoundError'
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super('GitHub API rate limit alcanzado. Espera y vuelve a intentarlo.')
    this.name = 'RateLimitedError'
  }
}

// ─── Helpers puros ───────────────────────────────────────────────────────────

/**
 * Extrae el número de la última página del header Link de GitHub.
 * GitHub usa per_page=1 → la página "last" = número total de contribuidores.
 * Devuelve 1 si el header es null/vacío (repo con un único contribuidor
 * o ninguno, porque GitHub omite el header en ese caso).
 */
export function parseLinkHeaderLastPage(linkHeader: string | null | undefined): number {
  if (!linkHeader) return 1
  // Busca: rel="last" precedido de ?page=N o &page=N en la URL
  const match = linkHeader.match(/[?&]page=(\d+)>[^>]*rel="last"/)
  if (!match || !match[1]) return 1
  const parsed = parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

/**
 * Convierte bytes por lenguaje → porcentajes redondeados a 2 decimales.
 * Si el total es 0 devuelve el objeto vacío.
 */
function languageBytesToPct(bytes: Record<string, number>): Record<string, number> {
  const total = Object.values(bytes).reduce((s, n) => s + n, 0)
  if (total === 0) return {}
  return Object.fromEntries(
    Object.entries(bytes).map(([lang, b]) => [lang, Math.round((b / total) * 10000) / 100]),
  )
}

/**
 * Dado el array de 52 semanas de commit_activity, devuelve las últimas 12.
 * Si el array tiene menos de 12 elementos se rellena con ceros por la izquierda.
 */
function last12Weeks(activity: Array<{ total: number }>): number[] {
  const totals = activity.map((w) => w.total)
  const last12 = totals.slice(-12)
  // rellenar si vinieron menos de 12 (p.ej. repo muy nuevo o API devolvió [])
  while (last12.length < 12) last12.unshift(0)
  return last12
}

// ─── Función pura principal ───────────────────────────────────────────────────

export function mapRepoData(raw: RawGitHubPayload): RepoData {
  const languages = languageBytesToPct(raw.languages)
  const commitActivityLast12w = last12Weeks(raw.commitActivity)
  const contributorsCount = parseLinkHeaderLastPage(raw.contributorsLinkHeader)

  const data = {
    owner: raw.repo.owner.login,
    name: raw.repo.name,
    description: raw.repo.description ?? null,
    latestRelease: raw.latestRelease?.tag_name ?? null,
    stars: raw.repo.stargazers_count,
    forks: raw.repo.forks_count,
    contributorsCount,
    languages,
    topics: raw.topics,
    createdAt: raw.repo.created_at,
    pushedAt: raw.repo.pushed_at,
    topContributors: raw.topContributors,
    commitActivityLast12w,
  }

  return RepoDataSchema.parse(data)
}

// ─── Función con red ─────────────────────────────────────────────────────────

/**
 * Sanea el token de GitHub. Vercel a veces inyecta un BOM (U+FEFF) en las env
 * vars; un BOM en el valor rompe la cabecera Authorization de fetch/undici con
 * "Cannot convert argument to a ByteString". Quitamos BOM/zero-width + espacios;
 * si queda vacío devolvemos undefined → Octokit funciona sin autenticar (repos
 * públicos, con rate-limit más bajo).
 */
function sanitizeToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const cp = ch.codePointAt(0)
      return cp !== 0xfeff && cp !== 0x200b // BOM y zero-width space
    })
    .join('')
    .trim()
  return cleaned.length > 0 ? cleaned : undefined
}

function createOctokit(): Octokit {
  return new Octokit({
    auth: sanitizeToken(process.env['GITHUB_TOKEN']),
  })
}

/**
 * Obtiene datos de un repositorio público (o privado con token adecuado).
 * Lanza RepoNotFoundError en 404, RateLimitedError en 403/429.
 */
export async function fetchRepoData(owner: string, repo: string): Promise<RepoData> {
  const octokit = createOctokit()

  // Petición 1: repositorio base (necesaria antes de las demás para fallar rápido)
  let repoData: Awaited<ReturnType<typeof octokit.repos.get>>['data']
  try {
    const response = await octokit.repos.get({ owner, repo })
    repoData = response.data
  } catch (err: unknown) {
    if (isOctokitHttpError(err, 404)) throw new RepoNotFoundError(owner, repo)
    if (isOctokitHttpError(err, 403) || isOctokitHttpError(err, 429)) throw new RateLimitedError()
    throw err
  }

  // Peticiones 2-6 en paralelo
  const [languagesRes, contributorsRes, commitActivityRes, latestReleaseRes, topicsRes] =
    await Promise.allSettled([
      octokit.repos.listLanguages({ owner, repo }),
      // per_page=1 para que GitHub incluya el Link header con la última página = total
      octokit.repos.listContributors({ owner, repo, per_page: 1, anon: 'false' }),
      octokit.repos.getCommitActivityStats({ owner, repo }),
      octokit.repos.getLatestRelease({ owner, repo }),
      octokit.repos.getAllTopics({ owner, repo }),
    ])

  // Lenguajes (bytes)
  const languages =
    languagesRes.status === 'fulfilled' ? (languagesRes.value.data as Record<string, number>) : {}

  // contributorsCount vía Link header
  let contributorsLinkHeader: string | null = null
  if (contributorsRes.status === 'fulfilled') {
    const linkRaw = contributorsRes.value.headers['link']
    contributorsLinkHeader = typeof linkRaw === 'string' ? linkRaw : null
  }

  // topContributors: hacemos una segunda petición con per_page=5
  let topContributors: string[] = []
  try {
    const top5Res = await octokit.repos.listContributors({ owner, repo, per_page: 5, anon: 'false' })
    topContributors = top5Res.data
      .filter((c): c is typeof c & { login: string } => typeof c.login === 'string')
      .map((c) => c.login)
  } catch {
    // tolerable: topContributors puede ser vacío
  }

  // commitActivity (52 semanas)
  type CommitWeek = { total: number; week: number; days: number[] }
  let commitActivity: CommitWeek[] = []
  if (commitActivityRes.status === 'fulfilled') {
    const raw = commitActivityRes.value.data
    // la API puede devolver 202 (calculando) → data puede ser vacío
    if (Array.isArray(raw)) {
      commitActivity = raw as CommitWeek[]
    }
  }

  // latestRelease
  let latestRelease: { tag_name: string } | null = null
  if (latestReleaseRes.status === 'fulfilled') {
    latestRelease = { tag_name: latestReleaseRes.value.data.tag_name }
  }

  // topics
  let topics: string[] = []
  if (topicsRes.status === 'fulfilled') {
    topics = topicsRes.value.data.names ?? []
  }

  const raw: RawGitHubPayload = {
    repo: {
      owner: { login: repoData.owner?.login ?? owner },
      name: repoData.name,
      description: repoData.description,
      created_at: repoData.created_at,
      pushed_at: repoData.pushed_at,
      stargazers_count: repoData.stargazers_count,
      forks_count: repoData.forks_count,
    },
    languages,
    contributorsLinkHeader,
    topContributors,
    commitActivity,
    latestRelease,
    topics,
  }

  return mapRepoData(raw)
}

// ─── Utilidad interna ────────────────────────────────────────────────────────

function isOctokitHttpError(err: unknown, status: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status: number }).status === status
  )
}
