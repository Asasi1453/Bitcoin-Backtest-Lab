import { describe, expect, it } from 'vitest';
import { runPython } from '../server/python';
import { backtest } from '../shared/engine';
import { defaultConfig, type Candle, type Config } from '../shared/types';
import { examplePython, MAX_PYTHON_BYTES, validatePythonStrategy } from '../shared/python-strategy';

const candles: Candle[] = [100, 105, 110, 115, 120, 125].map((price, i) => ({
  time: 1704067200 + i * 60,
  open: price,
  high: price + 2,
  low: price - 2,
  close: price + 1,
  volume: 10,
}));
const strategy = (source: string) => ({ name: 'Test Python', source });
const config: Config = {
  ...defaultConfig,
  strategy: 'python',
  python: examplePython,
  interval: '1m',
  mode: 'demo',
  start: '2024-01-01',
  end: '2024-01-01',
  allocation: 100,
  fee: 0,
  slippage: 0,
  stopLoss: 0,
  takeProfit: 0,
};

describe('Local Python strategies', () => {
  it('provides only the closed history prefix, preserves state and fills at next open', async () => {
    const python = strategy(`def on_candle(candles, state):
    state['count'] = state.get('count', 0) + 1
    assert state['count'] == len(candles)
    assert candles[-1]['time'] == 1704067200 + (len(candles) - 1) * 60
    if len(candles) == 1: return 'buy'
    if len(candles) == 3: return 'sell'
    return None
`);
    const signals = await runPython(python, candles);
    expect(signals).toEqual(['buy', 'hold', 'sell', 'hold', 'hold', 'hold']);
    const result = backtest(candles, { ...config, python }, signals);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      entryTime: candles[1].time,
      entry: 105,
      exitTime: candles[3].time,
      exit: 115,
      reason: 'Strateji sinyali',
    });
    expect(result.metrics.finalEquity).toBeCloseTo((10000 * 115) / 105);
    expect(result.config.python).toEqual(python);
    expect(await runPython(python, candles)).toEqual(signals);
  });
  it('does not execute top-level code during syntax validation', async () => {
    await expect(
      runPython(
        strategy(
          "raise RuntimeError('must not run')\ndef on_candle(candles, state):\n    return 'hold'",
        ),
        null,
      ),
    ).resolves.toEqual([]);
  });
  it('reports syntax errors with a strategy line number', async () => {
    await expect(
      runPython(strategy('def on_candle(candles, state)\n    pass'), null),
    ).rejects.toThrow(/satır 1.*SyntaxError/);
  });
  it('rejects framework files without the supported callback', async () => {
    await expect(runPython(strategy('class Strategy: pass'), null)).rejects.toThrow(/on_candle/);
  });
  it('reports runtime exceptions and invalid signals', async () => {
    await expect(
      runPython(strategy('def on_candle(candles, state):\n    return 1 / 0'), candles),
    ).rejects.toThrow(/satır 2.*ZeroDivisionError/);
    await expect(
      runPython(strategy("def on_candle(candles, state):\n    return 'short'"), candles),
    ).rejects.toThrow(/yalnızca buy/);
  });
  it('keeps candle values read-only', async () => {
    await expect(
      runPython(strategy("def on_candle(candles, state):\n    candles[-1]['close'] = 0"), candles),
    ).rejects.toThrow(/TypeError/);
  });
  it('terminates an infinite loop and can run another strategy afterwards', async () => {
    await expect(
      runPython(strategy('def on_candle(candles, state):\n    while True: pass'), candles, {
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/süre sınırı/);
    await expect(runPython(examplePython, candles)).resolves.toHaveLength(candles.length);
  });
  it('caps printing without corrupting the signal protocol', async () => {
    await expect(
      runPython(
        strategy("def on_candle(candles, state):\n    print('hello')\n    return 'hold'"),
        candles,
      ),
    ).resolves.toEqual(candles.map(() => 'hold'));
    await expect(
      runPython(strategy("def on_candle(candles, state):\n    print('x' * 17000)"), candles),
    ).rejects.toThrow(/günlük çıktısı/);
  });
  it('gives an actionable missing-interpreter error', async () => {
    await expect(
      runPython(examplePython, null, { executable: '/nonexistent/bitcoin-python' }),
    ).rejects.toThrow(/Python bulunamadı/);
  });
  it('does not pass application secrets into the child environment', async () => {
    process.env.BTC_TEST_SECRET = 'test-only-value';
    try {
      await expect(
        runPython(
          strategy(
            "import os\ndef on_candle(candles, state):\n    assert 'BTC_TEST_SECRET' not in os.environ\n    return 'hold'",
          ),
          candles,
        ),
      ).resolves.toHaveLength(candles.length);
    } finally {
      delete process.env.BTC_TEST_SECRET;
    }
  });
  it('rejects empty and oversized source before starting Python', () => {
    expect(() => validatePythonStrategy(strategy(''))).toThrow();
    expect(() => validatePythonStrategy(strategy('ü'.repeat(MAX_PYTHON_BYTES)))).toThrow(/64 KB/);
    expect(() => backtest(candles, config)).toThrow(/sinyalleri/);
  });
  it('applies stop-loss, fees and slippage to Python positions', () => {
    const result = backtest(candles, { ...config, fee: 1, slippage: 1, stopLoss: 1 }, [
      'buy',
      'hold',
      'hold',
      'hold',
      'hold',
      'hold',
    ]);
    expect(result.trades[0].reason).toBe('Stop-loss');
    expect(result.trades[0].entry).toBeCloseTo(105 * 1.01);
    expect(result.metrics.totalFees).toBeGreaterThan(0);
    expect(result.metrics.netProfit).toBeCloseTo(result.trades[0].pnl);
  });
  it('keeps earlier signals unchanged when future prices change', async () => {
    const original = await runPython(examplePython, candles);
    const changed = candles.map((c, i) =>
      i < 4 ? c : { ...c, open: 500, high: 900, low: 400, close: 800 },
    );
    expect((await runPython(examplePython, changed)).slice(0, 4)).toEqual(original.slice(0, 4));
  });
});
