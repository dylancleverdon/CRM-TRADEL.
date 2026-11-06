import { outcomeDef } from './constants';
import { emailConnected } from './email';
import { relayToPhone } from './phonerelay';
import { isAndroid, isDesktop, Native } from './platform';
import { nowIso, store } from './store';
import type { EntityType } from './types';

/**
 * Saving people to the phone's contacts under a Google account (dylan@tradelink.marketing by default), so they sync
 * to Google Contacts and show as caller ID when they call back:
 * - automatically after a call on the phone (Settings → Phone contacts: every call / connected / off), and
 * - any time with the "Save to phone" button, no call needed. On the Mac the button asks your phone to do it.
 * Numbers already in contacts are left alone. The settings live on the phone.
 */
export type ContactSaveMode = 'off' | 'all' | 'connected';
export interface ContactSaveSettings { mode: ContactSaveMode; account: string }

export const DEFAULT_CONTACT_ACCOUNT = 'dylan@tradelink.marketing';
const KEY = 'tl.phoneContacts';

// Warnings are shown once per app session, not after every call.
const warned = new Set<string>();
const once = (key: string, msg: string) => (warned.has(key) ? '' : (warned.add(key), msg));

export function getContactSave(): ContactSaveSettings {
  const d: ContactSaveSettings = { mode: 'all', account: DEFAULT_CONTACT_ACCOUNT };
  try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return d; }
}

export function setContactSave(patch: Partial<ContactSaveSettings>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getContactSave(), ...patch })); } catch { /* ignore */ }
}

/** Whether this call should be saved, given the setting and (when known) the outcome. */
export function shouldSave(mode: ContactSaveMode, outcome: string | null): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return !!outcome && !!outcomeDef(outcome)?.connected;
}

function recordFor(type: EntityType | string, id: string): any {
  if (type === 'lead') return store.get('leads', id);
  if (type === 'contact') return store.get('contacts', id);
  const opp = store.get('opportunities', id);
  return opp ? store.get('contacts', opp.contactId) : undefined;
}

const noteFor = (rec: any) => ['From TradeLink CRM', rec.trade, rec.city].filter(Boolean).join(' · ');

/** Remembered on the record (synced), so the button shows "On my phone" on both devices. */
function markOnPhone(type: EntityType | string, id: string) {
  if (type === 'lead') store.upsert('leads', { id, phoneContactAt: nowIso() });
  else if (type === 'contact') store.upsert('contacts', { id, phoneContactAt: nowIso() });
}

export interface PhoneContactInput { name: string; company: string; title: string; phone: string; note: string; entityType: string; entityId: string }

function inputFor(e: { type: EntityType | string; id: string }): PhoneContactInput | null {
  const rec = recordFor(e.type, e.id);
  if (!rec?.phone) return null;
  return { name: rec.contactName || '', company: rec.company || '', title: rec.title || '', phone: rec.phone, note: noteFor(rec), entityType: e.type, entityId: e.id };
}

const displayName = (c: { name: string; company: string }) => (c.name && c.company ? `${c.name} – ${c.company}` : c.name || c.company || 'them');

export interface SaveResult { saved: number; existing: number; phoneOnly: number; error: string }

/** On the phone: save these people to its contacts, under the account from Settings → Phone contacts. */
export async function saveContactsOnPhone(list: PhoneContactInput[], mayAsk: boolean): Promise<SaveResult> {
  const res: SaveResult = { saved: 0, existing: 0, phoneOnly: 0, error: '' };
  if (!mayAsk) {
    const p = await Native.checkPermissions().catch(() => ({ contacts: '' }));
    if (p.contacts !== 'granted')
      return { ...res, error: 'Contacts access is off on your phone: open TradeLink on the phone → Settings → Phone contacts → Check accounts, and allow it' };
  }
  const account = getContactSave().account;
  for (const c of list) {
    try {
      const r = await Native.saveContact({ name: c.name, company: c.company, title: c.title, phone: c.phone, note: c.note, account, group: 'TradeLink CRM' });
      if (r.status === 'exists') res.existing++;
      else if (r.status === 'saved-on-phone') res.phoneOnly++;
      else res.saved++;
      markOnPhone(c.entityType, c.entityId);
    } catch (e: any) {
      res.error = e?.code === 'denied' ? 'Contacts access is off: allow it to save people to your phone' : e?.message || String(e);
      if (e?.code === 'denied') break;
    }
  }
  return res;
}

