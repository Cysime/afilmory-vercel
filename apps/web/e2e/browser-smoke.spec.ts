import { expect, test } from "@playwright/test";

import { stubLocalThumbnails } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubLocalThumbnails(page);
});

test("gallery, command palette, and viewer work in WebKit", async ({
  page,
}, testInfo) => {
  await page.goto("/?cross-browser-smoke=true");
  const search = page.getByRole("button", { name: "Search & Filter" });
  await expect(search).toBeVisible();

  const photos = page.locator("[data-photo-id]");
  await expect(photos.first()).toBeVisible();

  await search.click();
  await expect(
    page.getByRole("dialog", { name: "Search & Filter" }).getByRole("combobox"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await photos.first().click();
  const viewer = page.getByRole("dialog", { name: "Photo viewer" });
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/\/photos\/[^/?]+/);

  // Desktop eagerly renders the lazy EXIF inspector. Waiting for it prevents
  // Playwright from tearing down Vite while those chunks are still compiling,
  // and verifies the split panel rather than only the viewer shell.
  if (testInfo.project.name === "webkit-smoke") {
    await expect(
      page.getByRole("heading", { name: "Photo Inspector" }),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toBeHidden();
});
