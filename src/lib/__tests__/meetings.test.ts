import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
const net = vi.hoisted(() => ({ calls: [] as any[], replies: [] as any[], sent: [] as any[], failSend: false }));
vi.mock('../email', () => ({
  emailConnected: () => true,
  mailboxEmail: () => 'dylan@tradelink.marketing',
  connectorCall: vi.fn(async (body: any) => { net.calls.push(body); return net.replies.shift() ?? { ok: true }; }),
  sendEmail: vi.fn(async (a: any) => { if (net.failSend) throw new Error('Gmail said no'); net.sent.push(a); return {}; }),
}));
vi.mock('../platform', () => ({ isAndroid: () => false, isDesktop: () => true, Native: {}, openExternal: vi.fn(), httpRequest: vi.fn() }));
vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, String(v)), removeItem: (k: string) => m.delete(k), clear: () => m.clear() };
});

import { addTask } from '../actions';
import { bookMeeting, cancelMeeting, daySlots, DEFAULT_MEETINGS, joinUrl, meetingSettings, meetingWhen, rescheduleMeeting, upcomingMeetings, withMeeting } from '../meetings';
import { store } from '../store';

const tue = new Date(2026, 10, 10); // Tuesday, Nov 10 2026 (local)
const at = (h: number, m = 0, d = tue) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);

describe('meeting times', () => {
  it('30-minute times; outside your hours and busy on your calendar are greyed out', () => {
    const s = meetingSettings({});
    const busy = [{ start: at(10).toISOString(), end: at(11).toISOString() }];
    const slots = daySlots(tue, s, busy, at(8, 25).getTime());
    const state = (h: number, m = 0) => slots.find((x) => x.start.getTime() === at(h, m).getTime())?.state;
    expect(slots[0].start).toEqual(at(7));
    expect(state(8, 30)).toBe('past'); // less than 10 minutes from now
    expect(daySlots(tue, s, busy, at(8).getTime()).find((x) => x.start.getTime() === at(8, 30).getTime())!.state).toBe('off'); // before your hours
    expect(state(9)).toBe('free');
    expect(state(9, 30)).toBe('free');
    expect(state(10)).toBe('busy');
    expect(state(10, 30)).toBe('busy');
    expect(state(11)).toBe('free');
    expect(state(16, 30)).toBe('free'); // 4:30–5:00 fits
    expect(state(17)).toBe('off');
    expect(state(7, 30)).toBe('past');
    expect(daySlots(new Date(2026, 10, 15), s, [], at(8).getTime()).every((x) => x.state === 'off')).toBe(true); // Sunday
  });

  it('a 60-minute meeting must fit before the end of your day', () => {
    const s = meetingSettings({ lengthMin: 60 });
    const slots = daySlots(tue, s, [], at(6).getTime());
    expect(slots.find((x) => x.start.getTime() === at(16).getTime())!.state).toBe('free');
    expect(slots.find((x) => x.start.getTime() === at(16, 30).getTime())!.state).toBe('off');
  });

  it('uses the clock on days the clocks change', () => {
    const sunday = new Date(2026, 10, 1); // US clocks go back that night
    const slots = daySlots(sunday, meetingSettings({ week: [{ on: true, from: '09:00', to: '12:00' }] as any }), [], 0);
    expect(slots.map((x) => `${x.start.getHours()}:${String(x.start.getMinutes()).padStart(2, '0')}`).slice(0, 3)).toEqual(['7:00', '7:30', '8:00']);
  });

  it('settings keep your hours and fill in anything missing', () => {
    const s = meetingSettings({ week: [undefined, { on: true, from: '08:00', to: '12:00' }] as any });
    expect(s.week[1]).toEqual({ on: true, from: '08:00', to: '12:00' });
    expect(s.week[2]).toEqual(DEFAULT_MEETINGS.week[2]);
    expect(s.title).toBe('TradeLink × {company}');
  });
});

describe('the confirmation email', () => {
  const when = 'Tuesday, November 10 · 10:00–10:30 AM PST';
  it('fills {meetingTime} and {meetLink} when the email has them', () => {
    expect(withMeeting('See you {meetingTime} at {meetLink}', when, 'https://meet.google.com/x')).toBe(`See you ${when} at https://meet.google.com/x`);
  });
  it('otherwise puts the time and link after the first paragraph', () => {
    const body = 'Hi Juan,\n\nThanks for making time — this confirms our call.\n\nIf anything changes, just reply.\n\nTalk soon,\nDylan';
    expect(withMeeting(body, when, 'https://meet.google.com/x')).toBe(
      `Hi Juan,\n\nThanks for making time — this confirms our call.\n\n${when}\nGoogle Meet: https://meet.google.com/x\n\nIf anything changes, just reply.\n\nTalk soon,\nDylan`);
    expect(withMeeting('', when, '')).toBe(`${when}\nGoogle Meet: (the link is in the calendar invite)`);
  });
  it('says the time like a person would', () => {
    expect(meetingWhen(at(10), at(10, 30))).toMatch(/^Tuesday, November 10 · 10:00–10:30 AM( \S+)?$/);
    expect(meetingWhen(at(11, 45), at(12, 15))).toMatch(/^Tuesday, November 10 · 11:45 AM–12:15 PM/);
  });
});

