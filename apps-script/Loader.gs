/**
 * TradeLink CRM — self-updating loader for the Google Sheet "CRM Tradelink Data Storage".
 *
 * PASTE THIS ONCE. This small loader downloads the real sync code (Code.gs) from the latest
 * GitHub release of dylancleverdon/CRM-TRADEL. and runs it, so updates to the CRM reach the
 * sheet automatically (within ~10 minutes, or right after each release).
 *
 * Permissions it uses: this spreadsheet, and internet access to download Code.gs from GitHub.
 * (Features that need more — e.g. Gmail — will ask you to approve that separately.)
 *
 * Setup:
 *  1. Extensions -> Apps Script. Delete everything, paste this file, Save.
 *  2. Deploy -> Manage deployments -> pencil (edit) -> Version: New version -> Deploy.
 *     (Execute as: Me, Who has access: Anyone.) Approve the permissions.
 */

var TL_CODE_URL = 'https://github.com/dylancleverdon/CRM-TRADEL./releases/latest/download/Code.gs';
var TL_CACHE_SECONDS = 600;
var TL_LOADED = false;

function tlFetch_() {
  var res = UrlFetchApp.fetch(TL_CODE_URL + '?t=' + Date.now(), { followRedirects: true, muteHttpExceptions: true });
  var code = res.getContentText();
  if (res.getResponseCode() !== 200 || code.indexOf('TradeLink CRM') < 0) throw new Error('Download failed: HTTP ' + res.getResponseCode());
  CacheService.getScriptCache().put('tl_code', code, TL_CACHE_SECONDS);
  tlSaveBackup_(code);
  return code;
}

// Copy kept in script properties (8KB chunks) so the CRM keeps working if GitHub is unreachable,
// and so the onEdit trigger (which cannot use the internet) can still load the code.
function tlSaveBackup_(code) {
  var chunks = [];
  for (var i = 0; i < code.length; i += 8000) chunks.push(code.slice(i, i + 8000));
  var data = { tl_code_n: String(chunks.length) };
  chunks.forEach(function (c, i) { data['tl_code_' + i] = c; });
  PropertiesService.getScriptProperties().setProperties(data, false);
}

function tlBackup_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('tl_code_n') || 0);
  var code = '';
  for (var i = 0; i < n; i++) code += props.getProperty('tl_code_' + i) || '';
  return code;
}

function tlLoad_(allowFetch) {
  if (TL_LOADED) return;
  var code = null, why = '';
  try { code = CacheService.getScriptCache().get('tl_code'); } catch (e) { code = null; }
  if (!code && allowFetch) {
    try { code = tlFetch_(); } catch (e) { code = null; why = String(e && e.message || e); }
  }
  if (!code) code = tlBackup_();
  if (!code) throw new Error('TradeLink code could not be downloaded from GitHub' + (why ? ': ' + why : '') +
    '. In Apps Script, select updateNow and click Run once to grant permission.');
  var stub = doPost;
  (0, eval)(code); // defines the real doGet/doPost/onEdit globally, replacing these stubs
  if (doPost === stub) throw new Error('Downloaded TradeLink code is incomplete.');
  TL_LOADED = true;
}

function tlJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function tlWantsReload_(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'tlReload') return true;
    if (e && e.postData && JSON.parse(e.postData.contents).action === 'tlReload') return true;
  } catch (err) { /* not JSON */ }
  return false;
}

function doPost(e) {
  if (tlWantsReload_(e)) {
    try { var code = tlFetch_(); return tlJson_({ ok: true, reloaded: true, bytes: code.length }); }
    catch (err) { return tlJson_({ ok: false, error: String(err) }); }
  }
  try { tlLoad_(true); } catch (err) { return tlJson_({ ok: false, error: String(err) }); }
  return doPost(e); // the real implementation from Code.gs
}

function doGet(e) {
  if (tlWantsReload_(e)) return doPost(e);
  try { tlLoad_(true); } catch (err) { return tlJson_({ ok: false, error: String(err) }); }
  return doGet(e);
}

function onEdit(e) {
  try { tlLoad_(false); } catch (err) { return; }
  return onEdit(e);
}

/** Run this from the editor if you ever want to force an update right away. */
function updateNow() {
  Logger.log('Updated TradeLink code: ' + tlFetch_().length + ' bytes');
}
