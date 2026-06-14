/**
 * scripts/seed-gallery.ts
 *
 * Siembra la galería de RepoReel con una lista curada de repos famosos.
 *
 * CÓMO EJECUTAR
 *   pnpm seed
 *   SEED_BASE_URL=https://reporeel.cronhaus.dev pnpm seed
 *
 * VARIABLES DE ENTORNO REQUERIDAS
 *   BLOB_READ_WRITE_TOKEN  — token de Vercel Blob (cogido de .env.local
 *                            automáticamente por tsx/dotenv si está presente,
 *                            o pasado explícitamente).
 *   SEED_BASE_URL          — base URL de la app (default: https://reporeel.cronhaus.dev).
 *
 * COMPORTAMIENTO
 *   - Procesa repos en lotes de 3 (máx. renders concurrentes de la app).
 *   - Si la respuesta de /api/generate ya es `ready`, cuenta como hecho (idempotente).
 *   - Si recibe 503 (sin slots), espera RETRY_WAIT_MS y reintenta el repo (hasta MAX_503_RETRIES veces).
 *   - Sondea /api/status cada POLL_INTERVAL_MS hasta `ready` o `error` (timeout POLL_TIMEOUT_MS/repo).
 *   - Al terminar escribe gallery-index.json en Vercel Blob solo con los repos `ready`.
 *   - Errores por repo no abortan el resto del lote.
 */

import { put } from '@vercel/blob'

// ─── Configuración ──────────────────────────────────────────────────────────────

const BASE_URL =
  process.env['SEED_BASE_URL']?.replace(/\/$/, '') ??
  'https://reporeel.cronhaus.dev'

const BATCH_SIZE = 3 // máx. renders concurrentes que acepta la app
const POLL_INTERVAL_MS = 15_000 // 15 s entre sondeos de status
const POLL_TIMEOUT_MS = 4 * 60_000 // 4 min por repo
const RETRY_WAIT_MS = 30_000 // espera tras 503 (sin slot disponible)
const MAX_503_RETRIES = 5 // reintentos máx. por repo ante 503

// ─── Lista curada de repos ─────────────────────────────────────────────────────

interface Repo {
  owner: string
  repo: string
}

const REPOS: Repo[] = [
  { owner: 'facebook', repo: 'react' },
  { owner: 'vuejs', repo: 'core' },
  { owner: 'sveltejs', repo: 'svelte' },
  { owner: 'vercel', repo: 'next.js' },
  { owner: 'oven-sh', repo: 'bun' },
  { owner: 'denoland', repo: 'deno' },
  { owner: 'microsoft', repo: 'vscode' },
  { owner: 'rust-lang', repo: 'rust' },
  { owner: 'golang', repo: 'go' },
  { owner: 'tailwindlabs', repo: 'tailwindcss' },
  { owner: 'ollama', repo: 'ollama' },
  { owner: 'nodejs', repo: 'node' },
]

// ─── Tipos de respuesta de la API ──────────────────────────────────────────────

interface GenerateResponse {
  jobId?: string
  status: 'ready' | 'rendering' | 'error'
  url?: string
  poster?: string
  error?: string
}

interface StatusResponse {
  status: 'ready' | 'rendering' | 'error'
  url?: string
  poster?: string
  error?: string
}

// ─── Lógica principal ──────────────────────────────────────────────────────────

async function triggerRender(
  repo: Repo,
  attempt = 0,
): Promise<GenerateResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: repo.owner, repo: repo.repo }),
    })

    if (res.status === 429) {
      console.warn(
        `[seed] ${repo.owner}/${repo.repo} — rate-limited (429). Saltando.`,
      )
      return null
    }

    if (res.status === 503) {
      if (attempt >= MAX_503_RETRIES) {
        console.warn(
          `[seed] ${repo.owner}/${repo.repo} — sin slots tras ${MAX_503_RETRIES} reintentos. Saltando.`,
        )
        return null
      }
      console.log(
        `[seed] ${repo.owner}/${repo.repo} — sin slots (503), esperando ${RETRY_WAIT_MS / 1000}s… (intento ${attempt + 1}/${MAX_503_RETRIES})`,
      )
      await sleep(RETRY_WAIT_MS)
      return triggerRender(repo, attempt + 1)
    }

    if (!res.ok) {
      console.warn(
        `[seed] ${repo.owner}/${repo.repo} — POST /api/generate devolvió ${res.status}`,
      )
      return null
    }

    return (await res.json()) as GenerateResponse
  } catch (err) {
    console.warn(
      `[seed] ${repo.owner}/${repo.repo} — error en POST /api/generate:`,
      err,
    )
    return null
  }
}

