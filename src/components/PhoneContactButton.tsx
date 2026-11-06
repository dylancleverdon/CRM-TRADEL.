import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { ago } from '../lib/format';
import { addToPhoneContacts } from '../lib/phonecontacts';
import type { EntityType } from '../lib/types';
import { toast } from './ui';

/**
 * "Save to phone": adds this lead/contact to your phone's contacts (and so Google Contacts), no call needed.
 * On the Mac your phone does it, so it works the same from either device.
 */
export function PhoneContactButton({ entity, rec, sm }: {
  entity: { type: EntityType; id: string };
  rec: { phone?: string; phoneContactAt?: string };
  sm?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const onPhone = !!rec.phoneContactAt;
  const save = async () => {
    setBusy(true);
    try {
      toast(`📇 ${await addToPhoneContacts([entity], (s) => toast(s))}`);
    } catch (e: any) {
      toast(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className={`btn ${sm ? 'sm' : ''} ${onPhone ? 'selected' : ''}`}
      disabled={!rec.phone || busy}
      title={onPhone ? `In your phone contacts (saved ${ago(rec.phoneContactAt)}). Click to save again.` : 'Add to your phone contacts, no call needed'}
      onClick={save}
    >
      <Smartphone size={sm ? 13 : 15} /> {busy ? 'Saving…' : onPhone ? 'On my phone' : 'Save to phone'}
    </button>
  );
}
