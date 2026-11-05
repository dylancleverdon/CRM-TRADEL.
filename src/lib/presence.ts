/**
 * Online presence: how a business shows up on Yelp and Google. Checked by hand from Call Mode or the lead page
 * (one tap opens the search), recorded on the lead/contact, and used in the call script ({yelp} and {google}).
 */

export const YELP_STATUSES = ['Listed', 'Unclaimed', 'Not listed'] as const;
export const GOOGLE_STATUSES = ['Listed', 'Unverified', 'Not listed'] as const;
export type Site = 'yelp' | 'google';

export interface Presence {
  yelpStatus?: string;
  yelpUrl?: string;
  yelpRating?: string;
  yelpReviews?: string;
  googleStatus?: string;
  googleUrl?: string;
  googleRating?: string;
  googleReviews?: string;
  presenceCheckedAt?: string;
}

/** Every presence field, so a lead's findings carry over when it becomes a contact. */
export const PRESENCE_FIELDS: (keyof Presence)[] = [
  'yelpStatus', 'yelpUrl', 'yelpRating', 'yelpReviews', 'googleStatus', 'googleUrl', 'googleRating', 'googleReviews', 'presenceCheckedAt',
];

interface Biz { company?: string; city?: string; state?: string; address?: string; phone?: string }

const place = (b: Biz) => [b.city, b.state || 'WA'].filter(Boolean).join(', ');

export const yelpSearchUrl = (b: Biz) =>
  `https://www.yelp.com/search?find_desc=${encodeURIComponent(b.company || '')}&find_loc=${encodeURIComponent(place(b))}`;

export const googleMapsUrl = (b: Biz) =>
  `https://www.google.com/maps/search/${encodeURIComponent([b.company, b.address, b.city, b.state].filter(Boolean).join(' '))}`;

export const googleSearchUrl = (b: Biz) =>
  `https://www.google.com/search?q=${encodeURIComponent([b.company, b.city, b.state].filter(Boolean).join(' '))}`;

/** Odd legal names ("Ballard Htg Clng Elec & Plbg") often only match by phone number. */
export function googlePhoneSearchUrl(b: Biz): string {
  const d = (b.phone || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return '';
  return `https://www.google.com/search?q=${encodeURIComponent(`"${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}"`)}`;
}

export function statusField(site: Site) { return site === 'yelp' ? 'yelpStatus' : 'googleStatus'; }

/** Accepts "4.5", "4,5", "4.5 stars"; returns '' if it isn't a rating. */
export function cleanRating(v: string): string {
  const m = (v || '').replace(',', '.').match(/\d(\.\d)?/);
  const n = m ? Number(m[0]) : NaN;
  return n >= 1 && n <= 5 ? String(n) : '';
}

export function cleanCount(v: string): string {
  const d = (v || '').replace(/[^\d]/g, '');
  return d ? String(Number(d)) : '';
}

const ratingText = (rating?: string, reviews?: string) =>
  rating ? `${rating} stars${reviews ? ` from ${reviews} review${reviews === '1' ? '' : 's'}` : ''}` : reviews ? `${reviews} review${reviews === '1' ? '' : 's'}` : '';

/** Lines for the call script's {yelp} and {google} placeholders ('' when not checked yet). */
export function presenceLines(p: Presence & Biz & { trade?: string }): { yelp: string; google: string } {
  const trade = (p.trade || 'home service').toLowerCase();
  const city = p.city || 'your area';
  let yelp = '';
  if (p.yelpStatus === 'Not listed') yelp = `I noticed ${p.company} isn't on Yelp yet, which means you're not showing up when people ask AI search for a ${trade} company in ${city}.`;
  else if (p.yelpStatus === 'Unclaimed') yelp = `I noticed your Yelp page isn't claimed yet, so you can't reply to reviews or control what people see there.`;
  else if (p.yelpStatus === 'Listed') yelp = `I saw you're on Yelp${ratingText(p.yelpRating, p.yelpReviews) ? ` with ${ratingText(p.yelpRating, p.yelpReviews)}` : ''}.`;
  let google = '';
  if (p.googleStatus === 'Not listed') google = `You're also not showing up on Google Maps just yet.`;
  else if (p.googleStatus === 'Unverified') google = `Your Google Business Profile isn't verified yet, so it's not showing up the way it could.`;
  else if (p.googleStatus === 'Listed') google = `On Google you've got ${ratingText(p.googleRating, p.googleReviews) || 'a Business Profile'}.`;
  return { yelp, google };
}

/** Matches the Leads list filter. */
export function presenceMatch(p: Presence, filter: string): boolean {
  if (!filter) return true;
  if (filter === 'noYelp') return p.yelpStatus === 'Not listed' || p.yelpStatus === 'Unclaimed';
  if (filter === 'noGoogle') return p.googleStatus === 'Not listed' || p.googleStatus === 'Unverified';
  if (filter === 'gap') return presenceMatch(p, 'noYelp') || presenceMatch(p, 'noGoogle');
  if (filter === 'unchecked') return !p.yelpStatus && !p.googleStatus;
  return true;
}
