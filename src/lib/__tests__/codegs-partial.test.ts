import { describe, expect, it } from 'vitest';
import { loadCodeGs } from './fakeAppsScript';

describe('Code.gs: a nameless lead never blanks out the sheet', () => {
  it('keeps filled fields when a partial copy arrives, but takes what it adds', () => {
    const s = loadCodeGs();
    s.handle({ action: 'sync', since: 0, changes: { leads: [{ id: 'L1', company: 'Senske Lawn & Tree Care LLC', contactName: 'Nathan Hurst', phone: '2065550100', updatedAt: '2026-11-06T18:00:00.000Z' }] } });
    s.handle({ action: 'sync', since: 0, changes: { leads: [{ id: 'L1', company: '', contactName: '', phone: '', lastOutcome: 'No Answer', updatedAt: '2026-11-06T19:00:00.000Z' }] } });
    const r = s.handle({ action: 'sync', since: 0, changes: {} }).changes.leads.find((x: any) => x.id === 'L1');
    expect(r).toMatchObject({ company: 'Senske Lawn & Tree Care LLC', contactName: 'Nathan Hurst', phone: '2065550100', lastOutcome: 'No Answer' });
  });
  it('a full update can still clear a field', () => {
    const s = loadCodeGs();
    s.handle({ action: 'sync', since: 0, changes: { leads: [{ id: 'L2', company: 'A', notes: 'x', updatedAt: '2026-11-06T18:00:00.000Z' }] } });
    s.handle({ action: 'sync', since: 0, changes: { leads: [{ id: 'L2', company: 'A', notes: '', updatedAt: '2026-11-06T19:00:00.000Z' }] } });
    expect(s.handle({ action: 'sync', since: 0, changes: {} }).changes.leads.find((x: any) => x.id === 'L2').notes).toBe('');
  });
});

describe('Code.gs: the phone never dials a call the Mac gave up on', () => {
  it('a cancelled request is gone, and an unanswered one expires after 15 seconds', () => {
    const s = loadCodeGs();
    const r = s.handle({ action: 'callRequest', req: { number: '2065550100' } });
    expect(s.handle({ action: 'callPoll', phone: true }).req.id).toBe(r.id);
    s.handle({ action: 'callCancel', id: r.id });
    expect(s.handle({ action: 'callPoll', phone: true }).req).toBeNull();
    const r2 = s.handle({ action: 'callRequest', req: { number: '2065550101' } });
    const stored = JSON.parse(s.props.get('callRequest')!);
    s.props.set('callRequest', JSON.stringify({ ...stored, at: stored.at - 16000 }));
    expect(s.handle({ action: 'callPoll', phone: true }).req).toBeNull();
    expect(r2.ok).toBe(true);
  });
});

describe('Code.gs: screenshots on suggestions', () => {
  it('puts the image in the Suggestion screenshots tab next to the suggestion, and needs the key once locked', () => {
    const s = loadCodeGs();
    const png = Buffer.from('fake-jpeg-bytes').toString('base64');
    const r = s.handle({ action: 'screenshot', suggestionId: 'sg1', page: 'Leads', text: 'Erased lead', image: `data:image/jpeg;base64,${png}` });
    expect(r).toEqual({ ok: true, row: 2 });
    const tab = s.active.getSheetByName('Suggestion screenshots')!;
    expect(tab.getRange(2, 1, 1, 4).getValues()[0].filter((_: any, i: number) => i !== 1)).toEqual(['sg1', 'Leads', 'Erased lead']);
    expect((tab as any).images[0]).toMatchObject({ col: 5, row: 2 });
    const key = (s.handle({ action: 'ping' }), s.props.get('tl_syncKey')!);
    s.handle({ action: 'lock', key });
    expect(s.handle({ action: 'screenshot', suggestionId: 'sg2', image: png })).toMatchObject({ ok: false, code: 'locked' });
  });
});
