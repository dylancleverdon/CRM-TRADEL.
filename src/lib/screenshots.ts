/**
 * Screenshots on suggestions: shrunk on this device (JPEG, at most 1280 px) and put into the "Suggestion
 * screenshots" tab of your sheet next to the suggestion. Queued here until the sheet takes it (e.g. offline).
 */
import { store } from './store';
import { sheetAction } from './sync';

const LS = 'tl.shotQueue';
interface Shot { suggestionId: string; page: string; text: string; image: string }
const load = (): Shot[] => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } };
const save = (l: Shot[]) => { try { localStorage.setItem(LS, JSON.stringify(l)); } catch { /* full: keep what fits */ } };

/** A picked or pasted image → a JPEG data URL small enough for the sheet. */
export async function shrinkImage(file: Blob, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't an image")); i.src = url; });
    let scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    for (let q = 0.8; ; q -= 0.15, scale *= 0.85) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', Math.max(0.4, q));
      if (data.length < 1_400_000 || q < 0.45) return data;
    }
  } finally { URL.revokeObjectURL(url); }
}

let flushing = false;
/** Sends queued screenshots to the sheet; marks each suggestion once it's there. */
export async function flushScreenshots(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const s of load()) {
      try {
        const r = await sheetAction({ action: 'screenshot', ...s });
        if (!r?.ok) break;
        save(load().filter((x) => x.suggestionId !== s.suggestionId));
        store.upsert('suggestions', { id: s.suggestionId, screenshot: `Row ${r.row} of the Suggestion screenshots tab` } as any);
        sent++;
      } catch { break; } // offline: try again later
    }
  } finally { flushing = false; }
  return sent;
}

export function attachScreenshot(suggestionId: string, page: string, text: string, image: string) {
  save([...load().filter((x) => x.suggestionId !== suggestionId), { suggestionId, page, text, image }]);
  return flushScreenshots();
}
