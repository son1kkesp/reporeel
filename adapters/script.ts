/**
 * adapters/script.ts
 *
 * Genera copy con IA (tagline + punchlines) para el tráiler.
 *
 * - generateCopy(storyboard, repo): llama a OpenRouter con REST directo
 *   y devuelve un Copy validado con Zod.
 * - Si la IA falla / cuelga / devuelve JSON inválido → cae en
 *   buildFallbackCopy(storyboard, repoName) del core (determinista).
 *
 * Lecciones aplicadas (Cronhaus Inbox bug):
 *   - NO usa AI SDK (bug BOM con undici/Next 16)
 *   - Usa fetch nativo + REST directo a OpenRouter
 *   - Sanitiza la API key con sanitizeKey() para eliminar BOM y espacios
 */

import { z } from 'zod'
import { buildFallbackCopy } from '@/core/copy'
import type { Beat } from '@/core/storyboard'
import type { RepoData } from '@/core/repo-data'
import type { Copy } from '@/core/copy'

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type { Copy }

// ─── Modelo configurable ──────────────────────────────────────────────────────

/**
 * Modelo barato y rápido en OpenRouter.
 * Configurable por env COPY_MODEL.
 * google/gemini-flash-1.5-8b es one of the cheapest fast models available.
 */
const DEFAULT_MODEL = 'google/gemini-flash-1.5-8b'

// ─── Schema Zod del Copy de respuesta IA ─────────────────────────────────────

const CopySchema = z.object({
  tagline: z.string().min(1),
  lines: z.array(z.string().min(1)).min(1).max(5),
  installCmd: z.string().optional(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Elimina el BOM UTF-8 (U+FEFF) y espacios de los extremos de la key.
 * Lección de Cronhaus Inbox: env vars leídas de ciertos entornos Windows
 * pueden incluir un BOM al inicio que rompe la autenticación.
 */
function sanitizeKey(raw: string): string {
  return raw.replace(/^﻿/, '').trim()
}

// ─── JSON Schema para response_format ────────────────────────────────────────

const copyJsonSchema = {
  type: 'object',
  properties: {
    tagline: {
      type: 'string',
      description:
        'Tagline del repo: una frase impactante de máximo 80 caracteres. NO inventes cifras; usa solo lo que hay en el contexto.',
    },
    lines: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 5,
      description:
        'Punchlines del tráiler: 2-3 frases cortas, impactantes. NO inventes cifras; coge los números del storyboard.',
    },
    installCmd: {
      type: 'string',
      description:
        'Comando de instalación si se proporcionó en el contexto. Omitir si no se conoce.',
    },
  },
  required: ['tagline', 'lines'],
  additionalProperties: false,
} as const

// ─── Construcción del prompt ──────────────────────────────────────────────────

function buildPrompt(storyboard: Beat[], repo: RepoData): string {
  const hook = storyboard.find((b) => b.tipo === 'hook')
  const identity = storyboard.find((b) => b.tipo === 'identity')
  const momentum = storyboard.find((b) => b.tipo === 'momentum')
  const proof = storyboard.find((b) => b.tipo === 'proof')
  const cta = storyboard.find((b) => b.tipo === 'cta')

  const contextLines = [
    `Repositorio: ${repo.owner}/${repo.name}`,
    repo.description ? `Descripción: ${repo.description}` : null,
    `Héroe: ${String(hook?.data.heroKind ?? '')} — valor: ${String(hook?.data.heroValue ?? '')}`,
    `Lenguaje principal: ${String(identity?.data.topLanguage ?? '')} (${String(identity?.data.topLanguagePct ?? '')}%)`,
    identity?.data.secondLanguage
      ? `Segundo lenguaje: ${String(identity.data.secondLanguage)} (${String(identity.data.secondLanguagePct)}%)`
      : null,
    `Topics: ${repo.topics.join(', ')}`,
    `Stars: ${repo.stars} · Forks: ${repo.forks} · Contribuidores: ${repo.contributorsCount}`,
    momentum?.data.age ? `Edad: ${String(momentum.data.age)}` : null,
    proof?.data.latestRelease ? `Último release: ${String(proof.data.latestRelease)}` : null,
    cta?.data.installCmd ? `Comando de instalación: ${String(cta.data.installCmd)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    'Eres un copywriter experto en trailers de software para redes sociales verticales (9:16).',
    'Tu objetivo es generar copy viral, claro y conciso para un tráiler de 15 segundos.',
    '',
    'REGLAS IMPORTANTES:',
    '- El tagline es una sola frase impactante (máximo 80 caracteres).',
    '- Las lines son 2-3 punchlines cortas (cada una máximo 80 caracteres).',
    '- NUNCA inventes cifras, stars, forks ni contribuidores. Usa SOLO los datos del contexto.',
    '- Si hay installCmd en el contexto, inclúyelo en installCmd. Si no, omite el campo.',
    '- Escribe en español.',
    '',
    'CONTEXTO DEL REPO:',
    contextLines,
  ].join('\n')
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Genera copy con IA para el repo.
 * Si falla (red, timeout, JSON inválido), cae en buildFallbackCopy().
 */
export async function generateCopy(storyboard: Beat[], repo: RepoData): Promise<Copy> {
  const rawKey = process.env['OPENROUTER_API_KEY'] ?? ''
  const apiKey = sanitizeKey(rawKey)

  if (!apiKey) {
    // Sin key → fallback inmediato (también cubre tests sin env)
    return buildFallbackCopy(storyboard, repo.name)
  }

  const model = sanitizeKey(process.env['COPY_MODEL'] ?? '') || DEFAULT_MODEL
  const prompt = buildPrompt(storyboard, repo)

  try {
    const response = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/reporeel',
          'X-Title': 'RepoReel',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'repo_copy',
              strict: true,
              schema: copyJsonSchema,
            },
          },
          temperature: 0.7,
          max_tokens: 400,
        }),
      },
      15_000, // 15 s timeout
    )

    if (!response.ok) {
      throw new Error(`OpenRouter HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const raw = data.choices?.[0]?.message?.content
    if (!raw) throw new Error('Respuesta vacía de OpenRouter')

    const parsed = JSON.parse(raw) as unknown
    const copy = CopySchema.parse(parsed)

    // installCmd: si la IA no la devolvió, intentamos sacarla del storyboard
    if (!copy.installCmd) {
      const ctaInstall = storyboard.find((b) => b.tipo === 'cta')?.data.installCmd
      if (typeof ctaInstall === 'string' && ctaInstall.length > 0) {
        return { ...copy, installCmd: ctaInstall }
      }
    }

    return copy
  } catch {
    // Cualquier error (red, timeout, parse, validación) → fallback determinista
    return buildFallbackCopy(storyboard, repo.name)
  }
}

// ─── Utilidad: fetch con timeout ──────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
