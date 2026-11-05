/**
 * Pure helpers for public-record leads: trade mapping, name cleanup, scoring, merging.
 * No network or storage here so it can be unit tested.
 */

export type SourceId = 'li' | 'seattle' | 'seattleLoc' | 'everett' | 'bellevue' | 'tacoma' | 'liLapsed';

export const SOURCE_LABEL: Record<SourceId, string> = {
  li: 'WA L&I',
  seattle: 'Seattle',
  seattleLoc: 'Seattle (owners)',
  everett: 'Everett',
  liLapsed: 'WA L&I (lapsed)',
  bellevue: 'Bellevue',
  tacoma: 'Tacoma',
};

/** A normalised business from any public source. */
export interface PublicBiz {
  id: string;
  sources: SourceId[];
  company: string;
  contactName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  trade: string;
  specialty: string;
  licenseNo: string;
  ubi: string;
  ownership: string;
  licenseStart: string; // ISO date
  naics: string;
  /** Extra identifiers used to merge records across sources, e.g. "seaacct:0001325410134112". */
  keys?: string[];
  /** Contractor license expired on this date (lapsed-license source). */
  lapsedAt?: string;
  /** No longer present in any source since this date (kept so nothing is lost). */
  notListedSince?: string;
}

// ---------------------------------------------------------------- trades

/** L&I specialty descriptions → CRM trade. Matched case-insensitively by prefix/contains. */
const LI_SPECIALTY: [RegExp, string][] = [
  [/^GENERAL$/, 'General Contractor'],
  [/PAINTING/, 'Painting'],
  [/FLOOR COVERING/, 'Flooring'],
  [/^LANDSCAPING/, 'Landscaping'],
  [/^TILE/, 'Tile & Stone'],
  [/CABINETS|FINISH CARPENTRY/, 'Cabinets & Carpentry'],
  [/^CONCRETE/, 'Concrete'],
  [/^HANDYMAN/, 'Handyman'],
  [/HVAC|HEATING\/VENT/, 'HVAC'],
  [/TREE REMOVAL/, 'Tree Service'],
  [/^PLUMBING/, 'Plumbing'],
  [/^ROOFING/, 'Roofing'],
  [/DRY ?WALL/, 'Drywall'],
  [/FRAMING/, 'Remodeling'],
  [/^SIDING/, 'Siding'],
  [/EXCAVATION|LAND CLEARING/, 'Excavation'],
  [/^MASONRY/, 'Masonry'],
  [/PRESSURE WASHING/, 'Pressure Washing'],
  [/^FENCING/, 'Fencing'],
  [/GLAZING|GLASS/, 'Windows & Doors'],
  [/PAVING/, 'Paving'],
  [/WINDOW COVERINGS/, 'Window Coverings'],
  [/PUMP & IRRIGATION|DOMESTIC PUMP|WELL DRILLING/, 'Well & Pump'],
  [/INSULATION/, 'Insulation'],
  [/GUTTERS/, 'Gutters'],
  [/OVERHEAD\/GARAGE|DOORS, GATES|DOORS & GATES/, 'Garage Doors'],
  [/CONSTRUCTION CLEAN/, 'Cleaning'],
  [/LOCKS, SECURITY/, 'Locksmith'],
  [/SANITATION SYSTEM|SIDE SEWERS/, 'Septic & Sewer'],
  [/IRRIGATION\/SPRINKLING/, 'Irrigation'],
  [/SWIMMING POOLS/, 'Pool Service'],
  [/APPLIANCE/, 'Appliance Repair'],
  [/STRUCTURAL PEST/, 'Pest Control'],
  [/DRAIN CLEANING|WATER CONDITIONING|BACKFLOW/, 'Plumbing'],
  [/WOOD\/PELLET|GAS STOVES/, 'Fireplace & Stoves'],
  [/DEMOLITION/, 'Demolition'],
  [/AWNINGS|CLOSETS|LATHING|SUSPENDED CEILING|CENTRAL VACUUM|MANUFACTURED\/MOBILE/, 'Remodeling'],
  [/ASBESTOS/, 'Demolition'],
  [/^RESIDENTIAL( MAINTENANCE)?$|^LIMITED ENERGY|^JOURNEY LEVEL|^ALL AREAS|^MAINTENANCE|LIGHTING MAINT|^INSTALLATION/, ''], // decided by license type
  [/SIGN|STEEL ERECT|UTILITIES AND TELECOM|INDUSTRIAL EQUIP|ELEVATOR|BOILER|METAL FABRICATION|WELDING|SCAFFOLD|SANDBLAST|FIRE PROTECT|INST EQUIP|SERVICE STATION|DRILLING, BLASTING|TANKS AND TANK|FIREPROOFING|COMMERCIAL\/INDUSTRIAL|EQUIPMENT REPAIR/, 'Commercial / Industrial'],
];

