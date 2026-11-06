import { describe, expect, it } from 'vitest';
import { CALL_OUTCOMES } from '../constants';
import { callModeKey, isTyping, KEYED_OUTCOMES, outcomeForKey, outcomeKey } from '../keys';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;

describe('call shortcuts', () => {
  it('1–9 and 0 pick the outcomes in the order shown; Do Not Call has no key', () => {
    expect(KEYED_OUTCOMES).toHaveLength(10);
    expect(outcomeForKey('1')).toBe(CALL_OUTCOMES[0].name);
    expect(outcomeForKey('1')).toBe('No Answer');
    expect(outcomeForKey('7')).toBe('Meeting Booked');
    expect(outcomeForKey('8')).toBe('Warm – Not Ready Yet');
    expect(outcomeForKey('0')).toBe('Wrong Number');
    expect(outcomeKey('Meeting Booked')).toBe('7');
    expect(outcomeKey('Wrong Number')).toBe('0');
    expect(outcomeKey('Do Not Call')).toBe('');
    expect(KEYED_OUTCOMES).not.toContain('Do Not Call');
    expect(outcomeForKey('a')).toBe('');
    expect(outcomeForKey('-')).toBe('');
  });

  it('letters and numbers in a text box are typing, not shortcuts', () => {
    expect(isTyping(el('TEXTAREA'))).toBe(true);
    expect(isTyping(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isTyping(el('INPUT', { type: 'datetime-local' }))).toBe(true);
    expect(isTyping(el('SELECT'))).toBe(true);
    expect(isTyping(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTyping(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTyping(el('BUTTON'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it('Call Mode: Space calls, S skips, T texts, never while typing or with Cmd/Ctrl', () => {
    const body = el('BODY');
    expect(callModeKey({ key: ' ', target: body })).toBe('call');
    expect(callModeKey({ key: 's', target: body })).toBe('skip');
    expect(callModeKey({ key: 'S', target: body })).toBe('skip');
    expect(callModeKey({ key: 't', target: el('BUTTON') })).toBe('text');
    expect(callModeKey({ key: ' ', target: el('INPUT', { type: 'text' }) })).toBe('');
    expect(callModeKey({ key: 's', metaKey: true, target: body })).toBe('');
    expect(callModeKey({ key: ' ', repeat: true, target: body })).toBe('');
    expect(callModeKey({ key: 'x', target: body })).toBe('');
  });
});
