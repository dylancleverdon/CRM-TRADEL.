import { describe, expect, it } from 'vitest';
import {
  cleanPhone, fromBellevue, fromLI, fromSeattle, fromTacoma, isoDate, mergeBusinesses, ownerName, scoreBusiness,
  titleCase, toLead, tradeFromLI, tradeFromNaics,
} from '../leadmap';

// Real rows (shape copied from the live datasets)
const liRow = {
  businessname: '!ECO STAR C G CONSTRUCTION LLC', contractorlicensenumber: 'ECOSTSC758NN', contractorlicensetypecode: 'CC',
  contractorlicensetypecodedesc: 'CONSTRUCTION CONTRACTOR', address1: '2420 COLUMBIA HOUSE BLVD #311', city: 'VANCOUVER',
  state: 'WA', zip: '98661', phonenumber: '5039573452', licenseeffectivedate: '2025-08-15T00:00:00.000',
  businesstypecodedesc: 'Limited Liability Company', specialtycode1desc: 'GENERAL', ubi: '605854613',
  primaryprincipalname: 'GUERRERO MARTINEZ, CARLOS I.',
};
const seaRow = {
  business_legal_name: 'SMITH JOHN', trade_name: 'JOHNS PLUMBING', ownership_type: 'Sole proprietorship',
  naics_code: '238220', naics_description: 'Plumbing, Heating, and Air-Conditioning Contractors', license_start_date: '20240105',
  street_address: '1 MAIN ST', city: 'SEATTLE', state: 'WA', zip: '98101', business_phone: '206-555-0100',
  city_account_number: '0001', ubi: '605854613',
};
const belRow = {
  BusinessId: '184249', LegalEntityName: 'GLOBENEATMASTERS LLC', Dba: 'GLOBENEATMASTERS', Ubi: '6059816360010001',
  Naic: '561720', LegalEntityType: 'LLC OR PLLC', FirstActivityDate: '09/28/2025', CancelDate: null,
  PhysicalAddressLine1: '15905 SE 43RD ST', PhysicalCity: 'BELLEVUE', PhysicalState: 'WA', PhysicalPostalCode: '98006',
  ProductsAndServices: 'RESIDENTIAL AND COMMERCIAL CLEANING SERVICES',
};
const tacRow = {
  License_Number: '500001529', Business_Name: 'SCOTT DEWITT', Business_Open_Date: '1989/07/01',
  Trade_Name: 'DEWITT CONSTRUCTION / PAINTING', NAICS_Code: '238320', NAICS_Code_Description: 'Painting and Wall Covering Contractors (ES 0200',
  Site_Street: '35017 S 57TH AV', Site_City: 'AUBURN', Site_State: 'WA', Site_Zip_Code: '98001',
};

describe('cleanup helpers', () => {
  it('title-cases names but keeps suffixes', () => {
    expect(titleCase('!ECO STAR C G CONSTRUCTION LLC')).toBe('Eco Star C G Construction LLC');
    expect(titleCase('# JUAN HANDYMAN')).toBe('Juan Handyman');
  });
  it('turns "LAST, FIRST M." into "First Last"', () => {
    expect(ownerName('GUERRERO MARTINEZ, CARLOS I.')).toBe('Carlos Guerrero Martinez');
    expect(ownerName('Ochoa, Eric James')).toBe('Eric Ochoa');
    expect(ownerName('')).toBe('');
  });
  it('normalises phones and dates', () => {
    expect(cleanPhone('(206) 555-0100')).toBe('2065550100');
    expect(cleanPhone('1-206-555-0100')).toBe('2065550100');
    expect(cleanPhone('555')).toBe('');
    expect(isoDate('2025-08-15T00:00:00.000')).toBe('2025-08-15');
    expect(isoDate('20140814')).toBe('2014-08-14');
    expect(isoDate('2022/01/01')).toBe('2022-01-01');
    expect(isoDate('09/28/2025')).toBe('2025-09-28');
  });
});

