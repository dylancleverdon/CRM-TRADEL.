import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LeadStatus } from '../lib/types';

export function Modal({ title, onClose, children, footer, wide, xwide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; xwide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${xwide ? 'xwide' : ''}`}>
        <div className="modal-head">
          <h2 style={{ flex: 1 }}>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- toasts ----------
let pushToast: (msg: string) => void = () => {};
export const toast = (msg: string) => pushToast(msg);

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  useEffect(() => {
    pushToast = (msg) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), msg.length > 60 ? 6000 : 2600);
    };
  }, []);
  return (
    <div className="toast-wrap">
      {items.map((i) => <div className="toast" key={i.id}>{i.msg}</div>)}
    </div>
  );
}

export const STATUS_COLOR: Record<string, string> = {
  New: 'info', Attempting: '', Connected: 'warn', Qualified: 'good', Nurture: 'accent', Disqualified: 'bad', Converted: 'good',
  Prospect: 'info', 'Active Client': 'good', 'Past Client': '',
  Pending: 'warn', Approved: 'good', Rejected: 'bad', Implemented: 'accent', Duplicate: '',
};

export function StatusPill({ status }: { status: LeadStatus | string }) {
  return <span className={`pill ${STATUS_COLOR[status] || ''}`}>{status || '—'}</span>;
}

export function QualityPill({ q }: { q: string }) {
  if (q === 'good') return <span className="pill good">👍 Good</span>;
  if (q === 'bad') return <span className="pill bad">👎 Bad</span>;
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return <label className={`field ${full ? 'full' : ''}`}>{label}{children}</label>;
}

export function Progress({ value, max, good }: { value: number; max: number; good?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className={`progress ${good || pct >= 100 ? 'good' : ''}`}><div style={{ width: `${pct}%` }} /></div>;
}

/** Text input that saves on blur, so typing doesn't spam sync. */
export function InlineInput({ value, onSave, placeholder, type = 'text', ...rest }: {
  value: string | number; onSave: (v: string) => void; placeholder?: string; type?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => setV(String(value ?? '')), [value]);
  return (
    <input
      {...rest}
      type={type}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== String(value ?? '') && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