async function pollUntilReady(jobId: string, label: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)

    let status: StatusResponse
    try {
      const res = await fetch(
        `${BASE_URL}/api/status?jobId=${encodeURIComponent(jobId)}`,
      )
      if (!res.ok) {
        console.warn(
          `[seed] ${label} — GET /api/status devolvió ${res.status}`,
        )
        continue
      }
      status = (await res.json()) as StatusResponse
    } catch (err) {
      console.warn(`[seed] ${label} — error en GET /api/status:`, err)
      continue
    }

    if (status.status === 'ready') {
      return true
    }
    if (status.status === 'error') {
      console.warn(`[seed] ${label} — render fallido: ${status.error ?? '(sin detalle)'}`)
      return false
    }

    // status === 'rendering' → seguimos sondeando
    const remaining = Math.round((deadline - Date.now()) / 1000)
    console.log(`[seed] ${label} — renderizando… (${remaining}s restantes)`)
  }

  console.warn(`[seed] ${label} — timeout de ${POLL_TIMEOUT_MS / 1000}s agotado`)
  return false
}

async function processRepo(repo: Repo): Promise<boolean> {
  const label = `${repo.owner}/${repo.repo}`

  let generate: GenerateResponse | null
  try {
    generate = await triggerRender(repo)
  } catch (err) {
    console.warn(`[seed] ${label} — error inesperado:`, err)
    return false
  }

  if (generate === null) return false

  // Idempotente: ya estaba listo (caché hit)
  if (generate.status === 'ready') {
    console.log(`[seed] ${label} ✓ (cacheado)`)
    return true
  }

  if (generate.status === 'error') {
    console.warn(
      `[seed] ${label} — error inmediato: ${generate.error ?? '(sin detalle)'}`,
    )
    return false
  }

  // status === 'rendering'
  if (!generate.jobId) {
    console.warn(`[seed] ${label} — rendering pero sin jobId. Saltando.`)
    return false
  }

  const ok = await pollUntilReady(generate.jobId, label)
  if (ok) {
    console.log(`[seed] ${label} ✓`)
  }
  return ok
}

async function processBatch(batch: Repo[]): Promise<Repo[]> {
  const results = await Promise.allSettled(batch.map(processRepo))
  const ready: Repo[] = []
  for (let i = 0; i < batch.length; i++) {
    const result = results[i]
    if (result && result.status === 'fulfilled' && result.value) {
      const repo = batch[i]
      if (repo) ready.push(repo)
    }
  }
  return ready
}

async function writeGalleryIndex(items: Repo[]): Promise<void> {
  const payload = JSON.stringify({ items }, null, 2)
  await put('gallery-index.json', payload, {
    access: 'public',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
  })
  console.log(`[seed] gallery-index.json escrito en Vercel Blob (${items.length} repos).`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  if (!process.env['BLOB_READ_WRITE_TOKEN']) {
    console.error(
      '[seed] ERROR: BLOB_READ_WRITE_TOKEN no está definido.\n' +
        '       Asegúrate de tener .env.local con BLOB_READ_WRITE_TOKEN=<token>.',
    )
    process.exit(1)
  }

  console.log(`[seed] Base URL: ${BASE_URL}`)
  console.log(`[seed] Repos a sembrar: ${REPOS.length} (lotes de ${BATCH_SIZE})`)
  console.log()

  const readyRepos: Repo[] = []

  for (let i = 0; i < REPOS.length; i += BATCH_SIZE) {
    const batch = REPOS.slice(i, i + BATCH_SIZE)
    const batchLabel = batch.map((r) => `${r.owner}/${r.repo}`).join(', ')
    console.log(
      `[seed] Lote ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(REPOS.length / BATCH_SIZE)}: ${batchLabel}`,
    )

    const batchReady = await processBatch(batch)
    readyRepos.push(...batchReady)
    console.log()
  }

  // Resumen
  const failed = REPOS.length - readyRepos.length
  console.log(`[seed] ── Resumen ─────────────────────────────────────`)
  console.log(`[seed]   OK:       ${readyRepos.length}/${REPOS.length}`)
  console.log(`[seed]   Fallidos: ${failed}`)
  if (failed > 0) {
    const failedRepos = REPOS.filter(
      (r) => !readyRepos.some((ok) => ok.owner === r.owner && ok.repo === r.repo),
    )
    for (const r of failedRepos) {
      console.log(`[seed]     ✗ ${r.owner}/${r.repo}`)
    }
  }
  console.log()

  if (readyRepos.length === 0) {
    console.warn('[seed] Ningún repo listo. No se escribe gallery-index.json.')
    process.exit(1)
  }

  await writeGalleryIndex(readyRepos)
  console.log('[seed] ¡Galería sembrada con éxito!')
}

main().catch((err: unknown) => {
  console.error('[seed] Error fatal:', err)
  process.exit(1)
})
