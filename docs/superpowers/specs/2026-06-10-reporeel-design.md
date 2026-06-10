# RepoReel — Spec de diseño

> **Estado:** v1.1 (revisado) · **Fecha:** 2026-06-10 · **Autor:** Iván Barrera (Cronhaus) con Claude
> **v1.1 — tras revisión adversaria:** contrato del job async + estado en Blob; contrato `compose`↔HyperFrames vía variables; criterio de "done" de la plantilla; generación del poster `og:image`; timeout + semáforo de concurrencia; contrato de mocks en tests; nota de audio; índice de galería. *(Next.js 16 es correcto — confirmado y desplegado en Cronhaus Inbox; el revisor lo marcó por conocimiento desactualizado.)*
> **Tipo:** proyecto-escaparate (showcase) nº 2 de Cronhaus — el del **gancho viral**
> **Dominio:** `reporeel.cronhaus.dev` (subdominio del laboratorio Cronhaus) · repo OSS público

---

## 1. Propósito

**RepoReel** convierte un repo de GitHub en un **tráiler vertical (9:16) en MP4** de un clic: pegas `owner/repo` y obtienes un vídeo cinematográfico de ese proyecto —su héroe (★), lenguajes, ritmo de commits, contribuidores, release— montado con **HyperFrames** y con copy generado por IA.

Es el **showcase #2 de Cronhaus**, diseñado para **viralidad en TikTok/Reels/Shorts** y para atraer atención (clientes/empleo) al estudio. Cada vídeo lleva marca de agua `reporeel.cronhaus.dev · by Cronhaus`, así que **cada compartición es marketing gratis de Cronhaus**.

**Diferencial (hueco verificado):** NO es "capturar la web del repo" (eso ya lo hace el skill `website-to-hyperframes` de HeyGen). Es **curaduría de datos reales de la GitHub API + formato tráiler vertical + bucle viral de compartición**.

## 2. Objetivos y criterios de éxito

- **Wow instantáneo (<5 s):** la landing reproduce una **galería de tráileres pre-renderizados** de repos famosos → impresiona al entrar, coste cero, sin espera.
- **Un clic:** pega un repo → tráiler. Sin registro.
- **Bucle viral:** marca de agua + **OG card que auto-previsualiza el vídeo** en redes → quien comparte trae gente.
- **Código ejemplar:** público; resiste la lectura de un dev senior (arquitectura, tests).
- **Acotado:** v1 construible por una persona en semanas.
- **Vanguardia sólida:** HyperFrames + Vercel, verificado con context7.

**Señales de éxito:** (a) alguien comparte el reel de un repo y otros vuelven a hacer el suyo; (b) un dev lee el repo y respeta la ingeniería; (c) tráfico/atención a Cronhaus.

## 3. No-objetivos (v1)

- Solo **vertical 9:16** (16:9 y 1:1 → v2).
- Solo **repos públicos** (sin auth de usuario).
- Sin **temas/música/voz a elección** (v1 sin voiceover; texto cinético). *Nota honesta: TikTok/Reels penalizan el vídeo muteado en su algoritmo; se acepta para simplificar la v1, pero **evaluar música royalty-free en v1.5** — puede ser determinante para el alcance.*
- Sin **edición** del tráiler (es auto-generado; una plantilla excelente).
- Sin **GitHub Action `release → trailer`** (v2).
- Sin cuentas ni base de datos de usuarios.

## 4. Audiencia

1. **Cualquiera en TikTok/Reels/Shorts** (dev y no-dev) que ve un reel compartido → el hook NO puede asumir que es dev.
2. **Devs/mantenedores** que generan el reel de su repo.
3. **Reclutadores/clientes** que leen el repo público → Cronhaus.

## 5. Experiencia de usuario

1. **Landing:** hero + **galería de reels pre-renderizados** de ~12 repos trending (react, vue, bun, deno…) en autoplay (muteado, loop). Input central: *"Pega un repo de GitHub"*.
2. **Generar:** envías `owner/repo` →
   - **Cacheado** (`owner/repo@hoy`) → se sirve el MP4 al instante.
   - **Fresco** → trabajo asíncrono con UX de progreso (*"Renderizando tu tráiler… ~30 s"*); poll de estado.
3. **Resultado** (`/r/owner/repo`): el MP4 vertical en loop + **descargar** + **compartir** (copia enlace con OG card) + CTA *"haz el de tu repo"*. La marca de agua va **incrustada en el vídeo**.
4. **Compartir:** el enlace `/r/owner/repo` tiene meta OG (`og:video` + `og:image` de poster) para auto-previsualizar en X/LinkedIn/TikTok.

