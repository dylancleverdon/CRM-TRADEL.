"""Runs the Lead Finder's exact queries against the live public datasets (GitHub Actions)."""
import json
import time
import urllib.parse
import urllib.request

NAICS = ['23611', '238', '5617', '56162', '81141', '4842', '5621', '562991']


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tradelink-crm-probe"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def socrata(name, domain, ds, params):
    t = time.time(); rows = []; off = 0; size = 0
    while True:
        q = urllib.parse.urlencode({**params, "$limit": 5000, "$offset": off})
        req = urllib.request.Request(f"https://{domain}/resource/{ds}.json?{q}", headers={"User-Agent": "probe"})
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read(); size += len(body); page = json.loads(body)
        rows += page; off += 5000
        if len(page) < 5000: break
    with_phone = sum(1 for r in rows if (r.get("phonenumber") or r.get("business_phone")))
    print(f"{name}: {len(rows)} rows, {with_phone} with phone, {size/1e6:.1f} MB, {time.time()-t:.1f}s, pages={off//5000}")
    print("  sample:", json.dumps(rows[0])[:400] if rows else None)


def arcgis(name, layer, where, fields):
    t = time.time(); rows = []; off = 0
    while True:
        q = urllib.parse.urlencode({"where": where, "outFields": fields, "returnGeometry": "false", "f": "json",
                                    "resultOffset": off, "resultRecordCount": 2000, "orderByFields": "OBJECTID"})
        page = get(f"{layer}/query?{q}")
        if "error" in page: print(name, "ERROR", page["error"]); return
        feats = [f["attributes"] for f in page.get("features", [])]
        rows += feats; off += 2000
        if (len(feats) < 2000 and not page.get("exceededTransferLimit")) or not feats: break
    print(f"{name}: {len(rows)} rows, {time.time()-t:.1f}s")
    print("  sample:", json.dumps(rows[0])[:400] if rows else None)


socrata("L&I active", "data.wa.gov", "m8qx-ubtq", {
    "$select": "businessname,contractorlicensenumber,contractorlicensetypecode,contractorlicensetypecodedesc,address1,address2,city,state,zip,phonenumber,licenseeffectivedate,businesstypecodedesc,specialtycode1desc,specialtycode2desc,ubi,primaryprincipalname",
    "$where": "statuscode='A'", "$order": "contractorlicensenumber"})
socrata("Seattle home services", "cos-data.seattle.gov", "wnbq-64tb", {
    "$where": " OR ".join(f"starts_with(naics_code, '{p}')" for p in NAICS), "$order": "city_account_number"})
arcgis("Bellevue home services", "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Business_Licenses_(All)/FeatureServer/3",
       "CancelDate IS NULL AND (" + " OR ".join(f"Naic LIKE '{p}%'" for p in NAICS) + ")",
       "OBJECTID,BusinessId,LegalEntityName,Dba,Ubi,Naic,LegalEntityType,FirstActivityDate,CancelDate,PhysicalCity")
arcgis("Tacoma home services", "https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/Business_Licenses/FeatureServer/0",
       " OR ".join(f"NAICS_Code LIKE '{p}%'" for p in NAICS),
       "OBJECTID,License_Number,Business_Name,Trade_Name,NAICS_Code,Business_Open_Date,Site_City")
