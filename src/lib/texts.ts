/**
 * Follow-up texts, sent from your own phone number.
 * - On the phone: the app sends the text directly.
 * - On the Mac: the request goes to your phone through your private email connector (its URL lives only on
 *   your devices, unlike the sheet's sync URL, which is in the public app code). The phone, in Desk phone mode,
 *   sends it and confirms. Both sides log the same activity id, so it's never duplicated.
 */
import { logActivity } from './actions';
import { connectorCall, emailConnected } from './email';
import { saveContactsOnPhone } from './phonecontacts';
import { relayToPhone } from './phonerelay';
import { firstName } from './emailmatch';
import { isAndroid, isDesktop, Native, openExternal } from './platform';
import { getSetting, store } from './store';
import type { EntityType } from './types';

export const DEFAULT_FOLLOW_UP_TEXT = `Good speaking with you. For future reference and so you can save the contact this is Dylan Cleverdon a Yelp Partner at Tradelink. my website is:
Tradelink.marketing
and my email is:
Dylan@tradelink.marketing`;

export const TEXT_PLACEHOLDERS = '{firstName} {name} {company} {myName}';

export const getFollowUpText = () => getSetting<string>('followUpText', DEFAULT_FOLLOW_UP_TEXT) || DEFAULT_FOLLOW_UP_TEXT;

type Who = { type: EntityType | string; id: string };

function recordFor(e: Who): any {
  if (e.type === 'lead') return store.get('leads', e.id);
  if (e.type === 'contact') return store.get('contacts', e.id);
  const o = store.get('opportunities', e.id);
  return o ? store.get('contacts', o.contactId) : undefined;
}

export function fillText(tpl: string, e: Who | null): string {
  const r = e ? recordFor(e) || {} : {};
  const vars: Record<string, string> = {
    firstName: firstName(r.contactName || ''), name: r.contactName || '', company: r.company || '', myName: getSetting('myName', '') || 'Dylan',
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

const textActivityId = (requestId: string) => `tx-${requestId}`;

function logText(e: Who, phone: string, body: string, id?: string) {
  if (e.type !== 'lead' && e.type !== 'contact' && e.type !== 'opportunity') return;
  if (id && store.data.activities.has(id)) return;
  logActivity({ type: e.type as EntityType, id: e.id }, { ...(id ? { id } : {}), type: 'text', outcome: 'Follow-up text sent', notes: body, phone } as any);
}

/** Who can send right now: 'phone' (this is the phone), 'relay' (Mac → phone), or why not. */
export function textRoute(): { route: 'phone' | 'relay' | 'none'; why?: string } {
  if (isAndroid()) return { route: 'phone' };
  if (isDesktop()) {
    if (!emailConnected()) return { route: 'none', why: 'Connect your email on this Mac and on your phone (Email tab): texts go to your phone through your private email connector.' };
    return { route: 'relay' };
  }
  return { route: 'none', why: 'Open TradeLink on your Mac or phone to send texts from your number.' };
}


/**
 * Sends the text from your phone and logs it. Resolves with a short status message; throws with a readable
 * reason if it couldn't be sent.
 */
export async function sendFollowUpText(e: Who, phone: string, body: string, onStatus?: (s: string) => void): Promise<string> {
  const text = body.trim();
  if (!phone || !text) throw new Error('Missing phone number or message');
  const { route, why } = textRoute();
  if (route === 'phone') {
    await Native.sendSms({ number: phone, body: text });
    logText(e, phone, text);
    return 'Text sent';
  }
  if (route === 'relay') {
    const rec = recordFor(e) || {};
    const ack = await relayToPhone('textRequest', { req: { number: phone, body: text, name: rec.company || '', entityType: e.type, entityId: e.id } }, 'ack',
      (s) => onStatus?.(s === 'Sending to your phone…' ? 'Sending from your phone…' : s));
    if (!ack.ok) throw new Error(ack.error || 'Your phone could not send it');
    logText(e, phone, text, textActivityId(ack.requestId));
    return 'Text sent from your phone';
  }
  // No way to send automatically: hand it to this device's messaging app.
  openExternal(`sms:${phone}?body=${encodeURIComponent(text)}`);
  throw new Error(why || 'Texting is not available here');
}

// ---------------------------------------------------------------- the phone's side (Desk phone mode)

const LS_TEXT_HANDLED = 'tl.textHandled';
const LS_CONTACT_HANDLED = 'tl.contactHandled';
let phonePolling = false;

/**
 * Desk phone mode: do what the Mac asked for, i.e. send a follow-up text and/or save people to the phone's contacts.
 * Never prompts for permissions (the phone may be face-down on the desk); the Mac is told what to allow instead.
 */
export async function pollPhoneRequests(): Promise<void> {
  if (!isAndroid() || !emailConnected() || phonePolling) return;
  phonePolling = true;
  try {
    const r = await connectorCall({ action: 'textPoll', phone: true });
    const req = r.req;
    if (req?.id && req.id !== localStorage.getItem(LS_TEXT_HANDLED)) {
      localStorage.setItem(LS_TEXT_HANDLED, req.id);
      try {
        await Native.sendSms({ number: req.number, body: req.body, noPrompt: true });
        logText({ type: req.entityType, id: req.entityId }, req.number, req.body, textActivityId(req.id));
        await connectorCall({ action: 'textPoll', phone: true, ack: req.id, ok: true });
      } catch (e: any) {
        const error = e?.code === 'denied'
          ? 'Texting is not allowed on your phone yet: open TradeLink on the phone → Settings → Follow-up text → Allow texting'
          : e?.message || String(e);
        await connectorCall({ action: 'textPoll', phone: true, ack: req.id, ok: false, error }).catch(() => {});
      }
    }
    const creq = r.contactReq;
    if (creq?.id && creq.id !== localStorage.getItem(LS_CONTACT_HANDLED)) {
      localStorage.setItem(LS_CONTACT_HANDLED, creq.id);
      const res = await saveContactsOnPhone(creq.contacts || [], false);
      const done = res.saved + res.existing + res.phoneOnly;
      await connectorCall({
        action: 'textPoll', phone: true, contactAck: creq.id, contactOk: !res.error || done > 0, contactError: res.error,
        contactSaved: res.saved, contactExisting: res.existing, contactPhoneOnly: res.phoneOnly,
      }).catch(() => {});
    }
  } catch { /* offline or connector not updated yet: try again next poll */ } finally {
    phonePolling = false;
  }
}
