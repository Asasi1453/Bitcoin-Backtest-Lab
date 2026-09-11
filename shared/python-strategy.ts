export interface PythonStrategy {
  name: string;
  source: string;
}
export type PythonSignal = 'buy' | 'sell' | 'hold';
export const MAX_PYTHON_BYTES = 64 * 1024;
export function validatePythonStrategy(input: unknown): asserts input is PythonStrategy {
  const p = input as PythonStrategy;
  if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60)
    throw new Error('Python strateji adı 1–60 karakter olmalı.');
  if (
    typeof p.source !== 'string' ||
    !p.source.trim() ||
    new TextEncoder().encode(p.source).length > MAX_PYTHON_BYTES ||
    p.source.includes('\0')
  )
    throw new Error('Python kodu boş olamaz ve 64 KB sınırını aşamaz.');
}
export const examplePython: PythonStrategy = {
  name: 'Python · Yükseliş yutan mum',
  source: `def on_candle(candles, state):
    """candles: kapanmış mumlar; state: test boyunca korunan sözlük.
    Son mum candles[-1]; time UTC Unix saniyesidir.
    Dönüş: "buy", "sell", "hold" veya None.
    Sinyal bir sonraki mumun açılışında uygulanır.
    """
    if len(candles) < 2:
        return "hold"

    prev, curr = candles[-2], candles[-1]
    bullish_engulfing = (
        prev["close"] < prev["open"]
        and curr["close"] > curr["open"]
        and curr["open"] <= prev["close"]
        and curr["close"] >= prev["open"]
    )
    if bullish_engulfing:
        return "buy"
    if curr["close"] < curr["open"]:
        return "sell"
    return "hold"
`,
};
