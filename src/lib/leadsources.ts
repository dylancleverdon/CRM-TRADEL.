/**
 * Lead Finder data: downloads public Washington business records to this device and exposes
 * them to the CRM as virtual leads (see store.virtualLeads). Nothing here is written to the
 * Google Sheet until a lead is actually worked.
 */
import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import {
  carryOver, fromBellevue, fromEverett, fromLI, fromLILapsed, fromSeattle, fromSeattleLoc, fromTacoma, HOME_SERVICE_NAICS,
  mergeBusinesses, toLead, type PublicBiz, type SourceId,
} from './leadmap';
import { httpRequest } from './platform';
import { getSetting, store } from './store';

export interface SourceDef {
  id: SourceId;
  name: string;
  description: string;
  hasPhones: boolean;
  fetchAll: (onPage: (n: number) => void) => Promise<PublicBiz[]>;
}

const PAGE = 5000; // keep each response small enough for the phone's native bridge

async function getJson(url: string): Promise<any> {
  const res = await httpRequest(url, 'GET');
  if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return JSON.parse(res.text);
}

async function socrataAll(domain: string, ds: string, params: Record<string, string>, onPage: (n: number) => void) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({ ...params, $limit: String(PAGE), $offset: String(offset) });
    const page = await getJson(`https://${domain}/resource/${ds}.json?${q}`);
    if (!Array.isArray(page)) throw new Error(page?.message || 'Unexpected response');
    rows.push(...page);
    onPage(rows.length);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function arcgisAll(layerUrl: string, where: string, fields: string, onPage: (n: number) => void, orderBy = 'OBJECTID') {
  const rows: any[] = [];
  const step = 2000; // ArcGIS Online max records per request
  for (let offset = 0; ; offset += step) {
    const q = new URLSearchParams({
      where, outFields: fields, returnGeometry: 'false', f: 'json',
      resultOffset: String(offset), resultRecordCount: String(step), orderByFields: orderBy,
    });
    const page = await getJson(`${layerUrl}/query?${q}`);
    if (page.error) throw new Error(page.error.message || 'ArcGIS error');
    const feats = (page.features || []).map((f: any) => f.attributes);
    rows.push(...feats);
    onPage(rows.length);
    if (feats.length < step && !page.exceededTransferLimit) break;
    if (!feats.length) break;
  }
  return rows;
}

const naicsWhereSoql = (col: string) => HOME_SERVICE_NAICS.map((p) => `starts_with(${col}, '${p}')`).join(' OR ');
const naicsWhereArc = (col: string) => HOME_SERVICE_NAICS.map((p) => `${col} LIKE '${p}%'`).join(' OR ');
const LI_SELECT = 'businessname,contractorlicensenumber,contractorlicensetypecode,contractorlicensetypecodedesc,address1,address2,city,state,zip,phonenumber,licenseeffectivedate,licenseexpirationdate,businesstypecodedesc,specialtycode1desc,specialtycode2desc,ubi,primaryprincipalname';
const yearsAgo = (n: number) => new Date(Date.now() - n * 365 * 86400000).toISOString().slice(0, 10);

