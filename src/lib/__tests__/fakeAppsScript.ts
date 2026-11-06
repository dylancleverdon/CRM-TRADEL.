/**
 * A small in-memory stand-in for the Apps Script services Code.gs uses (SpreadsheetApp, PropertiesService,
 * LockService, Utilities), so the real server code can be tested without Google.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

class FakeRange {
  constructor(private sh: FakeSheet, private r: number, private c: number, private nr: number, private nc: number) {}
  getValues() {
    const out: any[][] = [];
    for (let i = 0; i < this.nr; i++) {
      const row: any[] = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sh.cells[this.r - 1 + i]?.[this.c - 1 + j] ?? '');
      out.push(row);
    }
    return out;
  }
  getDisplayValues() { return this.getValues().map((row) => row.map((v) => String(v))); }
  getValue() { return this.getValues()[0][0]; }
  setValues(v: any[][]) {
    v.forEach((row, i) => row.forEach((x, j) => {
      const ri = this.r - 1 + i;
      while (this.sh.cells.length <= ri) this.sh.cells.push([]);
      this.sh.cells[ri][this.c - 1 + j] = x;
    }));
    return this;
  }
  setValue(x: any) { return this.setValues([[x]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setDataValidation() { return this; }
  setWrap() { return this; }
  setFontSize() { return this; }
}

export class FakeSheet {
  cells: any[][] = [];
  constructor(public name: string) {}
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.cells.length - 1; i >= 0; i--) if ((this.cells[i] || []).some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this.cells) for (let j = (row || []).length - 1; j >= 0; j--) if (row[j] !== '' && row[j] != null) { max = Math.max(max, j + 1); break; }
    return max;
  }
  getMaxRows() { return Math.max(1000, this.cells.length); }
  getRange(a: any, b?: number, c?: number, d?: number) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)$/)!;
      const col = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      return new FakeRange(this, Number(m[2]), col, 1, 1);
    }
    return new FakeRange(this, a, b!, c ?? 1, d ?? 1);
  }
  setFrozenRows() {}
  setColumnWidth() {}
  setRowHeight() {}
  images: { bytes: number; col: number; row: number }[] = [];
  insertImage(blob: any, col: number, row: number) {
    this.images.push({ bytes: blob.bytes.length, col, row });
    let h = 800, w = 1200;
    const img: any = { getHeight: () => h, getWidth: () => w, setHeight: (x: number) => { h = x; return img; }, setWidth: (x: number) => { w = x; return img; } };
    return img;
  }
  clear() { this.cells = []; }
}

export class FakeSpreadsheet {
  sheets: FakeSheet[] = [];
  constructor(public name: string, public id: string) {}
  getName() { return this.name; }
  getId() { return this.id; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }
  getSheets() { return this.sheets; }
  getSheetByName(n: string) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n: string) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  deleteSheet(s: FakeSheet) { this.sheets = this.sheets.filter((x) => x !== s); }
}

export function loadCodeGs() {
  const props = new Map<string, string>();
  const files = new Map<string, FakeSpreadsheet>();
  const active = new FakeSpreadsheet('CRM Tradelink Data Storage', 'main');
  active.insertSheet('Sheet1');
  const env = {
    props,
    files,
    active,
    failCreate: false,
    created: 0,
    handle: (_body: any): any => null,
  };
  const ctx: any = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (props.has(k) ? props.get(k)! : null),
        setProperty: (k: string, v: string) => { props.set(k, String(v)); },
        deleteProperty: (k: string) => { props.delete(k); },
        setProperties: (o: Record<string, string>) => Object.entries(o).forEach(([k, v]) => props.set(k, String(v))),
      }),
    },
    SpreadsheetApp: {
      getActive: () => active,
      create: (name: string) => {
        if (env.failCreate) throw new Error('Not allowed to create spreadsheets');
        env.created++;
        const ss = new FakeSpreadsheet(name, `file${env.created}`);
        ss.insertSheet('Sheet1');
        files.set(ss.id, ss);
        return ss;
      },
      openById: (id: string) => { const f = files.get(id); if (!f) throw new Error('not found'); return f; },
      newDataValidation: () => {
        const b: any = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) };
        return b;
      },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => randomUUID(),
      base64Decode: (s: string) => Array.from(Buffer.from(s, 'base64')),
      newBlob: (bytes: number[], type: string, name: string) => ({ bytes, type, name }),
    },
    ContentService: { createTextOutput: (t: string) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(resolve(__dirname, '../../../apps-script/Code.gs'), 'utf8'), ctx);
  env.handle = (body: any) => JSON.parse(JSON.stringify(ctx.handle_(body)));
  return env;
}

/** A stand-in for the Google Calendar API service (Calendar.Events / Calendar.Freebusy). */
export function fakeCalendar() {
  const events = new Map<string, any>();
  const calls: { op: string; args: any[] }[] = [];
  let n = 0;
  const cal = {
    events, calls,
    busy: [] as { start: string; end: string }[],
    /** Google sometimes takes a moment to make the Meet link. */
    meetLater: false,
    Events: {
      insert: (ev: any, calId: string, opts: any) => {
        calls.push({ op: 'insert', args: [ev, calId, opts] });
        const id = `ev${++n}`;
        const made = { ...ev, id, htmlLink: `https://calendar.google.com/event?eid=${id}`, status: 'confirmed',
          ...(cal.meetLater ? {} : { hangoutLink: `https://meet.google.com/abc-${id}` }) };
        events.set(id, made);
        return made;
      },
      get: (calId: string, id: string) => {
        calls.push({ op: 'get', args: [calId, id] });
        const e = events.get(id);
        if (!e) throw new Error('Not Found');
        const ready = { ...e, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/late-${id}` }] } };
        events.set(id, ready);
        return ready;
      },
      patch: (patch: any, calId: string, id: string, opts: any) => {
        calls.push({ op: 'patch', args: [patch, calId, id, opts] });
        const e = events.get(id);
        if (!e) throw new Error('Not Found');
        const next = { ...e, ...patch };
        events.set(id, next);
        return next;
      },
      remove: (calId: string, id: string, opts: any) => {
        calls.push({ op: 'remove', args: [calId, id, opts] });
        if (!events.has(id)) throw new Error('API call to calendar.events.delete failed with error: Resource has been deleted');
        events.delete(id);
      },
      list: () => ({ items: [...events.values()] }),
    },
    Freebusy: {
      query: (q: any) => { calls.push({ op: 'freebusy', args: [q] }); return { calendars: { primary: { busy: cal.busy } } }; },
    },
  };
  return cal;
}

/** The email connector (Email.gs) with a stand-in for the CRM's sheet, which it asks about sync keys. */
export function loadEmailGs(opts: { calendar?: ReturnType<typeof fakeCalendar> } = {}) {
  const props = new Map<string, string>();
  const cache = new Map<string, string>();
  const env = {
    props,
    cache,
    /** What the sheet knows: its key, whether it's locked, whether it can be reached. */
    sheet: { key: 'k'.repeat(64), locked: false, down: false },
    fetches: 0,
    handle: (_body: any): any => null,
  };
  const ctx: any = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (props.has(k) ? props.get(k)! : null),
        setProperty: (k: string, v: string) => { props.set(k, String(v)); },
        deleteProperty: (k: string) => { props.delete(k); },
        setProperties: (o: Record<string, string>) => Object.entries(o).forEach(([k, v]) => props.set(k, String(v))),
      }),
    },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => { cache.set(k, String(v)); } }) },
    Utilities: {
      getUuid: () => randomUUID(),
      sleep: () => {},
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Like Apps Script: an array of signed bytes.
      computeDigest: (alg: string, s: string) => Array.from(createHash(alg).update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    },
    UrlFetchApp: {
      fetch: (_url: string, opts: any) => {
        env.fetches++;
        if (env.sheet.down) throw new Error('Address unavailable');
        const b = JSON.parse(opts.payload);
        const keyed = !!b.key && b.key === env.sheet.key;
        // Same answers as Code.gs's ping.
        const r = env.sheet.locked && !keyed ? { ok: true, locked: true, keyed: false, codeVersion: '1.0.28' }
          : { ok: true, serverTime: Date.now(), codeVersion: '1.0.28', security: { locked: env.sheet.locked, keyed, sheetUrl: 'https://docs.google.com/x' } };
        return { getContentText: () => JSON.stringify(r), getResponseCode: () => 200 };
      },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'Dylan@tradelink.marketing' }), getScriptTimeZone: () => 'America/Los_Angeles' },
    ...(opts.calendar ? { Calendar: opts.calendar } : {}),
    MailApp: { getRemainingDailyQuota: () => 1500 },
    GmailApp: { search: () => [] },
    ContentService: { createTextOutput: (t: string) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(resolve(__dirname, '../../../apps-script/Email.gs'), 'utf8'), ctx);
  env.handle = (body: any) => JSON.parse(JSON.stringify(ctx.tlEmailHandle_(body)));
  return env;
}
