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
  r.dataset.mode = mode;
  r.dataset.density = prefs.density;
  r.style.fontSize = `${15 * prefs.fontScale}px`;
  r.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(r).getPropertyValue('--bg'));
}

window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => applyTheme());