## 6. Arquitectura (hexagonal)

```
reporeel/
├── core/                 # Dominio puro — sin red, IA ni framework
│   ├── repo-data.ts      # Tipos + esquema Zod de los datos del repo
│   ├── storyboard.ts     # buildStoryboard(repoData) → Beat[] (selección de beats, héroe, derivados). PURO, determinista.
│   └── copy.ts           # Tipos de Copy (tagline, lines, installCmd) + fallback determinista
├── adapters/
│   ├── github.ts         # owner/repo → RepoData (GitHub REST, token de servidor)
│   ├── script.ts         # storyboard+repoData → Copy (IA barata vía OpenRouter); mockable; con fallback
│   ├── compose.ts        # storyboard+copy → composición HyperFrames 9:16 (HTML + variables)
│   ├── render.ts         # composición → MP4 (Vercel Sandbox) → Vercel Blob → URL
│   └── cache.ts          # owner/repo@día → {mp4Url, poster, meta} (Blob + índice)
├── app/                  # Next.js (landing, galería, API, páginas /r, OG)
├── compositions/         # plantilla del tráiler (escenas HTML 1080×1920) + GSAP vendorizado
├── scripts/seed-gallery.ts  # render one-off de ~12 repos famosos para la galería
└── docs/superpowers/
```

**Regla de oro:** `core/` no importa de `adapters/` ni `app/`. `storyboard.ts` es **puro y testeable al 100%** sin red ni IA (selecciona qué stat es el héroe, ordena beats, calcula derivados como "X★", "Y% TypeScript"). La IA solo escribe **copy corto** (tagline/punchlines), nunca cifras.

## 7. Componentes

| Componente | Responsabilidad | Depende de |
|---|---|---|
| `core/storyboard` | repoData → beats ordenados + héroe. Puro. | nada |
| `core/copy` | tipos + fallback determinista de copy | nada |
| `adapters/github` | owner/repo → `RepoData` (REST) | GitHub API + token |
| `adapters/script` | storyboard → `Copy` (IA); **fallback** a `core/copy` si falla | OpenRouter |
| `adapters/compose` | storyboard+copy → HTML de composición 9:16 | core |
| `adapters/render` | composición → MP4 en Blob | HyperFrames, Vercel Sandbox, Blob |
| `adapters/cache` | índice `owner/repo@día` → MP4 | Blob |
| `app` (API) | `/api/generate` (async job), `/api/status` | adapters |
| `app` (UI) | landing+galería, `/r/owner/repo` con OG, watermark | core, cache |

## 8. Pipeline de render (el núcleo, basado en `hyperframes-vercel-template`)

Base = la plantilla oficial de Vercel (Next.js + **Vercel Sandbox** + **Vercel Blob**), adaptada para componer la HTML **dinámicamente** desde los datos del repo:

`POST /api/generate {owner/repo}` → `cache.get(owner/repo@hoy)` →
- **hit** → devuelve `{status:'ready', url}`.
- **miss** → encola job: `github.fetch` → `core.buildStoryboard` → `script.generate` (IA, con fallback) → `compose` (HTML 9:16) → `render` en Vercel Sandbox (`hyperframes render --workers auto`) → subir MP4 a Blob → `cache.set` → `{status:'ready', url}`. Devuelve `jobId` y se hace **poll** en `/api/status`.

**Galería sembrada:** `scripts/seed-gallery.ts` renderiza ~12 repos famosos una vez → MP4 en Blob + entradas de caché. La landing los sirve al instante (wow + siembra + SEO).

**Contrato del job async (decidido):** `jobId` = la clave de caché `owner/repo/YYYY-MM-DD`. El estado vive en **Vercel Blob** (`jobs/<jobId>.json` = `{ status:'rendering'|'ready'|'error', url?, poster?, error?, updatedAt }`), NUNCA en memoria (las funciones serverless son efímeras entre invocaciones; un poll a otra instancia perdería el estado). `/api/generate` escribe `rendering` y lanza el render; al terminar escribe `ready`+`url`+`poster`. `/api/status?jobId=` lee el JSON de Blob. Idempotente: dos peticiones del mismo repo/día comparten jobId.

