/**
 * Keyboard shortcuts for calling: the call outcome form (1–0 pick an outcome, Enter saves) and Call Mode
 * (Space calls, S skips, T texts). Letters and numbers are only shortcuts when you aren't typing in a box.
 */
import { CALL_OUTCOMES } from './constants';

const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

/** True when a key press goes into a text box, so letters and numbers are typing, not shortcuts. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TEXT.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  return false;
}

/** Outcomes picked with the number keys 1–9 and 0, in the order shown. Do Not Call has no key: click it on purpose. */
export const KEYED_OUTCOMES: string[] = CALL_OUTCOMES.filter((o) => o.name !== 'Do Not Call').slice(0, 10).map((o) => o.name);

/** The key that picks this outcome ('' if none). */
export const outcomeKey = (name: string): string => {
  const i = KEYED_OUTCOMES.indexOf(name);
  return i < 0 ? '' : String((i + 1) % 10);
};

/** The outcome a number key picks ('' if none). */
export const outcomeForKey = (key: string): string => (/^[0-9]$/.test(key) ? KEYED_OUTCOMES[(Number(key) + 9) % 10] || '' : '');

/** What a key does in Call Mode when no window is open and you aren't typing. */
export function callModeKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; repeat?: boolean; target: EventTarget | null }):
  'call' | 'skip' | 'text' | '' {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return '';
  if (e.key === ' ' || e.key === 'Spacebar') return 'call';
  const k = e.key.toLowerCase();
  return k === 's' ? 'skip' : k === 't' ? 'text' : '';
}
