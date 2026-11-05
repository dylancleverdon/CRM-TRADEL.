import { ListPlus } from 'lucide-react';
import { setQueued } from '../lib/actions';
import { toast } from './ui';

/** Adds a lead or contact to "My queue" in Call Mode (called right after the current call), or takes it off. */
export function QueueButton({ entity, queued, disabled, compact, sm }: {
  entity: { type: 'lead' | 'contact'; id: string };
  queued: boolean;
  disabled?: boolean;
  /** Icon only (for table rows). */
  compact?: boolean;
  sm?: boolean;
}) {
  return (
    <button
      className={`btn ${sm || compact ? 'sm' : ''} ${queued ? 'selected' : ''}`}
      disabled={disabled}
      title={queued ? 'In your call queue: click to take it off' : 'Add to your call queue: called right after the current call'}
      onClick={(e) => {
        e.stopPropagation();
        setQueued(entity, !queued);
        toast(queued ? 'Taken off your call queue' : 'Added to your call queue');
      }}
    >
      <ListPlus size={compact || sm ? 13 : 15} />{!compact && (queued ? ' Queued' : ' Queue call')}
    </button>
  );
}
