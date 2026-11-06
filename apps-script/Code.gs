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
 *
 * Security: a private sync key is kept in Script Properties and shown in the "🔒 Sync key" tab (your sheet
 * isn't shared, so only you see it). Once you tap "Lock my CRM" in the app, every request needs the key.
 * Backups: two copies (A and B) in your Drive, overwritten on alternating days at the first sync of each day.
 */

var TABLES = {
  leads: ['id', 'company', 'contactName', 'phone', 'altPhone', 'email', 'website', 'trade', 'city', 'state', 'address',
    'source', 'status', 'quality', 'disqualifyReason', 'tags', 'attempts', 'lastContactedAt', 'lastOutcome',
    'nextFollowUpAt', 'notes', 'convertedContactId', 'createdAt', 'updatedAt', 'deleted', '_serverTime',
    'origin', 'score', 'licenseNo', 'ubi', 'specialty', 'licenseStart', 'ownership', 'sources', 'naics', 'zip', 'queuedAt',
    'yelpStatus', 'yelpUrl', 'yelpRating', 'yelpReviews', 'googleStatus', 'googleUrl', 'googleRating', 'googleReviews', 'presenceCheckedAt', 'script', 'phoneContactAt'],
  contacts: ['id', 'company', 'contactName', 'title', 'phone', 'altPhone', 'email', 'website', 'trade', 'city', 'state',
    'address', 'status', 'leadId', 'tags', 'lastContactedAt', 'lastOutcome', 'nextFollowUpAt', 'notes', 'createdAt',
    'updatedAt', 'deleted', '_serverTime', 'queuedAt',
    'yelpStatus', 'yelpUrl', 'yelpRating', 'yelpReviews', 'googleStatus', 'googleUrl', 'googleRating', 'googleReviews', 'presenceCheckedAt', 'script', 'phoneContactAt'],
  opportunities: ['id', 'contactId', 'name', 'service', 'stage', 'monthlyValue', 'setupFee', 'probability',
    'expectedCloseDate', 'nextStep', 'lostReason', 'closedAt', 'notes', 'createdAt', 'updatedAt', 'deleted', '_serverTime'],
  activities: ['id', 'entityType', 'entityId', 'entityName', 'type', 'outcome', 'notes', 'durationSec', 'phone',
    'occurredAt', 'createdAt', 'updatedAt', 'deleted', '_serverTime', 'threadId', 'messageId', 'direction', 'emailFrom', 'emailTo', 'readAt',
    'pick', 'scriptKind', 'eventId', 'meetLink', 'endAt'],
  tasks: ['id', 'entityType', 'entityId', 'entityName', 'title', 'dueAt', 'priority', 'done', 'doneAt', 'notes',
    'createdAt', 'updatedAt', 'deleted', '_serverTime'],
  suggestions: ['id', 'page', 'suggestion', 'decision', 'decisionNotes', 'decidedAt', 'createdAt', 'updatedAt',
    'deleted', '_serverTime'],
  settings: ['id', 'value', 'updatedAt', 'deleted', '_serverTime']
};

var DECISIONS = ['Pending', 'Approved', 'Rejected', 'Implemented', 'Duplicate'];
var SETUP_VERSION = '11';
var CODE_VERSION = '__CODE_VERSION__'; // stamped with the release version by CI

/** Runs the full setup only once per script version (keeps every sync fast). */
function ensureSetup_() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActive();
  var missing = !ss.getSheetByName(KEY_TAB) || Object.keys(TABLES).some(function (n) { return !ss.getSheetByName(n); });
  if (missing || props.getProperty('setup') !== SETUP_VERSION) {
    setup();
    props.setProperty('setup', SETUP_VERSION);
  }
}

