import { useSyncExternalStore } from 'react';

export interface ThemeDef { id: string; name: string; hue: number; sat: number; accentL?: number }

export const THEMES: ThemeDef[] = [
  { id: 'forest', name: 'Forest Green (default)', hue: 150, sat: 45 },
  { id: 'emerald', name: 'Emerald', hue: 160, sat: 70 },
  { id: 'mint', name: 'Mint', hue: 165, sat: 55, accentL: 58 },
  { id: 'olive', name: 'Olive', hue: 80, sat: 35 },
  { id: 'teal', name: 'Teal', hue: 185, sat: 55 },
  { id: 'ocean', name: 'Ocean Blue', hue: 210, sat: 65 },
  { id: 'midnight', name: 'Midnight', hue: 232, sat: 45 },
  { id: 'purple', name: 'Royal Purple', hue: 268, sat: 50 },
  { id: 'rose', name: 'Rose', hue: 340, sat: 55 },
  { id: 'crimson', name: 'Crimson', hue: 355, sat: 65 },
  { id: 'amber', name: 'Amber', hue: 38, sat: 85 },
  { id: 'copper', name: 'Copper', hue: 22, sat: 60 },
  { id: 'slate', name: 'Slate', hue: 215, sat: 12 },
  { id: 'graphite', name: 'Graphite', hue: 0, sat: 0 },
];

export type Mode = 'dark' | 'light' | 'system';
export interface ThemePrefs { mode: Mode; theme: string; density: 'comfortable' | 'compact'; fontScale: number; oled: boolean }

const KEY = 'tl.theme';
const defaults: ThemePrefs = { mode: 'dark', theme: 'forest', density: 'comfortable', fontScale: 1, oled: false };

let prefs: ThemePrefs = (() => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return defaults; }
})();
const listeners = new Set<() => void>();

export const useThemePrefs = () =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => prefs);

export function setThemePrefs(patch: Partial<ThemePrefs>) {
  prefs = { ...prefs, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  applyTheme();
  listeners.forEach((l) => l());
}

// ---------- heatmap steps: the accent's hue at evenly spaced perceived lightness (OKLab), so every theme gets a
// one-hue ramp whose lowest step still stands out from the card (checked for all themes, both modes).
const hslRgb = (h: number, s: number, l: number): number[] => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
};
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);
function rgbToLab(rgb: number[]): number[] {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q];
}
function labToRgb([L, A, B]: number[]): number[] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const q = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q].map(toGamma);
}
const toHex = (rgb: number[]) => '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');

/** Four steps, fewest → most: darker → lighter on dark themes, lighter → darker on light ones. */
export function heatSteps(accentRgb: number[], mode: 'dark' | 'light'): string[] {
  const [, a0, b0] = rgbToLab(accentRgb);
  const hue = Math.atan2(b0, a0);
  const c0 = Math.min(0.13, Math.hypot(a0, b0));
  const Ls = mode === 'dark' ? [0.47, 0.57, 0.67, 0.77] : [0.755, 0.65, 0.545, 0.44];
  return Ls.map((L) => {
    let c = c0;
    let rgb = labToRgb([L, c * Math.cos(hue), c * Math.sin(hue)]);
    while (c > 0.002 && rgb.some((x) => x < -0.0005 || x > 1.0005)) { c *= 0.92; rgb = labToRgb([L, c * Math.cos(hue), c * Math.sin(hue)]); }
    return toHex(rgb);
  });
}

function resolvedMode(): 'dark' | 'light' {
  if (prefs.mode === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return prefs.mode;
}

export function applyTheme() {
  const t = THEMES.find((x) => x.id === prefs.theme) || THEMES[0];
  const { hue: h, sat: s } = t;
  const mode = resolvedMode();
  const r = document.documentElement;
  const v = (k: string, val: string) => r.style.setProperty(k, val);
  const bs = Math.min(s, 40);
  if (mode === 'dark') {
    v('--bg', prefs.oled ? '#000' : `hsl(${h} ${bs}% 6%)`);
    v('--bg-2', prefs.oled ? `hsl(${h} ${bs}% 4%)` : `hsl(${h} ${bs}% 8%)`);
    v('--surface', `hsl(${h} ${bs}% 10%)`);
    v('--surface-2', `hsl(${h} ${bs}% 13%)`);
    v('--surface-3', `hsl(${h} ${bs}% 17%)`);
    v('--border', `hsl(${h} ${bs}% 20%)`);
    v('--text', `hsl(${h} 15% 92%)`);
    v('--text-2', `hsl(${h} 10% 68%)`);
    v('--text-3', `hsl(${h} 8% 50%)`);
    v('--accent', `hsl(${h} ${s}% ${t.accentL ?? 45}%)`);
    v('--accent-strong', `hsl(${h} ${s}% ${(t.accentL ?? 45) + 10}%)`);
    v('--accent-soft', `hsl(${h} ${s}% 45% / 0.18)`);
    v('--accent-text', `hsl(${h} ${Math.max(s, 30)}% 72%)`);
    v('--on-accent', '#fff');
    v('--shadow', '0 8px 30px rgb(0 0 0 / 0.45)');
  } else {
    v('--bg', `hsl(${h} ${bs}% 97%)`);
    v('--bg-2', `hsl(${h} ${bs}% 94%)`);
    v('--surface', '#ffffff');
    v('--surface-2', `hsl(${h} ${bs}% 96%)`);
    v('--surface-3', `hsl(${h} ${bs}% 92%)`);
    v('--border', `hsl(${h} ${bs / 2}% 86%)`);
    v('--text', `hsl(${h} 25% 12%)`);
    v('--text-2', `hsl(${h} 10% 35%)`);
    v('--text-3', `hsl(${h} 8% 50%)`);
    v('--accent', `hsl(${h} ${s}% ${Math.min(t.accentL ?? 34, 36)}%)`);
    v('--accent-strong', `hsl(${h} ${s}% 28%)`);
    v('--accent-soft', `hsl(${h} ${s}% 40% / 0.12)`);
    v('--accent-text', `hsl(${h} ${Math.max(s, 30)}% 28%)`);
    v('--on-accent', '#fff');
    v('--shadow', '0 8px 30px rgb(0 0 0 / 0.12)');
  }
  const accentL = mode === 'dark' ? t.accentL ?? 45 : Math.min(t.accentL ?? 34, 36);
  heatSteps(hslRgb(h, s, accentL), mode).forEach((c, i) => v(`--heat-${i}`, c));
  r.dataset.mode = mode;
  r.dataset.density = prefs.density;
  r.style.fontSize = `${15 * prefs.fontScale}px`;
  r.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(r).getPropertyValue('--bg'));
}

window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => applyTheme());
