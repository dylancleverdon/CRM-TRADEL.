import { describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
import { fromLI, toLead } from '../leadmap';
import { store } from '../store';

const biz = (n: number) => toLead(fromLI({
  businessname: `SENSKE ${n} LLC`, contractorlicensenumber: `L${n}`, contractorlicensetypecode: 'CC', specialtycode1desc: 'LANDSCAPING',
  city: 'KENT', phonenumber: `20655577${String(n).padStart(2, '0')}`, ubi: `7000000${String(n).padStart(2, '0')}`, primaryprincipalname: 'HURST, NATHAN',
  businesstypecodedesc: 'Limited Liability Company', licenseeffectivedate: '2015-01-01T00:00:00.000',
})!) as any;

describe('lead details are never erased', () => {
  it("an update for a lead this device doesn't have does not create a nameless copy", () => {
    store.upsert('leads', { id: 'wa-unknown-1', phoneContactAt: '2026-11-06T19:04:13.100Z' } as any);
    expect(store.data.leads.has('wa-unknown-1')).toBe(false);
    expect(store.dirty.leads.has('wa-unknown-1')).toBe(false);
  });

  it("a nameless copy from another device fills in only what it adds, and the full lead is sent back", () => {
    const l = biz(1);
    store.setVirtualLeads(new Map([[l.id, l]]));
    store.applyRemote('leads', [{ id: l.id, company: '', contactName: '', phone: '', status: 'Attempting', attempts: '1', lastOutcome: 'Left Voicemail', phoneContactAt: '2026-11-06T18:54:46.325Z', updatedAt: '2026-11-06T18:57:37.430Z' }]);
    const r = store.data.leads.get(l.id)!;
    expect(r.company).toBe('Senske 1 LLC');
    expect(r.contactName).toBe('Nathan Hurst');
    expect(r.phone).toBe(l.phone);
    expect(r.lastOutcome).toBe('Left Voicemail');
    expect(store.dirty.leads.has(l.id)).toBe(true);
  });

  it('leads already damaged in the sheet are repaired from Lead Finder, history names too', () => {
    const l = biz(2);
    store.data.leads.set(l.id, { id: l.id, company: '', status: 'Qualified', email: 'info@senske.com', updatedAt: '2026-11-06T19:31:41.213Z' } as any);
    store.data.activities.set('act-x', { id: 'act-x', entityType: 'lead', entityId: l.id, entityName: 'Lead', type: 'call', outcome: 'No Answer', occurredAt: '2026-11-06T19:00:00.000Z', updatedAt: '' } as any);
    store.setVirtualLeads(new Map([[l.id, l]]));
    const r = store.data.leads.get(l.id)!;
    expect(r).toMatchObject({ company: 'Senske 2 LLC', status: 'Qualified', email: 'info@senske.com', contactName: 'Nathan Hurst' });
    expect(store.data.activities.get('act-x')!.entityName).toBe('Senske 2 LLC');
    expect(store.dirty.leads.has(l.id)).toBe(true);
  });

  it('a full update from another device still replaces fields, including clearing them on purpose', () => {
    const l = biz(3);
    store.data.leads.set(l.id, { ...l, notes: 'old', updatedAt: '2026-11-06T10:00:00.000Z' });
    store.applyRemote('leads', [{ ...l, notes: '', updatedAt: '2026-11-06T11:00:00.000Z' }]);
    expect(store.data.leads.get(l.id)!.notes).toBe('');
  });
});