function applyDecisionDropdown_(sh) {
  var hs = getHeaders_(sh);
  var col = hs.indexOf('decision') + 1;
  if (!col) return;
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(DECISIONS, true).setAllowInvalid(true).build();
  sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

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
    body = body || {};
    var keyed = authed_(body);
    var locked = isLocked_();
    noteDevice_(body, keyed);
    if (body.action === 'ping') {
      if (locked && !keyed) return { ok: true, locked: true, keyed: false, codeVersion: CODE_VERSION };
      ensureSetup_(); // only what is missing: the email connector checks keys with a ping
      return { ok: true, serverTime: Date.now(), tables: Object.keys(TABLES), sheet: SpreadsheetApp.getActive().getName(),
        codeVersion: CODE_VERSION, loader: typeof TL_CODE_URL !== 'undefined', security: securityInfo_(keyed) };
    }
    if (body.action === 'tlReload') {
      // Only re-downloads this code from the official release, so it never needs the key.
      if (typeof tlFetch_ !== 'function') return { ok: false, error: 'Not running through the auto-update loader' };
      return { ok: true, reloaded: true, bytes: tlFetch_().length };
    }
    if (locked && !keyed) {
      return { ok: false, code: 'locked',
        error: 'This CRM is locked. Paste your sync key in Settings → Sync (it is in the "' + KEY_TAB + '" tab of your Google Sheet).' };
    }
    if (body.action === 'sync') {
      var r = sync_(body);
      r.security = securityInfo_(keyed);
      return r;
    }
    if (body.action === 'lock') {
      if (!keyed) return { ok: false, error: 'Wrong or missing sync key' };
      PropertiesService.getScriptProperties().setProperty('tl_locked', '1');
      return { ok: true, security: securityInfo_(true) };
    }
    if (body.action === 'callRequest') return callRequest_(body);
    if (body.action === 'callPoll') return callPoll_(body);
    return { ok: false, error: 'Unknown action' };
  } catch (err) {
    return { ok: false, error: String(err && err.stack || err) };
  }
}

// ---------- Security: the sync key ----------

var KEY_TAB = '🔒 Sync key';

function syncKey_() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('tl_syncKey');
  if (!k) {
    k = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('tl_syncKey', k);
  }
  return k;
}

function authed_(body) {
  var k = PropertiesService.getScriptProperties().getProperty('tl_syncKey');
  return !!k && typeof body.key === 'string' && body.key === k;
}

function isLocked_() {
  return PropertiesService.getScriptProperties().getProperty('tl_locked') === '1';
}

/** The key, shown only to you in a tab of this sheet. The sync API never reads or returns this tab. */
function writeKeyTab_() {
  var ss = SpreadsheetApp.getActive();
  var k = syncKey_();
  var sh = ss.getSheetByName(KEY_TAB) || ss.insertSheet(KEY_TAB);
  if (String(sh.getRange('A3').getValue()) === k) return;
  sh.clear();
  sh.getRange('A1').setValue('TradeLink CRM sync key. Paste it into Settings → Sync on your Mac (it can send it to your phone), ' +
    'then tap "Lock my CRM". Keep it private: with this key and the sync link, anyone could read and change your CRM.')
    .setWrap(true).setFontWeight('bold');
  sh.getRange('A3').setNumberFormat('@').setValue(k).setFontSize(13);
  sh.setColumnWidth(1, 640);
}

/** Remembers which devices sync, and whether they send the key (shown in Settings → Sync). */
function noteDevice_(body, keyed) {
  try {
    var d = body.device;
    if (!d || !d.id) return;
    var props = PropertiesService.getScriptProperties();
    var list = {};
    try { list = JSON.parse(props.getProperty('tl_devices') || '{}'); } catch (e) { list = {}; }
    var now = Date.now();
    var cur = list[d.id];
    if (cur && cur.keyed === keyed && now - cur.at < 5 * 60000) return; // no write on every sync
    list[d.id] = { name: String(d.name || 'Device').slice(0, 40), keyed: keyed, at: now };
    var keep = {};
    Object.keys(list).sort(function (a, b) { return list[b].at - list[a].at; }).slice(0, 8)
      .forEach(function (id) { keep[id] = list[id]; });
    props.setProperty('tl_devices', JSON.stringify(keep));
  } catch (e) { /* never block a sync over this */ }
}

function securityInfo_(keyed) {
  // The sheet's link is harmless to share (the sheet itself is private); it helps you find the key tab.
  var info = { locked: isLocked_(), keyed: keyed, sheetUrl: SpreadsheetApp.getActive().getUrl() };
  if (keyed) {
    try { info.devices = JSON.parse(PropertiesService.getScriptProperties().getProperty('tl_devices') || '{}'); } catch (e) { info.devices = {}; }
    info.backup = backupInfo_();
  }
  return info;
}

// ---------- Backups: two copies, A and B, overwritten on alternating days ----------

