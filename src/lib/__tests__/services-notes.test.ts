import { describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));

import { convertLead, createOpportunity, logActivity } from '../actions';
import { cleanServiceName, joinServices, serviceLabel, serviceList, toggleService } from '../services';
import { store } from '../store';

describe('several services on one opportunity', () => {
  it('stores them as a list in the one column, and reads old single values', () => {
    expect(serviceList('Yelp Ads')).toEqual(['Yelp Ads']);
    expect(serviceList('')).toEqual([]);
    let s = toggleService('', 'Yelp Ads');
    s = toggleService(s, 'SEO / Google Business Profile');
    expect(s).toBe('Yelp Ads, SEO / Google Business Profile');
    expect(serviceLabel(s)).toBe('Yelp Ads + SEO / Google Business Profile');
    expect(toggleService(s, 'Yelp Ads')).toBe('SEO / Google Business Profile');
    expect(joinServices(['A', 'A', ' B '])).toBe('A, B');
    expect(cleanServiceName('Ads, Social')).toBe('Ads / Social');
  });

  it('names a new deal after all its services', () => {
    const c = store.upsert('contacts', { company: 'Acme Plumbing', phone: '2065550100', status: 'Prospect' } as any);
    const o = createOpportunity(c, { service: 'Yelp Ads, Review Generation' });
    expect(o.name).toBe('Acme Plumbing - Yelp Ads + Review Generation');
    expect(o.service).toBe('Yelp Ads, Review Generation');
  });
});

describe('posted notes', () => {
  it('saves each note with its date and time, and edits / deletes keep the history straight', () => {
    const before = Date.now();
    const n = logActivity({ type: 'lead', id: 'n1' }, { type: 'note', notes: 'Owner is Juan, best after 3pm' });
    expect(n.type).toBe('note');
    expect(new Date(n.occurredAt).getTime()).toBeGreaterThanOrEqual(before);

    store.upsert('activities', { id: n.id, notes: 'Owner is Juan, best after 4pm' });
    const edited = store.get('activities', n.id)!;
    expect(edited.notes).toBe('Owner is Juan, best after 4pm');
    expect(edited.occurredAt).toBe(n.occurredAt); // editing keeps when it was written

    store.remove('activities', n.id);
    expect(store.get('activities', n.id)).toBeUndefined();
    expect(store.dirty.activities.has(n.id)).toBe(true); // the delete syncs to the sheet
  });

  it("keeps a lead's own script when it becomes a contact", () => {
    const lead = store.upsert('leads', { id: 'sc1', company: 'Kent HVAC', phone: '2065550111', status: 'Qualified', script: 'Hi {name}, custom pitch' } as any);
    expect(convertLead(lead).script).toBe('Hi {name}, custom pitch');
  });
});
