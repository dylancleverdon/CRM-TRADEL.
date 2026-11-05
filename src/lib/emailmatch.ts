/** Pure helpers for email: matching messages to CRM people, thread state, templates. */

export interface EmailMessage {
  id: string;
  threadId: string;
  date: string;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  snippet: string;
  outgoing: boolean;
  unread: boolean;
}

export interface Person { type: 'lead' | 'contact'; id: string; name: string; email: string }

export interface EmailActivityDraft {
  id: string;
  entityType: 'lead' | 'contact';
  entityId: string;
  entityName: string;
  type: 'email';
  outcome: string;
  notes: string;
  occurredAt: string;
  threadId: string;
  messageId: string;
  direction: 'in' | 'out';
  emailFrom: string;
  emailTo: string;
}

export const normEmail = (e: string) => String(e || '').trim().toLowerCase();

/** Every address in a free-text email field ("a@x.com, b@y.com"). */
export function emailsIn(field: string): string[] {
  return (String(field || '').match(/[^\s,;<>"]+@[^\s,;<>"]+\.[a-z]{2,}/gi) || []).map(normEmail);
}

export function buildPeopleIndex(people: Person[]): Map<string, Person> {
  const m = new Map<string, Person>();
  // contacts win over leads for the same address
  for (const p of people.filter((x) => x.type === 'lead')) for (const e of emailsIn(p.email)) m.set(e, p);
  for (const p of people.filter((x) => x.type === 'contact')) for (const e of emailsIn(p.email)) m.set(e, p);
  return m;
}

/** Deterministic id so both devices create the same activity (no duplicates). */
export const emailActivityId = (messageId: string, entityId: string) => `em-${messageId}-${entityId}`;

/**
 * Split messages into activities for known people and "other" mail.
 * Only the other side of the conversation is used for matching (not my own address).
 */
export function matchMessages(messages: EmailMessage[], people: Map<string, Person>, me: string) {
  const activities: EmailActivityDraft[] = [];
  const unmatched: EmailMessage[] = [];
  const myAddr = normEmail(me);
  for (const m of messages) {
    const others = (m.outgoing ? m.to : [m.from]).map(normEmail).filter((a) => a && a !== myAddr);
    const hits = new Map<string, Person>();
    for (const a of others) {
      const p = people.get(a);
      if (p) hits.set(p.id, p);
    }
    if (!hits.size) {
      if (!m.outgoing) unmatched.push(m);
      continue;
    }
    for (const p of hits.values()) {
      activities.push({
        id: emailActivityId(m.id, p.id),
        entityType: p.type,
        entityId: p.id,
        entityName: p.name,
        type: 'email',
        outcome: `${m.outgoing ? 'Sent' : 'Received'}: ${m.subject}`,
        notes: m.snippet,
        occurredAt: m.date,
        threadId: m.threadId,
        messageId: m.id,
        direction: m.outgoing ? 'out' : 'in',
        emailFrom: m.from,
        emailTo: m.to.join(', '),
      });
    }
  }
  return { activities, unmatched };
}

/** Threads whose latest logged message came from the other person = waiting on a reply from me. */
export function needsReply<T extends { threadId?: string; direction?: string; occurredAt: string; type: string; deleted?: boolean }>(acts: T[]): T[] {
  const latest = new Map<string, T>();
  for (const a of acts) {
    if (a.type !== 'email' || !a.threadId || a.deleted) continue;
    const cur = latest.get(a.threadId);
    if (!cur || a.occurredAt > cur.occurredAt) latest.set(a.threadId, a);
  }
  return Array.from(latest.values()).filter((a) => a.direction === 'in').sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

// ---------------------------------------------------------------- templates

export interface EmailTemplate { id: string; name: string; subject: string; body: string }

export const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    id: 'vm', name: 'After voicemail',
    subject: 'Quick question for {company}',
    body: `Hi {firstName},

I just tried calling and left you a voicemail. I'm {myName} with TradeLink — we help {trade} companies in {city} get more booked jobs from Google, Yelp and Local Services Ads.

Would you be open to a quick 15-minute call this week? I can show you exactly where your next customers are searching.

Thanks,
{myName}
TradeLink`,
  },
  {
    id: 'info', name: 'Info they asked for',
    subject: 'The info you asked for — TradeLink',
    body: `Hi {firstName},

Great talking with you today. As promised, here's a quick overview of how we help {trade} businesses like {company}:

• Google Business Profile & local SEO — show up in the map pack
• Google Local Services Ads — pay per lead, Google Guaranteed badge
• Yelp Ads — capture people ready to hire
• Review generation — more 5-star reviews, automatically

What's a good time this week for a 15-minute walkthrough?

{myName}
TradeLink`,
  },
  {
    id: 'meeting', name: 'Meeting confirmation',
    subject: 'Confirmed: our call',
    body: `Hi {firstName},

Thanks for making time — this confirms our call. I'll walk you through what's working for other {trade} companies in {city} and what it would look like for {company}.

If anything changes, just reply to this email.

Talk soon,
{myName}`,
  },
  {
    id: 'proposal', name: 'Proposal follow-up',
    subject: 'Following up on your proposal',
    body: `Hi {firstName},

Just following up on the proposal I sent over for {company}. Happy to answer any questions or adjust anything so it fits what you need.

Would a quick call tomorrow work?

{myName}
TradeLink`,
  },
];

export function fillEmail(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
}

export function firstName(full: string): string {
  return String(full || '').trim().split(/\s+/)[0] || 'there';
}
