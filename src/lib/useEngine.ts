/** The lead engine's model, shared by Call Mode, the Dashboard and Settings. Rebuilt when calls, leads or deals change. */
import { useMemo } from 'react';
import { stages } from './actions';
import { DEFAULT_GOALS } from './constants';
import { buildModel, DEFAULT_ENGINE, type EngineSettings } from './engine';
import { store, useSetting, useTable } from './store';

export function useEngineSettings(): EngineSettings {
  const s = useSetting<Partial<EngineSettings>>('engine', DEFAULT_ENGINE);
  return { ...DEFAULT_ENGINE, ...(s || {}) };
}

export function useEngineModel() {
  const acts = useTable('activities');
  const leads = useTable('leads');
  const contacts = useTable('contacts');
  const opps = useTable('opportunities');
  const settings = useEngineSettings();
  const goals = useSetting('goals', DEFAULT_GOALS);
  const g = { calls: Number(goals.calls) || 60, connects: Number(goals.connects) || 12, meetings: Number(goals.meetings) || 2 };
  const model = useMemo(
    () => buildModel({
      activities: acts, getLead: (id) => store.get('leads', id), contacts, opportunities: opps,
      wonStages: stages().filter((s) => s.closed === 'won').map((s) => s.name), goal: settings.goal, goals: g,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acts, leads, contacts, opps, settings.goal, g.calls, g.connects, g.meetings],
  );
  return { model, settings };
}