export const SOURCES: SourceDef[] = [
  {
    id: 'li',
    name: 'WA L&I contractor registry',
    description: 'Every licensed contractor in Washington — phone, owner name, trade. ~76k active.',
    hasPhones: true,
    fetchAll: async (onPage) =>
      (await socrataAll('data.wa.gov', 'm8qx-ubtq', {
        $select: LI_SELECT,
        $where: "statuscode='A'",
        $order: 'contractorlicensenumber',
      }, onPage)).map(fromLI).filter(Boolean) as PublicBiz[],
  },
  {
    id: 'seattle',
    name: 'Seattle business licenses',
    description: 'Home-service businesses licensed to work in Seattle (incl. cleaning, landscaping, movers) — with phones.',
    hasPhones: true,
    fetchAll: async (onPage) =>
      (await socrataAll('cos-data.seattle.gov', 'wnbq-64tb', {
        $where: naicsWhereSoql('naics_code'),
        $order: 'city_account_number',
      }, onPage)).map(fromSeattle).filter(Boolean) as PublicBiz[],
  },
  {
    id: 'seattleLoc',
    name: 'Seattle business locations (owner names)',
    description: 'Businesses physically located in Seattle — adds owner/contact names and phones, matched by city account number.',
    hasPhones: true,
    fetchAll: async (onPage) =>
      (await arcgisAll('https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Seattle_Business_License/FeatureServer/0',
        naicsWhereArc('BUSLIC_NAICS_CODE'),
        'objectid,BUSLIC_ID,BUSLIC_LEGAL_NAME,BUSLIC_TRADE_NAME,BUSLIC_CONTACT_NAME,BUSLIC_PHONE_NUM,BUSLIC_NAICS_CODE,BUSLIC_NAICS_DESC,BUSLIC_LOCATION_ADRS_TEXT,BUSLIC_MAIL_ADRS_TEXT,BUSLIC_OPENDATE,BUSLIC_CITYACCTNUM',
        onPage, 'objectid')).map(fromSeattleLoc).filter(Boolean) as PublicBiz[],
  },
  {
    id: 'everett',
    name: 'Everett business licenses',
    description: 'Home-service businesses licensed in Everett. No phones — matched to other sources by state UBI.',
    hasPhones: false,
    fetchAll: async (onPage) =>
      (await socrataAll('data.everettwa.gov', 'qvfa-2v26', {
        $select: 'registration,legalentityname,primarydba,ubi,naics,address,issuedate,firstactivitydate',
        $where: naicsWhereSoql('naics'),
        $order: 'registration',
      }, onPage)).map(fromEverett).filter(Boolean) as PublicBiz[],
  },
  {
    id: 'bellevue',
    name: 'Bellevue business licenses',
    description: 'Home-service businesses licensed in Bellevue. No phones — matched to other sources by state UBI.',
    hasPhones: false,
    fetchAll: async (onPage) =>
      (await arcgisAll('https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Business_Licenses_(All)/FeatureServer/3',
        `CancelDate IS NULL AND (${naicsWhereArc('Naic')})`,
        'OBJECTID,BusinessId,LegalEntityName,Dba,Ubi,Naic,LegalEntityType,FirstActivityDate,CancelDate,MailingAddressLine1,MailingCity,MailingState,MailingPostalCode,PhysicalAddressLine1,PhysicalCity,PhysicalState,PhysicalPostalCode,ProductsAndServices',
        onPage)).map(fromBellevue).filter(Boolean) as PublicBiz[],
  },
  {
    id: 'tacoma',
    name: 'Tacoma business licenses',
    description: 'Home-service businesses licensed in Tacoma. No phones.',
    hasPhones: false,
    fetchAll: async (onPage) =>
      (await arcgisAll('https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/Business_Licenses/FeatureServer/0',
        naicsWhereArc('NAICS_Code'),
        'OBJECTID,License_Number,Business_Name,Business_Open_Date,Trade_Name,NAICS_Code,NAICS_Code_Description,Mailing_Street,Mailing_City,Mailing_State,Mailing_Zip_Code,Site_Street,Site_City,Site_State,Site_Zip_Code',
        onPage)).map(fromTacoma).filter(Boolean) as PublicBiz[],
  },
  {
    id: 'liLapsed',
    name: 'WA L&I lapsed licenses (last 2 years)',
    description: 'Contractors whose license expired recently — many are still working or about to renew. Scored lower.',
    hasPhones: true,
    fetchAll: async (onPage) =>
      (await socrataAll('data.wa.gov', 'm8qx-ubtq', {
        $select: LI_SELECT,
        $where: `statuscode='E' AND licenseexpirationdate > '${yearsAgo(2)}T00:00:00'`,
        $order: 'contractorlicensenumber',
      }, onPage)).map(fromLILapsed).filter(Boolean) as PublicBiz[],
  },
];

export const DEFAULT_ENABLED: Record<SourceId, boolean> = { li: true, seattle: true, seattleLoc: true, everett: true, bellevue: true, tacoma: true, liLapsed: true };

// ---------------------------------------------------------------- state

export interface SourceStatus { count: number; fetchedAt: number; error: string }
export interface FinderState {
  loaded: boolean;
  refreshing: boolean;
  progress: string;
  total: number;
  withPhone: number;
  fetchedAt: number;
  sources: Partial<Record<SourceId, SourceStatus>>;
}

