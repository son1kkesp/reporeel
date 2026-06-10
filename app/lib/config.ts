/**
 * app/lib/config.ts
 *
 * Configuración pública compartida de la app.
 *
 * Centraliza valores que antes estaban duplicados en varios módulos
 * (layout.tsx, /r/[owner]/[repo]/page.tsx) para tener una única fuente
 * de verdad y evitar divergencias.
 */

/**
 * URL canónica del sitio.
 *
 * Se lee de `NEXT_PUBLIC_SITE_URL` (expuesta al cliente porque la usan
 * `metadataBase` y la construcción de URLs de Open Graph). En local cae a
 * `http://localhost:3000`.
 *
 * En producción debe apuntar al dominio real (p. ej. `https://reporeel.vercel.app`)
 * para que las OG/Twitter cards y las URLs absolutas se resuelvan correctamente.
 */
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
