"""Statewide survey: every published business-license-like dataset covering Washington (GitHub Actions)."""
import json
import urllib.parse
import urllib.request

WA_BBOX = "-124.85,45.54,-116.91,49.01"
TERMS = ["business license", "business licenses", "business registration", "licensed businesses", "business directory",
         "businesses", "business location", "contractor license", "home occupation"]
KEYS = ("business", "licen", "contractor", "occupation")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tradelink-crm-probe"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


print("=== ArcGIS Hub/Online: datasets whose extent is inside Washington ===")
seen = {}
for term in TERMS:
    url = "https://hub.arcgis.com/api/search/v1/collections/dataset/items?" + urllib.parse.urlencode({"q": term, "bbox": WA_BBOX, "limit": 100})
    pages = 0
    while url and pages < 10:
        try:
            d = get(url)
        except Exception as e:  # noqa: BLE001
            print("hub error", term, e); break
        for f in d.get("features", []):
            p = f.get("properties", {})
            title = (p.get("title") or "")
            if not any(k in title.lower() for k in KEYS):
                continue
            key = p.get("url") or p.get("id")
            if key in seen:
                continue
            seen[key] = (title, p.get("owner") or "", p.get("url") or "", str(p.get("modified") or "")[:10])
        nxt = [l["href"] for l in d.get("links", []) if l.get("rel") == "next"]
        url = nxt[0] if nxt else None
        pages += 1
for k, (title, owner, url, mod) in sorted(seen.items(), key=lambda x: x[1][1]):
    print(f"  {title} | {owner} | {url} | {mod}")
print("total hub candidates:", len(seen))

print("\n=== Socrata: all Washington government open-data domains ===")
try:
    doms = get("https://api.us.socrata.com/api/catalog/v1/domains?limit=2000")["results"]
    wa = [d["domain"] for d in doms if any(k in d["domain"] for k in ("wa.gov", "seattle", "tacoma", "spokane", "kingcounty", "bellevue",
                                                                         "everett", "vancouver", "kitsap", "pierce", "snohomish", "clark", "olympia", "redmond", "kirkland", "renton", "kent"))]
    print("  domains:", wa)
    for dom in wa:
        for term in ["business license", "business", "contractor"]:
            r = get("https://api.us.socrata.com/api/catalog/v1?" + urllib.parse.urlencode({"domains": dom, "q": term, "only": "dataset", "limit": 20}))
            for x in r["results"]:
                n = x["resource"]["name"]
                if any(k in n.lower() for k in KEYS):
                    print(f"  {dom} | {x['resource']['id']} | {n} | updated {x['resource'].get('data_updated_at','')[:10]}")
except Exception as e:  # noqa: BLE001
    print("socrata error", e)

print("\n=== Seattle 'Seattle Business License' map layer (with contact names) ===")
try:
    d = get("https://hub.arcgis.com/api/search/v1/collections/dataset/items?" + urllib.parse.urlencode({"q": "Seattle Business License", "limit": 10}))
    for f in d.get("features", []):
        p = f["properties"]
        print("  ", p.get("title"), "|", p.get("owner"), "|", p.get("url"))
        if p.get("owner") == "SeattleCityGIS" and p.get("url") and "Business_License" in p.get("url", "").replace(" ", "_"):
            base = p["url"]
            meta = get(base + "?f=json")
            print("   fields:", [x["name"] for x in meta.get("fields", [])][:40])
            print("   count:", get(base + "/query?where=1%3D1&returnCountOnly=true&f=json"))
except Exception as e:  # noqa: BLE001
    print("seattle layer error", e)
