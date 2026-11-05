"""Prints the structure of public WA datasets used for lead sourcing (run on GitHub Actions)."""
import json
import urllib.parse
import urllib.request


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tradelink-crm-probe"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def soql(domain, ds, **params):
    return get(f"https://{domain}/resource/{ds}.json?" + urllib.parse.urlencode(params))


def describe(domain, ds, top_cols=()):
    print(f"\n==================== {domain} {ds}")
    try:
        meta = get(f"https://{domain}/api/views/{ds}.json")
    except Exception as e:  # noqa: BLE001
        print("  meta error", e)
        return
    print("  name:", meta.get("name"), "| rowsUpdatedAt:", meta.get("rowsUpdatedAt"))
    cols = [c["fieldName"] for c in meta.get("columns", []) if not c["fieldName"].startswith(":")]
    print("  columns:", cols)
    try:
        print("  total rows:", soql(domain, ds, **{"$select": "count(*)"}))
        for row in soql(domain, ds, **{"$limit": 2}):
            print("  sample:", json.dumps(row)[:900])
    except Exception as e:  # noqa: BLE001
        print("  rows error", e)
    for c in cols:
        if any(k in c.lower() for k in top_cols):
            try:
                rows = soql(domain, ds, **{"$select": f"{c}, count(*) as n", "$group": c, "$order": "n DESC", "$limit": 60})
                print(f"  top values of {c}:", [(r.get(c), r.get("n")) for r in rows])
            except Exception as e:  # noqa: BLE001
                print(f"  group error {c}", e)
    return cols


# Seattle business license tax certificates
cols = describe("cos-data.seattle.gov", "wnbq-64tb", top_cols=("naics_desc", "naics_description", "city"))
if cols:
    naics = next((c for c in cols if c.lower() in ("naics_code", "naicscode", "naics")), None)
    if naics:
        # Home-service NAICS prefixes: 2361 res. building, 2381-2389 specialty trades, 5617 services to buildings
        # (5616 security/locksmith, 56173 landscaping, 56172 janitorial, 56174 carpet), 8113 repair, 4842 movers
        for pre in ["2361", "238", "5617", "56172", "56173", "56174", "56179", "5616", "811", "4842", "5629"]:
            try:
                print(f"  Seattle NAICS {pre}*:", soql("cos-data.seattle.gov", "wnbq-64tb", **{"$select": "count(*)", "$where": f"starts_with({naics}, '{pre}')"}))
            except Exception as e:  # noqa: BLE001
                print("  naics count error", pre, e)

# ArcGIS Hub (Tacoma, Spokane, counties ... publish here, not on Socrata)
for q in ["business license washington", "business licenses Tacoma", "business license Spokane", "business license Kitsap",
          "business license Mason County", "business license Everett", "business license Vancouver WA",
          "business license Bellevue", "business license Kent WA", "business license Olympia", "business registry Washington"]:
    try:
        d = get("https://hub.arcgis.com/api/search/v1/collections/dataset/items?" + urllib.parse.urlencode({"q": q, "limit": 12}))
        print(f"\n--- arcgis hub '{q}'")
        for f in d.get("features", []):
            p = f.get("properties", {})
            print(f"  {p.get('title')} | {p.get('owner') or p.get('orgName') or ''} | {p.get('url') or p.get('source') or ''} | modified {str(p.get('modified',''))[:10]}")
    except Exception as e:  # noqa: BLE001
        print("hub error", q, e)

# Socrata catalog, all domains, Washington-ish business license datasets
for q in ["business license", "business licenses", "active business"]:
    try:
        d = get("https://api.us.socrata.com/api/catalog/v1?" + urllib.parse.urlencode({"q": q, "limit": 40}))
        print(f"\n--- socrata (all domains) '{q}'")
        for r in d["results"]:
            res = r["resource"]
            dom = r.get("metadata", {}).get("domain", "")
            print(f"  {dom} | {res['id']} | {res['name']} | {res.get('type')} | updated {res.get('data_updated_at','')[:10]}")
    except Exception as e:  # noqa: BLE001
        print("catalog error", q, e)
