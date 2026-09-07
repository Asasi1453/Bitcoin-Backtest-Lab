import { describe, expect, it } from 'vitest';
import { backtest, validateConfig } from '../shared/engine';
import {
  candleValue,
  customLookback,
  matchesGroup,
  matchesRule,
  newRule,
  patternStrategy,
  validateCustomStrategy,
  type CustomStrategy,
} from '../shared/candle-rules';
import { defaultConfig, type Candle, type Config } from '../shared/types';
const make = (
  open: number,
  close: number,
  high = Math.max(open, close) + 1,
  low = Math.min(open, close) - 1,
): Candle => ({ time: 0, open, close, high, low, volume: 10 });
const timed = (data: Candle[]) => data.map((b, i) => ({ ...b, time: 1704067200 + i * 60 }));
const data = timed([
  make(105, 100),
  make(99, 106),
  make(107, 108),
  make(109, 107),
  make(106, 106),
  make(106, 106),
]);
const config: Config = {
  ...defaultConfig,
  strategy: 'custom',
  interval: '1m',
  mode: 'demo',
  capital: 10000,
  allocation: 100,
  fee: 0,
  slippage: 0,
  stopLoss: 0,
  takeProfit: 0,
  custom: patternStrategy('engulfing'),
};
describe('Candle rule evaluation', () => {
  it('measures body, wicks and normalized shares', () => {
    const candles = [make(100, 104, 106, 98)];
    for (const [field, expected] of [
      ['body', 4],
      ['upperWick', 2],
      ['lowerWick', 2],
      ['range', 8],
      ['bodyShare', 50],
      ['upperWickShare', 25],
      ['lowerWickShare', 25],
      ['changePct', 4],
    ] as const)
      expect(candleValue(candles, 0, { field, offset: 0 })).toBeCloseTo(expected);
  });
  it('does not match undefined percentage ratios or unavailable history', () => {
    const rule = {
      ...newRule(),
      left: { field: 'bodyShare' as const, offset: 0 },
      right: { kind: 'number' as const, value: 0 },
      operator: 'eq' as const,
    };
    expect(matchesRule([make(100, 100, 100, 100)], 0, rule)).toBe(false);
    expect(matchesGroup(data, 0, patternStrategy('engulfing').entry)).toBe(false);
  });
  it('detects a bullish body engulfing only with the required direction and coverage', () => {
    const group = patternStrategy('engulfing').entry;
    expect(matchesGroup(data, 1, group)).toBe(true);
    expect(matchesGroup(timed([make(105, 100), make(101, 106)]), 1, group)).toBe(false);
    expect(matchesGroup(timed([make(100, 105), make(99, 106)]), 1, group)).toBe(false);
  });
  it('supports wick-to-body multipliers and excludes zero-body candles', () => {
    const group = patternStrategy('hammer').entry;
    expect(matchesGroup([make(100, 102, 102.5, 94)], 0, group)).toBe(true);
    expect(matchesGroup([make(100, 102, 104, 94)], 0, group)).toBe(false);
    expect(matchesGroup([make(100, 100, 100, 94)], 0, group)).toBe(false);
  });
  it('supports multi-candle patterns and all/any groups', () => {
    const candles = [make(100, 101), make(101, 102), make(102, 103)];
    expect(matchesGroup(candles, 2, patternStrategy('three').entry)).toBe(true);
    const group = {
      mode: 'all' as const,
      rules: [newRule(), { ...newRule(), operator: 'lt' as const }],
    };
    expect(matchesGroup(candles, 2, group)).toBe(false);
    expect(matchesGroup(candles, 2, { ...group, mode: 'any' })).toBe(true);
    expect(matchesGroup(candles, 2, { mode: 'all', rules: [] })).toBe(false);
  });
});
describe('Custom backtests', () => {
  it('enters after the pattern closes and exits after the next exit signal', () => {
    const result = backtest(data, config);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryTime).toBe(data[2].time);
    expect(result.trades[0].entry).toBe(107);
    expect(result.trades[0].exitTime).toBe(data[4].time);
    expect(result.trades[0].exit).toBe(106);
    expect(result.trades[0].reason).toBe('Strateji sinyali');
    expect(result.metrics.netProfit).toBeCloseTo(10000 * (106 / 107 - 1));
  });
  it('does not alter past entries when future candles change', () => {
    const altered = structuredClone(data);
    altered[4] = { ...make(140, 150), time: data[4].time };
    const before = backtest(data, config),
      after = backtest(altered, config);
    expect(after.trades[0].entryTime).toBe(before.trades[0].entryTime);
    expect(after.trades[0].entry).toBe(before.trades[0].entry);
    expect(after.equity.slice(0, 4)).toEqual(before.equity.slice(0, 4));
  });
  it('lets risk rules or test end close positions when exit rules are empty', () => {
    const c = structuredClone(config);
    c.custom!.exit.rules = [];
    const result = backtest(data, c);
    expect(result.trades[0].exitTime).toBe(data.at(-1)!.time);
    expect(result.trades[0].reason).toBe('Test sonu');
  });
  it('gives conflicting exit signals priority over entry', () => {
    const c = structuredClone(config);
    c.custom!.exit = structuredClone(c.custom!.entry);
    expect(backtest(data, c).trades).toHaveLength(0);
  });
  it('does not re-enter on a candle where a stop gap closed the position', () => {
    const c = structuredClone(config);
    c.custom!.entry.rules = [newRule()];
    c.custom!.exit.rules = [];
    c.stopLoss = 5;
    const candles = timed([
      make(100, 101),
      make(100, 101),
      make(80, 81),
      make(81, 82),
      make(83, 84),
      make(84, 85),
    ]);
    const result = backtest(candles, c);
    expect(result.trades[0].exitTime).toBe(candles[2].time);
    expect(result.trades[0].reason).toContain('fiyat boşluğu');
    expect(result.trades[1].entryTime).toBe(candles[3].time);
  });
  it('waits for the maximum referenced offset and snapshots nested rules', () => {
    const c = structuredClone(config);
    c.custom!.exit.rules[0].left.offset = 4;
    expect(customLookback(c.custom!)).toBe(4);
    const result = backtest(
      [...data, ...timed([make(105, 106)]).map((b) => ({ ...b, time: data.at(-1)!.time + 60 }))],
      c,
    );
    c.custom!.name = 'changed';
    expect(result.config.custom!.name).toBe('Yükseliş yutan mum');
    expect(result.trades).toHaveLength(0);
  });
});
describe('Custom strategy validation', () => {
  it.each(['engulfing', 'hammer', 'three'] as const)('accepts the %s starter', (pattern) =>
    expect(() => validateCustomStrategy(patternStrategy(pattern))).not.toThrow(),
  );
  it('rejects malformed groups, missing entries and unbounded rules', () => {
    expect(() => validateConfig({ ...config, custom: undefined })).toThrow(/Özel strateji/);
    for (const patch of [
      { entry: { mode: 'all', rules: [] } },
      { entry: { mode: 'all', rules: Array(21).fill(newRule()) } },
      { name: '' },
      { exit: null },
    ])
      expect(() => validateCustomStrategy({ ...patternStrategy('engulfing'), ...patch })).toThrow(
        /Özel strateji/,
      );
  });
  it('rejects future, fractional and excessive offsets', () => {
    for (const offset of [-1, 0.5, 21]) {
      const c = patternStrategy('engulfing');
      c.entry.rules[0].left.offset = offset;
      expect(() => validateCustomStrategy(c)).toThrow(/geriye bakış/);
    }
  });
  it('rejects nonfinite constants, invalid multipliers and incompatible units', () => {
    const base = patternStrategy('engulfing');
    for (const right of [
      { kind: 'number', value: NaN },
      { kind: 'number', value: Infinity },
      { kind: 'candle', field: 'open', offset: 0, factor: 0 },
      { kind: 'candle', field: 'volume', offset: 0, factor: 1 },
    ]) {
      const c = structuredClone(base);
      c.entry.rules[0].right = right as CustomStrategy['entry']['rules'][number]['right'];
      expect(() => validateCustomStrategy(c)).toThrow(/Özel strateji/);
    }
  });
  it('rejects unknown operators and prototype property names', () => {
    const c = patternStrategy('engulfing');
    Object.assign(c.entry.rules[0], { operator: 'toString' });
    expect(() => validateCustomStrategy(c)).toThrow();
    c.entry.rules[0] = newRule();
    Object.assign(c.entry.rules[0].left, { field: '__proto__' });
    expect(() => validateCustomStrategy(c)).toThrow();
  });
});
