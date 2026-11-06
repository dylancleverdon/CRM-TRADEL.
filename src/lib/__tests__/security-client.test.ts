import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
const net = vi.hoisted(() => ({ bodies: [] as any[], reply: (_b: any): any => ({ ok: true }) }));
vi.mock('../platform', () => ({
  isAndroid: () => false, isDesktop: () => true, Native: {}, openExternal: vi.fn(),
  httpRequest: vi.fn(async (_url: string, _m: string, body: string) => {
    const b = JSON.parse(body);
    net.bodies.push(b);
    return { status: 200, text: JSON.stringify(net.reply(b)) };
  }),
}));
const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  // Installed before any module loads (sync.ts reads localStorage at load time).
  (globalThis as any).localStorage = {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(),
  };
  return m;
});

import { connectorCall, connectEmail, CONNECTOR_LOCKED } from '../email';
import { getSyncKey, saveSyncKey, setSyncKey, testConnection, withAuth } from '../sync';

const KEY = 'a'.repeat(64);

describe('sync key on this device', () => {
  beforeEach(() => { mem.clear(); net.bodies = []; });

  it('every request says which device it is, and carries the key once it is saved', () => {
    const before = withAuth({ action: 'sync' }) as any;
    expect(before.key).toBeUndefined();
    expect(before.device).toMatchObject({ name: 'Mac' });
    setSyncKey(` ${KEY} `);
    const after = withAuth({ action: 'sync' }) as any;
    expect(after.key).toBe(KEY);
    expect(after.device.id).toBe(before.device.id); // same device id every time
  });

  it('a wrong key is not saved', async () => {
    net.reply = (b) => ({ ok: true, security: { locked: false, keyed: b.key === KEY } });
    expect(await saveSyncKey('wrong-key')).toBe(false);
    expect(getSyncKey()).toBe('');
    expect(await saveSyncKey(KEY)).toBe(true);
    expect(getSyncKey()).toBe(KEY);
  });

  it('the connection test sends the key too', async () => {
    setSyncKey(KEY);
    net.reply = () => ({ ok: true, sheet: 'CRM Tradelink Data Storage', security: { locked: true, keyed: true } });
    await testConnection('https://script.google.com/macros/s/X/exec');
    expect(net.bodies[0]).toMatchObject({ action: 'ping', key: KEY });
  });
});

describe('email connector and the sync key', () => {
  beforeEach(() => { mem.clear(); net.bodies = []; });

  it('every connector request carries the key once it is saved, without touching what is sent', async () => {
    net.reply = () => ({ ok: true });
    await connectorCall({ action: 'recent', since: 5 }, 'https://script.google.com/macros/s/E/exec');
    expect(net.bodies[0].auth).toBeUndefined();
    setSyncKey(KEY);
    await connectorCall({ action: 'keyRequest', key: 'b'.repeat(64) }, 'https://script.google.com/macros/s/E/exec');
    expect(net.bodies[1]).toEqual({ action: 'keyRequest', key: 'b'.repeat(64), auth: KEY });
  });

  it('a locked connector says what to do', async () => {
    net.reply = () => ({ ok: false, code: 'locked', error: 'This email connector is locked.' });
    await expect(connectorCall({ action: 'recent' }, 'https://script.google.com/macros/s/E/exec')).rejects.toThrow(CONNECTOR_LOCKED);
    net.reply = () => ({ ok: true, locked: true, keyed: false, version: '1.0.29' });
    await expect(connectEmail('https://script.google.com/macros/s/E/exec')).rejects.toThrow(/Settings → Security/);
    expect(localStorage.getItem('tl.emailUrl')).toBeNull();
  });
});