var BACKUP_EVERY_MS = 20 * 60 * 60 * 1000;

/** Runs from the first sync of the day, before that sync's changes are applied. */
function maybeBackup_() {
  var props = PropertiesService.getScriptProperties();
  if (Date.now() < Number(props.getProperty('tl_nextBackup') || 0)) return;
  try {
    backupNow_();
    props.setProperty('tl_nextBackup', String(Date.now() + BACKUP_EVERY_MS));
    props.deleteProperty('tl_backupError');
  } catch (e) {
    props.setProperty('tl_nextBackup', String(Date.now() + 60 * 60 * 1000)); // try again in an hour
    props.setProperty('tl_backupError', String(e && e.message || e).slice(0, 300));
  }
}

function backupNow_() {
  var props = PropertiesService.getScriptProperties();
  var slot = props.getProperty('tl_lastBackupSlot') === 'A' ? 'B' : 'A';
  var dest = null;
  var id = props.getProperty('tl_backup_' + slot);
  if (id) { try { dest = SpreadsheetApp.openById(id); } catch (e) { dest = null; } }
  if (!dest) {
    dest = SpreadsheetApp.create('CRM Tradelink Backup – ' + slot);
    props.setProperty('tl_backup_' + slot, dest.getId());
  }
  var src = SpreadsheetApp.getActive();
  var now = new Date();
  var info = dest.getSheetByName('_backup') || dest.insertSheet('_backup');
  info.clear();
  info.getRange(1, 1, 3, 1).setValues([['Backup of "' + src.getName() + '" (copy ' + slot + ')'], [now.toISOString()],
    ['Copies A and B are overwritten on alternating days, so you always have the last two days.']]);
  Object.keys(TABLES).forEach(function (name) {
    var from = src.getSheetByName(name);
    if (!from) return;
    var to = dest.getSheetByName(name) || dest.insertSheet(name);
    to.clear();
    var rows = from.getLastRow(), cols = from.getLastColumn();
    if (!rows || !cols) return;
    var range = to.getRange(1, 1, rows, cols);
    range.setNumberFormat('@');
    range.setValues(from.getRange(1, 1, rows, cols).getDisplayValues());
  });
  var blank = dest.getSheetByName('Sheet1');
  if (blank && dest.getSheets().length > 1) dest.deleteSheet(blank);
  props.setProperty('tl_lastBackupSlot', slot);
  props.setProperty('tl_backupAt_' + slot, String(now.getTime()));
}

function backupInfo_() {
  var props = PropertiesService.getScriptProperties();
  var copies = [];
  ['A', 'B'].forEach(function (slot) {
    var id = props.getProperty('tl_backup_' + slot);
    if (id) copies.push({ slot: slot, at: Number(props.getProperty('tl_backupAt_' + slot) || 0), url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' });
  });
  return { copies: copies, error: props.getProperty('tl_backupError') || '' };
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
    if (name === 'suggestions') applyDecisionDropdown_(sh);
  });
  writeKeyTab_();
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
    ensureSetup_();
    maybeBackup_();
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
        if (name === 'suggestions') applyDecisionDropdown_(sh);
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

// ---------- "Ring my phone": the Mac asks the Android app to place a call ----------
// Uses script properties (no sheet reads) so polling every few seconds stays fast.

function callRequest_(body) {
  var props = PropertiesService.getScriptProperties();
  var req = body.req || {};
  req.id = Utilities.getUuid();
  req.at = Date.now();
  props.setProperty('callRequest', JSON.stringify(req));
  var seen = Number(props.getProperty('phoneSeen') || 0);
  return { ok: true, id: req.id, serverTime: req.at, phoneSeenAgo: seen ? req.at - seen : -1 };
}

function callPoll_(body) {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  if (body.ack) props.setProperty('callAck', String(body.ack));
  if (body.phone) props.setProperty('phoneSeen', String(now));
  var req = null;
  try { req = JSON.parse(props.getProperty('callRequest') || 'null'); } catch (e) { req = null; }
  if (req && now - req.at > 45000) req = null; // stale requests are ignored
  var seen = Number(props.getProperty('phoneSeen') || 0);
  return { ok: true, serverTime: now, req: req, ack: props.getProperty('callAck') || '', phoneSeenAgo: seen ? now - seen : -1 };
}

