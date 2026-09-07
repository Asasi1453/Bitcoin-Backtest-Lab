export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Sunucu yanıt vermiyor. API servisinin çalıştığını kontrol edin.');
  }
  if (!res.ok) throw new Error(data.error || 'İstek tamamlanamadı.');
  return data;
}
export const money = (n: number, digits = 2) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
export const pct = (n: number) => (n >= 0 ? '+' : '') + money(n) + '%';
export const date = (t: number) =>
  new Date(t * 1000).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
export function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