let state: FinderState = { loaded: false, refreshing: false, progress: '', total: 0, withPhone: 0, fetchedAt: 0, sources: {} };
const listeners = new Set<() => void>();
const setState = (p: Partial<FinderState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
export const useFinder = () =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);

const KEY_DATA = 'pool:v1';
const KEY_META = 'pool:meta:v1';
let pool: Map<string, PublicBiz> = new Map();

export const getPool = () => pool;

/** Rebuild the virtual leads (e.g. after priority trades change). */
export function publishPool() {
  const priority = getSetting<string[]>('priorityTrades', []);
  const enabled = getSetting<Record<SourceId, boolean>>('publicSources', DEFAULT_ENABLED);
  const now = Date.now();
  // Skip businesses that are already in the CRM under another id (same phone number).
  const knownPhones = new Set(
    Array.from(store.data.leads.values()).concat(Array.from(store.data.contacts.values()) as any)
      .map((l: any) => String(l.phone || '').replace(/\D/g, '').slice(-10)).filter(Boolean),
  );
  const out = new Map<string, any>();
  let withPhone = 0;
  for (const b of pool.values()) {
    if (!b.sources.some((s) => enabled[s] !== false)) continue;
    const pk = b.phone.slice(-10);
    if (pk && knownPhones.has(pk) && !store.data.leads.has(b.id)) continue;
    if (b.phone) withPhone++;
    out.set(b.id, toLead(b, priority, now));
  }
  store.setVirtualLeads(out);
  setState({ total: out.size, withPhone });
}

export async function loadPool() {
  try {
    const rows = ((await get(KEY_DATA)) as PublicBiz[] | undefined) || [];
    pool = new Map(rows.map((b) => [b.id, b]));
    const meta = (await get(KEY_META)) as Partial<FinderState> | undefined;
    setState({ loaded: true, fetchedAt: meta?.fetchedAt || 0, sources: meta?.sources || {} });
    publishPool();
  } catch (e) {
    setState({ loaded: true });
  }
}

/** Download every enabled source again and replace the local copy. */
export async function refreshPool(): Promise<void> {
  if (state.refreshing) return;
  setState({ refreshing: true, progress: 'Starting…' });
  const enabled = getSetting<Record<SourceId, boolean>>('publicSources', DEFAULT_ENABLED);
  const lists: PublicBiz[][] = [];
  const sources = { ...state.sources };
  const ok = new Set<SourceId>();
  // keep previously downloaded data for any source that fails this time
  const previous = (id: SourceId) => Array.from(pool.values()).filter((b) => b.sources[0] === id);
  for (const src of SOURCES) {
    if (enabled[src.id] === false) continue;
    try {
      const list = await src.fetchAll((n) => setState({ progress: `${src.name}: ${n.toLocaleString()} records…` }));
      lists.push(list);
      ok.add(src.id);
      sources[src.id] = { count: list.length, fetchedAt: Date.now(), error: '' };
    } catch (e: any) {
      lists.push(previous(src.id));
      sources[src.id] = { ...(sources[src.id] || { count: 0, fetchedAt: 0 }), error: e?.message || String(e) };
    }
  }
  // disabled sources count as "ok" so their old records are simply dropped
  for (const src of SOURCES) if (enabled[src.id] === false) ok.add(src.id);
  pool = carryOver(pool, mergeBusinesses(lists), ok);
  const fetchedAt = Date.now();
  try {
    await set(KEY_DATA, Array.from(pool.values()));
    await set(KEY_META, { fetchedAt, sources });
  } catch { /* storage full: keep in memory */ }
  setState({ refreshing: false, progress: '', fetchedAt, sources });
  publishPool();
}

const WEEK = 7 * 86400000;

/** Called at startup: load the local copy, refresh in the background if it's older than a week. */
export function startLeadSources() {
  loadPool().then(() => {
    if (Date.now() - state.fetchedAt > WEEK) setTimeout(() => refreshPool(), 8000);
  });
  // re-publish when shared settings (priority trades / enabled sources) change
  let lastKey = '';
  store.subscribe(() => {
    const key = JSON.stringify([getSetting('priorityTrades', []), getSetting('publicSources', DEFAULT_ENABLED)]);
    if (key !== lastKey) {
      const first = lastKey === '';
      lastKey = key;
      if (!first && state.loaded) publishPool();
    }
  });
}
