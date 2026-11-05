import type { LeadStatus } from './types';

export const LEAD_STATUSES: LeadStatus[] = ['New', 'Attempting', 'Connected', 'Qualified', 'Nurture', 'Disqualified', 'Converted'];

export const LEAD_STATUS_HELP: Record<LeadStatus, string> = {
  New: 'Never contacted',
  Attempting: 'Called, no conversation yet',
  Connected: 'Spoke with someone, not yet qualified',
  Qualified: 'Good fit - interested / has need',
  Nurture: 'Not now - revisit later',
  Disqualified: 'Bad fit - do not pursue',
  Converted: 'Became a contact',
};

export const DISQUALIFY_REASONS = [
  'Not interested', 'Already has an agency', 'No budget', 'Too small', 'Out of service area',
  'Wrong number / bad data', 'Do not call', 'Out of business', 'Not a decision maker', 'Other',
];

export const CONTACT_STATUSES = ['Prospect', 'Active Client', 'Past Client'] as const;

export interface StageDef { name: string; probability: number; closed?: 'won' | 'lost' }

export const DEFAULT_STAGES: StageDef[] = [
  { name: 'Discovery Booked', probability: 20 },
  { name: 'Discovery Held', probability: 35 },
  { name: 'Proposal Sent', probability: 60 },
  { name: 'Negotiation', probability: 80 },
  { name: 'Closed Won', probability: 100, closed: 'won' },
  { name: 'Closed Lost', probability: 0, closed: 'lost' },
];

export const DEFAULT_SERVICES = ['Yelp Ads', 'SEO / Google Business Profile', 'Google Ads / LSA', 'Social Media', 'Review Generation', 'Other'];

export const DEFAULT_TRADES = [
  'HVAC', 'Plumbing', 'Plumbing & HVAC', 'Electrical', 'Roofing', 'General Contractor', 'Remodeling', 'Landscaping',
  'Lawn Care', 'Tree Service', 'Pest Control', 'Cleaning', 'Carpet Cleaning', 'Pressure Washing', 'Painting', 'Handyman',
  'Garage Doors', 'Pool Service', 'Fencing', 'Concrete', 'Masonry', 'Paving', 'Flooring', 'Tile & Stone',
  'Cabinets & Carpentry', 'Drywall', 'Insulation', 'Siding', 'Gutters', 'Windows & Doors', 'Window Coverings',
  'Excavation', 'Septic & Sewer', 'Well & Pump', 'Irrigation', 'Fireplace & Stoves', 'Solar', 'Appliance Repair',
  'Junk Removal', 'Moving', 'Locksmith', 'Demolition', 'Commercial / Industrial', 'Other',
];

export const LOST_REASONS = ['Price', 'Went with competitor', 'No decision / ghosted', 'Timing', 'Not a fit', 'Other'];

export interface OutcomeDef {
  name: string;
  connected: boolean;       // spoke to a decision maker
  attempt: boolean;         // counts as a call attempt
  status?: LeadStatus;      // lead status after this outcome
  quality?: 'good' | 'bad';
  disqualifyReason?: string;
  followUpDays?: number;    // default follow-up (0 = later today)
  color: string;
}

export const CALL_OUTCOMES: OutcomeDef[] = [
  { name: 'No Answer', connected: false, attempt: true, status: 'Attempting', followUpDays: 1, color: 'muted' },
  { name: 'Left Voicemail', connected: false, attempt: true, status: 'Attempting', followUpDays: 2, color: 'muted' },
  { name: 'Busy', connected: false, attempt: true, status: 'Attempting', followUpDays: 0, color: 'muted' },
  { name: 'Gatekeeper', connected: false, attempt: true, status: 'Attempting', followUpDays: 1, color: 'warn' },
  { name: 'Call Back Later', connected: true, attempt: true, status: 'Connected', followUpDays: 1, color: 'warn' },
  { name: 'Interested - Send Info', connected: true, attempt: true, status: 'Qualified', quality: 'good', followUpDays: 2, color: 'good' },
  { name: 'Meeting Booked', connected: true, attempt: true, status: 'Qualified', quality: 'good', followUpDays: 1, color: 'good' },
  { name: 'Not Interested', connected: true, attempt: true, status: 'Nurture', followUpDays: 90, color: 'bad' },
  { name: 'Wrong Number', connected: false, attempt: true, status: 'Disqualified', quality: 'bad', disqualifyReason: 'Wrong number / bad data', color: 'bad' },
  { name: 'Do Not Call', connected: true, attempt: true, status: 'Disqualified', quality: 'bad', disqualifyReason: 'Do not call', color: 'bad' },
];

export const outcomeDef = (name: string) => CALL_OUTCOMES.find((o) => o.name === name);

export const DECISIONS = ['Pending', 'Approved', 'Rejected', 'Implemented', 'Duplicate'] as const;

export const DEFAULT_GOALS = { calls: 60, connects: 12, meetings: 2, followUps: 10 };

export const DEFAULT_SCRIPT = `Hi, is this the owner of {company}?

This is {myName} with TradeLink - we help {trade} companies in {city} get more booked jobs from Google, Yelp and Local Services Ads.

Quick question: where do most of your new customers come from right now?

[Listen]

We just helped a {trade} company near you add 20+ jobs a month. Would you be open to a 15-minute call this week so I can show you what that would look like for you?`;

export const GITHUB_REPO = 'dylancleverdon/CRM-TRADEL.';
export const LATEST_JSON_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/latest.json`;
export const APK_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/TradeLink-CRM.apk`;
