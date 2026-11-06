import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { TABLES, type RecordMap, type TableName } from './types';

type AnyRec = Record<string, any> & { id: string; updatedAt: string };

const NUMERIC = new Set(['attempts', 'monthlyValue', 'setupFee', 'probability', 'durationSec', 'score']);
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

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

class Store {
  data: Record<TableName, Map<string, AnyRec>> = Object.fromEntries(TABLES.map((t) => [t, new Map()])) as any;
  dirty: Record<TableName, Set<string>> = Object.fromEntries(TABLES.map((t) => [t, new Set()])) as any;
  version = 0;
  ready = false;
  private listeners = new Set<() => void>();
  private saveTimer: any = null;
  private cache = new Map<string, { v: number; list: any[] }>();
  onLocalChange: (() => void) | null = null;
  /**
   * Public-record businesses (Lead Finder) that act as leads without living in the sheet.
   * A virtual lead becomes a real, synced lead the first time it is changed (called, noted, etc.).
   */
  virtualLeads: Map<string, AnyRec> = new Map();

  setVirtualLeads(map: Map<string, AnyRec>) {
    this.virtualLeads = map;
    this.repairLeads();
    this.emit();
  }

  /**
   * Leads that lost their details (a device saved a partial copy of a Lead Finder business it didn't have): fill
   * the blanks back in from Lead Finder and sync the repaired lead. Returns how many were repaired.
   */
  repairLeads(): number {
    let n = 0;
    for (const [id, l] of this.data.leads) {
      const v = this.virtualLeads.get(id);
      if (!v || l.deleted || String(l.company || '').trim()) continue;
      const fixed: AnyRec = { ...l };
      for (const [k, val] of Object.entries(v)) if (isBlank(fixed[k]) && !isBlank(val)) fixed[k] = val;
      fixed.updatedAt = nowIso();
      this.data.leads.set(id, fixed);
      this.dirty.leads.add(id);
      for (const a of this.data.activities.values()) {
        if (a.entityId === id && (!a.entityName || a.entityName === 'Lead')) {
          this.data.activities.set(a.id, { ...a, entityName: fixed.company, updatedAt: nowIso() });
          this.dirty.activities.add(a.id);
        }
      }
      n++;
    }
    if (n) { this.scheduleSave(); this.onLocalChange?.(); }
    return n;
  }

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
    let list = Array.from(this.data[t].values()).filter((r) => includeDeleted || !r.deleted) as any[];
    if (t === 'leads' && this.virtualLeads.size) {
      const real = this.data.leads;
      const extra: AnyRec[] = [];
      for (const [id, v] of this.virtualLeads) if (!real.has(id)) extra.push(v);
      list = list.concat(extra);
    }
    this.cache.set(key, { v: this.version, list });
    return list;
  }

  get<T extends TableName>(t: T, id: string | undefined): RecordMap[T] | undefined {
    if (!id) return undefined;
    const r = this.data[t].get(id) || (t === 'leads' ? this.virtualLeads.get(id) : undefined);
    return r && !r.deleted ? (r as any) : undefined;
  }

  upsert<T extends TableName>(t: T, rec: Partial<RecordMap[T]> & { id?: string }): RecordMap[T] {
    const id = rec.id || uid();
    const existing = this.data[t].get(id) || (t === 'leads' ? this.virtualLeads.get(id) : undefined);
    // An update for a lead/contact this device doesn't have (e.g. a Lead Finder business not loaded here) must not
    // create a nameless copy: that copy would sync and blank out the real one.
    if (!existing && rec.id && (t === 'leads' || t === 'contacts') && isBlank((rec as AnyRec).company)) {
      console.warn(`Ignored an update for a ${t.slice(0, -1)} this device doesn't have: ${id}`);
      return { ...(rec as AnyRec), id } as any;
    }
    const ts = nowIso();
    const base: AnyRec = existing ? { ...existing } : ({} as AnyRec);
    if (!base.createdAt) base.createdAt = ts;
    const merged = { ...base, ...rec, id, updatedAt: ts } as AnyRec;
    this.data[t].set(id, merged);
    this.dirty[t].add(id);
    this.emit();
    this.scheduleSave();
    this.onLocalChange?.();
    return merged as any;
  }

  remove(t: TableName, id: string) {
    if (this.data[t].has(id) || (t === 'leads' && this.virtualLeads.has(id))) this.upsert(t, { id, deleted: true } as any);
  }

  /** Apply records coming from the server. Local unsynced edits that are newer win. */
  applyRemote(t: TableName, rows: Record<string, any>[]) {
    let changed = false;
    for (const raw of rows) {
      if (!raw.id) continue;
      const rec = normalize(raw);
      const local = this.data[t].get(rec.id);
      if (local && this.dirty[t].has(rec.id) && (local.updatedAt || '') > (rec.updatedAt || '')) continue;
      const known = local || (t === 'leads' ? this.virtualLeads.get(rec.id) : undefined);
      if ((t === 'leads' || t === 'contacts') && known && isBlank(rec.company) && !isBlank(known.company)) {
        // A nameless (partial) copy from another device: keep what we know, take only what it adds, and send the
        // full record back so the sheet is repaired too.
        const merged: AnyRec = { ...known };
        for (const [k, v] of Object.entries(rec)) if (!isBlank(v)) merged[k] = v;
        merged.updatedAt = nowIso();
        this.data[t].set(rec.id, merged);
        this.dirty[t].add(rec.id);
        changed = true;
        continue;
      }
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
