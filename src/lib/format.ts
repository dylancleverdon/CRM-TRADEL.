import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday } from 'date-fns';

export const money = (n: number) =>
  '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export function when(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  const t = format(d, 'h:mm a');
  if (isToday(d)) return `Today ${t}`;
  if (isYesterday(d)) return `Yesterday ${t}`;
  if (isTomorrow(d)) return `Tomorrow ${t}`;
  return format(d, 'EEE MMM d, yyyy h:mm a');
}

export function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

export function ago(iso: string | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (isNaN(+d)) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

export function duration(sec: number): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function formatPhone(p: string): string {
  const d = (p || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return p;
}

/** Value for <input type="datetime-local"> */
export function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return '';
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export function fromLocalInput(v: string): string {
  if (!v) return '';
  return new Date(v).toISOString();
}

export function fillTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] || `[${k}]`);
}
