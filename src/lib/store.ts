import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { TABLES, type RecordMap, type TableName } from './types';

type AnyRec = Record<string, any> & { id: string; updatedAt: string };

const NUMERIC = new Set(['attempts', 'monthlyValue', 'setupFee', 'probability', 'durationSec']);
const BOOL = new Set(['done', 'deleted']);

export const uid = () =>
  (crypto as any).randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const nowIso = () => new Date().toISOString();

/** Normalise values that come back from Google Sheets as strings. */
export function normalize(rec: Record<string, any>): AnyRec {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === '_serverTime') continue;
    if (NUMERIC.has(k)) out[k] = v === '' || v == null ? 0 : Number(v) || 0;
    else if (BOOL.has(k)) out[k] = v === true || String(v).toLowerCase() === 'true';
    else out[k] = v == null ? '' : v;
  }
  return out as AnyRec;
}

class Store {
  data: Record<TableName, Map<string, AnyRec>> = Object.fromEntries(TABLES.map((t) => [t, new Map()])) as any;
  dirty: Record<TableName, Set<string>> = Object.fromEntries(TABLES.map((t) => [t, new Set()])) as any;
  version = 0;
  ready = false;
  private listeners = new Set<() => void>();
  private saveTimer: any = null;
  private cache = new Map<string, { v: number; list: any[] }>();
  onLocalChange: (() => void) | null = null;

  async load() {
    for (const t of TABLES) {
      const rows = ((await get(`tbl:${t}`)) as AnyRec[] | undefined) || [];
      this.data[t] = new Map(rows.map((r) => [r.id, r]));
      const d = ((await get(`dirty:${t}`)) as string[] | undefined) || [];
      this.dirty[t] = new Set(d);
    }
    this.ready = true;
    this.emit();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  async saveNow() {
    for (const t of TABLES) {
      await set(`tbl:${t}`, Array.from(this.data[t].values()));
      await set(`dirty:${t}`, Array.from(this.dirty[t]));
    }
  }

  list<T extends TableName>(t: T, includeDeleted = false): RecordMap[T][] {
    const key = t + (includeDeleted ? ':all' : '');
    const c = this.cache.get(key);
    if (c && c.v === this.version) return c.list;
    const list = Array.from(this.data[t].values()).filter((r) => includeDeleted || !r.deleted) as any[];
    this.cache.set(key, { v: this.version, list });
    return list;
  }

  get<T extends TableName>(t: T, id: string | undefined): RecordMap[T] | undefined {
    if (!id) return undefined;
    const r = this.data[t].get(id);
    return r && !r.deleted ? (r as any) : undefined;
  }

  upsert<T extends TableName>(t: T, rec: Partial<RecordMap[T]> & { id?: string }): RecordMap[T] {
    const id = rec.id || uid();
    const existing = this.data[t].get(id);
    const ts = nowIso();
    const merged = { ...(existing || { createdAt: ts }), ...rec, id, updatedAt: ts } as AnyRec;
    this.data[t].set(id, merged);
    this.dirty[t].add(id);
    this.emit();
    this.scheduleSave();
    this.onLocalChange?.();
    return merged as any;
  }

  remove(t: TableName, id: string) {
    if (this.data[t].has(id)) this.upsert(t, { id, deleted: true } as any);
  }

  /** Apply records coming from the server. Local unsynced edits that are newer win. */
  applyRemote(t: TableName, rows: Record<string, any>[]) {
    let changed = false;
    for (const raw of rows) {
      if (!raw.id) continue;
      const rec = normalize(raw);
      const local = this.data[t].get(rec.id);
      if (local && this.dirty[t].has(rec.id) && (local.updatedAt || '') > (rec.updatedAt || '')) continue;
      this.data[t].set(rec.id, { ...(local || {}), ...rec });
      changed = true;
    }
    if (changed) {
      this.emit();
      this.scheduleSave();
    }
  }

  dirtyCount() {
    return TABLES.reduce((n, t) => n + this.dirty[t].size, 0);
  }

  async replaceAll(dump: Record<string, AnyRec[]>) {
    for (const t of TABLES) {
      this.data[t] = new Map((dump[t] || []).map((r) => [r.id, normalize(r)]));
      this.dirty[t] = new Set(this.data[t].keys());
    }
    this.emit();
    await this.saveNow();
  }
}

export const store = new Store();

export function useStoreVersion() {
  return useSyncExternalStore(store.subscribe, () => store.version);
}

export function useTable<T extends TableName>(t: T): RecordMap[T][] {
  useStoreVersion();
  return store.list(t);
}

export function useRecord<T extends TableName>(t: T, id: string | undefined): RecordMap[T] | undefined {
  useStoreVersion();
  return store.get(t, id);
}

// ---------- shared settings (synced through the "settings" tab) ----------

export function getSetting<V>(key: string, fallback: V): V {
  const row = store.get('settings', key);
  if (!row || row.value === '' || row.value == null) return fallback;
  try { return JSON.parse(row.value) as V; } catch { return row.value as unknown as V; }
}

export function setSetting(key: string, value: unknown) {
  store.upsert('settings', { id: key, value: JSON.stringify(value) });
}

export function useSetting<V>(key: string, fallback: V): V {
  useStoreVersion();
  return getSetting(key, fallback);
}
