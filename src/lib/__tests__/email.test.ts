import { describe, expect, it } from 'vitest';
import { buildPeopleIndex, emailActivityId, emailsIn, fillEmail, firstName, matchMessages, needsReply, type EmailMessage } from '../emailmatch';

const me = 'dylan@tradelink.marketing';
const msg = (id: string, p: Partial<EmailMessage>): EmailMessage => ({
  id, threadId: 't1', date: '2026-11-01T10:00:00Z', from: 'mike@acmehvac.com', fromName: 'Mike', to: [me], subject: 'Hi',
  snippet: 'hello', outgoing: false, unread: true, ...p,
});

describe('email matching', () => {
  const people = buildPeopleIndex([
    { type: 'lead', id: 'L1', name: 'Acme HVAC', email: 'Mike@AcmeHVAC.com, office@acmehvac.com' },
    { type: 'contact', id: 'C1', name: 'Bob Roofing', email: 'bob@roof.com' },
    { type: 'lead', id: 'L2', name: 'Bob lead dup', email: 'bob@roof.com' },
  ]);
  it('parses address lists and prefers contacts over leads', () => {
    expect(emailsIn('Mike@AcmeHVAC.com, office@acmehvac.com; "x" <z@y.io>')).toEqual(['mike@acmehvac.com', 'office@acmehvac.com', 'z@y.io']);
    expect(people.get('bob@roof.com')?.id).toBe('C1');
  });
  it('logs incoming and outgoing mail with known people, keeps the rest as "other"', () => {
    const { activities, unmatched } = matchMessages([
      msg('m1', {}),
      msg('m2', { from: me, to: ['office@acmehvac.com'], outgoing: true, subject: 'Re: Hi', date: '2026-11-02T10:00:00Z' }),
      msg('m3', { from: 'stranger@x.com' }),
      msg('m4', { from: me, to: ['stranger@x.com'], outgoing: true }),
    ], people, me);
    expect(activities.map((a) => [a.id, a.direction, a.outcome])).toEqual([
      ['em-m1-L1', 'in', 'Received: Hi'],
      ['em-m2-L1', 'out', 'Sent: Re: Hi'],
    ]);
    expect(unmatched.map((m) => m.id)).toEqual(['m3']); // my own sent mail to strangers isn't listed
    expect(emailActivityId('m1', 'L1')).toBe('em-m1-L1');
  });
  it('finds threads waiting on my reply', () => {
    const acts = [
      { type: 'email', threadId: 't1', direction: 'out', occurredAt: '2026-11-01' },
      { type: 'email', threadId: 't1', direction: 'in', occurredAt: '2026-11-02' },
      { type: 'email', threadId: 't2', direction: 'in', occurredAt: '2026-11-01' },
      { type: 'email', threadId: 't2', direction: 'out', occurredAt: '2026-11-03' },
      { type: 'call', threadId: '', direction: '', occurredAt: '2026-11-04' },
    ];
    expect(needsReply(acts).map((a) => a.threadId)).toEqual(['t1']);
  });
  it('fills templates', () => {
    expect(fillEmail('Hi {firstName}, {company} in {city}{missing}', { firstName: firstName('Carlos Guerrero'), company: 'Acme', city: 'Tacoma' })).toBe('Hi Carlos, Acme in Tacoma');
    expect(firstName('')).toBe('there');
  });
});
