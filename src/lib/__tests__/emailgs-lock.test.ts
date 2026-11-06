import { describe, expect, it } from 'vitest';
import { loadEmailGs } from './fakeAppsScript';

const later = (c: ReturnType<typeof loadEmailGs>) => c.cache.clear(); // 10 minutes pass: cached answers expire

describe('Email.gs: follows the CRM lock with the same sync key', () => {
  it('while the CRM is open, the connector stays open, and keeps only a hash of a confirmed key', () => {
    const c = loadEmailGs();
    expect(c.handle({ action: 'ping' })).toMatchObject({ ok: true, email: 'dylan@tradelink.marketing', locked: false });
    expect(c.handle({ action: 'textRequest', req: { number: '2065550101', body: 'hi' } }).ok).toBe(true);
    expect(c.handle({ action: 'ping', auth: c.sheet.key })).toMatchObject({ keyed: true, locked: false });
    const stored = c.props.get('tl_keyHash')!;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(c.sheet.key);
    expect([...c.props.values()].join(' ')).not.toContain(c.sheet.key);
  });

  it('once the CRM is locked, it locks itself: nothing without the key, everything with it', () => {
    const c = loadEmailGs();
    c.handle({ action: 'ping', auth: c.sheet.key });
    c.sheet.locked = true;
    later(c);
    expect(c.handle({ action: 'recent', since: 0 })).toMatchObject({ ok: false, code: 'locked' });
    expect(c.props.get('tl_locked')).toBe('1');
    expect(c.handle({ action: 'send', to: 'x@y.com', subject: 'hi', body: 'hi', auth: 'f'.repeat(64) })).toMatchObject({ ok: false, code: 'locked' });
    expect(c.handle({ action: 'textRequest', req: { number: '900', body: 'x' } })).toMatchObject({ ok: false, code: 'locked' });
    const ping = c.handle({ action: 'ping' });
    expect(ping).toEqual({ ok: true, locked: true, keyed: false, version: '__CODE_VERSION__' });
    expect(c.handle({ action: 'recent', since: 0, auth: c.sheet.key })).toMatchObject({ ok: true, messages: [] });
    expect(c.handle({ action: 'ping', auth: c.sheet.key })).toMatchObject({ ok: true, email: 'dylan@tradelink.marketing', locked: true, keyed: true });
  });

  it('a phone without the key gets only a pending "take the key" request, nothing else', () => {
    const c = loadEmailGs();
    c.sheet.locked = true;
    const key = c.sheet.key;
    c.handle({ action: 'textRequest', req: { number: '2065550101', body: 'Good speaking with you' }, auth: key });
    c.handle({ action: 'keyRequest', key, auth: key });
    const poll = c.handle({ action: 'textPoll', phone: true });
    expect(poll.keyReq.key).toBe(key);
    expect(poll.req).toBeUndefined();
    expect(poll.contactReq).toBeUndefined();
    expect(poll.ack).toBeUndefined();
    // With the key it took, the phone gets everything again and confirms.
    const keyed = c.handle({ action: 'textPoll', phone: true, auth: key, keyAck: poll.keyReq.id, keyOk: true });
    expect(keyed.req.body).toBe('Good speaking with you');
    expect(c.props.has('tl_keyRequest')).toBe(false);
  });

  it('a new key in the sheet takes over by itself, and the old key stops working', () => {
    const c = loadEmailGs();
    c.sheet.locked = true;
    const old = c.sheet.key;
    expect(c.handle({ action: 'recent', since: 0, auth: old }).ok).toBe(true);
    c.sheet.key = 'n'.repeat(64);
    later(c);
    expect(c.handle({ action: 'recent', since: 0, auth: old })).toMatchObject({ ok: false, code: 'locked' });
    expect(c.handle({ action: 'recent', since: 0, auth: c.sheet.key }).ok).toBe(true);
  });

  it("if the sheet can't be reached, a key it confirmed before still works, others don't", () => {
    const c = loadEmailGs();
    c.sheet.locked = true;
    const key = c.sheet.key;
    c.handle({ action: 'ping', auth: key });
    c.sheet.down = true;
    later(c);
    expect(c.handle({ action: 'recent', since: 0, auth: key }).ok).toBe(true);
    expect(c.handle({ action: 'recent', since: 0, auth: 'z'.repeat(64) })).toMatchObject({ ok: false, code: 'locked' });
    expect(c.handle({ action: 'recent', since: 0 })).toMatchObject({ ok: false, code: 'locked' });
  });

  it("made-up keys can't run up the sheet's quota", () => {
    const c = loadEmailGs();
    c.sheet.locked = true;
    c.handle({ action: 'ping', auth: c.sheet.key });
    const before = c.fetches;
    for (let i = 0; i < 40; i++) c.handle({ action: 'recent', since: 0, auth: `guess-${i}`.padEnd(64, 'x') });
    expect(c.fetches - before).toBeLessThanOrEqual(10);
    expect(c.handle({ action: 'recent', since: 0, auth: c.sheet.key }).ok).toBe(true); // you still get in
  });
});
