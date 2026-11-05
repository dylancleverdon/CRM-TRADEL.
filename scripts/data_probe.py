"""Statewide survey of WA business-license-like datasets + Seattle contact-name layer (GitHub Actions)."""
import json
import urllib.parse
import urllib.request

W, S, E, N = -124.9, 45.5, -116.9, 49.05  # Washington


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tradelink-crm-probe"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def inside_wa(ext):
    try:
        (x1, y1), (x2, y2) = ext
        # dataset footprint must sit inside Washington and be smaller than the whole US
        return x1 >= W - 0.5 and x2 <= E + 0.5 and y1 >= S - 0.5 and y2 <= N + 0.5
    except Exception:  # noqa: BLE001
        return False


print("=== ArcGIS Online: business/licence datasets whose footprint is inside Washington ===")
found = {}
for q in ['business license', 'business licenses', 'business', 'licensed', 'contractor', 'license']:
    start = 1
    while start and start <= 1000:
        d = get("https://www.arcgis.com/sharing/rest/search?" + urllib.parse.urlencode({
            "q": f'{q} AND (type:"Feature Service" OR type:"Map Service" OR type:"CSV" OR type:"Microsoft Excel")',
            "bbox": f"{W},{S},{E},{N}", "num": 100, "start": start, "f": "json"}))
        for it in d.get("results", []):
            t = (it.get("title") or "").lower()
            if not any(k in t for k in ("business", "licen", "contractor")):
                continue
            if not inside_wa(it.get("extent")):
                continue
            found[it["id"]] = (it.get("owner"), it.get("title"), it.get("type"), it.get("url") or "", it.get("access"))
        start = d.get("nextStart") if d.get("nextStart", -1) > 0 else None
for i, (owner, title, typ, url, acc) in sorted(found.items(), key=lambda x: (x[1][0] or "")):
    print(f"  {owner} | {title} | {typ} | {url} | {acc}")
print("total:", len(found))

print("\n=== Socrata: Washington domains with business/licence datasets ===")
for q in ["business license", "business licenses", "business", "contractor license", "licensed contractors"]:
    try:
        d = get("https://api.us.socrata.com/api/catalog/v1?" + urllib.parse.urlencode({"q": q, "only": "dataset", "limit": 300}))
        for r in d["results"]:
            dom = r.get("metadata", {}).get("domain", "")
            if any(k in dom for k in ("wa.gov", "seattle", "tacoma", "spokane", "kingcounty", "bellevue", "everett", "vancouver",
                                       "kitsap", "pierce", "snohomish", "clark", "olympia", "redmond", "kirkland", "renton", "kent", "bellingham", "yakima")):
                print(f"  {q!r}: {dom} | {r['resource']['id']} | {r['resource']['name']}")
    except Exception as e:  # noqa: BLE001
        print("socrata error", q, e)

print("\n=== Seattle Business License layer (contact names) ===")
base = "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Seattle_Business_License/FeatureServer"
try:
    svc = get(base + "?f=json")
    print("  layers:", [(l["id"], l["name"]) for l in svc.get("layers", [])])
    lid = svc["layers"][0]["id"]
    meta = get(f"{base}/{lid}?f=json")
    print("  fields:", [x["name"] for x in meta.get("fields", [])])
    print("  maxRecordCount:", meta.get("maxRecordCount"))
    print("  count:", get(f"{base}/{lid}/query?where=1%3D1&returnCountOnly=true&f=json"))
    w = " OR ".join(f"BUSLIC_NAICS_CODE LIKE '{p}%'" for p in ['23611', '238', '5617', '56162', '81141', '4842', '5621', '562991'])
    print("  home-service count:", get(f"{base}/{lid}/query?" + urllib.parse.urlencode({"where": w, "returnCountOnly": "true", "f": "json"})))
    s = get(f"{base}/{lid}/query?" + urllib.parse.urlencode({"where": w, "outFields": "*", "resultRecordCount": 2, "returnGeometry": "false", "f": "json"}))
    for f in s.get("features", []):
        print("  sample:", json.dumps(f["attributes"])[:700])
except Exception as e:  # noqa: BLE001
    print("  seattle layer error", e)