export function tradeFromLI(licenseType: string, specialty1: string, specialty2 = ''): string {
  const s = `${specialty1 || ''}`.toUpperCase().trim();
  const s2 = `${specialty2 || ''}`.toUpperCase().trim();
  if (/HVAC/.test(s) || /HVAC/.test(s2)) return 'HVAC';
  if (licenseType === 'EC') return 'Electrical';
  if (licenseType === 'PC') return 'Plumbing';
  if (licenseType === 'LC') return 'Commercial / Industrial'; // elevator contractors
  for (const [re, trade] of LI_SPECIALTY) if (re.test(s)) return trade || 'General Contractor';
  return s ? 'Other' : 'General Contractor';
}

/** NAICS code → CRM trade ('' = not a home-service business). */
export function tradeFromNaics(code: string): string {
  const c = String(code || '').trim();
  if (!c) return '';
  const table: [string, string][] = [
    ['236115', 'General Contractor'], ['236116', 'General Contractor'], ['236117', 'General Contractor'],
    ['236118', 'Remodeling'], ['2362', 'Commercial / Industrial'],
    ['238110', 'Concrete'], ['238120', 'Commercial / Industrial'], ['238130', 'Remodeling'], ['238140', 'Masonry'],
    ['238150', 'Windows & Doors'], ['238160', 'Roofing'], ['238170', 'Siding'], ['238190', 'Concrete'],
    ['238210', 'Electrical'], ['238220', 'Plumbing & HVAC'], ['238290', 'Garage Doors'],
    ['238310', 'Drywall'], ['238320', 'Painting'], ['238330', 'Flooring'], ['238340', 'Tile & Stone'],
    ['238350', 'Cabinets & Carpentry'], ['238390', 'Remodeling'], ['238910', 'Excavation'], ['238990', 'Handyman'],
    ['561710', 'Pest Control'], ['561720', 'Cleaning'], ['561730', 'Landscaping'], ['561740', 'Carpet Cleaning'],
    ['561790', 'Pressure Washing'], ['561621', 'Locksmith'], ['561622', 'Locksmith'],
    ['811411', 'Appliance Repair'], ['811412', 'Appliance Repair'],
    ['484210', 'Moving'], ['562111', 'Junk Removal'], ['562119', 'Junk Removal'], ['562991', 'Septic & Sewer'],
  ];
  for (const [prefix, trade] of table) if (c.startsWith(prefix)) return trade;
  return '';
}

/** NAICS prefixes to request from city datasets (server-side filter). */
export const HOME_SERVICE_NAICS = ['23611', '238', '5617', '56162', '81141', '4842', '5621', '562991'];

// ---------------------------------------------------------------- cleanup

const KEEP_UPPER = new Set(['LLC', 'INC', 'PLLC', 'LLP', 'LP', 'HVAC', 'USA', 'NW', 'NE', 'SW', 'SE', 'II', 'III', 'IV', 'PNW', 'DBA', 'CO.', 'GC']);

