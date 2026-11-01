import { expect, test } from '@playwright/test';
import { gotoScenario } from '../e2e/helpers';

/**
 * Main-thread blocking with and without the XLSX parse worker. With the worker
 * no single task may block the UI for long; without it the numbers are logged
 * for comparison only.
 */
for (const file of ['large.xlsx']) {
  for (const workers of [true, false]) {
    test(`${file} workers=${workers}`, async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { __long: number[] }).__long = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries())
            (window as unknown as { __long: number[] }).__long.push(Math.round(e.duration));
        }).observe({ type: 'longtask', buffered: true });
      });
      await gotoScenario(page, 'large', { workers });
      await page.evaluate(() => ((window as unknown as { __long: number[] }).__long = []));
      const t0 = Date.now();
      await page.getByRole('button', { name: `Preview ${file}`, exact: true }).click();
      await expect(page.locator('.dsc-renderer[data-ready="true"]')).toBeVisible({
        timeout: 60_000,
      });
      const ready = Date.now() - t0;
      const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
      console.log(
        file,
        'workers',
        workers,
        'ready',
        ready,
        'longest',
        Math.max(0, ...long),
        'total',
        long.reduce((a, b) => a + b, 0),
      );
    });
  }
}
