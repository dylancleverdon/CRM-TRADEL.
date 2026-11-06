/**
 * Follow-up reminders on the phone: a notification when a follow-up comes due, at its due time. They're scheduled
 * on the phone itself, so they fire with the app closed. Off by default (Settings → Follow-up reminders); the
 * setting is per phone. Tapping one opens the lead or contact. Follow-ups made on the Mac are picked up the next
 * time the phone syncs.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { isAndroid } from './platform';
import { store } from './store';
import type { Task } from './types';

const LS_ON = 'tl.reminders';
const LS_SCHEDULED = 'tl.remindersScheduled';
/** Upcoming reminders kept scheduled at once (Android limits how many alarms an app may hold). */
export const MAX_REMINDERS = 60;
const HORIZON_DAYS = 30;
const CHANNEL = 'followups';

export const remindersOn = () => { try { return localStorage.getItem(LS_ON) === 'on'; } catch { return false; } };

/** A stable notification id for a follow-up. */
export function notifId(taskId: string): number {
  let h = 0;
  for (let i = 0; i < taskId.length; i++) h = (Math.imul(31, h) + taskId.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) || 1;
}

export interface Planned { id: number; taskId: string; at: string; title: string; body: string; route: string }
type Scheduled = Record<string, { n: number; at: string; title: string; body: string }>;

/** Where tapping the reminder goes. */
export function routeFor(t: Pick<Task, 'entityType' | 'entityId'>, contactOfOpp: (id: string) => string = () => ''): string {
  if (t.entityType === 'lead' && t.entityId) return `/leads/${t.entityId}`;
  if (t.entityType === 'contact' && t.entityId) return `/contacts/${t.entityId}`;
  if (t.entityType === 'opportunity' && t.entityId) {
    const c = contactOfOpp(t.entityId);
    return c ? `/contacts/${c}?opp=${t.entityId}` : '/pipeline';
  }
  return '/tasks';
}

/** What should be scheduled: open follow-ups due later (within 30 days), soonest first, at most 60. */
export function planReminders(tasks: Task[], now = Date.now(), contactOfOpp?: (id: string) => string): Planned[] {
  const nowIso = new Date(now).toISOString();
  const until = new Date(now + HORIZON_DAYS * 86400000).toISOString();
  return tasks
    .filter((t) => !t.deleted && !t.done && t.dueAt && t.dueAt > nowIso && t.dueAt <= until)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id))
    .slice(0, MAX_REMINDERS)
    .map((t) => ({
      id: notifId(t.id),
      taskId: t.id,
      at: t.dueAt,
      title: `Follow-up: ${t.entityName || 'TradeLink'}`,
      body: `${t.title || 'Follow up'}. Tap to open.`,
      route: routeFor(t, contactOfOpp),
    }));
}

/** What changed since the last time: notifications to cancel and to (re)schedule. */
export function diffReminders(prev: Scheduled, next: Planned[]): { cancel: number[]; schedule: Planned[] } {
  const want = new Map(next.map((p) => [p.taskId, p]));
  const cancel: number[] = [];
  for (const [taskId, s] of Object.entries(prev)) {
    const p = want.get(taskId);
    if (!p || p.at !== s.at || p.title !== s.title || p.body !== s.body) cancel.push(s.n);
  }
  const schedule = next.filter((p) => {
    const s = prev[p.taskId];
    return !s || s.at !== p.at || s.title !== p.title || s.body !== p.body;
  });
  return { cancel, schedule };
}

const loadScheduled = (): Scheduled => { try { return JSON.parse(localStorage.getItem(LS_SCHEDULED) || '{}'); } catch { return {}; } };
const saveScheduled = (s: Scheduled) => { try { localStorage.setItem(LS_SCHEDULED, JSON.stringify(s)); } catch { /* ignore */ } };

let running = false;
let again = false;

