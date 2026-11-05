/**
 * Email connector client. The connector URL is stored ONLY on this device (localStorage):
 * it grants access to the mailbox, so it is never synced to the sheet or committed anywhere.
 */
import { useSyncExternalStore } from 'react';
import { emailsIn, buildPeopleIndex, isUnreadEmail, matchMessages, normEmail, type EmailMessage, type Person } from './emailmatch';
import { httpRequest, isDesktop } from './platform';
import { getSetting, nowIso, store } from './store';
import type { EntityType } from './types';

const LS_URL = 'tl.emailUrl';
const LS_SINCE = 'tl.emailSince';
const LS_OTHER = 'tl.emailOther';
/** New mail is checked every minute while the app is open. */
const POLL_MS = 60 * 1000;
/** How often to pick up mail you've read elsewhere (e.g. the Gmail app). */
const READ_STATE_MS = 5 * 60 * 1000;

export interface EmailState {
  status: 'not-connected' | 'idle' | 'checking' | 'error';
  me: string;
  lastChecked: number;
  error: string;
  other: EmailMessage[]; // recent mail from addresses not in the CRM (kept on this device only)
}

const loadOther = (): EmailMessage[] => { try { return JSON.parse(localStorage.getItem(LS_OTHER) || '[]'); } catch { return []; } };
let state: EmailState = {
  status: localStorage.getItem(LS_URL) ? 'idle' : 'not-connected',
  me: localStorage.getItem('tl.emailMe') || '',
  lastChecked: 0,
  error: '',
  other: loadOther(),
};
const listeners = new Set<() => void>();
const set = (p: Partial<EmailState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
export const useEmail = () =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);

export const getEmailUrl = () => localStorage.getItem(LS_URL) || '';
export const emailConnected = () => !!getEmailUrl();

/** A request to the private email connector (also used for follow-up texts). */
export async function connectorCall(body: unknown, url = getEmailUrl()) {
  const res = await httpRequest(url, 'POST', JSON.stringify(body));
  let parsed: any;
  try { parsed = JSON.parse(res.text); } catch {
    if (/accounts\.google|sign in/i.test(res.text)) throw new Error('Google asked for sign-in. Redeploy the email connector with "Who has access: Anyone".');
    throw new Error(`Unexpected response from the email connector (HTTP ${res.status}).`);
  }
  if (!parsed.ok) throw new Error(parsed.error || 'Email request failed');
  return parsed;
}

export async function connectEmail(url: string) {
  const r = await connectorCall({ action: 'ping' }, url.trim());
  localStorage.setItem(LS_URL, url.trim());
  localStorage.setItem('tl.emailMe', r.email);
  set({ status: 'idle', me: r.email, error: '' });
  checkEmail();
  return r.email as string;
}

export function disconnectEmail() {
  localStorage.removeItem(LS_URL);
  localStorage.removeItem(LS_SINCE);
  localStorage.removeItem(LS_OTHER);
  set({ status: 'not-connected', me: '', other: [] });
}

/** Everyone in the CRM with an email address. */
function people(): Person[] {
  const out: Person[] = [];
  for (const l of store.data.leads.values()) if (!l.deleted && l.email) out.push({ type: 'lead', id: l.id, name: l.company, email: l.email });
  for (const c of store.data.contacts.values()) if (!c.deleted && c.email) out.push({ type: 'contact', id: c.id, name: c.company, email: c.email });
  return out;
}

export interface NewEmail { id: string; entityType: string; entityId: string; entityName: string; subject: string; snippet: string; from: string }
const newMailListeners = new Set<(mail: NewEmail[]) => void>();
/** Called with new unread email from leads/contacts found by a check (not on the first check after connecting). */
export function onNewEmail(fn: (mail: NewEmail[]) => void): () => void {
  newMailListeners.add(fn);
  return () => { newMailListeners.delete(fn); };
}

function saveActivities(messages: EmailMessage[], me: string) {
  const { activities, unmatched } = matchMessages(messages, buildPeopleIndex(people()), me);
  let added = 0;
  const fresh: NewEmail[] = [];
  for (const a of activities) {
    if (store.data.activities.has(a.id)) continue;
    store.upsert('activities', { ...a, durationSec: 0, phone: '' } as any);
    added++;
    if (isUnreadEmail(a)) fresh.push({ id: a.id, entityType: a.entityType, entityId: a.entityId, entityName: a.entityName, subject: a.outcome.replace(/^Received: /, ''), snippet: a.notes, from: a.emailFrom });
    if (a.direction === 'out') {
      const table = a.entityType === 'lead' ? 'leads' : 'contacts';
      const cur: any = store.get(table, a.entityId);
      if (cur && (!cur.lastContactedAt || cur.lastContactedAt < a.occurredAt))
        store.upsert(table, { id: a.entityId, lastContactedAt: a.occurredAt, lastOutcome: 'Email sent' } as any);
    }
  }
  return { added, unmatched, fresh };
}