describe('trade mapping', () => {
  it('maps L&I license types and specialties', () => {
    expect(tradeFromLI('EC', 'LIMITED ENERGY')).toBe('Electrical');
    expect(tradeFromLI('EC', 'HVAC/RFRG')).toBe('HVAC');
    expect(tradeFromLI('PC', 'JOURNEY LEVEL')).toBe('Plumbing');
    expect(tradeFromLI('CC', 'GENERAL')).toBe('General Contractor');
    expect(tradeFromLI('CC', 'ROOFING')).toBe('Roofing');
    expect(tradeFromLI('CC', 'Heating/Vent/Air-Conditioning and Refrig (HVAC/R) ')).toBe('HVAC');
    expect(tradeFromLI('CC', 'Tree Removal Service')).toBe('Tree Service');
    expect(tradeFromLI('CC', 'PRESSURE WASHING')).toBe('Pressure Washing');
    expect(tradeFromLI('CC', 'OVERHEAD/GARAGE DOORS')).toBe('Garage Doors');
    expect(tradeFromLI('CC', 'Structural Pest Control')).toBe('Pest Control');
    expect(tradeFromLI('CC', 'Steel Erectors')).toBe('Commercial / Industrial');
    expect(tradeFromLI('CC', 'Floor Covering and Counter Tops')).toBe('Flooring');
  });
  it('maps NAICS codes and ignores non-home-service ones', () => {
    expect(tradeFromNaics('238220')).toBe('Plumbing & HVAC');
    expect(tradeFromNaics('561720')).toBe('Cleaning');
    expect(tradeFromNaics('561730')).toBe('Landscaping');
    expect(tradeFromNaics('484210')).toBe('Moving');
    expect(tradeFromNaics('236118')).toBe('Remodeling');
    expect(tradeFromNaics('722511')).toBe(''); // restaurant
    expect(tradeFromNaics('811111')).toBe(''); // auto repair
  });
});

describe('source parsers', () => {
  it('parses an L&I row', () => {
    const b = fromLI(liRow)!;
    expect(b.id).toBe('wa-605854613');
    expect(b.company).toBe('Eco Star C G Construction LLC');
    expect(b.contactName).toBe('Carlos Guerrero Martinez');
    expect(b.phone).toBe('5039573452');
    expect(b.city).toBe('Vancouver');
    expect(b.licenseStart).toBe('2025-08-15');
  });
  it('parses Seattle, Bellevue and Tacoma rows', () => {
    const s = fromSeattle(seaRow)!;
    expect(s.trade).toBe('Plumbing & HVAC');
    expect(s.contactName).toBe('John Smith');
    expect(s.phone).toBe('2065550100');
    const bel = fromBellevue(belRow)!;
    expect(bel.id).toBe('wa-605981636');
    expect(bel.trade).toBe('Cleaning');
    expect(bel.phone).toBe('');
    expect(fromBellevue({ ...belRow, CancelDate: 123 })).toBeNull();
    const t = fromTacoma(tacRow)!;
    expect(t.trade).toBe('Painting');
    expect(t.company).toBe('Dewitt Construction / Painting');
    expect(t.contactName).toBe('Scott Dewitt');
    expect(t.specialty).toBe('Painting And Wall Covering Contractors');
    expect(fromSeattle({ ...seaRow, naics_code: '722511' })).toBeNull();
  });
});

describe('merging and scoring', () => {
  it('merges the same business from two sources by UBI', () => {
    const merged = mergeBusinesses([[fromLI({ ...liRow, phonenumber: '' })!], [fromSeattle(seaRow)!]]);
    expect(merged.size).toBe(1);
    const b = merged.get('wa-605854613')!;
    expect(b.sources).toEqual(['li', 'seattle']);
    expect(b.phone).toBe('2065550100'); // filled in from Seattle
    expect(b.company).toBe('Eco Star C G Construction LLC'); // L&I wins
    expect(b.trade).toBe('Plumbing & HVAC'); // specific trade beats "General Contractor"
  });
  it('merges records that share a phone number', () => {
    const a = fromSeattle({ ...seaRow, ubi: '' })!;
    const t = { ...fromTacoma(tacRow)!, phone: '2065550100' };
    expect(mergeBusinesses([[a], [t]]).size).toBe(1);
  });
  it('scores callable, residential, new small businesses highest', () => {
    const now = Date.parse('2025-09-01');
    const hot = scoreBusiness({ trade: 'HVAC', phone: '1', contactName: 'x', ownership: 'Limited Liability Company', licenseStart: '2025-08-15', sources: ['li', 'seattle'] }, [], now);
    const cold = scoreBusiness({ trade: 'Commercial / Industrial', phone: '', contactName: '', ownership: 'Corporation', licenseStart: '2001-01-01', sources: ['li'] }, [], now);
    expect(hot).toBe(100);
    expect(cold).toBeLessThan(15);
    const gc = scoreBusiness({ trade: 'General Contractor', phone: '1', contactName: 'x', ownership: 'Corporation', licenseStart: '2010-01-01', sources: ['li'] }, [], now);
    expect(scoreBusiness({ trade: 'General Contractor', phone: '1', contactName: 'x', ownership: 'Corporation', licenseStart: '2010-01-01', sources: ['li'] }, ['General Contractor'], now)).toBe(gc + 15);
  });
  it('produces a virtual lead', () => {
    const l = toLead(fromLI(liRow)!);
    expect(l).toMatchObject({ id: 'wa-605854613', status: 'New', origin: 'public', source: 'WA L&I', createdAt: '', attempts: 0 });
  });
});
