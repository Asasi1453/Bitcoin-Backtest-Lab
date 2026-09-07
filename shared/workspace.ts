import { defaultConfig, type Config } from './types';
import { validateConfig } from './engine';
export const preferenceKeys = [
  'capital',
  'allocation',
  'fee',
  'slippage',
  'stopLoss',
  'takeProfit',
] as const;
export type Preferences = Partial<Pick<Config, (typeof preferenceKeys)[number]>>;
export interface Preset {
  name: string;
  config: Config;
}
export interface Workspace {
  presets: Preset[];
  defaults: Preferences;
}
export const emptyWorkspace = (): Workspace => ({ presets: [], defaults: {} });
export function validateWorkspace(input: unknown): asserts input is Workspace {
  const w = input as Workspace;
  if (
    !w ||
    typeof w !== 'object' ||
    !Array.isArray(w.presets) ||
    w.presets.length > 1000 ||
    !w.defaults ||
    typeof w.defaults !== 'object' ||
    Array.isArray(w.defaults)
  )
    throw new Error('Geçersiz çalışma alanı: en fazla 1000 şablon saklanabilir.');
  for (const p of w.presets) {
    if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60)
      throw new Error('Şablon adı 1–60 karakter olmalı.');
    validateConfig(p.config);
  }
  if (
    Object.keys(w.defaults).some(
      (k) => !preferenceKeys.includes(k as (typeof preferenceKeys)[number]),
    )
  )
    throw new Error('Geçersiz varsayılan ayar alanı.');
  validateConfig({ ...defaultConfig, ...w.defaults });
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function mergeWorkspace(existing: Workspace, incoming: Workspace): Workspace {
  const presets = [...existing.presets],
    known = new Set(presets.map(stable));
  for (const p of incoming.presets) {
    const key = stable(p);
    if (!known.has(key)) {
      presets.push(p);
      known.add(key);
    }
  }
  const merged = { presets, defaults: { ...existing.defaults, ...incoming.defaults } };
  validateWorkspace(merged);
  return merged;
}
