import { expect, test } from '@playwright/test';
import { gotoScenario, openPreview } from './helpers';

// Screenshot baselines are generated on Linux (CI); fonts differ on other OSes.
test.skip(process.platform !== 'linux', 'Visual baselines are Linux-only');

const mask = (page: import('@playwright/test').Page) => [
  page.locator('.pg-log'),
  page.locator('.pg-code'),
];

for (const [name, file] of [
  ['pdf', 'sample.pdf'],
  ['docx', 'proposal.docx'],
  ['pptx', 'deck.pptx'],
  ['xlsx', 'budget.xlsx'],
  ['markdown', 'readme.md'],
  ['json', 'config.json'],
] as const) {
  test(`${name} preview`, async ({ page }) => {
    await gotoScenario(page, 'attachments', { theme: 'light' });
    const dialog = await openPreview(page, file);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    // The sidebar scrolls the active item into view (and re-adjusts after
    // measuring rows); wait until it stops moving.
    const scrollTop = () => dialog.locator('.dsc-sidebar-list').evaluate((el) => el.scrollTop);
    await expect
      .poll(async () => {
        const a = await scrollTop();
        await page.waitForTimeout(250);
        return a === (await scrollTop());
      })
      .toBe(true);
    // These shots cover document rendering; the attachment list's scroll offset varies by
    // environment once it overflows, so it is masked here.
    await expect(dialog).toHaveScreenshot(`${name}.png`, {
      mask: [...mask(page), dialog.locator('.dsc-sidebar-list')],
    });
  });
}

test('dark theme compare', async ({ page }) => {
  await gotoScenario(page, 'compare', { theme: 'dark' });
  await page.getByRole('button', { name: /Compare “sample.pdf”/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.dsc-renderer[data-ready="true"]')).toHaveCount(2);
  await page.waitForTimeout(500);
  await expect(dialog).toHaveScreenshot('compare-dark.png');
});
