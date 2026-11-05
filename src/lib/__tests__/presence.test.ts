import { describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));

import { convertLead } from '../actions';
import { DEFAULT_SCRIPT } from '../constants';
import { fillTemplate } from '../format';
import { cleanCount, cleanRating, googlePhoneSearchUrl, presenceLines, presenceMatch, yelpSearchUrl } from '../presence';
import { store } from '../store';

const biz = { company: 'Ballard Htg Clng Elec & Plbg', city: 'Lynnwood', state: 'WA', phone: '2067848101', trade: 'Plumbing' };

describe('online presence', () => {
  it('builds Yelp and Google searches for the business', () => {
    expect(yelpSearchUrl(biz)).toBe('https://www.yelp.com/search?find_desc=Ballard%20Htg%20Clng%20Elec%20%26%20Plbg&find_loc=Lynnwood%2C%20WA');
    expect(googlePhoneSearchUrl(biz)).toBe('https://www.google.com/search?q=%22206-784-8101%22');
    expect(googlePhoneSearchUrl({ phone: '' })).toBe('');
  });

  it('cleans what you type for stars and reviews', () => {
    expect(cleanRating('4,5 stars')).toBe('4.5');
    expect(cleanRating('7')).toBe('');
    expect(cleanCount('1,204 reviews')).toBe('1204');
  });

  it('writes the script lines from what you found, and nothing before you check', () => {
    expect(presenceLines(biz)).toEqual({ yelp: '', google: '' });
    const lines = presenceLines({ ...biz, yelpStatus: 'Not listed', googleStatus: 'Listed', googleRating: '4.8', googleReviews: '12' });
    expect(lines.yelp).toBe("I noticed Ballard Htg Clng Elec & Plbg isn't on Yelp yet, which means you're not showing up when people ask AI search for a plumbing company in Lynnwood.");
    expect(lines.google).toBe("On Google you've got 4.8 stars from 12 reviews.");
  });

  it('drops the {yelp} {google} line from the script until the business is checked', () => {
    const vars = { company: 'Acme', trade: 'roofing', city: 'Kent', name: 'Pat', myName: 'Dylan' };
    const unchecked = fillTemplate(DEFAULT_SCRIPT, { ...vars, yelp: '', google: '' }, ['yelp', 'google']);
    expect(unchecked).not.toMatch(/\[yelp\]|\[google\]|\n\n\n/);
    const checked = fillTemplate(DEFAULT_SCRIPT, { ...vars, yelp: 'I noticed Acme isn’t on Yelp yet.', google: '' }, ['yelp', 'google']);
    expect(checked).toContain('I noticed Acme isn’t on Yelp yet.');
    // Other placeholders still flag gaps.
    expect(fillTemplate('Hi {name}', {})).toBe('Hi [name]');
  });

  it('filters leads by what is missing', () => {
    expect(presenceMatch({ yelpStatus: 'Unclaimed' }, 'noYelp')).toBe(true);
    expect(presenceMatch({ googleStatus: 'Listed', yelpStatus: 'Listed' }, 'gap')).toBe(false);
    expect(presenceMatch({}, 'unchecked')).toBe(true);
  });

  it('keeps the findings when a lead becomes a contact', () => {
    const lead = store.upsert('leads', { id: 'p1', company: 'Acme Roofing', phone: '2065550199', status: 'Qualified', yelpStatus: 'Not listed', googleStatus: 'Unverified', googleUrl: 'https://maps.app.goo.gl/x' } as any);
    const contact = convertLead(lead);
    expect(contact.yelpStatus).toBe('Not listed');
    expect(contact.googleStatus).toBe('Unverified');
    expect(contact.googleUrl).toBe('https://maps.app.goo.gl/x');
  });
});
