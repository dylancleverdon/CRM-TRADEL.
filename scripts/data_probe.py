"""Inspect WA candidate business datasets found by the statewide survey (GitHub Actions)."""
import json
import urllib.parse
import urllib.request

NAICS = ['23611', '238', '5617', '56162', '81141', '4842', '5621', '562991']


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tradelink-crm-probe"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def socrata(domain, ds):
    print(f"\n==== {domain} {ds}")
    try:
        meta = get(f"https://{domain}/api/views/{ds}.json")
        print("  name:", meta.get("name"), "| type:", meta.get("viewType"), meta.get("assetType"))
        print("  desc:", (meta.get("description") or "")[:400].replace("\n", " "))
        cols = [c["fieldName"] for c in meta.get("columns", []) if not c["fieldName"].startswith(":")]
        print("  columns:", cols)
        print("  rows:", get(f"https://{domain}/resource/{ds}.json?$select=count(*)"))
        for r in get(f"https://{domain}/resource/{ds}.json?$limit=2"):
            print("  sample:", json.dumps(r)[:700])
        for c in cols:
            if any(k in c.lower() for k in ("naics", "city", "type", "status", "descr", "category")):
                try:
                    rows = get(f"https://{domain}/resource/{ds}.json?" + urllib.parse.urlencode({"$select": f"{c}, count(*) as n", "$group": c, "$order": "n DESC", "$limit": 25}))
                    print(f"  top {c}:", [(r.get(c), r.get('n')) for r in rows])
                except Exception as e:  # noqa: BLE001
                    print("  group err", c, e)
    except Exception as e:  # noqa: BLE001
        print("  error", e)


def arc(name, base):
    print(f"\n==== {name} {base}")
    try:
        svc = get(base + "?f=json")
        layers = svc.get("layers") or [{"id": 0, "name": "?"}]
        print("  layers:", [(l["id"], l["name"]) for l in layers][:6], "| desc:", (svc.get("serviceDescription") or svc.get("description") or "")[:200])
        for l in layers[:2]:
            u = f"{base}/{l['id']}"
            meta = get(u + "?f=json")
            print(f"  layer {l['id']} fields:", [f["name"] for f in meta.get("fields", [])][:40])
            print("  count:", get(u + "/query?where=1%3D1&returnCountOnly=true&f=json"))
            s = get(u + "/query?" + urllib.parse.urlencode({"where": "1=1", "outFields": "*", "resultRecordCount": 2, "returnGeometry": "false", "f": "json"}))
            for f in s.get("features", []):
                print("  sample:", json.dumps(f["attributes"])[:600])
    except Exception as e:  # noqa: BLE001
        print("  error", e)


socrata("data.everettwa.gov", "qvfa-2v26")
socrata("data.wa.gov", "hw7n-fcif")
socrata("data.wa.gov", "5t5b-7yy4")
arc("OpenDataFME Business Licenses", "https://services5.arcgis.com/frpHL0Fv8koQRVWY/arcgis/rest/services/Business_Licenses/FeatureServer")
arc("Shoreline Business Inventory", "https://services.arcgis.com/PV0gqqATVfCt173z/arcgis/rest/services/City_of_Shoreline_Business_Inventory/FeatureServer")
arc("Spokane Valley NE_PAO Businesses", "https://services2.arcgis.com/hYnqO6a7TkujNqEg/arcgis/rest/services/AGOL_Support/FeatureServer")
arc("Bellevue local businesses", "https://services7.arcgis.com/9u5SMK7jcrQbBJIC/arcgis/rest/services/WhatsOpenPublicView/FeatureServer")
