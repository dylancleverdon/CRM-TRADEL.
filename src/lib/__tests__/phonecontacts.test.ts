import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
const native = vi.hoisted(() => ({
  saveContact: vi.fn(async (o: any) => ({ status: 'saved', name: `${o.name} – ${o.company}`, account: o.account })),
  checkPermissions: vi.fn(async () => ({ contacts: 'granted' })),
}));
vi.mock('../platform', () => ({ isAndroid: () => true, isDesktop: () => false, Native: native }));
// The email module reads localStorage when it loads; these tests don't need it.
vi.mock('../email', () => ({ emailConnected: () => false, connectorCall: vi.fn() }));

import { DEFAULT_CONTACT_ACCOUNT, saveCalledNumber, shouldSave } from '../phonecontacts';
import { store } from '../store';

describe('saving called numbers to the phone contacts', () => {
  beforeEach(() => { native.saveContact.mockClear(); native.checkPermissions.mockClear(); });

  it('saves every call by default, or only connected ones', () => {
    expect(shouldSave('all', 'No Answer')).toBe(true);
    expect(shouldSave('connected', 'No Answer')).toBe(false);
    expect(shouldSave('connected', 'Warm – Not Ready Yet')).toBe(true);
    expect(shouldSave('connected', null)).toBe(false);
    expect(shouldSave('off', 'Meeting Booked')).toBe(false);
  });

  it('saves "Name – Company" with the number under dylan@tradelink.marketing', async () => {
    store.upsert('leads', { id: 'pc1', company: 'American First Air', contactName: 'Juan Andrade', phone: '3239975336', trade: 'HVAC', city: 'Kent' } as any);
    const msg = await saveCalledNumber({ type: 'lead', id: 'pc1' }, '3239975336', 'Warm – Not Ready Yet');
    expect(native.saveContact).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Juan Andrade', company: 'American First Air', phone: '3239975336', account: DEFAULT_CONTACT_ACCOUNT, group: 'TradeLink CRM',
      note: 'From TradeLink CRM · HVAC · Kent',
    }));
    expect(msg).toBe('Saved Juan Andrade – American First Air to contacts (dylan@tradelink.marketing)');
  });

  it("doesn't ask for Contacts access while dialing for the Mac", async () => {
    native.checkPermissions.mockResolvedValueOnce({ contacts: 'prompt' });
    expect(await saveCalledNumber({ type: 'lead', id: 'pc1' }, '3239975336', null, false)).toBe('');
    expect(native.saveContact).not.toHaveBeenCalled();
  });

  it('warns once if Contacts access is denied, then stays quiet', async () => {
    native.saveContact.mockRejectedValue(Object.assign(new Error('Contacts permission is off'), { code: 'denied' }));
    expect(await saveCalledNumber({ type: 'lead', id: 'pc1' }, '3239975336', 'No Answer')).toMatch(/allow Contacts access/);
    expect(await saveCalledNumber({ type: 'lead', id: 'pc1' }, '3239975336', 'No Answer')).toBe('');
  });
});
