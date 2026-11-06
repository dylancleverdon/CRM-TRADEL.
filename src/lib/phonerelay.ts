import { connectorCall } from './email';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mac → phone, through your private email connector (its URL is only on your devices): send a request, then wait
 * for the phone (in Desk phone mode) to confirm it. Resolves with the phone's ack; throws if it never answers.
 */
export async function relayToPhone(
  action: 'textRequest' | 'contactRequest' | 'keyRequest',
  body: Record<string, unknown>,
  ackKey: 'ack' | 'contactAck' | 'keyAck',
  onStatus?: (s: string) => void,
  timeoutMs = 90000,
): Promise<any> {
  const r = await connectorCall({ action, ...body });
  if (r.phoneSeenAgo < 0 || r.phoneSeenAgo > 30000)
    onStatus?.('Waiting for your phone: open TradeLink on it and turn on Desk phone mode (connected to the same email)…');
  else onStatus?.('Sending to your phone…');
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await wait(2500);
    const p = await connectorCall({ action: 'textPoll' }).catch(() => null);
    const ack = p?.[ackKey];
    if (ack?.id === r.id) return { ...ack, requestId: r.id };
  }
  throw new Error("Your phone didn't pick it up. Open TradeLink on the phone, turn on Desk phone mode, and make sure email is connected there too.");
}