function describe(r: SaveResult, list: PhoneContactInput[]): string {
  if (list.length === 1) {
    const n = displayName(list[0]);
    if (r.existing) return `${n} is already in your phone contacts`;
    if (r.phoneOnly) return `Saved ${n} to the phone only: ${getContactSave().account} isn't syncing contacts there (Settings → Phone contacts)`;
    return `Saved ${n} to your phone contacts`;
  }
  const done = r.saved + r.phoneOnly;
  return `Saved ${done} to your phone contacts${r.existing ? ` · ${r.existing} already there` : ''}`;
}

/**
 * The "Save to phone" button (and the Leads bulk action): adds people to your phone contacts without calling them.
 * On the phone it saves right away; on the Mac your phone does it (Desk phone mode, email connected on both).
 */
export async function addToPhoneContacts(entities: { type: EntityType | string; id: string }[], onStatus?: (s: string) => void): Promise<string> {
  const list = entities.map(inputFor).filter(Boolean) as PhoneContactInput[];
  if (!list.length) throw new Error('No phone number to save');
  if (isAndroid()) {
    const r = await saveContactsOnPhone(list, true);
    if (r.error && !(r.saved + r.existing + r.phoneOnly)) throw new Error(r.error);
    return describe(r, list) + (r.error ? ` (some weren't saved: ${r.error})` : '');
  }
  if (isDesktop()) {
    if (!emailConnected())
      throw new Error('Connect your email on this Mac and on your phone (Email tab): the request goes to your phone through your private email connector.');
    const total: SaveResult = { saved: 0, existing: 0, phoneOnly: 0, error: '' };
    for (let i = 0; i < list.length; i += 20) {
      const chunk = list.slice(i, i + 20);
      const ack = await relayToPhone('contactRequest', { contacts: chunk }, 'contactAck', onStatus);
      if (!ack.ok) throw new Error(ack.error || 'Your phone could not save them');
      total.saved += ack.saved || 0;
      total.existing += ack.existing || 0;
      total.phoneOnly += ack.phoneOnly || 0;
      chunk.forEach((c) => markOnPhone(c.entityType, c.entityId));
    }
    return describe(total, list);
  }
  throw new Error('Open TradeLink on your Mac or phone to save people to your phone contacts.');
}

/**
 * Saves the called number to the phone's contacts. Returns a short message to show ('' when nothing to say,
 * e.g. the number was already saved or saving is off).
 */
export async function saveCalledNumber(entity: { type: EntityType | string; id: string }, phone: string, outcome: string | null, mayAsk = true): Promise<string> {
  if (!isAndroid() || !phone) return '';
  const s = getContactSave();
  if (!shouldSave(s.mode, outcome)) return '';
  if (!mayAsk) {
    const p = await Native.checkPermissions().catch(() => ({ contacts: '' }));
    if (p.contacts !== 'granted') return '';
  }
  const rec = recordFor(entity.type, entity.id) || {};
  const note = ['From TradeLink CRM', rec.trade, rec.city].filter(Boolean).join(' · ');
  try {
    const r = await Native.saveContact({
      name: rec.contactName || '', company: rec.company || '', title: rec.title || '', phone, note, account: s.account, group: 'TradeLink CRM',
    });
    markOnPhone(entity.type, entity.id);
    if (r.status === 'saved') return `Saved ${r.name} to contacts (${r.account})`;
    if (r.status === 'saved-on-phone') return once('phone-only', `Saved ${r.name} to this phone only: ${s.account} isn't syncing contacts here (Settings → Phone contacts)`);
    return '';
  } catch (e: any) {
    if (e?.code === 'denied') return once('denied', 'Numbers aren’t being saved to contacts: allow Contacts access, or turn it off in Settings → Phone contacts');
    return `Couldn’t save to contacts: ${e?.message || e}`;
  }
}
