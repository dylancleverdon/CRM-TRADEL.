import { describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));

import { logCall } from '../actions';
import { fromLI, toLead } from '../leadmap';
import { buildCallQueue } from '../queue';
import { store } from '../store';

const row = (n: number, extra: Record<string, string> = {}) => ({
  businessname: `BIZ ${n} LLC`, contractorlicensenumber: `LIC${n}`, contractorlicensetypecode: 'CC', specialtycode1desc: 'ROOFING',
  city: 'SEATTLE', phonenumber: `20655501${String(n).padStart(2, '0')}`, ubi: `6000000${String(n).padStart(2, '0')}`, primaryprincipalname: 'DOE, JANE',
  businesstypecodedesc: 'Limited Liability Company', licenseeffectivedate: '2015-01-01T00:00:00.000', ...extra,
});

describe('virtual leads in the store', () => {
  it('lists public leads, materialises them on first change, and keeps them out of the sheet until then', () => {
    const v = new Map([1, 2, 3].map((n) => { const l = toLead(fromLI(row(n))!); return [l.id, l as any]; }));
    store.setVirtualLeads(v);
    expect(store.list('leads').length).toBe(3);
    expect(store.dirty.leads.size).toBe(0);
    expect(store.get('leads', 'wa-600000001')?.company).toBe('Biz 1 LLC');

    logCall({ entity: { type: 'lead', id: 'wa-600000001' }, outcome: 'No Answer', notes: 'test', durationSec: 5, phone: '2065550101', followUp: null });
    const real = store.data.leads.get('wa-600000001')!;
    expect(real).toBeTruthy(); // now a real lead…
    expect(real.company).toBe('Biz 1 LLC'); // …with all public-record fields kept
    expect(real.attempts).toBe(1);
    expect(real.status).toBe('Attempting');
    expect(real.createdAt).not.toBe('');
    expect(store.dirty.leads.has('wa-600000001')).toBe(true); // queued for the sheet
    expect(store.dirty.leads.has('wa-600000002')).toBe(false);
    expect(store.list('leads').length).toBe(3); // not duplicated
  });

  it('orders the call queue by score, puts new businesses first, skips Do Not Call numbers and duplicates', () => {
    const recent = new Date(Date.now() - 5 * 86400000).toISOString();
    const leads = [
      toLead(fromLI(row(10, { specialtycode1desc: 'GENERAL', businesstypecodedesc: 'Corporation' }))!),
      toLead(fromLI(row(11))!),
      toLead(fromLI(row(12, { licenseeffectivedate: recent }))!),
      toLead(fromLI(row(13, { phonenumber: '' }))!),
      { ...toLead(fromLI(row(14))!), lastOutcome: 'Do Not Call', status: 'Disqualified' },
      { ...toLead(fromLI(row(15))!), id: 'dup', phone: '2065550111' }, // same phone as #11
    ] as any[];
    // a second record with the DNC number must be skipped too
    leads.push({ ...toLead(fromLI(row(16))!), phone: '2065550114' });
    const q = buildCallQueue(leads, [], []);
    expect(q.map((x) => x.id)).toEqual(['wa-600000012', 'wa-600000011', 'wa-600000010']);
    expect(q[0].reason).toMatch(/NEW business/);
  });
});
