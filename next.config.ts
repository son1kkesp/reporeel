import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * outputFileTracingIncludes (top-level, Next 16 — docs: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md)
   *
   * Fuerza que `compositions/trailer/**` entre en el trace de la Function que
   * ejecuta el render. En una Vercel Function solo se incluyen los archivos que
   * Next traza por imports estáticos; los que se leen en runtime con `fs`
   * (readdir/readFile en render.sandbox.ts) NO se detectan automáticamente y
   * estarían ausentes en producción → "file not found" al render.
   *
   * Claves: route paths (picomatch contra el path de la página/route handler).
   *   `/api/generate` apunta al handler que dispara el render vía after().
   * Valores: globs resueltos desde la raíz del proyecto (project root).
   *   `./compositions/trailer/**` incluye HTMLs, meta.json, fuentes TTF y gsap.
   *
   * La opción es top-level (no en `experimental`) según los docs de Next 16.
   */
  outputFileTracingIncludes: {
    "/api/generate": ["./compositions/trailer/**"],
  },
};

export default nextConfig;
