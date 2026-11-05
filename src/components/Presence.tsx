import { ExternalLink, Globe, MapPin, Phone, Search, Star } from 'lucide-react';
import { useState } from 'react';
import { ago } from '../lib/format';
import { openBeside } from '../lib/platform';
import {
  cleanCount, cleanRating, GOOGLE_STATUSES, googleMapsUrl, googlePhoneSearchUrl, googleSearchUrl, YELP_STATUSES, yelpSearchUrl,
  type Presence, type Site,
} from '../lib/presence';
import { nowIso, store } from '../lib/store';
import { Field, InlineInput } from './ui';

type Rec = Presence & { company: string; city?: string; state?: string; address?: string; phone?: string };

const chipColor = (s: string) => (s === 'Listed' ? 'good' : s === 'Not listed' ? 'bad' : 'warn');

/** How the business shows up on Yelp and Google: one tap to look, one tap to record what you found. */
export function PresenceCard({ rec, entity }: { rec: Rec; entity: { type: 'lead' | 'contact'; id: string } }) {
  const save = (patch: Partial<Presence>) => {
    const full = { id: entity.id, ...patch, presenceCheckedAt: nowIso() };
    if (entity.type === 'lead') store.upsert('leads', full);
    else store.upsert('contacts', full);
  };
  return (
    <div className="card">
      <div className="card-head">
        <Globe size={15} /><h3>Online presence</h3>
        <span className="faint" style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>{rec.presenceCheckedAt ? `checked ${ago(rec.presenceCheckedAt)}` : 'not checked yet'}</span>
      </div>
      <SiteRow site="yelp" rec={rec} save={save} />
      <SiteRow site="google" rec={rec} save={save} />
    </div>
  );
}

function SiteRow({ site, rec, save }: { site: Site; rec: Rec; save: (p: Partial<Presence>) => void }) {
  const [details, setDetails] = useState(false);
  const yelp = site === 'yelp';
  const status = (yelp ? rec.yelpStatus : rec.googleStatus) || '';
  const url = (yelp ? rec.yelpUrl : rec.googleUrl) || '';
  const rating = (yelp ? rec.yelpRating : rec.googleRating) || '';
  const reviews = (yelp ? rec.yelpReviews : rec.googleReviews) || '';
  const field = (k: 'Status' | 'Url' | 'Rating' | 'Reviews') => `${site}${k}` as keyof Presence;
  const byPhone = !yelp ? googlePhoneSearchUrl(rec) : '';
  return (
    <div style={{ padding: '8px 0', borderTop: yelp ? undefined : '1px solid var(--border)' }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <b style={{ minWidth: 58 }}>{yelp ? 'Yelp' : 'Google'}</b>
        {yelp
          ? <button className="btn sm" onClick={() => openBeside(yelpSearchUrl(rec))}><Search size={13} /> Search Yelp</button>
          : <>
            <button className="btn sm" onClick={() => openBeside(googleMapsUrl(rec))}><MapPin size={13} /> Maps</button>
            <button className="btn sm" onClick={() => openBeside(googleSearchUrl(rec))}><Search size={13} /> Search</button>
            {byPhone && <button className="btn sm" title="Find their listing by phone number" onClick={() => openBeside(byPhone)}><Phone size={13} /> By phone</button>}
          </>}
        {url && <button className="btn sm" onClick={() => openBeside(url)}><ExternalLink size={13} /> Their page</button>}
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {(yelp ? YELP_STATUSES : GOOGLE_STATUSES).map((s) => (
          <button key={s} className={`chip ${status === s ? `on ${chipColor(s)}` : ''}`} onClick={() => save({ [field('Status')]: status === s ? '' : s })}>{s}</button>
        ))}
        {(rating || reviews) && !details && <span className="faint" style={{ fontSize: '0.8rem' }}><Star size={12} style={{ verticalAlign: -1 }} /> {rating || '–'}{reviews ? ` · ${reviews} reviews` : ''}</span>}
        <button className="btn ghost sm" onClick={() => setDetails(!details)}>{details ? 'Done' : url || rating ? 'Edit' : 'Add link & stars'}</button>
      </div>
      {details && (
        <div className="form-grid" style={{ marginTop: 8 }}>
          <Field label={`${yelp ? 'Yelp' : 'Google'} page link`} full>
            <InlineInput value={url} placeholder={yelp ? 'https://www.yelp.com/biz/…' : 'https://maps.app.goo.gl/…'} onSave={(v) => save({ [field('Url')]: v.trim() })} />
          </Field>
          <Field label="Stars">
            <InlineInput value={rating} placeholder="4.5" inputMode="decimal" onSave={(v) => save({ [field('Rating')]: cleanRating(v) })} />
          </Field>
          <Field label="Reviews">
            <InlineInput value={reviews} placeholder="23" inputMode="numeric" onSave={(v) => save({ [field('Reviews')]: cleanCount(v) })} />
          </Field>
        </div>
      )}
    </div>
  );
}
