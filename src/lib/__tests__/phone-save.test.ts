import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
const env = vi.hoisted(() => ({ android: true, desktop: false, connected: true, contactsAllowed: 'granted' }));
const native = vi.hoisted(() => ({
  saveContact: vi.fn(async (o: any) => ({ status: 'saved', name: `${o.name} – ${o.company}`, account: o.account })),
  checkPermissions: vi.fn(async () => ({ contacts: env.contactsAllowed })),
  sendSms: vi.fn(async () => ({ parts: 1 })),
}));
const connector = vi.hoisted(() => ({ calls: [] as any[], replies: [] as any[] }));
vi.mock('../platform', () => ({
  isAndroid: () => env.android, isDesktop: () => env.desktop, Native: native, openExternal: vi.fn(), httpRequest: vi.fn(),
}));
vi.mock('../email', () => ({
  emailConnected: () => env.connected,
  connectorCall: vi.fn(async (body: any) => { connector.calls.push(body); return connector.replies.shift() ?? { ok: true }; }),
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

import { addToPhoneContacts, DEFAULT_CONTACT_ACCOUNT } from '../phonecontacts';
import { store } from '../store';
import { pollPhoneRequests } from '../texts';

const lead = (id: string, extra: Record<string, unknown> = {}) =>
  store.upsert('leads', { id, company: 'American First Air', contactName: 'Juan Andrade', phone: '3239975336', trade: 'HVAC', city: 'Kent', ...extra } as any);
const asPhone = () => { env.android = true; env.desktop = false; };
const asMac = () => { env.android = false; env.desktop = true; };

describe('Save to phone (no call needed)', () => {
  beforeEach(() => {
    connector.calls = []; connector.replies = []; native.saveContact.mockClear(); mem.clear();
    env.connected = true; env.contactsAllowed = 'granted';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('on the phone, saves them right away under your Google account and remembers it', async () => {
    asPhone();
    lead('ps1');
    const msg = await addToPhoneContacts([{ type: 'lead', id: 'ps1' }]);
    expect(native.saveContact).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Juan Andrade', company: 'American First Air', phone: '3239975336', account: DEFAULT_CONTACT_ACCOUNT, group: 'TradeLink CRM',
    }));
    expect(msg).toBe('Saved Juan Andrade – American First Air to your phone contacts');
    expect(store.get('leads', 'ps1')!.phoneContactAt).toBeTruthy();
  });

  it('says so when they are already in your contacts', async () => {
    asPhone();
    lead('ps2');
    native.saveContact.mockResolvedValueOnce({ status: 'exists', name: 'Juan AFA', account: '' } as any);
    expect(await addToPhoneContacts([{ type: 'lead', id: 'ps2' }])).toBe('Juan Andrade – American First Air is already in your phone contacts');
  });

  it('on the Mac, asks your phone to save them and waits for it to confirm', async () => {
    asMac();
    lead('ps3');
    connector.replies.push({ ok: true, id: 'c-1', phoneSeenAgo: 1000 });
    connector.replies.push({ ok: true, contactAck: { id: 'c-1', ok: true, saved: 1, existing: 0, phoneOnly: 0 } });
    const p = addToPhoneContacts([{ type: 'lead', id: 'ps3' }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe('Saved Juan Andrade – American First Air to your phone contacts');
    expect(connector.calls[0]).toMatchObject({ action: 'contactRequest', contacts: [{ name: 'Juan Andrade', phone: '3239975336', entityId: 'ps3' }] });
    expect(store.get('leads', 'ps3')!.phoneContactAt).toBeTruthy();
  });

  it('on the Mac, sends a big selection in batches of 20', async () => {
    asMac();
    const ids = Array.from({ length: 25 }, (_, i) => { lead(`bulk${i}`, { phone: `20655502${String(i).padStart(2, '0')}` }); return `bulk${i}`; });
    connector.replies.push({ ok: true, id: 'c-a', phoneSeenAgo: 500 }, { ok: true, contactAck: { id: 'c-a', ok: true, saved: 18, existing: 2, phoneOnly: 0 } });
    connector.replies.push({ ok: true, id: 'c-b', phoneSeenAgo: 500 }, { ok: true, contactAck: { id: 'c-b', ok: true, saved: 5, existing: 0, phoneOnly: 0 } });
    const p = addToPhoneContacts(ids.map((id) => ({ type: 'lead', id })));
    await vi.advanceTimersByTimeAsync(8000);
    expect(await p).toBe('Saved 23 to your phone contacts · 2 already there');
    expect(connector.calls.filter((c) => c.action === 'contactRequest').map((c) => c.contacts.length)).toEqual([20, 5]);
  });

  it('on the Mac, needs email connected to reach the phone', async () => {
    asMac();
    env.connected = false;
    lead('ps4');
    await expect(addToPhoneContacts([{ type: 'lead', id: 'ps4' }])).rejects.toThrow(/Connect your email/);
  });

  it('the phone takes the sync key the Mac sends, keeps it, and confirms', async () => {
    asPhone();
    const key = 'b'.repeat(64);
    connector.replies.push({ ok: true, keyReq: { id: 'k-1', key } });
    await pollPhoneRequests();
    expect(localStorage.getItem('tl.syncKey')).toBe(key);
    expect(connector.calls.find((c) => c.keyAck)).toMatchObject({ keyAck: 'k-1', keyOk: true });
  });

  it("the phone saves what the Mac asked for and confirms; without Contacts access it says what to allow", async () => {
    asPhone();
    lead('ps5');
    const contacts = [{ name: 'Juan Andrade', company: 'American First Air', title: '', phone: '3239975336', note: '', entityType: 'lead', entityId: 'ps5' }];
    connector.replies.push({ ok: true, contactReq: { id: 'c-9', contacts } });
    await pollPhoneRequests();
    expect(native.saveContact).toHaveBeenCalledTimes(1);
    expect(connector.calls[connector.calls.length - 1]).toMatchObject({ contactAck: 'c-9', contactOk: true, contactSaved: 1 });

    env.contactsAllowed = 'prompt';
    connector.replies.push({ ok: true, contactReq: { id: 'c-10', contacts } });
    await pollPhoneRequests();
    expect(native.saveContact).toHaveBeenCalledTimes(1); // never prompts on the desk
    expect(connector.calls[connector.calls.length - 1]).toMatchObject({ contactAck: 'c-10', contactOk: false });
    expect(connector.calls[connector.calls.length - 1].contactError).toMatch(/Contacts access is off/);
  });
});
