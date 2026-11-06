/**
 * TradeLink CRM — self-updating EMAIL connector loader (Gmail / Google Workspace).
 *
 * PASTE THIS ONCE — signed in as the mailbox you want to connect (e.g. Dylan@tradelink.marketing):
 *  1. Go to https://script.google.com -> New project. Name it "TradeLink Email". Delete the starter code,
 *     paste this whole file, click Save.
 *  2. On the left, Services (+) → Google Calendar API → Add (for meeting invites with Google Meet).
 *  3. Choose the function "updateNow" in the toolbar and click Run. Approve the permissions
 *     (Gmail, Calendar, connect to an external service). The log should say "Updated TradeLink code".
 *  4. Deploy -> New deployment -> type Web app. Execute as: Me. Who has access: Anyone. Deploy.
 *  5. Copy the Web app URL and paste it into the CRM: Email tab -> Connect (on each device).
 *     Keep this URL private: anyone who has it can read and send email from this mailbox.
 *
 * The real connector code (Email.gs) downloads from the latest GitHub release, so updates arrive automatically.
 *
 * ALREADY SET UP? To add meeting invites: paste this file over the old one and Save, do step 2, run updateNow and
 * approve, then Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy. The URL stays the same.
 */

var TL_CODE_URL = 'https://github.com/dylancleverdon/CRM-TRADEL./releases/latest/download/Email.gs';
var TL_CACHE_SECONDS = 600;
var TL_LOADED = false;

function tlFetch_() {
  var res = UrlFetchApp.fetch(TL_CODE_URL + '?t=' + Date.now(), { followRedirects: true, muteHttpExceptions: true });
  var code = res.getContentText();
  if (res.getResponseCode() !== 200 || code.indexOf('TL_EMAIL_VERSION') < 0) throw new Error('Download failed: HTTP ' + res.getResponseCode());
  CacheService.getScriptCache().put('tl_email_code', code, TL_CACHE_SECONDS);
  tlSaveBackup_(code);
  return code;
}

// Copy kept in script properties (8KB chunks) so the CRM keeps working if GitHub is unreachable,
// and so the onEdit trigger (which cannot use the internet) can still load the code.
function tlSaveBackup_(code) {
  var chunks = [];
  for (var i = 0; i < code.length; i += 8000) chunks.push(code.slice(i, i + 8000));
  var data = { tl_email_code_n: String(chunks.length) };
  chunks.forEach(function (c, i) { data['tl_email_code_' + i] = c; });
  PropertiesService.getScriptProperties().setProperties(data, false);
}

function tlBackup_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('tl_email_code_n') || 0);
  var code = '';
  for (var i = 0; i < n; i++) code += props.getProperty('tl_email_code_' + i) || '';
  return code;
}

function tlLoad_(allowFetch) {
  if (TL_LOADED) return;
  var code = null, why = '';
  try { code = CacheService.getScriptCache().get('tl_email_code'); } catch (e) { code = null; }
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


/** Run this from the editor if you ever want to force an update right away. */
function updateNow() {
  Logger.log('Updated TradeLink code: ' + tlFetch_().length + ' bytes');
}

/**
 * Never called. Google decides which permissions to request by scanning the code pasted here, and the
 * downloaded code is not scanned — so the services the email connector uses are named here:
 * reading/sending Gmail (GmailApp, MailApp), your email address (Session), downloading updates (UrlFetchApp) and
 * meeting invites with Google Meet (Calendar: the Google Calendar API service, added under Services).
 */
function tlPermissions_() {
  Calendar.Events.list('primary', { maxResults: 1 });
  Calendar.Freebusy.query({ timeMin: new Date().toISOString(), timeMax: new Date().toISOString(), items: [{ id: 'primary' }] });
  GmailApp.search('in:inbox', 0, 1);
  GmailApp.createDraft('', '', '');
  MailApp.getRemainingDailyQuota();
  Session.getEffectiveUser().getEmail();
  UrlFetchApp.fetch(TL_CODE_URL);
}
