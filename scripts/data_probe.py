"""Prints the structure of public WA datasets used for lead sourcing (run on GitHub Actions)."""
import json
import urllib.parse
import urllib.request


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tradelink-crm-probe"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def arcgis(name, base):
    print(f"\n==================== {name} {base}")
    try:
        svc = get(base + "?f=json")
        layers = [l["id"] for l in svc.get("layers", [])] or [0]
        print("  layers:", [(l["id"], l["name"]) for l in svc.get("layers", [])])
    except Exception as e:  # noqa: BLE001
        print("  service error", e)
        layers = [0]
    for lid in layers[:2]:
        url = f"{base}/{lid}"
        try:
            meta = get(url + "?f=json")
            print(f"  layer {lid} '{meta.get('name')}' editingInfo.lastEditDate={meta.get('editingInfo', {}).get('lastEditDate')}")
            fields = [f["name"] for f in meta.get("fields", [])]
            print("  fields:", fields)
            print("  count:", get(url + "/query?" + urllib.parse.urlencode({"where": "1=1", "returnCountOnly": "true", "f": "json"})))
            rows = get(url + "/query?" + urllib.parse.urlencode({"where": "1=1", "outFields": "*", "resultRecordCount": 3, "returnGeometry": "false", "f": "json"}))
            for f in rows.get("features", []):
                print("  sample:", json.dumps(f.get("attributes"))[:900])
            for fld in fields:
                if any(k in fld.lower() for k in ("naics", "type", "categ", "class", "status", "desc")):
                    try:
                        st = get(url + "/query?" + urllib.parse.urlencode({
                            "where": "1=1", "groupByFieldsForStatistics": fld, "returnGeometry": "false", "f": "json",
                            "outStatistics": json.dumps([{"statisticType": "count", "onStatisticField": fld, "outStatisticFieldName": "n"}]),
                            "orderByFields": "n DESC", "resultRecordCount": 50}))
                        print(f"  top {fld}:", [(x['attributes'].get(fld), x['attributes'].get('n')) for x in st.get("features", [])][:50])
                    except Exception as e:  # noqa: BLE001
                        print("  stats error", fld, e)
        except Exception as e:  # noqa: BLE001
            print("  layer error", e)


arcgis("Tacoma", "https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/Business_Licenses/FeatureServer")
arcgis("Bellevue", "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Business_Licenses_(All)/FeatureServer")
