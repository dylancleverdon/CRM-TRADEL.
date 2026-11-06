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