**Contrato `compose` ↔ HyperFrames (decidido):** NO se genera HTML desde cero. Hay una **plantilla fija** en `compositions/trailer/` que usa el **sistema de variables de HyperFrames** (`data-composition-variables` + slots `{{...}}`, patrón `variables-launch` de la biblia). `compose.ts` solo construye el **JSON de variables** (`{ repoName, heroStat, lang1, lang1Pct, tagline, line1, installCmd, … }`) desde `storyboard+copy`; el render hace `hyperframes render --vars '<json>'`. Así la pieza creativa (plantilla) y la lógica (datos) quedan **desacopladas y testeables** por separado.

**Poster para OG (decidido):** en el step de render, tras el MP4, se extrae un **frame representativo con ffmpeg** (el del beat de identidad, ~3 s) → `<jobId>-poster.jpg` en Blob. La página `/r` emite `og:video` + `og:image`=poster (X/LinkedIn a menudo ignoran `og:video` → el **poster ES el OG efectivo**).

**Índice de galería:** `seed-gallery.ts` escribe `gallery-index.json` en Blob (lista de `{ "owner/repo", mp4Url, poster }`); la landing lo lee con ISR → añadir un repo a la galería NO requiere redeploy de código.

## 9. Controles de coste/abuso (igual de importantes que en Cronhaus Inbox)

- **Caché por `owner/repo@día`:** un repo popular = máx. 1 render/día. La mayoría del tráfico ("prueba react") es caché → coste 0.
- **Rate-limit** de renders frescos por IP/sesión (p. ej. **3 / 10 min**) → 429 con mensaje.
- **Token de servidor** para GitHub API (rate limits; solo repos públicos).
- Coste por render fresco ~$0.02-0.10 (Vercel Sandbox). **Escape hatch documentado:** si explota de verdad, migrar el worker de render a Cloudflare (~10× más barato) — fuera de v1.
- **Timeout + concurrencia:** cada render con **timeout de 90 s** (aborto + error elegante). **Semáforo global de máx. 3 renders concurrentes** → al superarse, `503` "vuelve en un momento" (protege el coste aunque el atacante use varias IPs, que saltearían el rate-limit por-IP). Requiere **plan Vercel Pro** (Sandbox: 5 h y 2000 concurrentes; nos auto-limitamos a 3).

## 10. La plantilla de tráiler 9:16 (diseño)

~15-18 s, mobile-first, hook en el frame 1. Beats (del storyboard):
1. **Hook (0-2 s):** el dato que para el scroll, legible para no-devs (*"Este proyecto que mantiene medio internet tiene 220.000 ★"*). `kinetic-slam` + `apple-money-count`.
2. **Identidad (2-5 s):** nombre + descripción en una línea + lenguajes como barras animadas. `data-chart`.
3. **Momentum (5-10 s):** actividad de commits / contribuidores / "vivo desde 20XX". `data-chart`, contadores.
4. **Prueba (10-14 s):** punchline de IA sobre qué hace + comando de instalación en terminal animada (`apple-terminal`).
5. **CTA/outro (14-18 s):** *"Haz el de tu repo · reporeel.cronhaus.dev"* + marca de agua.

Bloques de la biblia HyperFrames: `kinetic-slam`, `pill-karaoke`, `apple-money-count`, `data-chart`, `apple-terminal`, transiciones `whip-pan`/`cinematic-zoom`. Base ~`vignelli` (1080×1920). **GSAP vendorizado localmente** (no CDN) para render server-side fiable (nota de la biblia). Regla 95/5 de transiciones. Texto con límites/truncado (los nombres y descripciones de repo son muy variables).

**Criterio de "done" (binario, para no iterar sin fin):** *un no-dev externo ve el tráiler de `facebook/react` o `oven-sh/bun` sin contexto y "pilla" el pitch en ≤3 s, con curiosidad.* Referencias de estilo: los `hyperframes-launches` + canales de "tech en 30 s" de TikTok (texto enorme, un dato por beat, ritmo rápido). Si en 3 pruebas con alguien no-técnico no lo pilla, se ajusta el **hook**, no se añade más relleno.

## 11. IA / copy

- **Modelo barato y rápido** vía OpenRouter (tagline corto; **Fable 5 sería overkill y 2× coste**). A confirmar con context7 al construir.
- Input: `RepoData` + `Storyboard`. Output: `Copy` (tagline, 2-3 lines, installCmd?) validado con Zod. **Nunca inventa cifras** (vienen del storyboard/GitHub).
- **Fallback determinista:** si la IA falla/timeout → `core/copy` genera copy templado desde el storyboard → el tráiler **siempre se renderiza** sin IA (degradación elegante).
- **Sin secretos en repo:** `OPENROUTER_API_KEY` y `GITHUB_TOKEN` en `.env.local` / Vercel env.

