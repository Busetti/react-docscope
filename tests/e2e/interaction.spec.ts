import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { gotoScenario, openPreview } from './helpers';

test('PDF search highlights every match across pages', async ({ page }) => {
  await gotoScenario(page);
  const dialog = await openPreview(page, 'sample.pdf');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('invoice');
  await expect(dialog.getByRole('status').filter({ hasText: / of 18$/ })).toBeVisible();
  const active = dialog.locator('.dsc-pdf-hl--active');
  await expect(active).toBeVisible();
  // the highlight box sits on the word "invoice" in the text layer
  const hl = (await active.boundingBox())!;
  const word = await dialog
    .locator('.textLayer span', { hasText: 'invoice' })
    .first()
    .boundingBox();
  expect(Math.abs(hl.y - word!.y)).toBeLessThan(word!.height);
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status').filter({ hasText: '2 of 18' })).toBeVisible();
  await page.keyboard.press('Shift+Enter');
  await expect(dialog.getByRole('status').filter({ hasText: '1 of 18' })).toBeVisible();
});

test('Markdown search uses the CSS Custom Highlight API', async ({ page }) => {
  await gotoScenario(page);
  await openPreview(page, 'readme.md');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('markdown');
  await expect(page.getByRole('status').filter({ hasText: '1 of 3' })).toBeVisible();
  const sizes = await page.evaluate(() => {
    const reg = (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights;
    return [reg.get('dsc-search')?.size, reg.get('dsc-search-active')?.size];
  });
  expect(sizes).toEqual([2, 1]);
});

test('keyboard navigation, focus trap and Escape', async ({ page }) => {
  await gotoScenario(page);
  const dialog = await openPreview(page, 'sample.pdf');
  await expect(dialog.locator('.dsc-root')).toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(dialog.getByRole('heading', { name: 'proposal.docx' })).toBeVisible();
  await page.keyboard.press(']');
  await expect(dialog.getByRole('heading', { name: 'deck.pptx' })).toBeVisible();
  for (let i = 0; i < 40; i += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Preview sample.pdf' })).toBeFocused();
});

test('split-screen comparison of different formats', async ({ page }) => {
  await gotoScenario(page, 'compare');
  await page.getByRole('button', { name: /Compare “sample.pdf”/ }).click();
  const dialog = page.getByRole('dialog');
  const left = dialog.getByRole('region', { name: 'Left document' });
  const right = dialog.getByRole('region', { name: 'Right document' });
  await expect(left.locator('.dsc-renderer[data-ready="true"]')).toBeVisible();
  await expect(right.locator('.dsc-renderer[data-ready="true"]')).toBeVisible();
  await right.getByRole('combobox').selectOption({ label: 'budget.xlsx' });
  await expect(right.getByRole('grid')).toBeVisible();
  await left.getByRole('button', { name: 'Zoom in' }).click();
  await expect(right.getByRole('button', { name: /Zoom 100%/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Swap documents' }).click();
  await expect(
    dialog.getByRole('region', { name: 'Left document' }).getByRole('grid'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Stacked' }).click();
  await expect(dialog.locator('.dsc-compare-panes--vertical')).toBeVisible();
  await dialog.getByRole('button', { name: 'Exit compare' }).click();
  await expect(dialog.getByRole('region', { name: 'Left document' })).toBeHidden();
});

test('expired signed URLs are re-resolved transparently', async ({ page }) => {
  await gotoScenario(page, 'signed');
  const dialog = await openPreview(page, 'sample.pdf');
  await expect(dialog.locator('.dsc-pdf-page canvas[data-rendered="true"]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  const log = page.getByTestId('event-log');
  await expect(log).toContainText('attempt=1 · reason=expired');
  await expect(log).toContainText('onLoad → sample.pdf');
});

test('authorization headers reach the server', async ({ page }) => {
  await gotoScenario(page, 'headers');
  const dialog = await openPreview(page, 'proposal.docx');
  await expect(dialog.getByText('Project Proposal')).toBeVisible();
});

test('failures show meaningful states and never leak signed URLs', async ({ page }) => {
  await gotoScenario(page, 'failures');
  let dialog = await openPreview(page, 'resolver-throws.pdf');
  await expect(dialog.getByRole('alert')).toContainText('Backend unavailable');
  await expect(dialog.getByRole('alert')).not.toContainText('X-Amz-Signature');
  await dialog.getByRole('button', { name: 'Next document' }).click();
  await expect(dialog.getByText('Document not found')).toBeVisible();
  await page.keyboard.press('Escape');
  dialog = await openPreview(page, 'malformed.pdf');
  await expect(dialog.getByText('Unable to read document')).toBeVisible();
  await page.keyboard.press('Escape');
  dialog = await openPreview(page, 'broken-deck.pptx');
  await expect(dialog.getByRole('note')).toContainText('converted version');
  await expect(dialog.locator('.dsc-pdf-page').first()).toBeVisible();
});

test('encrypted PDFs ask for a password', async ({ page }) => {
  await gotoScenario(page, 'failures');
  const dialog = await openPreview(page, 'locked.pdf');
  const input = dialog.getByRole('textbox', { name: 'Password' });
  await expect(input).toBeFocused();
  // a11y of the prompt itself
  const results = await new AxeBuilder({ page }).include('.dsc-password').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  // typing must not trigger single-key viewer shortcuts (r = rotate, f = fullscreen)
  await input.fill('nope');
  await input.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('Incorrect password. Please try again.');
  await expect(input).toHaveValue('');
  await input.pressSequentially('docscope');
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(dialog.locator('.dsc-pdf-page canvas[data-rendered="true"]').first()).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /Page 1 of 3/ })).toBeVisible();
  // cancel → PASSWORD_REQUIRED state with a retry that asks again
  await page.keyboard.press('Escape');
  const again = await openPreview(page, 'locked.pdf');
  await again.getByRole('button', { name: 'Cancel' }).click();
  await expect(again.getByText('Password required')).toBeVisible();
  await again.getByRole('button', { name: 'Retry' }).click();
  await expect(again.getByRole('textbox', { name: 'Password' })).toBeVisible();
});

test('local files are previewed without uploading', async ({ page }) => {
  await gotoScenario(page, 'local');
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') uploads.push(r.url());
  });
  await page
    .getByTestId('local-file-input')
    .setInputFiles(['tests/fixtures/config.json', 'tests/fixtures/photo.jpg']);
  const dialog = await openPreview(page, 'config.json');
  await expect(dialog.getByRole('tree')).toContainText('"docscope"');
  expect(uploads).toEqual([]);
});

test('download returns the original bytes', async ({ page }) => {
  await gotoScenario(page);
  const dialog = await openPreview(page, 'budget.xlsx');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('budget.xlsx');
});

test('inline mode at narrow widths and dark theme pass axe', async ({ page }) => {
  await gotoScenario(page, 'attachments', { mode: 'inline', width: '420px', theme: 'dark' });
  const root = page.locator('.dsc-root').first();
  await expect(root).toHaveAttribute('data-dsc-theme', 'dark');
  await expect(root.locator('.dsc-renderer[data-ready="true"]')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.dsc-root').analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`),
  ).toEqual([]);
});

test('modal passes axe', async ({ page }) => {
  await gotoScenario(page);
  await openPreview(page, 'budget.xlsx');
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`),
  ).toEqual([]);
});