export function titleCase(s: string): string {
  return String(s || '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .trim()
    .split(/\s+/)
    .map((w) => {
      const u = w.toUpperCase();
      if (KEEP_UPPER.has(u.replace(/[.,]$/, ''))) return u;
      if (/^\d/.test(w) || (w.length <= 2 && !/[aeiouy]/i.test(w))) return u; // "C G", "4X"
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** "GUERRERO MARTINEZ, CARLOS I." → "Carlos Guerrero Martinez" */
export function ownerName(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes(',')) {
    const [last, rest] = s.split(',', 2);
    const first = (rest || '').trim().split(/\s+/)[0] || '';
    return titleCase(`${first} ${last}`.trim());
  }
  return titleCase(s);
}

export const digits = (p: string) => String(p || '').replace(/\D/g, '');
export const phoneKey = (p: string) => digits(p).slice(-10);

export function cleanPhone(p: string): string {
  const d = digits(p);
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d.length === 10 ? d : '';
}

export const ubi9 = (u: string) => {
  const d = digits(u);
  return d.length >= 9 ? d.slice(0, 9) : '';
};

/** Accepts "2025-08-15T00:00:00.000", "20140814", "2022/01/01", "09/28/2025", epoch ms. */
export function isoDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return '';
}

// ---------------------------------------------------------------- source rows → PublicBiz

export function fromLI(r: Record<string, any>): PublicBiz | null {
  const company = titleCase(r.businessname);
  if (!company) return null;
  const ubi = ubi9(r.ubi);
  return {
    id: ubi ? `wa-${ubi}` : `li-${r.contractorlicensenumber}`,
    sources: ['li'],
    company,
    contactName: ownerName(r.primaryprincipalname),
    phone: cleanPhone(r.phonenumber),
    address: titleCase([r.address1, r.address2].filter(Boolean).join(' ')),
    city: titleCase(r.city),
    state: r.state || 'WA',
    zip: String(r.zip || '').slice(0, 5),
    trade: tradeFromLI(r.contractorlicensetypecode, r.specialtycode1desc, r.specialtycode2desc),
    specialty: [r.contractorlicensetypecodedesc, r.specialtycode1desc].filter(Boolean).map(titleCase).join(' · '),
    licenseNo: r.contractorlicensenumber || '',
    ubi,
    ownership: r.businesstypecodedesc || '',
    licenseStart: isoDate(r.licenseeffectivedate),
    naics: '',
  };
}

export function fromSeattle(r: Record<string, any>): PublicBiz | null {
  const trade = tradeFromNaics(r.naics_code);
  if (!trade) return null;
  const company = titleCase(r.trade_name || r.business_legal_name);
  if (!company) return null;
  const ubi = ubi9(r.ubi);
  const isPerson = /sole/i.test(r.ownership_type || '');
  return {
    id: ubi ? `wa-${ubi}` : `sea-${r.city_account_number}`,
    sources: ['seattle'],
    company,
    contactName: isPerson && r.business_legal_name ? ownerName(String(r.business_legal_name).replace(/^(\S+)\s+(.*)$/, '$1, $2')) : '',
    phone: cleanPhone(r.business_phone),
    address: titleCase(r.street_address),
    city: titleCase(r.city),
    state: r.state || 'WA',
    zip: String(r.zip || '').slice(0, 5),
    trade,
    specialty: titleCase(r.naics_description || ''),
    licenseNo: '',
    ubi,
    ownership: r.ownership_type || '',
    licenseStart: isoDate(r.license_start_date),
    naics: String(r.naics_code || ''),
    keys: r.city_account_number ? [`seaacct:${r.city_account_number}`] : [],
  };
}

/** "317 27TH AVE S, SEATTLE, WA 98144" / "212 74TH ST SE, EVERETT, WA, 98203" → parts */
export function splitAddress(a: string): { street: string; city: string; state: string; zip: string } {
  const parts = String(a || '').split(',').map((x) => x.trim()).filter(Boolean);
  const zipM = String(a || '').match(/\b(\d{5})(?:-\d{4})?\s*$/);
  const stateM = String(a || '').match(/\b([A-Z]{2})\b[ ,]*\d{5}/);
  return {
    street: parts[0] || '',
    city: parts.length > 1 ? parts[1].replace(/\s+[A-Z]{2}\s*\d{5}.*$/, '') : '',
    state: stateM ? stateM[1] : 'WA',
    zip: zipM ? zipM[1] : '',
  };
}

/** Seattle "Business Locations (Active)" layer — has owner/contact names. */
export function fromSeattleLoc(r: Record<string, any>): PublicBiz | null {
  const trade = tradeFromNaics(r.BUSLIC_NAICS_CODE);
  if (!trade) return null;
  const company = titleCase(r.BUSLIC_TRADE_NAME || r.BUSLIC_LEGAL_NAME);
  if (!company) return null;
  const a = splitAddress(r.BUSLIC_LOCATION_ADRS_TEXT || r.BUSLIC_MAIL_ADRS_TEXT || '');
  const acct = String(r.BUSLIC_CITYACCTNUM || '').trim();
  return {
    id: acct ? `sea-${acct}` : `sealoc-${r.BUSLIC_ID}`,
    sources: ['seattleLoc'],
    company,
    contactName: titleCase(r.BUSLIC_CONTACT_NAME || ''),
    phone: cleanPhone(r.BUSLIC_PHONE_NUM),
    address: titleCase(a.street),
    city: titleCase(a.city || 'Seattle'),
    state: a.state,
    zip: a.zip,
    trade,
    specialty: titleCase(String(r.BUSLIC_NAICS_DESC || r['NAICS DESC'] || '').trim()),
    licenseNo: '',
    ubi: '',
    ownership: '',
    licenseStart: isoDate(r.BUSLIC_OPENDATE),
    naics: String(r.BUSLIC_NAICS_CODE || ''),
    keys: acct ? [`seaacct:${acct}`] : [],
  };
}

export function fromEverett(r: Record<string, any>): PublicBiz | null {
  const trade = tradeFromNaics(r.naics);
  if (!trade) return null;
  const company = titleCase(r.primarydba || r.legalentityname);
  if (!company) return null;
  const ubi = ubi9(r.ubi);
  const a = splitAddress(r.address || '');
  return {
    id: ubi ? `wa-${ubi}` : `evt-${r.registration}`,
    sources: ['everett'],
    company,
    contactName: '',
    phone: '',
    address: titleCase(a.street),
    city: titleCase(a.city || 'Everett'),
    state: a.state,
    zip: a.zip,
    trade,
    specialty: '',
    licenseNo: '',
    ubi,
    ownership: '',
    licenseStart: isoDate(r.firstactivitydate || r.issuedate),
    naics: String(r.naics || ''),
  };
}

/** Recently expired L&I licenses: same shape as fromLI, flagged as lapsed. */
export function fromLILapsed(r: Record<string, any>): PublicBiz | null {
  const b = fromLI(r);
  if (!b) return null;
  return { ...b, sources: ['liLapsed'], lapsedAt: isoDate(r.licenseexpirationdate) };
}

export function fromBellevue(r: Record<string, any>): PublicBiz | null {
  if (r.CancelDate) return null;
  const trade = tradeFromNaics(r.Naic);
  if (!trade) return null;
  const company = titleCase(r.Dba || r.LegalEntityName);
  if (!company) return null;
  const ubi = ubi9(r.Ubi);
  return {
    id: ubi ? `wa-${ubi}` : `bel-${r.BusinessId}`,
    sources: ['bellevue'],
    company,
    contactName: '',
    phone: '',
    address: titleCase(r.PhysicalAddressLine1 || r.MailingAddressLine1 || ''),
    city: titleCase(r.PhysicalCity || r.MailingCity || 'Bellevue'),
    state: r.PhysicalState || r.MailingState || 'WA',
    zip: String(r.PhysicalPostalCode || r.MailingPostalCode || '').slice(0, 5),
    trade,
    specialty: r.ProductsAndServices ? String(r.ProductsAndServices).slice(0, 140).toLowerCase() : '',
    licenseNo: '',
    ubi,
    ownership: titleCase(r.LegalEntityType || ''),
    licenseStart: isoDate(r.FirstActivityDate),
    naics: String(r.Naic || ''),
  };
}

export function fromTacoma(r: Record<string, any>): PublicBiz | null {
  const trade = tradeFromNaics(r.NAICS_Code);
  if (!trade) return null;
  const company = titleCase(r.Trade_Name || r.Business_Name);
  if (!company) return null;
  return {
    id: `tac-${r.License_Number}`,
    sources: ['tacoma'],
    company,
    contactName: r.Trade_Name && r.Business_Name && r.Trade_Name !== r.Business_Name ? titleCase(r.Business_Name) : '',
    phone: '',
    address: titleCase(r.Site_Street || r.Mailing_Street || ''),
    city: titleCase(r.Site_City || r.Mailing_City || 'Tacoma'),
    state: r.Site_State || r.Mailing_State || 'WA',
    zip: String(r.Site_Zip_Code || r.Mailing_Zip_Code || '').slice(0, 5),
    trade,
    specialty: titleCase(String(r.NAICS_Code_Description || '').replace(/\s*\(ES.*$/, '')),
    licenseNo: String(r.License_Number || ''),
    ubi: '',
    ownership: '',
    licenseStart: isoDate(r.Business_Open_Date),
    naics: String(r.NAICS_Code || ''),
  };
}

// ---------------------------------------------------------------- merge

/** Merge businesses from several sources: same id (state UBI) → one record; earlier sources win per field. */
const NO_MERGE = new Set(['sources', 'id', 'keys', 'lapsedAt', 'notListedSince']);

/**
 * Merge businesses from several sources into one record each. Records are the same business when they share
 * an id (state UBI), any extra key (e.g. Seattle account number) or a phone number. Earlier sources win per field;
 * later ones only fill gaps, so partial records still enrich each other.
 */
export function mergeBusinesses(lists: PublicBiz[][]): Map<string, PublicBiz> {
  const out = new Map<string, PublicBiz>();
  const alias = new Map<string, string>(); // key → id
  const keysOf = (b: PublicBiz) => [...(b.keys || []), ...(b.phone ? [`phone:${phoneKey(b.phone)}`] : [])];
  for (const list of lists) {
    for (const b of list) {
      let id = b.id;
      if (!out.has(id)) {
        const hit = keysOf(b).map((k) => alias.get(k)).find(Boolean);
        if (hit) id = hit;
      }
      const cur = out.get(id);
      if (!cur) {
        out.set(id, { ...b, id, sources: [...b.sources], keys: [...(b.keys || [])] });
      } else {
        for (const k of Object.keys(b) as (keyof PublicBiz)[]) {
          if (NO_MERGE.has(k)) continue;
          if (!cur[k] && b[k]) (cur as any)[k] = b[k];
        }
        // a specific trade beats the catch-all "General Contractor"
        if (cur.trade === 'General Contractor' && b.trade && b.trade !== 'General Contractor' && b.trade !== 'Commercial / Industrial')
          cur.trade = b.trade;
        for (const s of b.sources) if (!cur.sources.includes(s)) cur.sources.push(s);
        for (const k of b.keys || []) if (!cur.keys!.includes(k)) cur.keys!.push(k);
        // a lapsed record merging into an active one does not make it lapsed
        if (cur.lapsedAt && !b.lapsedAt) delete cur.lapsedAt;
      }
      const target = out.get(id)!;
      for (const k of keysOf(target)) if (!alias.has(k)) alias.set(k, id);
    }
  }
  return out;
}

/**
 * Keep businesses that dropped out of the latest download (license ended, list changed) for a year,
 * marked "not listed", so partial leads are never lost. Only applies to sources that downloaded successfully.
 */
export function carryOver(prev: Map<string, PublicBiz>, next: Map<string, PublicBiz>, okSources: Set<SourceId>,
  now = Date.now(), keepDays = 365): Map<string, PublicBiz> {
  const today = new Date(now).toISOString().slice(0, 10);
  for (const [id, b] of next) if (b.notListedSince) delete b.notListedSince;
  for (const [id, old] of prev) {
    if (next.has(id)) continue;
    if (!old.sources.every((s) => okSources.has(s))) continue; // its source failed: handled by the caller
    const since = old.notListedSince || today;
    if (daysSince(since, now) > keepDays) continue;
    next.set(id, { ...old, notListedSince: since });
  }
  return next;
}

/** Which useful fields a lead is still missing (drives the "Needs info" worklist). */
export function missingInfo(l: { phone?: string; contactName?: string; address?: string; website?: string; email?: string }): string[] {
  const m: string[] = [];
  if (!l.phone) m.push('phone');
  if (!l.contactName) m.push('owner name');
  if (!l.address) m.push('address');
  if (!l.website) m.push('website');
  if (!l.email) m.push('email');
  return m;
}

// ---------------------------------------------------------------- scoring

const TIER_A = new Set(['HVAC', 'Plumbing', 'Plumbing & HVAC', 'Roofing', 'Electrical', 'Remodeling', 'Landscaping',
  'Tree Service', 'Pest Control', 'Garage Doors', 'Septic & Sewer', 'Lawn Care']);
const TIER_C = new Set(['Commercial / Industrial', 'Other']);

export function daysSince(iso: string, now = Date.now()): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return isNaN(t) ? Infinity : (now - t) / 86400000;
}

/** 0-100: how worth calling this business is. */
export function scoreBusiness(b: Pick<PublicBiz, 'trade' | 'phone' | 'contactName' | 'ownership' | 'licenseStart' | 'sources'> & Partial<PublicBiz>,
  priorityTrades: string[] = [], now = Date.now()): number {
  let s = 0;
  if (TIER_A.has(b.trade)) s += 40;
  else if (b.trade === 'General Contractor') s += 22;
  else if (TIER_C.has(b.trade)) s += 5;
  else s += 30;
  if (priorityTrades.includes(b.trade)) s += 15;
  if (b.phone) s += 20;
  if (b.contactName) s += 10;
  const own = (b.ownership || '').toLowerCase();
  if (/individual|sole|limited liability company|llc/.test(own)) s += 10;
  else if (/partnership/.test(own)) s += 7;
  else if (/corporation/.test(own)) s += 4;
  const age = daysSince(b.licenseStart, now);
  if (age <= 90) s += 15;
  else if (age <= 365) s += 8;
  if (b.sources.length > 1) s += 5;
  if ((b as PublicBiz).lapsedAt) s -= 15;
  if ((b as PublicBiz).notListedSince) s -= 25;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export const isNewBusiness = (licenseStart: string, now = Date.now()) => daysSince(licenseStart, now) <= 30;

/** PublicBiz → the CRM Lead shape (virtual until first touched). */
export function toLead(b: PublicBiz, priorityTrades: string[] = [], now = Date.now()) {
  return {
    id: b.id,
    company: b.company,
    contactName: b.contactName,
    phone: b.phone,
    altPhone: '',
    email: '',
    website: '',
    trade: b.trade,
    city: b.city,
    state: b.state,
    address: b.address,
    source: b.sources.map((s) => SOURCE_LABEL[s]).join(', '),
    status: 'New' as const,
    quality: '' as const,
    disqualifyReason: '',
    tags: '',
    attempts: 0,
    lastContactedAt: '',
    lastOutcome: '',
    nextFollowUpAt: '',
    notes: '',
    convertedContactId: '',
    createdAt: '',
    updatedAt: '',
    deleted: false,
    origin: 'public' as const,
    score: scoreBusiness(b, priorityTrades, now),
    licenseNo: b.licenseNo,
    ubi: b.ubi,
    specialty: b.specialty,
    licenseStart: b.licenseStart,
    ownership: b.ownership,
    sources: b.sources.join(','),
    naics: b.naics,
    zip: b.zip,
    lapsedAt: b.lapsedAt || '',
    notListedSince: b.notListedSince || '',
  };
}