let running = false;
let lastReadState = 0;
/** Pull new mail and log anything to/from CRM leads & contacts. */
export async function checkEmail(): Promise<void> {
  if (!emailConnected() || running) return;
  running = true;
  set({ status: 'checking', error: '' });
  try {
    const since = Number(localStorage.getItem(LS_SINCE) || 0);
    const r = await connectorCall({ action: 'recent', since, max: 150 });
    const { unmatched, fresh } = saveActivities(r.messages, r.me);
    if (since && fresh.length) newMailListeners.forEach((fn) => fn(fresh));
    const other = [...unmatched, ...state.other]
      .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 150);
    localStorage.setItem(LS_OTHER, JSON.stringify(other));
    localStorage.setItem(LS_SINCE, String(r.serverTime));
    set({ status: 'idle', me: r.me, lastChecked: Date.now(), other });
    if (Date.now() - lastReadState > READ_STATE_MS) { lastReadState = Date.now(); refreshReadState().catch(() => {}); }
  } catch (e: any) {
    set({ status: 'error', error: e?.message || String(e) });
  } finally {
    running = false;
  }
}

/** After an email address is added to a lead/contact, pull their past emails too. */
export async function backfillAddress(address: string) {
  if (!emailConnected() || !emailsIn(address).length) return 0;
  const r = await connectorCall({ action: 'search', addresses: emailsIn(address) });
  const { added } = saveActivities(r.messages, r.me);
  // anything now matched no longer belongs in "other"
  const known = new Set(emailsIn(address));
  const other = state.other.filter((m) => !known.has(normEmail(m.from)));
  localStorage.setItem(LS_OTHER, JSON.stringify(other));
  set({ other });
  return added;
}

export interface SendArgs { entity?: { type: EntityType; id: string }; to: string; subject: string; body: string; threadId?: string }

export async function sendEmail(a: SendArgs) {
  const signature = getSetting<string>('emailSignature', '');
  const body = signature ? `${a.body}\n\n${signature}` : a.body;
  const r = await connectorCall({ action: 'send', to: a.to, subject: a.subject, body, threadId: a.threadId, fromName: getSetting('myName', '') ? `${getSetting('myName', '')} | TradeLink` : '' });
  const m: EmailMessage = r.message;
  if (a.entity && a.entity.type !== 'opportunity') {
    const table = a.entity.type === 'lead' ? 'leads' : 'contacts';
    const cur: any = store.get(table, a.entity.id);
    // remember the address on the record so replies get matched
    if (cur && !emailsIn(cur.email).includes(normEmail(a.to))) store.upsert(table, { id: a.entity.id, email: cur.email ? `${cur.email}, ${a.to}` : a.to } as any);
  }
  saveActivities([{ ...m, to: m.to.length ? m.to : [normEmail(a.to)], outgoing: true }], state.me || m.from);
  if (a.entity && a.entity.type !== 'opportunity') {
    const table = a.entity.type === 'lead' ? 'leads' : 'contacts';
    store.upsert(table, { id: a.entity.id, lastContactedAt: nowIso(), lastOutcome: 'Email sent' } as any);
  }
  return m;
}

// ---------------------------------------------------------------- read / unread

/** Mark emails read in the CRM (both devices, via the sheet) and in Gmail. */
export function markEmailsRead(activityIds: string[], read = true) {
  const msgIds: string[] = [];
  for (const id of activityIds) {
    const a = store.get('activities', id);
    if (!a || a.type !== 'email') continue;
    if (!!a.readAt === read) continue;
    store.upsert('activities', { id, readAt: read ? nowIso() : '' });
    if (a.messageId) msgIds.push(a.messageId);
  }
  if (msgIds.length && emailConnected()) connectorCall({ action: 'markRead', ids: msgIds, unread: !read }).catch(() => {});
}

/** Unread emails you've since read in Gmail (on any device) move to Read here too. */
async function refreshReadState() {
  const unread = Array.from(store.data.activities.values()).filter((a) => isUnreadEmail(a as any) && a.messageId).slice(0, 25);
  if (!unread.length) return;
  const r = await connectorCall({ action: 'readState', ids: unread.map((a) => a.messageId) });
  const read = new Set<string>(r.read || []);
  for (const a of unread) if (read.has(a.messageId!)) store.upsert('activities', { id: a.id, readAt: nowIso() });
}

export interface FullEmail extends EmailMessage { body: string; cc: string[] }
const fullCache = new Map<string, FullEmail>();

/** The whole message (the CRM only keeps a short preview). */
export async function getFullEmail(messageId: string): Promise<FullEmail> {
  const hit = fullCache.get(messageId);
  if (hit) return hit;
  const r = await connectorCall({ action: 'get', id: messageId });
  fullCache.set(messageId, r.message);
  return r.message;
}

export function startEmail() {
  if (emailConnected()) setTimeout(() => checkEmail(), 6000);
  // The Mac keeps checking in the background so it can notify you; elsewhere only while the app is on screen.
  setInterval(() => { if (isDesktop() || document.visibilityState === 'visible') checkEmail(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkEmail(); });
}
