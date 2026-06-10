/**
 * tests/e2e/demo.spec.ts
 *
 * E2E de la UI pública de RepoReel.
 *
 * La API (/api/generate, /api/status) se mockea con page.route() para que los
 * tests sean deterministas y sin red:
 *   - POST /api/generate → 202 { jobId, status: 'rendering' }
 *   - GET  /api/status    → 200 { status: 'ready', url, poster }
 *
 * Cubre: carga del landing + hero, flujo de generación (pegar facebook/react →
 * "renderizando" → <video> con el resultado), degradación de la galería vacía,
 * y ausencia de violaciones de accesibilidad críticas (axe).
 */

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SAMPLE_URL = "/sample.mp4";
const POSTER_URL = "/poster.jpg";

/** Mockea /api/generate y /api/status con respuestas fijas. */
async function mockApi(page: Page): Promise<void> {
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "facebook/react/2026-06-10",
        status: "rendering",
      }),
    });
  });

  await page.route("**/api/status*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        url: SAMPLE_URL,
        poster: POSTER_URL,
      }),
    });
  });
}

test.describe("Landing", () => {
  test("carga y muestra el hero", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");

    // Titular potente del hero (Task 6.3).
    const hero = page.getByRole("heading", { level: 1 });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(/tráiler/i);

    // Input central para pegar el repo.
    await expect(page.getByLabel(/repositorio de github/i)).toBeVisible();

    // Branding Cronhaus presente.
    await expect(page.getByText(/cronhaus/i).first()).toBeVisible();
  });

  test("galería degrada con elegancia cuando está vacía", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");

    // Con el índice vacío (caso por defecto, sin Vercel Pro) se muestra el
    // estado "pronto" en lugar de una rejilla rota.
    await expect(
      page.getByRole("heading", { name: /^galería$/i }),
    ).toBeVisible();
    await expect(page.getByText(/aún no hay tráileres/i)).toBeVisible();
  });
});

test.describe("Flujo de generación", () => {
  test("pegar facebook/react → renderizando → vídeo resultado", async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto("/");

    await page.getByLabel(/repositorio de github/i).fill("facebook/react");
    await page.getByRole("button", { name: /generar tráiler/i }).click();

    // Estado intermedio de progreso.
    await expect(page.getByText(/renderizando tu tráiler/i)).toBeVisible();

    // Al estar 'ready', se reproduce el MP4 vertical.
    const video = page.locator("video").first();
    await expect(video).toBeVisible({ timeout: 15000 });
    await expect(video).toHaveAttribute("src", SAMPLE_URL);
  });
});

test.describe("Accesibilidad", () => {
  test("el landing no tiene violaciones críticas de axe", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(critical).toEqual([]);
  });
});
