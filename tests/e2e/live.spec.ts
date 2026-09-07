import { test, expect } from '@playwright/test';
import type { Candle, Result } from '../../shared/types';
test('one-minute real Binance chart and full-day historical backtest', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.LIVE_TESTS !== '1',
    'Opt-in integration test requires Binance network access.',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const chartResponse = page.waitForResponse((r) => r.url().includes('/api/candles?interval=1m'));
  await page.getByRole('button', { name: '1m', exact: true }).click();
  const response = await chartResponse;
  expect(response.ok()).toBe(true);
  const { candles }: { candles: Candle[] } = await response.json();
  expect(candles.length).toBeGreaterThan(400);
  expect(candles.every((c, i) => !i || c.time - candles[i - 1].time === 60)).toBe(true);
  expect(candles.at(-1)!.time * 1000 + 60000).toBeLessThanOrEqual(Date.now());
  await expect(page.locator('.price-chart canvas').first()).toBeVisible();
  await expect(page.locator('.connection')).toContainText('CANLI BAĞLANTI', { timeout: 30000 });
  await page.getByRole('combobox', { name: 'Zaman dilimi', exact: true }).selectOption('1m');
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Başlangıç · UTC').fill(day);
  await page.getByLabel('Bitiş · UTC').fill(day);
  const backtestResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/backtests') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  const completed = await backtestResponse;
  expect(completed.ok()).toBe(true);
  const result: Result = await completed.json();
  expect(result.source).toBe('Binance Spot');
  expect(result.config.interval).toBe('1m');
  expect(result.candleCount).toBe(1440);
  expect(result.end - result.start).toBe(1439 * 60);
  expect(result.metrics.netProfit).toBeCloseTo(
    result.trades.reduce((sum, t) => sum + t.pnl, 0),
    6,
  );
  const saved: Result = await (await request.get('/api/backtests/' + result.id)).json();
  expect(saved.config.interval).toBe('1m');
  expect(saved.candleCount).toBe(1440);
  await expect(page.locator('.results-panel .tiny-badge')).toHaveText('BINANCE');
  expect(errors).toEqual([]);
});
test('real Binance ticker, closed candles, WebSocket updates and historical backtest', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.LIVE_TESTS !== '1',
    'Opt-in integration test requires Binance network access.',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ticker = await request.get('/api/ticker');
  expect(ticker.ok()).toBe(true);
  expect(Number((await ticker.json()).lastPrice)).toBeGreaterThan(0);
  await page.goto('/');
  await expect(page.locator('.price-chart canvas').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.connection')).toContainText('CANLI BAĞLANTI', { timeout: 30000 });
  const before = await page.locator('.price-metric .metric-sub').textContent();
  await expect.poll(() => page.locator('.price-metric .metric-sub').textContent()).not.toBe(before);
  await page
    .getByLabel('Başlangıç · UTC')
    .fill(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  await expect(page.locator('.performance-metrics')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.results-panel .tiny-badge')).toHaveText('BINANCE');
  await page.screenshot({ path: 'test-results/live-backtest-desktop.png', fullPage: true });
  const saved = await (await request.get('/api/backtests')).json();
  const result = await (
    await request.get(
      '/api/backtests/' +
        saved.find((r: { config: { mode: string } }) => r.config.mode === 'live').id,
    )
  ).json();
  expect(result.source).toBe('Binance Spot');
  expect(result.candleCount).toBeGreaterThan(150);
  expect(result.end * 1000 + 3600000).toBeLessThanOrEqual(Date.now());
  expect(result.metrics.finalEquity).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
