/**
 * TradeLink CRM - Google Sheets sync backend.
 *
 * SETUP (one time, ~2 minutes):
 *  1. Open the Google Sheet "CRM Tradelink Data Storage".
 *  2. Extensions -> Apps Script. Delete what is there, paste this whole file, click Save.
 *  3. Click Deploy -> New deployment -> (gear) Web app.
 *       Execute as: Me      Who has access: Anyone
 *     Click Deploy, approve the permissions, and copy the "Web app URL".
 *  4. Paste that URL into Settings -> Sync in both the Mac app and the Android app.
 *
 * The script creates every tab and header it needs on first use.
 * You can edit data directly in the sheet; edits sync back to the apps.
 * In the "suggestions" tab use the Decision dropdown to record decisions.
 */

var TABLES = {
  leads: ['id', 'company', 'contactName', 'phone', 'altPhone', 'email', 'website', 'trade', 'city', 'state', 'address',
    'source', 'status', 'quality', 'disqualifyReason', 'tags', 'attempts', 'lastContactedAt', 'lastOutcome',
    'nextFollowUpAt', 'notes', 'convertedContactId', 'createdAt', 'updatedAt', 'deleted', '_serverTime'],
  contacts: ['id', 'company', 'contactName', 'title', 'phone', 'altPhone', 'email', 'website', 'trade', 'city', 'state',
    'address', 'status', 'leadId', 'tags', 'lastContactedAt', 'lastOutcome', 'nextFollowUpAt', 'notes', 'createdAt',
    'updatedAt', 'deleted', '_serverTime'],
  opportunities: ['id', 'contactId', 'name', 'service', 'stage', 'monthlyValue', 'setupFee', 'probability',
    'expectedCloseDate', 'nextStep', 'lostReason', 'closedAt', 'notes', 'createdAt', 'updatedAt', 'deleted', '_serverTime'],
  activities: ['id', 'entityType', 'entityId', 'entityName', 'type', 'outcome', 'notes', 'durationSec', 'phone',
    'occurredAt', 'createdAt', 'updatedAt', 'deleted', '_serverTime'],
  tasks: ['id', 'entityType', 'entityId', 'entityName', 'title', 'dueAt', 'priority', 'done', 'doneAt', 'notes',
    'createdAt', 'updatedAt', 'deleted', '_serverTime'],
  suggestions: ['id', 'page', 'suggestion', 'decision', 'decisionNotes', 'decidedAt', 'createdAt', 'updatedAt',
    'deleted', '_serverTime'],
  settings: ['id', 'value', 'updatedAt', 'deleted', '_serverTime']
};

var DECISIONS = ['Pending', 'Approved', 'Rejected', 'Implemented', 'Duplicate'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.payload) return json_(handle_(JSON.parse(p.payload)));
  return json_(handle_({ action: p.action || 'ping' }));
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad JSON' }); }
  return json_(handle_(body));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(body) {
  try {
    if (body.action === 'ping') {
      setup();
      return { ok: true, serverTime: Date.now(), tables: Object.keys(TABLES), sheet: SpreadsheetApp.getActive().getName() };
    }
    if (body.action === 'sync') return sync_(body);
    if (body.action === 'reset' && body.confirm === 'YES') return reset_();
    return { ok: false, error: 'Unknown action' };
  } catch (err) {
    return { ok: false, error: String(err && err.stack || err) };
  }
}

