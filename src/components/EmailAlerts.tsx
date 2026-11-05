import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { onNewEmail } from '../lib/email';
import { notify } from '../lib/platform';
import { toast } from './ui';

/** New email from a lead or contact: an in-app alert, and a system notification on the Mac (click opens it). */
export function EmailAlerts() {
  const navigate = useNavigate();
  useEffect(() => onNewEmail((mail) => {
    const first = mail[0];
    const title = mail.length === 1 ? `New email from ${first.entityName}` : `${mail.length} new emails from leads & contacts`;
    const body = mail.length === 1 ? first.subject : mail.slice(0, 3).map((m) => m.entityName).join(', ');
    toast(`✉️ ${title}`);
    notify(title, body, () => navigate(mail.length === 1 ? `/email?open=${encodeURIComponent(first.id)}` : '/email'));
  }), [navigate]);
  return null;
}