## 12. Modelo de datos

- **`RepoData`** (Zod, nullable donde la API pueda omitir): `owner, name, description, stars, forks, languages` (map %), `topics, createdAt, pushedAt, latestRelease, contributorsCount, topContributors, commitActivity`.
- **`Beat`**: `{ tipo: 'hook'|'identity'|'momentum'|'proof'|'cta', data }`.
- **`Copy`**: `{ tagline, lines: string[], installCmd?: string }`.

## 13. Manejo de errores

- **Repo no existe / privado** → mensaje claro ("solo repos públicos").
- **GitHub API rate-limit** → mensaje amable + reintento.
- **Render falla/timeout** → 1 reintento; si falla, error elegante (sin crash). La **galería nunca depende de render en vivo**.
- **IA falla** → fallback determinista (§11). El tráiler sale igual.
- **OG por plataforma:** X/LinkedIn/TikTok tratan `og:video` distinto → poster `og:image` como fallback; testear.

## 14. Testing

- **`core/storyboard`** (unit, Vitest): fixtures de `RepoData` → beats/héroe esperados. Determinista, sin red/IA.
- **`core/copy`**: el fallback genera copy válido desde cualquier storyboard.
- **`adapters/github`**: con **fixtures JSON** fijos (nunca API en vivo en CI).
- **`adapters/script`**: IA **mockeada** (nunca IA real en CI); test del fallback.
- **`adapters/compose`**: dado storyboard+copy, genera HTML válido (lint de HyperFrames como check).
- **E2E (Playwright + axe):** landing carga + galería reproduce; enviar un repo de **fixture** → página `/r`; meta OG (`og:video` + `og:image`) presente. **Contrato de mocks:** el render mockeado devuelve la URL de un **MP4 de fixtures** real commiteado en `__fixtures__/sample.mp4`; el test de `compose` compara el **JSON de variables** contra un *snapshot*. Sin render real de Sandbox ni IA real en CI.

## 15. Stack

Next.js 16 + TS estricto + Tailwind v4 + shadcn/ui · **HyperFrames** (CLI/engine) + **Vercel Sandbox** + **Vercel Blob** (de la plantilla oficial) · GitHub REST · IA copy vía OpenRouter · Zod · Vitest · Playwright + axe-core · pnpm/Node 24. Deploy en Vercel, dominio `reporeel.cronhaus.dev`. Versiones/APIs confirmadas con **context7** al construir.

## 16. Fases / orden de construcción

0. **Scaffold** (partir de `hyperframes-vercel-template` o Next + añadir hyperframes) + tooling + CI + `.gitignore` (secretos fuera).
1. **`core/storyboard` + `core/copy`** (TDD, puro).
2. **`adapters/github`** (fixtures) + `RepoData`.
3. **`adapters/compose` + plantilla del tráiler 9:16** — la pieza creativa; iterar con `hyperframes preview`. (La que más riesgo de tiempo tiene.)
4. **`adapters/script`** (IA + mock + fallback).
5. **`adapters/render` + `cache`** (flujo Vercel Sandbox + Blob).
6. **`app/`** — API (generate/status async + rate-limit), landing + galería, `/r/owner/repo` con OG + watermark.
7. **`scripts/seed-gallery.ts`** — render de ~12 repos famosos.
8. **Deploy** (dominio `reporeel.cronhaus.dev`) + README + GIF.

## 17. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Coste/concurrencia en pico viral | Caché por repo@día + rate-limit + escape hatch Cloudflare (v2) |
| La plantilla del tráiler no "luce" lo suficiente | Invertir en UNA plantilla excelente; bloques de la biblia; iterar con preview; es el corazón del wow |
| GitHub API rate-limit | Token de servidor + caché |
| Texto variable de repos (nombres/descr. largos) | Límites/truncado en la composición |
| `og:video` se comporta distinto por red | Poster `og:image` de fallback + test por plataforma |
| Render en Sandbox falla/timeout | Reintento + error elegante; galería independiente del render en vivo |

## 18. Decisiones cerradas / abiertas

- **Cerrado:** nombre **RepoReel** · `reporeel.cronhaus.dev` (subdominio) · formato **9:16 vertical** · render en **Vercel** (Sandbox+Blob) · IA barata para copy (no Fable 5) · caché+galería+rate-limit · sin audio v1 · solo repos públicos.
- **Abierto:** modelo de IA concreto (confirmar al construir) · vendorizar GSAP vs inlining de HyperFrames (lean vendorizar) · nº exacto de repos de la galería (~12).