describe('booking, moving and cancelling', () => {
  beforeEach(() => { net.calls = []; net.replies = []; net.sent = []; net.failSend = false; });
  const pick = { start: at(10), end: at(10, 30) };
  const lead = () => store.upsert('leads', { id: 'MB1', company: 'American First Air', contactName: 'Juan Andrade', phone: '3239975336', trade: 'HVAC', city: 'Kent', email: '' } as any);

  it('Meeting Booked: Google sends the invite with a Meet link, then your confirmation email with the time and link', async () => {
    lead();
    net.replies.push({ ok: true, event: { id: 'ev1', meet: 'https://meet.google.com/abc', start: pick.start.toISOString(), end: pick.end.toISOString() } });
    const said = await bookMeeting({ type: 'lead', id: 'MB1' }, 'Juan@AFA.com', pick, true);
    expect(net.calls[0]).toMatchObject({ action: 'calCreate', attendee: 'juan@afa.com', title: 'TradeLink × American First Air', name: 'Juan Andrade',
      description: 'Marketing plan call with Dylan Cleverdon, Yelp Partner at TradeLink · Tradelink.marketing · Dylan@tradelink.marketing' });
    expect(said[0]).toMatch(/^📅 Invite sent to juan@afa.com for Tuesday, November 10 · 10:00–10:30 AM.* \(Google Meet link added\)$/);
    expect(said[1]).toBe('✉️ Meeting confirmation email sent');
    expect(net.sent[0].to).toBe('juan@afa.com');
    expect(net.sent[0].subject).toBe('Confirmed: our call');
    expect(net.sent[0].body).toContain('Google Meet: https://meet.google.com/abc');
    expect(net.sent[0].body).toMatch(/Hi Juan,\n\nThanks for making time/);
    expect(store.get('leads', 'MB1')!.email).toBe('juan@afa.com'); // remembered for next time
    const m = store.list('activities').find((a) => a.type === 'meeting' && a.entityId === 'MB1')!;
    expect(m).toMatchObject({ outcome: 'Scheduled', eventId: 'ev1', meetLink: 'https://meet.google.com/abc', emailTo: 'juan@afa.com', emailFrom: 'dylan@tradelink.marketing',
      occurredAt: pick.start.toISOString(), endAt: pick.end.toISOString() });
    expect(net.sent[0].body).not.toContain('authuser'); // the client's email has the plain link
    expect(upcomingMeetings(store.list('activities'), at(9).getTime()).map((a) => a.id)).toContain(m.id);
  });

  it("if the confirmation email fails, it says the invite still went out", async () => {
    lead();
    net.replies.push({ ok: true, event: { id: 'ev2', meet: 'https://meet.google.com/def' } });
    net.failSend = true;
    const said = await bookMeeting({ type: 'lead', id: 'MB1' }, 'juan@afa.com', pick, true);
    expect(said[1]).toBe("The invite went out, but the confirmation email didn't: Gmail said no");
  });

  it('rescheduling moves the meeting and its follow-up; cancelling closes the follow-up and drops it from upcoming', async () => {
    lead();
    net.replies.push({ ok: true, event: { id: 'ev3', meet: 'https://meet.google.com/ghi' } });
    addTask({ type: 'lead', id: 'MB1' }, 'Discovery call', pick.start.toISOString(), 'High');
    await bookMeeting({ type: 'lead', id: 'MB1' }, 'juan@afa.com', pick, false);
    const m = store.list('activities').find((a) => a.eventId === 'ev3')!;
    const moved = { start: at(14), end: at(14, 30) };
    net.replies.push({ ok: true, event: { id: 'ev3' } });
    await rescheduleMeeting(m.id, moved);
    expect(net.calls[net.calls.length - 1]).toMatchObject({ action: 'calUpdate', id: 'ev3', start: moved.start.toISOString() });
    expect(store.get('activities', m.id)).toMatchObject({ outcome: 'Rescheduled', occurredAt: moved.start.toISOString() });
    const task = store.list('tasks').find((t) => t.entityId === 'MB1' && t.title === 'Discovery call')!;
    expect(task.dueAt).toBe(moved.start.toISOString());
    await cancelMeeting(m.id);
    expect(net.calls[net.calls.length - 1]).toEqual({ action: 'calCancel', id: 'ev3' });
    expect(store.get('activities', m.id)!.outcome).toBe('Cancelled');
    expect(store.get('tasks', task.id)!.done).toBe(true);
    expect(upcomingMeetings(store.list('activities'), at(9).getTime()).map((a) => a.id)).not.toContain(m.id);
  });
});

describe('joining', () => {
  it('opens Meet as the account that owns the meeting, not the browser\'s first account', () => {
    expect(joinUrl('https://meet.google.com/abc-defg-hij', 'dylan@tradelink.marketing')).toBe('https://meet.google.com/abc-defg-hij?authuser=dylan%40tradelink.marketing');
    expect(joinUrl('https://meet.google.com/abc-defg-hij?hs=122', 'dylan@tradelink.marketing')).toBe('https://meet.google.com/abc-defg-hij?hs=122&authuser=dylan%40tradelink.marketing');
    expect(joinUrl('https://meet.google.com/abc-defg-hij', '')).toBe('https://meet.google.com/abc-defg-hij');
    expect(joinUrl('', 'dylan@tradelink.marketing')).toBe('');
  });
});