/** Brings the phone's scheduled reminders in line with your follow-ups (or clears them when reminders are off). */
export async function syncReminders(): Promise<number> {
  if (!isAndroid()) return 0;
  if (running) { again = true; return 0; }
  running = true;
  try {
    const prev = loadScheduled();
    const plan = remindersOn()
      ? planReminders(store.list('tasks'), Date.now(), (id) => store.get('opportunities', id)?.contactId || '')
      : [];
    const { cancel, schedule } = diffReminders(prev, plan);
    if (cancel.length) await LocalNotifications.cancel({ notifications: cancel.map((id) => ({ id })) });
    if (schedule.length) {
      await LocalNotifications.schedule({
        notifications: schedule.map((p) => ({
          id: p.id, title: p.title, body: p.body, channelId: CHANNEL, smallIcon: 'ic_stat_tradelink', iconColor: '#1f9d63',
          schedule: { at: new Date(p.at), allowWhileIdle: true }, extra: { route: p.route, taskId: p.taskId },
        })),
      });
    }
    const next: Scheduled = {};
    for (const p of plan) next[p.taskId] = { n: p.id, at: p.at, title: p.title, body: p.body };
    saveScheduled(next);
    return plan.length;
  } finally {
    running = false;
    if (again) { again = false; void syncReminders(); }
  }
}

/** Cancels and schedules everything again (e.g. once exact timing is allowed, so earlier ones are on time too). */
export async function rescheduleAllReminders(): Promise<void> {
  if (!isAndroid()) return;
  const prev = loadScheduled();
  const ids = Object.values(prev).map((s) => s.n);
  if (ids.length) await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) }).catch(() => {});
  saveScheduled({});
  await syncReminders();
}

/** The next reminder that will fire, for Settings. */
export function nextReminder(): { at: string; title: string } | null {
  const s = Object.values(loadScheduled()).sort((a, b) => a.at.localeCompare(b.at))[0];
  return s ? { at: s.at, title: s.title } : null;
}
export const scheduledCount = () => Object.keys(loadScheduled()).length;

export interface ReminderAccess { notifications: 'granted' | 'denied' | 'prompt'; exact: 'granted' | 'denied' | 'unknown' }

export async function reminderAccess(): Promise<ReminderAccess> {
  const p = await LocalNotifications.checkPermissions();
  let exact: ReminderAccess['exact'] = 'unknown';
  try { exact = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted' ? 'granted' : 'denied'; } catch { /* older Android: always exact */ }
  const n = p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
  return { notifications: n, exact };
}

/** Turns reminders on or off on this phone. Turning on asks for notification access. */
export async function setReminders(on: boolean): Promise<ReminderAccess> {
  if (on) {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
    if (p.display !== 'granted') throw new Error('Notifications are off for TradeLink. Turn them on in Android Settings → Apps → TradeLink CRM → Notifications.');
  }
  try { localStorage.setItem(LS_ON, on ? 'on' : 'off'); } catch { /* ignore */ }
  await syncReminders();
  return reminderAccess();
}

/** Opens Android's "Alarms & reminders" setting so reminders fire exactly on time. */
export const allowExactTiming = () => LocalNotifications.changeExactNotificationSetting();

let started = false;

/** At app start (Android): tapping a reminder opens its record; reminders follow your follow-ups as they change. */
export function startReminders() {
  if (!isAndroid() || started) return;
  started = true;
  LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const route = a.notification?.extra?.route;
    if (typeof route === 'string' && route.startsWith('/')) window.location.hash = `#${route}`;
  }).catch(() => {});
  LocalNotifications.createChannel({ id: CHANNEL, name: 'Follow-up reminders', description: 'When a follow-up comes due', importance: 4, visibility: 1, vibration: true })
    .catch(() => {})
    .finally(() => { void syncReminders().catch(() => {}); });
  let t: ReturnType<typeof setTimeout> | undefined;
  store.subscribe(() => {
    if (!remindersOn()) return;
    clearTimeout(t);
    t = setTimeout(() => { void syncReminders().catch(() => {}); }, 2000); // after a sync or an edit settles
  });
}
