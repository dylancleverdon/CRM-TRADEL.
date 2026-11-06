import { describe, expect, it } from 'vitest';
import { fakeCalendar, loadEmailGs } from './fakeAppsScript';

const slot = { start: '2026-11-10T18:00:00.000Z', end: '2026-11-10T18:30:00.000Z' };

describe('Email.gs: Google Calendar invites with Google Meet', () => {
  it("until the Calendar service is added, says how to add it (and ping says it isn't there)", () => {
    const c = loadEmailGs();
    expect(c.handle({ action: 'ping' }).calendar).toBe(false);
    expect(c.handle({ action: 'calCreate', ...slot, attendee: 'juan@afa.com' })).toMatchObject({ ok: false, code: 'nocalendar' });
    expect(c.handle({ action: 'calBusy', from: slot.start, to: slot.end }).error).toMatch(/Settings → Meetings/);
  });

  it('books it with a Meet link and has Google email the invite', () => {
    const cal = fakeCalendar();
    const c = loadEmailGs({ calendar: cal });
    expect(c.handle({ action: 'ping' }).calendar).toBe(true);
    const r = c.handle({ action: 'calCreate', ...slot, attendee: 'Juan Andrade <Juan@AFA.com>', name: 'Juan Andrade', timeZone: 'America/Los_Angeles',
      title: 'TradeLink × American First Air', description: 'Marketing plan call with Dylan Cleverdon' });
    expect(r).toMatchObject({ ok: true, event: { id: 'ev1', meet: 'https://meet.google.com/abc-ev1', start: slot.start, end: slot.end } });
    const [ev, calId, opts] = cal.calls.find((x) => x.op === 'insert')!.args;
    expect(calId).toBe('primary');
    expect(opts).toEqual({ conferenceDataVersion: 1, sendUpdates: 'all' });
    expect(ev).toMatchObject({
      summary: 'TradeLink × American First Air', attendees: [{ email: 'juan@afa.com', displayName: 'Juan Andrade' }],
      start: { dateTime: slot.start, timeZone: 'America/Los_Angeles' },
      conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    });
  });

  it('waits for the Meet link when Google is still making it', () => {
    const cal = fakeCalendar();
    cal.meetLater = true;
    const c = loadEmailGs({ calendar: cal });
    expect(c.handle({ action: 'calCreate', ...slot, attendee: 'juan@afa.com' }).event.meet).toBe('https://meet.google.com/late-ev1');
  });

  it('needs a time and their email', () => {
    const c = loadEmailGs({ calendar: fakeCalendar() });
    expect(c.handle({ action: 'calCreate', start: slot.start, end: slot.start, attendee: 'juan@afa.com' }).error).toBe('Pick a meeting time');
    expect(c.handle({ action: 'calCreate', ...slot, attendee: '' }).error).toBe('Their email address is missing');
  });

  it('reschedules and cancels with Google telling the client; cancelling twice is fine', () => {
    const cal = fakeCalendar();
    const c = loadEmailGs({ calendar: cal });
    c.handle({ action: 'calCreate', ...slot, attendee: 'juan@afa.com' });
    const moved = c.handle({ action: 'calUpdate', id: 'ev1', start: '2026-11-11T17:00:00.000Z', end: '2026-11-11T17:30:00.000Z' });
    expect(moved.event).toMatchObject({ start: '2026-11-11T17:00:00.000Z', meet: 'https://meet.google.com/abc-ev1' });
    expect(cal.calls.find((x) => x.op === 'patch')!.args[3]).toEqual({ sendUpdates: 'all' });
    expect(c.handle({ action: 'calCancel', id: 'ev1' })).toEqual({ ok: true });
    expect(cal.calls.find((x) => x.op === 'remove')!.args[2]).toEqual({ sendUpdates: 'all' });
    expect(c.handle({ action: 'calCancel', id: 'ev1' })).toEqual({ ok: true });
  });

  it('reads busy times from your calendar', () => {
    const cal = fakeCalendar();
    cal.busy = [{ start: '2026-11-10T17:00:00Z', end: '2026-11-10T18:00:00Z' }];
    const c = loadEmailGs({ calendar: cal });
    expect(c.handle({ action: 'calBusy', from: '2026-11-10T00:00:00Z', to: '2026-11-11T00:00:00Z' })).toEqual({ ok: true, busy: cal.busy });
  });

  it('once the CRM is locked, calendar actions need the key like everything else', () => {
    const c = loadEmailGs({ calendar: fakeCalendar() });
    c.sheet.locked = true;
    expect(c.handle({ action: 'calCreate', ...slot, attendee: 'juan@afa.com' })).toMatchObject({ ok: false, code: 'locked' });
    expect(c.handle({ action: 'calCreate', ...slot, attendee: 'juan@afa.com', auth: c.sheet.key }).ok).toBe(true);
  });
});
