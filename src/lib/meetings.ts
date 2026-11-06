/**
 * Meetings: Google Calendar invites with a Google Meet link, booked from the call outcome (Meeting Booked) or the
 * email writer through your private email connector, which runs as your Google account. Google emails the invite
 * (and any change) to the client; the CRM can also send your "Meeting confirmation" email with the time and Meet
 * link filled in. The picker offers 30-minute times and greys out times outside your weekly hours (Settings →
 * Meetings) and times already busy on your Google Calendar.
 */
import { addDays, format, startOfDay } from 'date-fns';
import { logActivity, type Entity } from './actions';
import { connectorCall, mailboxEmail, sendEmail } from './email';
import { DEFAULT_TEMPLATES, emailsIn, fillEmail, firstName, normEmail, type EmailTemplate } from './emailmatch';
import { getSetting, store } from './store';
import type { Activity } from './types';

export interface DayHours { on: boolean; from: string; to: string }
export interface MeetingSettings {
  lengthMin: number;
  title: string;
  description: string;
  /** Your weekly hours, Sunday first. */
  week: DayHours[];
}

const workday = (): DayHours => ({ on: true, from: '09:00', to: '17:00' });
const dayOff = (): DayHours => ({ on: false, from: '09:00', to: '17:00' });
export const DEFAULT_MEETINGS: MeetingSettings = {
  lengthMin: 30,
  title: 'TradeLink × {company}',
  description: 'Marketing plan call with Dylan Cleverdon, Yelp Partner at TradeLink · Tradelink.marketing · Dylan@tradelink.marketing',
  week: [dayOff(), workday(), workday(), workday(), workday(), workday(), dayOff()],
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function meetingSettings(raw?: Partial<MeetingSettings> | null): MeetingSettings {
  const s = { ...DEFAULT_MEETINGS, ...(raw || {}) };
  const week = Array.from({ length: 7 }, (_, i) => ({ ...DEFAULT_MEETINGS.week[i], ...((raw?.week || [])[i] || {}) }));
  return { ...s, week, lengthMin: Number(s.lengthMin) || 30 };
}
export const getMeetingSettings = () => meetingSettings(getSetting<Partial<MeetingSettings>>('meetings', {}));

// ---------------------------------------------------------------- picking a time

export interface Busy { start: string; end: string }
export type SlotState = 'free' | 'busy' | 'off' | 'past';
export interface Slot { start: Date; end: Date; state: SlotState }
export interface Pick { start: Date; end: Date }

const mins = (hhmm: string) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/**
 * A day's 30-minute starts from 7 AM to 7 PM (wider if your hours are), each marked free, busy on your calendar,
 * outside your hours, or already past. Built from local clock times, so days when the clocks change are right.
 */
export function daySlots(day: Date, s: MeetingSettings, busy: Busy[], now = Date.now()): Slot[] {
  const hours = s.week[day.getDay()] || dayOff();
  const from = mins(hours.from), to = mins(hours.to);
  const lo = Math.min(7 * 60, hours.on ? from : 7 * 60);
  const hi = Math.max(19 * 60, hours.on ? to : 19 * 60);
  const b = busy.map((x) => [Date.parse(x.start), Date.parse(x.end)]).filter(([x, y]) => !isNaN(x) && !isNaN(y));
  const out: Slot[] = [];
  for (let m = Math.floor(lo / 30) * 30; m + s.lengthMin <= hi; m += 30) {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
    const end = new Date(start.getTime() + s.lengthMin * 60000);
    const st = start.getTime(), en = end.getTime();
    const state: SlotState = st < now + 10 * 60000 ? 'past'
      : b.some(([x, y]) => st < y && en > x) ? 'busy'
        : !hours.on || m < from || m + s.lengthMin > to ? 'off' : 'free';
    out.push({ start, end, state });
  }
  return out;
}

/** The next 14 days from today. */
export const pickerDays = (now = new Date()) => Array.from({ length: 14 }, (_, i) => addDays(startOfDay(now), i));

/** "Tuesday, November 10 · 10:00–10:30 AM PST" */
export function meetingWhen(start: Date, end: Date): string {
  let tz = '';
  try { tz = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(start).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { /* ignore */ }
  const sameHalf = format(start, 'a') === format(end, 'a');
  return `${format(start, 'EEEE, MMMM d')} · ${format(start, sameHalf ? 'h:mm' : 'h:mm a')}–${format(end, 'h:mm a')}${tz ? ` ${tz}` : ''}`;
}

const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

let busyCache: { key: string; at: number; busy: Busy[] } | null = null;

/** Busy times on your Google Calendar (cached for a minute). */
export async function fetchBusy(from: Date, to: Date): Promise<Busy[]> {
  const key = `${from.toISOString()}|${to.toISOString()}`;
  if (busyCache && busyCache.key === key && Date.now() - busyCache.at < 60000) return busyCache.busy;
  const r = await connectorCall({ action: 'calBusy', from: from.toISOString(), to: to.toISOString() });
  busyCache = { key, at: Date.now(), busy: r.busy || [] };
  return busyCache.busy;
}

/** Whether your email connector can book Google Calendar invites yet. */
export async function calendarReady(): Promise<boolean> {
  const r = await connectorCall({ action: 'ping' });
  return r.calendar === true;
}

// ---------------------------------------------------------------- the confirmation email

const MEET_FALLBACK = '(the link is in the calendar invite)';

/**
 * Puts the meeting time and Meet link into an email: into {meetingTime} / {meetLink} if it has them, otherwise
 * as two lines after the first paragraph under the greeting.
 */
export function withMeeting(text: string, when: string, link: string): string {
  const meet = link || MEET_FALLBACK;
  if (/\{meetingTime\}|\{meetLink\}/.test(text)) return text.replace(/\{meetingTime\}/g, when).replace(/\{meetLink\}/g, meet);
  const block = `${when}\nGoogle Meet: ${meet}`;
  if (!text.trim()) return block;
  const parts = text.split(/\n[ \t]*\n/);
  if (parts.length >= 3) { parts.splice(2, 0, block); return parts.join('\n\n'); }
  return `${text.trimEnd()}\n\n${block}`;
}

/** The same, as placeholders, for the email writer (filled in when you send). */
export const withMeetingPlaceholders = (text: string) => (/\{meetingTime\}|\{meetLink\}/.test(text) ? text : withMeeting(text, '{meetingTime}', '{meetLink}'));

type Rec = { company?: string; contactName?: string; trade?: string; city?: string; email?: string } | undefined;
const recOf = (e: Entity): Rec => (e.type === 'lead' ? store.get('leads', e.id) : e.type === 'contact' ? store.get('contacts', e.id) : undefined);
const varsOf = (r: Rec) => ({
  company: r?.company || '', name: r?.contactName || '', firstName: firstName(r?.contactName || ''),
  trade: (r?.trade || 'home service').toLowerCase(), city: r?.city || 'your area', myName: getSetting('myName', '') || 'Dylan',
});

function rememberEmail(e: Entity, address: string) {
  if (e.type !== 'lead' && e.type !== 'contact') return;
  const table = e.type === 'lead' ? 'leads' : 'contacts';
  const cur: any = store.get(table, e.id);
  const a = normEmail(address);
  if (cur && a && !emailsIn(cur.email || '').includes(a)) store.upsert(table, { id: e.id, email: cur.email ? `${cur.email}, ${a}` : a } as any);
}

// ---------------------------------------------------------------- booking, moving, cancelling

export interface Booked { activity: Activity; meetLink: string; when: string }

/** Creates the Google Calendar invite (Google emails it to them) and logs the meeting on the record. */
export async function createInvite(entity: Entity, attendee: string, pick: Pick): Promise<Booked> {
  const s = getMeetingSettings();
  const rec = recOf(entity);
  const vars = varsOf(rec);
  const r = await connectorCall({
    action: 'calCreate', start: pick.start.toISOString(), end: pick.end.toISOString(), attendee: normEmail(attendee),
    name: rec?.contactName || '', title: fillEmail(s.title, vars), description: fillEmail(s.description, vars), timeZone: localZone(),
  });
  const ev = r.event || {};
  rememberEmail(entity, attendee);
  const when = meetingWhen(pick.start, pick.end);
  const activity = logActivity(entity, {
    type: 'meeting', outcome: 'Scheduled', occurredAt: new Date(ev.start || pick.start).toISOString(), endAt: new Date(ev.end || pick.end).toISOString(),
    eventId: ev.id || '', meetLink: ev.meet || '', emailTo: normEmail(attendee), emailFrom: mailboxEmail(),
    notes: `${fillEmail(s.title, vars)} · invite sent to ${normEmail(attendee)}`,
  });
  return { activity, meetLink: ev.meet || '', when };
}

/** Your "Meeting confirmation" email, with the time and Meet link. */
export async function sendConfirmation(entity: Entity, attendee: string, booked: Booked) {
  const templates = getSetting<EmailTemplate[]>('emailTemplates', DEFAULT_TEMPLATES);
  const t = templates.find((x) => x.id === 'meeting') || templates.find((x) => /confirm/i.test(x.name)) || DEFAULT_TEMPLATES.find((x) => x.id === 'meeting')!;
  const vars = varsOf(recOf(entity));
  await sendEmail({ entity, to: normEmail(attendee), subject: fillEmail(t.subject, vars), body: withMeeting(fillEmail(t.body, vars), booked.when, booked.meetLink) });
}

/** Meeting Booked: the invite, then (if you want) the confirmation email. Says what happened. */
export async function bookMeeting(entity: Entity, attendee: string, pick: Pick, confirm: boolean): Promise<string[]> {
  const booked = await createInvite(entity, attendee, pick);
  const said = [`📅 Invite sent to ${normEmail(attendee)} for ${booked.when}${booked.meetLink ? ' (Google Meet link added)' : ''}`];
  if (confirm) {
    try { await sendConfirmation(entity, attendee, booked); said.push('✉️ Meeting confirmation email sent'); }
    catch (e: any) { said.push(`The invite went out, but the confirmation email didn't: ${e?.message || e}`); }
  }
  return said;
}

const relatedIds = (a: Activity) => {
  const ids = new Set([a.entityId]);
  if (a.entityType === 'contact') { const c = store.get('contacts', a.entityId); if (c?.leadId) ids.add(c.leadId); }
  if (a.entityType === 'lead') { const l = store.get('leads', a.entityId); if (l?.convertedContactId) ids.add(l.convertedContactId); }
  return ids;
};

/** The follow-up that was set for the meeting's time (moved or closed along with it). */
const meetingTasks = (a: Activity) => {
  const ids = relatedIds(a);
  const at = Date.parse(a.occurredAt);
  return store.list('tasks').filter((t) => !t.done && ids.has(t.entityId) && Math.abs(Date.parse(t.dueAt) - at) < 60000);
};

/** Moves the meeting; Google emails them the new time. Its follow-up moves too. */
export async function rescheduleMeeting(activityId: string, pick: Pick) {
  const a = store.get('activities', activityId);
  if (!a?.eventId) throw new Error('This meeting has no calendar invite to move');
  await connectorCall({ action: 'calUpdate', id: a.eventId, start: pick.start.toISOString(), end: pick.end.toISOString(), timeZone: localZone() });
  const tasks = meetingTasks(a);
  store.upsert('activities', { id: a.id, occurredAt: pick.start.toISOString(), endAt: pick.end.toISOString(), outcome: 'Rescheduled' });
  for (const t of tasks) store.upsert('tasks', { id: t.id, dueAt: pick.start.toISOString() });
  return meetingWhen(pick.start, pick.end);
}

/** Cancels the meeting; Google tells them. Its follow-up is closed. */
export async function cancelMeeting(activityId: string) {
  const a = store.get('activities', activityId);
  if (!a?.eventId) throw new Error('This meeting has no calendar invite to cancel');
  await connectorCall({ action: 'calCancel', id: a.eventId });
  const tasks = meetingTasks(a);
  store.upsert('activities', { id: a.id, outcome: 'Cancelled' });
  for (const t of tasks) store.upsert('tasks', { id: t.id, done: true, doneAt: new Date().toISOString(), notes: `${t.notes ? `${t.notes}\n` : ''}Meeting cancelled` });
}

/**
 * Your Join link: opens Meet as the Google account that owns the meeting (your email connector's), not whichever
 * account your browser signed in with first. (The client's invite and email keep the plain link.)
 */
export function joinUrl(link: string, account: string): string {
  if (!link || !account) return link || '';
  try {
    const u = new URL(link);
    u.searchParams.set('authuser', account);
    return u.toString();
  } catch {
    return link;
  }
}

export const isLiveMeeting = (a: Activity) => a.type === 'meeting' && !a.deleted && !!a.eventId && a.outcome !== 'Cancelled';

/** Meetings booked through the CRM that haven't ended yet, soonest first. */
export function upcomingMeetings(acts: Activity[], now = Date.now()): Activity[] {
  return acts.filter((a) => isLiveMeeting(a) && Date.parse(a.endAt || a.occurredAt) > now)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
