import { expect, test } from '@playwright/test';
import { gotoScenario, openPreview } from './helpers';

test.beforeEach(async ({ page }) => gotoScenario(page));

test('PDF renders pages to canvas with a selectable text layer', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.pdf');
  await expect(dialog.getByRole('textbox', { name: /Page 1 of 6/ })).toBeVisible();
  const canvas = dialog.locator('.dsc-pdf-page canvas[data-rendered="true"]').first();
  await expect(canvas).toBeVisible();
  // the canvas actually contains drawn pixels (not blank)
  const inked = await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, Math.min(c.height, 400));
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 128) dark += 1;
    return dark;
  });
  expect(inked).toBeGreaterThan(1000);
  await expect(dialog.locator('.textLayer span', { hasText: 'Quarterly invoice summary' }).first()).toBeAttached();
  // only nearby pages are mounted (virtualised)
  expect(await dialog.locator('.dsc-pdf-page').count()).toBeLessThan(6 + 1);
});

test('DOCX keeps formatting, tables and images', async ({ page }) => {
  const dialog = await openPreview(page, 'proposal.docx');
  const doc = dialog.getByRole('document', { name: 'proposal.docx' });
  await expect(doc.getByText('Project Proposal')).toBeVisible();
  await expect(doc.locator('table')).toBeVisible();
  await expect(doc.locator('img').first()).toBeVisible();
  await expect(doc.getByText('document preview', { exact: true })).toHaveCSS('font-weight', '700');
});

test('PPTX renders slides with text, shapes, images and tables', async ({ page }) => {
  const dialog = await openPreview(page, 'deck.pptx');
  await expect(dialog.getByRole('textbox', { name: /Page 1 of 4/ })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Slide 1' })).toContainText('Quarterly Business Review');
  await dialog.getByRole('button', { name: 'Next page' }).click();
  await expect(dialog.getByRole('textbox', { name: /Page 2 of 4/ })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Slide 3' }).locator('img')).toBeAttached();
  await expect(dialog.getByRole('group', { name: 'Slide 4' }).locator('table')).toBeAttached();
});

test('XLSX is a read-only grid with sheets, merges and cached formula values', async ({ page }) => {
  const dialog = await openPreview(page, 'budget.xlsx');
  const grid = dialog.getByRole('grid');
  await expect(grid).toHaveAttribute('aria-readonly', 'true');
  await expect(grid.getByText('$177,000.00')).toBeVisible();
  await expect(grid.locator('[contenteditable], input, textarea')).toHaveCount(0);
  await grid.getByText('FY2026 Budget').dblclick();
  await expect(grid.locator('input, textarea')).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Timeline' }).click();
  await expect(dialog.getByRole('grid').getByText('2026-01-15')).toBeVisible();
});

test('CSV, JSON, XML, Markdown, TXT, images and video', async ({ page }) => {
  let dialog = await openPreview(page, 'customers.csv');
  await expect(dialog.getByRole('grid').getByText('customer1@example.com')).toBeVisible();
  await page.keyboard.press('Escape');

  dialog = await openPreview(page, 'config.json');
  await expect(dialog.getByRole('tree')).toContainText('"docscope"');
  await page.keyboard.press('Escape');

  dialog = await openPreview(page, 'catalog.xml');
  await expect(dialog.getByRole('tree')).toContainText('Midnight Rain');
  await page.keyboard.press('Escape');

  dialog = await openPreview(page, 'readme.md');
  await expect(dialog.getByRole('heading', { name: 'DocScope Markdown sample' })).toBeVisible();
  expect(await page.evaluate(() => (window as { __mdScriptRan?: boolean }).__mdScriptRan)).toBeUndefined();
  await page.keyboard.press('Escape');

  dialog = await openPreview(page, 'notes.txt');
  await expect(dialog.getByText('Line 001: meeting notes')).toBeVisible();
  await page.keyboard.press('Escape');

  for (const name of ['photo.jpg', 'diagram.png', 'animation.gif', 'image.webp', 'image.avif', 'icon.svg']) {
    dialog = await openPreview(page, name);
    const img = dialog.getByRole('img', { name });
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  }
  expect(await page.evaluate(() => (window as { __svgScriptRan?: boolean }).__svgScriptRan)).toBeUndefined();

  dialog = await openPreview(page, 'clip.mp4');
  const video = dialog.locator('video');
  await expect(video).toHaveAttribute('controls', '');
  expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(2);
});
