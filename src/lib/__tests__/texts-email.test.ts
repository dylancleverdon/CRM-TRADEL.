import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
const env = vi.hoisted(() => ({ android: false, desktop: true, connected: true }));
const native = vi.hoisted(() => ({ sendSms: vi.fn(async () => ({ parts: 2 })) }));
const connector = vi.hoisted(() => ({ calls: [] as any[], replies: [] as any[] }));
vi.mock('../platform', () => ({
  isAndroid: () => env.android, isDesktop: () => env.desktop, Native: native, openExternal: vi.fn(), httpRequest: vi.fn(),
}));
vi.mock('../email', () => ({
  emailConnected: () => env.connected,
  connectorCall: vi.fn(async (body: any) => { connector.calls.push(body); return connector.replies.shift() ?? { ok: true }; }),
}));

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(),
});

import { matchMessages, readEmails, sentEmails, unfillEmail, unreadEmails, buildPeopleIndex, type EmailMessage } from '../emailmatch';
import { store } from '../store';
import { DEFAULT_FOLLOW_UP_TEXT, fillText, pollTextRequests, sendFollowUpText, textRoute } from '../texts';

const lead = () => store.upsert('leads', { id: 'tx1', company: 'American First Air', contactName: 'Juan Andrade', phone: '3239975336' } as any);
const textActs = () => store.list('activities').filter((a) => a.type === 'text' && a.entityId === 'tx1');

describe('follow-up texts', () => {
  beforeEach(() => {
    connector.calls = []; connector.replies = []; native.sendSms.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
  });

  it('uses your message as the default, word for word', () => {
    lead();
    expect(fillText(DEFAULT_FOLLOW_UP_TEXT, { type: 'lead', id: 'tx1' })).toBe(DEFAULT_FOLLOW_UP_TEXT);
    expect(DEFAULT_FOLLOW_UP_TEXT).toContain('Dylan Cleverdon a Yelp Partner at Tradelink');
    expect(fillText('Hi {firstName} at {company}', { type: 'lead', id: 'tx1' })).toBe('Hi Juan at American First Air');
  });

  it('on the phone, sends it directly and logs it', async () => {
    env.android = true; env.desktop = false;
    lead();
    expect(await sendFollowUpText({ type: 'lead', id: 'tx1' }, '3239975336', 'Thanks Juan')).toBe('Text sent');
    expect(native.sendSms).toHaveBeenCalledWith({ number: '3239975336', body: 'Thanks Juan' });
    const sentTexts = textActs();
    expect(sentTexts[sentTexts.length - 1]?.notes).toBe('Thanks Juan');
    env.android = false; env.desktop = true;
  });

  it('on the Mac, asks the phone through the email connector and waits for it to confirm', async () => {
    lead();
    connector.replies.push({ ok: true, id: 'req-9', phoneSeenAgo: 3000 }); // textRequest
    connector.replies.push({ ok: true, ack: { id: 'other', ok: true } }); // someone else's ack
    connector.replies.push({ ok: true, ack: { id: 'req-9', ok: true } });
    const p = sendFollowUpText({ type: 'lead', id: 'tx1' }, '3239975336', 'Good speaking with you.');
    await vi.advanceTimersByTimeAsync(8000);
    expect(await p).toBe('Text sent from your phone');
    expect(connector.calls[0]).toMatchObject({ action: 'textRequest', req: { number: '3239975336', body: 'Good speaking with you.', entityId: 'tx1' } });
    expect(store.get('activities', 'tx-req-9')?.notes).toBe('Good speaking with you.');
  });

  it('says why when the phone could not send it', async () => {
    lead();
    connector.replies.push({ ok: true, id: 'req-10', phoneSeenAgo: 1000 });
    connector.replies.push({ ok: true, ack: { id: 'req-10', ok: false, error: 'Texting is not allowed on your phone yet' } });
    const p = sendFollowUpText({ type: 'lead', id: 'tx1' }, '3239975336', 'hi').catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe('Texting is not allowed on your phone yet');
  });

  it('needs email connected on the Mac to reach the phone', () => {
    env.connected = false;
    expect(textRoute().route).toBe('none');
    env.connected = true;
    expect(textRoute().route).toBe('relay');
  });

  it("the phone sends what the Mac asked for, once, logs it with the same id and confirms", async () => {
    env.android = true; env.desktop = false;
    lead();
    const req = { id: 'req-11', number: '3239975336', body: 'Sent via phone', entityType: 'lead', entityId: 'tx1' };
    connector.replies.push({ ok: true, req });
    await pollTextRequests();
    expect(native.sendSms).toHaveBeenCalledWith({ number: '3239975336', body: 'Sent via phone', noPrompt: true });
    expect(connector.calls[connector.calls.length - 1]).toMatchObject({ action: 'textPoll', ack: 'req-11', ok: true });
    expect(store.get('activities', 'tx-req-11')?.type).toBe('text');
    env.android = false; env.desktop = true;
  });
});

describe('email read state', () => {
  const msg = (p: Partial<EmailMessage>): EmailMessage => ({ id: 'm1', threadId: 't1', date: '2026-11-05T20:00:00.000Z', from: 'juan@afa.com', fromName: 'Juan',
    to: ['dylan@tradelink.marketing'], subject: 'Re: info', snippet: 'Thanks!', outgoing: false, unread: true, ...p });
  const people = buildPeopleIndex([{ type: 'lead', id: 'L1', name: 'American First Air', email: 'juan@afa.com' }]);

  it('mail unread in Gmail arrives as Unread; mail already read there, and mail you sent, count as read', () => {
    const { activities } = matchMessages([msg({}), msg({ id: 'm2', unread: false }), msg({ id: 'm3', outgoing: true, from: 'dylan@tradelink.marketing', to: ['juan@afa.com'] })], people, 'dylan@tradelink.marketing');
    expect(activities.map((a) => [a.messageId, !!a.readAt])).toEqual([['m1', false], ['m2', true], ['m3', true]]);
    const acts = activities.map((a) => ({ ...a, deleted: false }));
    expect(unreadEmails(acts).map((a) => a.messageId)).toEqual(['m1']);
    expect(readEmails(acts).map((a) => a.messageId)).toEqual(['m2']);
    expect(sentEmails(acts).map((a) => a.messageId)).toEqual(['m3']);
  });

  it('turns an email back into a template', () => {
    const vars = { company: 'American First Air', name: 'Juan Andrade', firstName: 'Juan', trade: 'hvac', city: 'Kent', myName: 'Dylan' };
    expect(unfillEmail('Hi Juan,\n\nGreat talking about American First Air in Kent. Juanita says hi.\n\nDylan', vars))
      .toBe('Hi {firstName},\n\nGreat talking about {company} in {city}. Juanita says hi.\n\n{myName}');
  });
});
