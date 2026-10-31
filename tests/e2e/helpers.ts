import { expect, type Page } from '@playwright/test';

export async function gotoScenario(page: Page, scenario = 'attachments', settings: Record<string, unknown> = {}) {
  const s = Buffer.from(JSON.stringify(settings)).toString('base64');
  await page.goto(`/#scenario=${scenario}&s=${encodeURIComponent(s)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'DocScope' })).toBeVisible();
}

export async function openPreview(page: Page, name: string) {
  await page.getByRole('button', { name: `Preview ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.dsc-renderer[data-ready="true"], .dsc-state').first()).toBeVisible({ timeout: 30_000 });
  return dialog;
}
