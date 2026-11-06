import { describe, expect, it } from 'vitest';
import { loadCodeGs } from './fakeAppsScript';

const lead = { id: 'L1', company: 'American First Air', phone: '3239975336', updatedAt: '2026-11-06T01:00:00.000Z' };

describe('Code.gs: sync key and lock', () => {
  it('before locking, everything still works without a key, and the key only appears in the private tab', () => {
    const s = loadCodeGs();
    const r = s.handle({ action: 'sync', since: 0, changes: {} });
    expect(r.ok).toBe(true);
    expect(r.security).toEqual({ locked: false, keyed: false, sheetUrl: 'https://docs.google.com/spreadsheets/d/main/edit' });
    const key = s.props.get('tl_syncKey')!;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(s.active.getSheetByName('🔒 Sync key')!.getRange('A3').getValue()).toBe(key);
    expect(JSON.stringify(r)).not.toContain(key);
    expect(JSON.stringify(s.handle({ action: 'ping' }))).not.toContain(key);
  });

  it('a device with the right key sees the devices and backups; a wrong key is simply not keyed', () => {
    const s = loadCodeGs();
    s.handle({ action: 'ping' });
    const key = s.props.get('tl_syncKey')!;
    const good = s.handle({ action: 'ping', key, device: { id: 'mac-1', name: 'Mac' } });
    expect(good.security.keyed).toBe(true);
    expect(good.security.devices['mac-1']).toMatchObject({ name: 'Mac', keyed: true });
    const bad = s.handle({ action: 'ping', key: 'nope', device: { id: 'phone-1', name: 'Android phone' } });
    expect(bad.security).toMatchObject({ locked: false, keyed: false });
    expect(bad.security.devices).toBeUndefined();
    expect(s.handle({ action: 'ping', key }).security.devices['phone-1']).toMatchObject({ keyed: false });
  });

  it('locking needs the key; once locked nothing works without it, and everything works with it', () => {
    const s = loadCodeGs();
    s.handle({ action: 'ping' });
    const key = s.props.get('tl_syncKey')!;
    expect(s.handle({ action: 'lock' }).ok).toBe(false);
    expect(s.props.get('tl_locked')).toBeUndefined();
    expect(s.handle({ action: 'lock', key }).security.locked).toBe(true);

    const blocked = s.handle({ action: 'sync', since: 0, changes: { leads: [lead] } });
    expect(blocked).toMatchObject({ ok: false, code: 'locked' });
    expect(s.handle({ action: 'callRequest', req: { number: '900' } })).toMatchObject({ ok: false, code: 'locked' });
    expect(s.handle({ action: 'callPoll' })).toMatchObject({ ok: false, code: 'locked' });
    expect(s.handle({ action: 'ping' })).toEqual({ ok: true, locked: true, keyed: false, codeVersion: '__CODE_VERSION__' });
    expect(s.active.getSheetByName('leads')!.getLastRow()).toBe(1); // only the header: nothing was written

    const ok = s.handle({ action: 'sync', key, since: 0, changes: { leads: [lead] } });
    expect(ok.ok).toBe(true);
    expect(s.active.getSheetByName('leads')!.getRange(2, 1, 1, 2).getValues()[0]).toEqual(['L1', 'American First Air']);
  });

  it('a ping sets up only what is missing: the key tab comes back if it was deleted', () => {
    const s = loadCodeGs();
    s.handle({ action: 'ping' });
    const key = s.props.get('tl_syncKey')!;
    s.active.deleteSheet(s.active.getSheetByName('🔒 Sync key')!);
    expect(s.handle({ action: 'ping', key }).security.keyed).toBe(true);
    expect(s.active.getSheetByName('🔒 Sync key')!.getRange('A3').getValue()).toBe(key);
  });

  it('the public reset is gone', () => {
    const s = loadCodeGs();
    s.handle({ action: 'sync', since: 0, changes: { leads: [lead] } });
    const key = s.props.get('tl_syncKey')!;
    expect(s.handle({ action: 'reset', confirm: 'YES', key }).error).toBe('Unknown action');
    expect(s.active.getSheetByName('leads')!.getLastRow()).toBe(2);
  });
});

describe('Code.gs: daily backups (keep 2)', () => {
  it('backs up before the first sync of the day is applied, alternating copies A and B', () => {
    const s = loadCodeGs();
    s.handle({ action: 'sync', since: 0, changes: { leads: [lead] } });
    const a = s.files.get(s.props.get('tl_backup_A')!)!;
    expect(a.name).toBe('CRM Tradelink Backup – A');
    expect(a.getSheetByName('leads')!.getLastRow()).toBe(1); // taken before the lead was added

    s.handle({ action: 'sync', since: 0, changes: {} }); // same day: no new backup
    expect(s.created).toBe(1);

    s.props.set('tl_nextBackup', '0'); // next day
    s.handle({ action: 'sync', since: 0, changes: {} });
    const b = s.files.get(s.props.get('tl_backup_B')!)!;
    expect(b.getSheetByName('leads')!.getRange(2, 1, 1, 2).getValues()[0]).toEqual(['L1', 'American First Air']);

    s.props.set('tl_nextBackup', '0'); // day after: A is overwritten, still only two copies
    s.handle({ action: 'sync', since: 0, changes: {} });
    expect(s.created).toBe(2);
    expect(a.getSheetByName('leads')!.getLastRow()).toBe(2);
    expect(a.getSheetByName('Sheet1')).toBeNull();

    const key = s.props.get('tl_syncKey')!;
    const info = s.handle({ action: 'ping', key }).security.backup;
    expect(info.copies.map((c: any) => c.slot)).toEqual(['A', 'B']);
    expect(info.error).toBe('');
  });

  it('a failing backup never blocks the sync, and shows why in Settings', () => {
    const s = loadCodeGs();
    s.failCreate = true;
    const r = s.handle({ action: 'sync', since: 0, changes: { leads: [lead] } });
    expect(r.ok).toBe(true);
    expect(s.active.getSheetByName('leads')!.getLastRow()).toBe(2);
    const key = s.props.get('tl_syncKey')!;
    expect(s.handle({ action: 'ping', key }).security.backup.error).toMatch(/Not allowed/);
  });
});
