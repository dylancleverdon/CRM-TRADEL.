import { outcomeDef } from './constants';
import { isAndroid, Native } from './platform';
import { store } from './store';
import type { EntityType } from './types';

/**
 * Android only: after a call, save the number to the phone's contacts under a Google account
 * (dylan@tradelink.marketing by default), so it syncs to Google Contacts and shows as caller ID when they call back.
 * Numbers already in contacts are left alone. The setting lives on the phone.
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
    if (r.status === 'saved') return `Saved ${r.name} to contacts (${r.account})`;
    if (r.status === 'saved-on-phone') return once('phone-only', `Saved ${r.name} to this phone only: ${s.account} isn't syncing contacts here (Settings → Phone contacts)`);
    return '';
  } catch (e: any) {
    if (e?.code === 'denied') return once('denied', 'Numbers aren’t being saved to contacts: allow Contacts access, or turn it off in Settings → Phone contacts');
    return `Couldn’t save to contacts: ${e?.message || e}`;
  }
}
