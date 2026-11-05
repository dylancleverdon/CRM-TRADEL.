"""Runs the Lead Finder's exact live queries for every source (GitHub Actions)."""
import datetime
import json
import time
import urllib.parse
import urllib.request

NAICS = ['23611', '238', '5617', '56162', '81141', '4842', '5621', '562991']
LI_SELECT = 'businessname,contractorlicensenumber,contractorlicensetypecode,contractorlicensetypecodedesc,address1,address2,city,state,zip,phonenumber,licenseeffectivedate,licenseexpirationdate,businesstypecodedesc,specialtycode1desc,specialtycode2desc,ubi,primaryprincipalname'


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tradelink-crm-probe"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def socrata(name, domain, ds, params):
    t = time.time(); rows = []; off = 0; size = 0
    try:
        while True:
            body = get(f"https://{domain}/resource/{ds}.json?" + urllib.parse.urlencode({**params, "$limit": 5000, "$offset": off}))
            size += len(body); page = json.loads(body); rows += page; off += 5000
            if len(page) < 5000: break
        ph = sum(1 for r in rows if r.get("phonenumber") or r.get("business_phone"))
        print(f"OK {name}: {len(rows)} rows, {ph} with phone, {size/1e6:.1f} MB, {time.time()-t:.1f}s")
        print("   sample:", json.dumps(rows[0])[:300] if rows else None)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {name}: {e}")


def arcgis(name, layer, where, fields, order):
    t = time.time(); rows = []; off = 0
    try:
        while True:
            page = json.loads(get(f"{layer}/query?" + urllib.parse.urlencode({"where": where, "outFields": fields, "returnGeometry": "false", "f": "json",
                                                                           "resultOffset": off, "resultRecordCount": 2000, "orderByFields": order})))
            if "error" in page: raise RuntimeError(page["error"])
            feats = [f["attributes"] for f in page.get("features", [])]
            rows += feats; off += 2000
            if (len(feats) < 2000 and not page.get("exceededTransferLimit")) or not feats: break
        print(f"OK {name}: {len(rows)} rows, {time.time()-t:.1f}s")
        print("   sample:", json.dumps(rows[0])[:300] if rows else None)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {name}: {e}")


two_years = (datetime.date.today() - datetime.timedelta(days=730)).isoformat()
socrata("L&I active", "data.wa.gov", "m8qx-ubtq", {"$select": LI_SELECT, "$where": "statuscode='A'", "$order": "contractorlicensenumber"})
socrata("L&I lapsed (2y)", "data.wa.gov", "m8qx-ubtq", {"$select": LI_SELECT, "$where": f"statuscode='E' AND licenseexpirationdate > '{two_years}T00:00:00'", "$order": "contractorlicensenumber"})
socrata("Seattle all", "cos-data.seattle.gov", "wnbq-64tb", {"$where": " OR ".join(f"starts_with(naics_code, '{p}')" for p in NAICS), "$order": "city_account_number"})
socrata("Everett", "data.everettwa.gov", "qvfa-2v26", {"$select": "registration,legalentityname,primarydba,ubi,naics,address,issuedate,firstactivitydate",
        "$where": " OR ".join(f"starts_with(naics, '{p}')" for p in NAICS), "$order": "registration"})
arcgis("Seattle owners", "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Seattle_Business_License/FeatureServer/0",
       " OR ".join(f"BUSLIC_NAICS_CODE LIKE '{p}%'" for p in NAICS),
       "objectid,BUSLIC_ID,BUSLIC_LEGAL_NAME,BUSLIC_TRADE_NAME,BUSLIC_CONTACT_NAME,BUSLIC_PHONE_NUM,BUSLIC_NAICS_CODE,BUSLIC_NAICS_DESC,BUSLIC_LOCATION_ADRS_TEXT,BUSLIC_MAIL_ADRS_TEXT,BUSLIC_OPENDATE,BUSLIC_CITYACCTNUM", "objectid")
arcgis("Bellevue", "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Business_Licenses_(All)/FeatureServer/3",
       "CancelDate IS NULL AND (" + " OR ".join(f"Naic LIKE '{p}%'" for p in NAICS) + ")", "OBJECTID,BusinessId,Dba,Ubi,Naic", "OBJECTID")
arcgis("Tacoma", "https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/Business_Licenses/FeatureServer/0",
       " OR ".join(f"NAICS_Code LIKE '{p}%'" for p in NAICS), "OBJECTID,License_Number,Trade_Name,NAICS_Code", "OBJECTID")
