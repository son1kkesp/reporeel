import { z } from 'zod'

export const RepoDataSchema = z.object({
  owner: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  latestRelease: z.string().nullable(),
  stars: z.number(),
  forks: z.number(),
  contributorsCount: z.number(),
  /** Porcentaje por lenguaje, valores 0-100 */
  languages: z.record(z.string(), z.number()),
  topics: z.array(z.string()),
  /** ISO 8601 */
  createdAt: z.string(),
  /** ISO 8601 */
  pushedAt: z.string(),
  topContributors: z.array(z.string()),
  /** Número de commits por semana, últimas 12 semanas */
  commitActivityLast12w: z.array(z.number()),
})

export type RepoData = z.infer<typeof RepoDataSchema>