/** Creates any missing tabs / headers. Safe to run any time. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = getHeaders_(sh);
    var missing = TABLES[name].filter(function (h) { return headers.indexOf(h) < 0; });
    if (headers.length === 0) {
      sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
    } else if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#0f3d26').setFontColor('#ffffff');
    if (name === 'suggestions') {
      var hs = getHeaders_(sh);
      var col = hs.indexOf('decision') + 1;
      var rule = SpreadsheetApp.newDataValidation().requireValueInList(DECISIONS, true).setAllowInvalid(true).build();
      sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
    }
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
}

function getHeaders_(sh) {
  var lc = sh.getLastColumn();
  if (lc === 0) return [];
  return sh.getRange(1, 1, 1, lc).getValues()[0].map(String).filter(function (h) { return h !== ''; });
}

function cellToValue_(v) {
  if (v instanceof Date) return v.toISOString();
  if (v === null || v === undefined) return '';
  return String(v);
}

function valueToCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function sync_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    setup();
    var ss = SpreadsheetApp.getActive();
    var since = Number(body.since || 0);
    var changes = body.changes || {};
    var now = Date.now();
    var out = {};

    Object.keys(TABLES).forEach(function (name) {
      var sh = ss.getSheetByName(name);
      var incoming = changes[name] || [];
      var headers = getHeaders_(sh);

      // add any new columns sent by clients
      var extra = {};
      incoming.forEach(function (r) {
        Object.keys(r).forEach(function (k) { if (headers.indexOf(k) < 0) extra[k] = true; });
      });
      var extraKeys = Object.keys(extra);
      if (extraKeys.length) {
        sh.getRange(1, headers.length + 1, 1, extraKeys.length).setValues([extraKeys]);
        headers = headers.concat(extraKeys);
      }
      var idCol = headers.indexOf('id');
      var updCol = headers.indexOf('updatedAt');
      var stCol = headers.indexOf('_serverTime');

      var lastRow = sh.getLastRow();
      var data = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
      var index = {};
      for (var i = 0; i < data.length; i++) {
        var id = String(data[i][idCol]);
        if (id) index[id] = i;
      }

      var rejected = [];
      var appends = [];
      incoming.forEach(function (rec) {
        if (!rec || !rec.id) return;
        var pos = index[rec.id];
        if (pos !== undefined) {
          var existingUpd = cellToValue_(data[pos][updCol]);
          if (existingUpd && rec.updatedAt && existingUpd > rec.updatedAt) {
            rejected.push(rowToObj_(headers, data[pos]));
            return;
          }
        }
        var row = headers.map(function (h, ci) {
          if (h === '_serverTime') return String(now);
          if (rec.hasOwnProperty(h)) return valueToCell_(rec[h]);
          return pos !== undefined ? data[pos][ci] : '';
        });
        if (pos !== undefined) {
          data[pos] = row;
          var rng = sh.getRange(pos + 2, 1, 1, headers.length);
          rng.setNumberFormat('@');
          rng.setValues([row]);
        } else {
          index[rec.id] = -1;
          appends.push(row);
        }
      });
      if (appends.length) {
        var start = sh.getLastRow() + 1;
        var ar = sh.getRange(start, 1, appends.length, headers.length);
        ar.setNumberFormat('@');
        ar.setValues(appends);
      }

      var result = [];
      for (var j = 0; j < data.length; j++) {
        if (Number(data[j][stCol] || 0) > since) result.push(rowToObj_(headers, data[j]));
      }
      out[name] = result.concat(rejected);
    });

    return { ok: true, serverTime: now, changes: out };
  } finally {
    lock.releaseLock();
  }
}

function rowToObj_(headers, row) {
  var o = {};
  for (var i = 0; i < headers.length; i++) o[headers[i]] = cellToValue_(row[i]);
  return o;
}

/**
 * Simple trigger: when you edit a row directly in the sheet, stamp it so the
 * change syncs to the apps. New rows typed by hand get an id automatically.
 */
function onEdit(e) {
  try {
    var sh = e.range.getSheet();
    var name = sh.getName();
    if (!TABLES[name]) return;
    var headers = getHeaders_(sh);
    var r0 = Math.max(e.range.getRow(), 2);
    var r1 = e.range.getLastRow();
    if (r1 < 2) return;
    var nowIso = new Date().toISOString();
    var now = String(Date.now());
    var idCol = headers.indexOf('id') + 1;
    var updCol = headers.indexOf('updatedAt') + 1;
    var stCol = headers.indexOf('_serverTime') + 1;
    var decCol = headers.indexOf('decision') + 1;
    var decAtCol = headers.indexOf('decidedAt') + 1;
    var crCol = headers.indexOf('createdAt') + 1;
    for (var r = r0; r <= r1; r++) {
      if (idCol && !sh.getRange(r, idCol).getValue()) {
        sh.getRange(r, idCol).setNumberFormat('@').setValue(Utilities.getUuid());
        if (crCol) sh.getRange(r, crCol).setNumberFormat('@').setValue(nowIso);
      }
      if (updCol) sh.getRange(r, updCol).setNumberFormat('@').setValue(nowIso);
      if (stCol) sh.getRange(r, stCol).setNumberFormat('@').setValue(now);
      if (name === 'suggestions' && decCol && decAtCol &&
          e.range.getColumn() <= decCol && e.range.getLastColumn() >= decCol) {
        sh.getRange(r, decAtCol).setNumberFormat('@').setValue(nowIso);
      }
    }
  } catch (err) { /* ignore */ }
}

function reset_() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  return { ok: true };
}
