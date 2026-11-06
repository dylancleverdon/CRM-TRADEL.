import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  // theme.ts reads saved preferences and listens for the system theme when it loads.
  const m = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) };
  (globalThis as any).window = { matchMedia: () => ({ matches: false, addEventListener: () => {} }) };
});
import { heatSteps, THEMES } from '../theme';

const hslRgb = (h: number, s: number, l: number) => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (rgb: number[]) => '#' + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

describe('heatmap ramp', () => {
  it('matches the colors checked with the palette validator (Forest Green)', () => {
    expect(heatSteps(hslRgb(150, 45, 45), 'dark')).toEqual(['#0e6c44', '#1d8d5b', '#45ac78', '#67cc96']);
    expect(heatSteps(hslRgb(150, 45, 34), 'light')).toEqual(['#76c398', '#55a278', '#34815a', '#09623d']);
  });

  it('in every theme, more is always clearer and the lowest step stands out from the card (2:1)', () => {
    for (const t of THEMES) {
      const bs = Math.min(t.sat, 40);
      for (const mode of ['dark', 'light'] as const) {
        const surface = mode === 'dark' ? hex(hslRgb(t.hue, bs, 10)) : '#ffffff';
        const steps = heatSteps(hslRgb(t.hue, t.sat, mode === 'dark' ? t.accentL ?? 45 : Math.min(t.accentL ?? 34, 36)), mode);
        const c = steps.map((x) => contrast(x, surface));
        expect(c[0], `${t.id} ${mode}`).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < c.length; i++) expect(c[i], `${t.id} ${mode} step ${i}`).toBeGreaterThan(c[i - 1]);
      }
    }
  });
});
