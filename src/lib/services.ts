/**
 * An opportunity can be for several services. They're kept in its one `service` column as a list,
 * e.g. "Yelp Ads, SEO / Google Business Profile", so older single-service deals keep working unchanged.
 */
export const serviceList = (s: string | undefined): string[] => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

export const joinServices = (list: string[]): string => Array.from(new Set(list.map((x) => x.trim()).filter(Boolean))).join(', ');

/** For names and cards: "Yelp Ads + SEO / Google Business Profile". */
export const serviceLabel = (s: string | undefined): string => serviceList(s).join(' + ');

export function toggleService(s: string | undefined, name: string): string {
  const list = serviceList(s);
  return joinServices(list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);
}

/** Commas separate services, so a service's own name can't contain one. */
export const cleanServiceName = (s: string): string => s.replace(/\s*,\s*/g, ' / ').trim();
