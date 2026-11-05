import { describe, expect, it } from 'vitest';
import {
  carryOver, fromEverett, fromLI, fromLILapsed, fromSeattle, fromSeattleLoc, mergeBusinesses, missingInfo, scoreBusiness,
  splitAddress, toLead,
} from '../leadmap';

const seaLoc = {
  BUSLIC_ID: 767802, BUSLIC_LEGAL_NAME: 'WOODWORKS BY ANDERS LLC', BUSLIC_TRADE_NAME: 'WOODWORKS BY ANDERS LLC',
  BUSLIC_CONTACT_NAME: 'GEORGE ZENO', BUSLIC_PHONE_NUM: '6267265303           ', BUSLIC_NAICS_CODE: '238350',
  BUSLIC_NAICS_DESC: 'FINISH CARPENTRY CONTRACTORS', BUSLIC_LOCATION_ADRS_TEXT: '317 27TH AVE S, SEATTLE, WA 98144',
  BUSLIC_OPENDATE: 1703980800000, BUSLIC_CITYACCTNUM: '0007678020769049',
};
const evt = {
  registration: '23269', legalentityname: 'SPARKLE CLEAN LLC', primarydba: 'SPARKLE CLEAN', ubi: '6012646820010001',
  naics: '561720', address: '212 74TH ST SE, EVERETT, WA, 98203', firstactivitydate: '1991-07-01T00:00:00.000',
};
const li = {
  businessname: 'SPARKLE CLEAN LLC', contractorlicensenumber: 'SPARKCL1', contractorlicensetypecode: 'CC',
  specialtycode1desc: 'Construction Clean-up', phonenumber: '4255550000', ubi: '601264682', primaryprincipalname: 'DOE, JANE',
  licenseexpirationdate: '2025-03-01T00:00:00.000',
};

describe('new sources', () => {
  it('splits addresses', () => {
    expect(splitAddress('317 27TH AVE S, SEATTLE, WA 98144')).toEqual({ street: '317 27TH AVE S', city: 'SEATTLE', state: 'WA', zip: '98144' });
    expect(splitAddress('212 74TH ST SE, EVERETT, WA, 98203')).toEqual({ street: '212 74TH ST SE', city: 'EVERETT', state: 'WA', zip: '98203' });
  });
  it('parses the Seattle owner layer and Everett', () => {
    const s = fromSeattleLoc(seaLoc)!;
    expect(s).toMatchObject({ company: 'Woodworks By Anders LLC', contactName: 'George Zeno', phone: '6267265303', city: 'Seattle', zip: '98144', trade: 'Cabinets & Carpentry' });
    expect(s.keys).toEqual(['seaacct:0007678020769049']);
    const e = fromEverett(evt)!;
    expect(e).toMatchObject({ id: 'wa-601264682', trade: 'Cleaning', city: 'Everett', phone: '' });
  });
  it('adds owner names to Seattle businesses via the city account number', () => {
    const wnbq = fromSeattle({ business_legal_name: 'WOODWORKS BY ANDERS LLC', ownership_type: 'LLC', naics_code: '238350', business_phone: '2065551111', city: 'SEATTLE', city_account_number: '0007678020769049', ubi: '604000001' })!;
    const m = mergeBusinesses([[wnbq], [fromSeattleLoc(seaLoc)!]]);
    expect(m.size).toBe(1);
    const b = m.get('wa-604000001')!;
    expect(b.contactName).toBe('George Zeno');
    expect(b.phone).toBe('2065551111'); // first source wins, second only fills gaps
    expect(b.sources).toEqual(['seattle', 'seattleLoc']);
  });
  it('gives a phone to a no-phone Everett record through the shared UBI', () => {
    const m = mergeBusinesses([[fromLI({ ...li, licenseexpirationdate: undefined })!], [fromEverett(evt)!]]);
    expect(m.get('wa-601264682')).toMatchObject({ phone: '4255550000', contactName: 'Jane Doe', sources: ['li', 'everett'] });
  });
});

describe('partial and lapsed records are kept', () => {
  it('flags lapsed licenses, scores them lower, but never marks an active business lapsed', () => {
    const lapsed = fromLILapsed(li)!;
    expect(lapsed.lapsedAt).toBe('2025-03-01');
    expect(scoreBusiness(lapsed)).toBe(scoreBusiness({ ...lapsed, lapsedAt: undefined }) - 15);
    const merged = mergeBusinesses([[fromLI(li)!], [lapsed]]).get('wa-601264682')!;
    expect(merged.lapsedAt).toBeUndefined();
    const onlyLapsed = mergeBusinesses([[lapsed]]).get('wa-601264682')!;
    expect(onlyLapsed.lapsedAt).toBe('2025-03-01');
    expect(toLead(onlyLapsed).lapsedAt).toBe('2025-03-01');
  });
  it('keeps businesses that disappear from a list for a year, then drops them', () => {
    const now = Date.parse('2026-01-10');
    const prev = mergeBusinesses([[fromEverett(evt)!, fromSeattleLoc(seaLoc)!]]);
    const next = mergeBusinesses([[fromSeattleLoc(seaLoc)!]]);
    const out = carryOver(prev, next, new Set(['everett', 'seattleLoc'] as const), now);
    expect(out.size).toBe(2);
    expect(out.get('wa-601264682')!.notListedSince).toBe('2026-01-10');
    expect(out.get('sea-0007678020769049')!.notListedSince).toBeUndefined();
    // a year later it is finally dropped
    const later = carryOver(out, mergeBusinesses([[fromSeattleLoc(seaLoc)!]]), new Set(['everett', 'seattleLoc'] as const), Date.parse('2027-02-01'));
    expect(later.has('wa-601264682')).toBe(false);
    // if the source failed to download, the caller keeps the old data instead
    const failed = carryOver(prev, mergeBusinesses([[fromSeattleLoc(seaLoc)!]]), new Set(['seattleLoc'] as const), now);
    expect(failed.has('wa-601264682')).toBe(false);
  });
  it('lists what a lead is missing', () => {
    expect(missingInfo({ phone: '1', contactName: '', address: 'x', website: '', email: '' })).toEqual(['owner name', 'website', 'email']);
  });
});
