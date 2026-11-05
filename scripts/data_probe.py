"""Prints the structure of public WA datasets used for lead sourcing (run on GitHub Actions)."""
import json
import urllib.parse
import urllib.request


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tradelink-crm-probe"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def soql(domain, ds, **params):
    q = urllib.parse.urlencode(params)
    return get(f"https://{domain}/resource/{ds}.json?{q}")


def describe(domain, ds, top_cols=()):
    print(f"\n==================== {domain} {ds}")
    try:
        meta = get(f"https://{domain}/api/views/{ds}.json")
    except Exception as e:  # noqa: BLE001
        print("  meta error", e)
        return
    print("  name:", meta.get("name"))
    print("  rowsUpdatedAt:", meta.get("rowsUpdatedAt"))
    cols = [c["fieldName"] for c in meta.get("columns", []) if not c["fieldName"].startswith(":")]
    print("  columns:", cols)
    try:
        print("  total rows:", soql(domain, ds, **{"$select": "count(*)"}))
    except Exception as e:  # noqa: BLE001
        print("  count error", e)
    try:
        for row in soql(domain, ds, **{"$limit": 2}):
            print("  sample:", json.dumps(row)[:900])
    except Exception as e:  # noqa: BLE001
        print("  sample error", e)
    for c in cols:
        if any(k in c.lower() for k in top_cols):
            try:
                rows = soql(domain, ds, **{"$select": f"{c}, count(*) as n", "$group": c, "$order": "n DESC", "$limit": 80})
                print(f"  top values of {c}:", [(r.get(c), r.get("n")) for r in rows])
            except Exception as e:  # noqa: BLE001
                print(f"  group error {c}", e)


def catalog(domain, query):
    try:
        d = get("https://api.us.socrata.com/api/catalog/v1?" + urllib.parse.urlencode({"domains": domain, "q": query, "limit": 8}))
        print(f"\n--- catalog {domain} '{query}'")
        for r in d["results"]:
            res = r["resource"]
            print(f"  {res['id']} | {res['name']} | updated {res.get('data_updated_at', '')[:10]} | type {res.get('type')}")
    except Exception as e:  # noqa: BLE001
        print("catalog error", domain, query, e)


# L&I contractor registry + principals (owners)
describe("data.wa.gov", "m8qx-ubtq", top_cols=("special", "status", "type", "contractortype"))
describe("data.wa.gov", "4xk5-x9j6")

for q in ["business lookup", "business license", "pesticide license", "household goods", "contractor",
          "electrical", "plumber", "landscape", "cleaning"]:
    catalog("data.wa.gov", q)
for dom, q in [("data.seattle.gov", "business license"), ("data.cityoftacoma.org", "business license"),
               ("data.bellevuewa.gov", "business license"), ("data.spokanecity.org", "business license"),
               ("data.kingcounty.gov", "business license")]:
    catalog(dom, q)
