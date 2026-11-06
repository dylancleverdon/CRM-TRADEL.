/**
 * On the phone, a lead or contact page leads with two big buttons, Call and Text; everything else is under More.
 * (On the Mac the full row of buttons stays as it is.)
 */
import { MessageSquare, MoreHorizontal, Phone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Modal } from './ui';

export function MobileActions({ phone, onCall, onText, title, more }: {
  phone?: string; onCall: () => void; onText: () => void; title: string;
  /** The rest of the actions, shown in a sheet; call `close` after one that opens something else. */
  more: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <div className="mobile-actions hide-desktop">
        <button className="btn call lg" disabled={!phone} onClick={onCall}><Phone size={20} /> Call</button>
        <button className="btn lg" disabled={!phone} onClick={onText}><MessageSquare size={19} /> Text</button>
        <button className="btn lg" onClick={() => setOpen(true)} aria-label="More actions"><MoreHorizontal size={19} /> More</button>
      </div>
      {open && (
        <Modal title={title} onClose={close}>
          <div className="sheet-actions">{more(close)}</div>
        </Modal>
      )}
    </>
  );
}
