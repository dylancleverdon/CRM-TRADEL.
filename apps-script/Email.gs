/**
 * TradeLink CRM - Gmail / Google Workspace email connector.
 *
 * Runs inside an Apps Script project owned by the mailbox you want to connect (e.g. Dylan@tradelink.marketing),
 * loaded and kept up to date by EmailLoader.gs. It only does what the CRM asks:
 *   ping    - which mailbox is connected
 *   recent  - recent messages (after a timestamp) so the CRM can log emails with leads/contacts
 *   search  - messages to/from specific addresses
 *   send    - send a new email or reply in a thread
 *   get     - one message with its full text (for reading it in the CRM)
 *   markRead / readState - keep "read" in step between Gmail and the CRM
 *   calBusy / calCreate / calUpdate / calCancel - Google Calendar invites with a Google Meet link (needs the
 *             Google Calendar API service added to this project; Google emails the invite and any change)
 *   textRequest / contactRequest / keyRequest / textPoll - the Mac asks your phone to send a follow-up text,
 *             save people to the phone's contacts, or take the sheet's sync key. This goes through this
 *             connector (its URL is private to your devices) rather than the sheet's public sync URL.
 * Messages are returned to the CRM app; only emails matching a CRM lead/contact are saved by the app.
 *
 * Once the CRM's Google Sheet is locked, this connector needs the same sync key: it asks the sheet whether a key
 * is right (so a new key there is picked up by itself) and keeps only a hash of it.
 */
var TL_EMAIL_VERSION = '__CODE_VERSION__';

/** The CRM's Google Sheet, which knows the sync key. A script property tl_sheetUrl overrides it. */
var TL_SHEET_URL = 'https://script.google.com/macros/s/AKfycbwfcYLWddHT-9JJ4-TcWJkTucaQUzKsQ8aAp5hg_jbyrlSYC5B16ZOxMZfd9WLRacC4Jw/exec';
var TL_LOCKED_MSG = 'This email connector is locked. Save your sync key on this device: Settings → Security & backups.';

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.payload) return tlEmailOut_(tlEmailHandle_(JSON.parse(p.payload)));
  return tlEmailOut_(tlEmailHandle_({ action: p.action || 'ping' }));
}

function doPost(e) {
  var b = {};
  try { b = JSON.parse(e.postData.contents); } catch (err) { return tlEmailOut_({ ok: false, error: 'Bad JSON' }); }
  return tlEmailOut_(tlEmailHandle_(b));
}

function tlEmailOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function tlEmailHandle_(b) {
  try {
    if (b.action === 'tlReload') {
      if (typeof tlFetch_ !== 'function') return { ok: false, error: 'Not running through the auto-update loader' };
      return { ok: true, reloaded: true, bytes: tlFetch_().length };
    }
    var auth = tlAuth_(b);
    if (b.action === 'ping') {
      if (!auth.ok) return { ok: true, locked: true, keyed: false, version: TL_EMAIL_VERSION };
      return { ok: true, email: tlMe_(), version: TL_EMAIL_VERSION, quota: MailApp.getRemainingDailyQuota(), locked: auth.locked, keyed: auth.keyed,
        calendar: tlHasCalendar_() };
    }
    if (!auth.ok) {
      // A phone without the key can still receive it from your Mac ("Send key to my phone"), and nothing else.
      if (b.action === 'textPoll' && b.phone) return tlKeyOnlyPoll_();
      return { ok: false, code: 'locked', error: TL_LOCKED_MSG };
    }
    if (b.action === 'recent') return tlRecent_(b);
    if (b.action === 'search') return tlSearch_(b);
    if (b.action === 'send') return tlSend_(b);
    if (b.action === 'get') return tlGet_(b);
    if (b.action === 'markRead') return tlMarkRead_(b);
    if (b.action === 'readState') return tlReadState_(b);
    if (b.action === 'textRequest') return tlTextRequest_(b);
    if (b.action === 'contactRequest') return tlContactRequest_(b);
    if (b.action === 'keyRequest') return tlKeyRequest_(b);
    if (b.action === 'textPoll') return tlTextPoll_(b);
    if (b.action === 'calBusy') return tlCalBusy_(b);
    if (b.action === 'calCreate') return tlCalCreate_(b);
    if (b.action === 'calUpdate') return tlCalUpdate_(b);
    if (b.action === 'calCancel') return tlCalCancel_(b);
    return { ok: false, error: 'Unknown action' };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ---------------------------------------------------------------- lock (the sheet's sync key)

function tlHash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (x) { var v = (x < 0 ? x + 256 : x).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
}

/** What the sheet says about a key: { locked, keyed }, or null if it can't be asked right now. Cached 10 minutes. */
function tlAskSheet_(key, cacheKey) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);
  // At most 10 questions per 10 minutes, so made-up keys can't use up the daily quota.
  var slot = 'tl_asks_' + Math.floor(Date.now() / 600000);
  var n = Number(cache.get(slot) || 0);
  if (n >= 10) return null;
  cache.put(slot, String(n + 1), 600);
  var url = PropertiesService.getScriptProperties().getProperty('tl_sheetUrl') || TL_SHEET_URL;
  var r = null;
  try {
    var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain;charset=utf-8', followRedirects: true, muteHttpExceptions: true,
      payload: JSON.stringify({ action: 'ping', key: key || '' }) });
    r = JSON.parse(res.getContentText());
  } catch (e) { r = null; }
  if (!r || !r.ok) return null;
  var sec = r.security || r; // a locked sheet answers a wrong key with just { ok, locked, keyed }
  var v = { locked: !!sec.locked, keyed: !!sec.keyed };
  cache.put(cacheKey, JSON.stringify(v), 600);
  return v;
}

/**
 * Follows the sheet: open while the sheet is open; once it's locked, only requests carrying the sync key (b.auth).
 * The sheet is asked about each key at most every 10 minutes, so a new key there takes over by itself (and the old
 * one stops working). A confirmed key is remembered as a hash for when the sheet can't be reached.
 */
function tlAuth_(b) {
  var props = PropertiesService.getScriptProperties();
  var key = typeof b.auth === 'string' ? b.auth : '';
  var h = key ? tlHash_(key) : '';
  var locked = props.getProperty('tl_locked') === '1';
  var known = !!h && h === props.getProperty('tl_keyHash');
  var v = tlAskSheet_(key, 'tl_auth_' + (h || 'none'));
  if (!v) return { ok: known || !locked, locked: locked, keyed: known }; // can't ask the sheet: keep the current rule
  if (v.locked !== locked) {
    if (v.locked) props.setProperty('tl_locked', '1'); else props.deleteProperty('tl_locked');
    locked = v.locked;
  }
  if (v.keyed && h) {
    if (!known) props.setProperty('tl_keyHash', h);
    return { ok: true, locked: locked, keyed: true };
  }
  if (known) props.deleteProperty('tl_keyHash'); // the sheet has a different key now
  return { ok: !locked, locked: locked, keyed: false };
}

/** For a phone that doesn't have the key yet: only a pending "take the sync key" request, nothing else. */
function tlKeyOnlyPoll_() {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  props.setProperty('tl_phoneSeen', String(now));
  var kreq = null;
  try { kreq = JSON.parse(props.getProperty('tl_keyRequest') || 'null'); } catch (e) { kreq = null; }
  if (kreq && now - kreq.at > 120000) { props.deleteProperty('tl_keyRequest'); kreq = null; }
  return { ok: true, locked: true, serverTime: now, keyReq: kreq };
}

// ---------------------------------------------------------------- Google Calendar (invites with a Meet link)

var TL_CAL_SETUP = "Google Calendar isn't added to your email connector yet. In the CRM, Settings → Meetings shows the steps (about 2 minutes).";

/** The Google Calendar API service (Apps Script → Services → Google Calendar API) is on. */
function tlHasCalendar_() {
  return typeof Calendar !== 'undefined' && !!Calendar && !!Calendar.Events;
}

function tlTime_(v) {
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function tlEventOut_(ev) {
  var meet = ev.hangoutLink || '';
  if (!meet && ev.conferenceData && ev.conferenceData.entryPoints) {
    ev.conferenceData.entryPoints.forEach(function (p) { if (!meet && p.entryPointType === 'video') meet = p.uri; });
  }
  return {
    id: ev.id, link: ev.htmlLink || '', meet: meet, status: ev.status || '',
    start: (ev.start && (ev.start.dateTime || ev.start.date)) || '', end: (ev.end && (ev.end.dateTime || ev.end.date)) || '',
  };
}

/** Busy times on your main calendar between `from` and `to`. */
function tlCalBusy_(b) {
  if (!tlHasCalendar_()) return { ok: false, code: 'nocalendar', error: TL_CAL_SETUP };
  var from = tlTime_(b.from), to = tlTime_(b.to);
  if (!from || !to || to <= from) return { ok: false, error: 'Bad time range' };
  var r = Calendar.Freebusy.query({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] });
  var cal = (r && r.calendars && r.calendars.primary) || {};
  return { ok: true, busy: (cal.busy || []).map(function (x) { return { start: x.start, end: x.end }; }) };
}

/** Books the meeting with a Google Meet link; Google emails the invite to the client. */
function tlCalCreate_(b) {
  if (!tlHasCalendar_()) return { ok: false, code: 'nocalendar', error: TL_CAL_SETUP };
  var start = tlTime_(b.start), end = tlTime_(b.end);
  if (!start || !end || end <= start) return { ok: false, error: 'Pick a meeting time' };
  var to = tlAddr_(b.attendee);
  if (to.indexOf('@') < 1) return { ok: false, error: 'Their email address is missing' };
  var tz = String(b.timeZone || Session.getScriptTimeZone() || 'UTC');
  var guest = { email: to };
  if (b.name) guest.displayName = String(b.name).slice(0, 100);
  var ev = Calendar.Events.insert({
    summary: String(b.title || 'Meeting').slice(0, 200),
    description: String(b.description || '').slice(0, 8000),
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    attendees: [guest],
    conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: true },
  }, 'primary', { conferenceDataVersion: 1, sendUpdates: 'all' });
  // The Meet link is usually there at once; if Google is still making it, ask again.
  for (var i = 0; i < 3 && !tlEventOut_(ev).meet; i++) { Utilities.sleep(1000); ev = Calendar.Events.get('primary', ev.id); }
  return { ok: true, event: tlEventOut_(ev) };
}

/** Moves the meeting; Google emails the client the new time. */
function tlCalUpdate_(b) {
  if (!tlHasCalendar_()) return { ok: false, code: 'nocalendar', error: TL_CAL_SETUP };
  var start = tlTime_(b.start), end = tlTime_(b.end);
  if (!b.id || !start || !end || end <= start) return { ok: false, error: 'Pick the new time' };
  var tz = String(b.timeZone || Session.getScriptTimeZone() || 'UTC');
  var ev = Calendar.Events.patch({ start: { dateTime: start.toISOString(), timeZone: tz }, end: { dateTime: end.toISOString(), timeZone: tz } },
    'primary', String(b.id), { sendUpdates: 'all' });
  return { ok: true, event: tlEventOut_(ev) };
}

/** Cancels the meeting; Google tells the client. Already gone counts as done. */
function tlCalCancel_(b) {
  if (!tlHasCalendar_()) return { ok: false, code: 'nocalendar', error: TL_CAL_SETUP };
  if (!b.id) return { ok: false, error: 'Which meeting?' };
  try {
    Calendar.Events.remove('primary', String(b.id), { sendUpdates: 'all' });
  } catch (e) {
    if (!/not found|deleted|410|404/i.test(String(e && e.message || e))) throw e;
  }
  return { ok: true };
}

function tlMe_() {
  return String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
}

function tlAddr_(s) {
  var m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '')).trim().toLowerCase();
}

function tlAddrs_(s) {
  return String(s || '').split(',').map(tlAddr_).filter(function (x) { return x.indexOf('@') > 0; });
}

/** Plain text of a message without the quoted earlier conversation. */
function tlCleanBody_(body) {
  var b = String(body || '');
  var cut = b.search(/\r?\n(On .{5,160}wrote:|-{2,} ?Original Message|From: .+\r?\nSent: )/);
  if (cut > 0) b = b.slice(0, cut);
  return b.replace(/\s+/g, ' ').trim().slice(0, 800);
}

function tlMsg_(m, threadId, me) {
  var from = tlAddr_(m.getFrom());
  return {
    id: m.getId(),
    threadId: threadId,
    date: m.getDate().toISOString(),
    from: from,
    fromName: String(m.getFrom()).replace(/<.*>/, '').replace(/"/g, '').trim(),
    to: tlAddrs_(m.getTo()).concat(tlAddrs_(m.getCc())),
    subject: m.getSubject() || '(no subject)',
    snippet: tlCleanBody_(m.getPlainBody()),
    outgoing: from === me,
    unread: m.isUnread(),
  };
}

function tlCollect_(threads, since, me) {
  var out = [];
  threads.forEach(function (t) {
    var tid = t.getId();
    t.getMessages().forEach(function (m) {
      if (m.getDate().getTime() > since) out.push(tlMsg_(m, tid, me));
    });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return out;
}

/** Recent mail (inbox + sent) after `since` (ms). First run looks back 30 days. */
function tlRecent_(b) {
  var me = tlMe_();
  var since = Number(b.since || 0);
  var max = Math.min(Number(b.max || 100), 250);
  var q = '-in:spam -in:trash -in:chats ' + (since ? 'after:' + Math.floor(since / 1000) : 'newer_than:30d');
  return { ok: true, me: me, serverTime: Date.now(), messages: tlCollect_(GmailApp.search(q, 0, max), since, me) };
}

/** Messages to/from the given addresses (used when an email address is added to a lead). */
function tlSearch_(b) {
  var me = tlMe_();
  var list = (b.addresses || []).map(function (a) { return String(a).toLowerCase().trim(); }).filter(function (a) { return a.indexOf('@') > 0; });
  var since = Number(b.since || 0);
  var out = [];
  for (var i = 0; i < list.length; i += 10) {
    var chunk = list.slice(i, i + 10);
    var q = '(' + chunk.map(function (a) { return 'from:' + a + ' OR to:' + a; }).join(' OR ') + ') -in:spam -in:trash' +
      (since ? ' after:' + Math.floor(since / 1000) : '');
    out = out.concat(tlCollect_(GmailApp.search(q, 0, 50), since, me));
  }
  return { ok: true, me: me, messages: out };
}

function tlHtml_(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
}

/** Send a new email, or reply inside an existing thread. Returns the sent message. */
function tlSend_(b) {
  if (!b.to) return { ok: false, error: 'Missing recipient' };
  var me = tlMe_();
  var opts = { htmlBody: tlHtml_(b.body) };
  if (b.cc) opts.cc = b.cc;
  if (b.fromName) opts.name = b.fromName;
  var msg;
  if (b.threadId) {
    var thread = GmailApp.getThreadById(b.threadId);
    if (!thread) return { ok: false, error: 'Thread not found' };
    var last = thread.getMessages()[thread.getMessageCount() - 1];
    var draft = last.createDraftReply(b.body || '', opts);
    msg = draft.send();
    return { ok: true, message: tlMsg_(msg, b.threadId, me) };
  }
  var d = GmailApp.createDraft(b.to, b.subject || '', b.body || '', opts);
  msg = d.send();
  return { ok: true, message: tlMsg_(msg, msg.getThread().getId(), me) };
}

/** One message with its full plain text: quoted earlier messages cut off, line breaks kept. */
function tlGet_(b) {
  var m = GmailApp.getMessageById(String(b.id || ''));
  if (!m) return { ok: false, error: 'Message not found' };
  var msg = tlMsg_(m, m.getThread().getId(), tlMe_());
  var body = String(m.getPlainBody() || '').replace(/\r\n/g, '\n');
  var cut = body.search(/\n(On .{5,160}wrote:|-{2,} ?Original Message|From: .+\nSent: )/);
  if (cut > 0) body = body.slice(0, cut);
  msg.body = body.replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
  msg.cc = tlAddrs_(m.getCc());
  return { ok: true, message: msg };
}

/** Mark messages read (or unread) in Gmail. */
function tlMarkRead_(b) {
  var done = [];
  (b.ids || []).slice(0, 50).forEach(function (id) {
    try {
      var m = GmailApp.getMessageById(String(id));
      if (!m) return;
      if (b.unread) m.markUnread(); else m.markRead();
      done.push(id);
    } catch (e) { /* skip */ }
  });
  return { ok: true, done: done };
}

/** Which of these messages have been read in Gmail since (e.g. on the phone's Gmail app). */
function tlReadState_(b) {
  var read = [];
  (b.ids || []).slice(0, 25).forEach(function (id) {
    try {
      var m = GmailApp.getMessageById(String(id));
      if (m && !m.isUnread()) read.push(id);
    } catch (e) { /* skip */ }
  });
  return { ok: true, read: read };
}

// ---------- Follow-up texts: the Mac asks the phone (in Desk phone mode) to send an SMS ----------

function tlTextRequest_(b) {
  var req = b.req || {};
  if (!req.number || !req.body) return { ok: false, error: 'Missing number or message' };
  var props = PropertiesService.getScriptProperties();
  var r = { id: Utilities.getUuid(), at: Date.now(), number: String(req.number), body: String(req.body).slice(0, 1500),
    name: String(req.name || ''), entityType: String(req.entityType || ''), entityId: String(req.entityId || '') };
  props.setProperty('tl_textRequest', JSON.stringify(r));
  var seen = Number(props.getProperty('tl_phoneSeen') || 0);
  return { ok: true, id: r.id, phoneSeenAgo: seen ? r.at - seen : -1 };
}

/** Save people to the phone's contacts (up to 20 per request: script properties hold 9 KB each). */
function tlContactRequest_(b) {
  var list = (b.contacts || []).slice(0, 20).map(function (c) {
    return { name: String(c.name || '').slice(0, 120), company: String(c.company || '').slice(0, 120), title: String(c.title || '').slice(0, 60),
      phone: String(c.phone || '').slice(0, 30), note: String(c.note || '').slice(0, 160), entityType: String(c.entityType || ''), entityId: String(c.entityId || '').slice(0, 60) };
  }).filter(function (c) { return c.phone; });
  if (!list.length) return { ok: false, error: 'No phone numbers to save' };
  var props = PropertiesService.getScriptProperties();
  var r = { id: Utilities.getUuid(), at: Date.now(), contacts: list };
  props.setProperty('tl_contactRequest', JSON.stringify(r));
  var seen = Number(props.getProperty('tl_phoneSeen') || 0);
  return { ok: true, id: r.id, count: list.length, phoneSeenAgo: seen ? r.at - seen : -1 };
}

/** Hands the sheet's sync key from the Mac to the phone. Kept here at most 2 minutes, deleted once the phone has it. */
function tlKeyRequest_(b) {
  var key = String(b.key || '');
  if (key.length < 32) return { ok: false, error: 'Missing sync key' };
  var props = PropertiesService.getScriptProperties();
  var r = { id: Utilities.getUuid(), at: Date.now(), key: key };
  props.setProperty('tl_keyRequest', JSON.stringify(r));
  var seen = Number(props.getProperty('tl_phoneSeen') || 0);
  return { ok: true, id: r.id, phoneSeenAgo: seen ? r.at - seen : -1 };
}

/** The phone polls with phone:true (and acks what it did); the Mac polls without it to read the acks. */
function tlTextPoll_(b) {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  if (b.phone) props.setProperty('tl_phoneSeen', String(now));
  if (b.ack) props.setProperty('tl_textAck', JSON.stringify({ id: String(b.ack), ok: b.ok !== false, error: String(b.error || ''), at: now }));
  if (b.contactAck) props.setProperty('tl_contactAck', JSON.stringify({ id: String(b.contactAck), ok: b.contactOk !== false, error: String(b.contactError || ''),
    saved: Number(b.contactSaved || 0), existing: Number(b.contactExisting || 0), phoneOnly: Number(b.contactPhoneOnly || 0), at: now }));
  if (b.keyAck) {
    props.setProperty('tl_keyAck', JSON.stringify({ id: String(b.keyAck), ok: b.keyOk !== false, error: String(b.keyError || ''), at: now }));
    props.deleteProperty('tl_keyRequest');
  }
  var kreq = null, kack = null;
  try { kreq = JSON.parse(props.getProperty('tl_keyRequest') || 'null'); } catch (e) { kreq = null; }
  try { kack = JSON.parse(props.getProperty('tl_keyAck') || 'null'); } catch (e) { kack = null; }
  if (kreq && now - kreq.at > 120000) { props.deleteProperty('tl_keyRequest'); kreq = null; }
  var req = null, ack = null, creq = null, cack = null;
  try { req = JSON.parse(props.getProperty('tl_textRequest') || 'null'); } catch (e) { req = null; }
  try { ack = JSON.parse(props.getProperty('tl_textAck') || 'null'); } catch (e) { ack = null; }
  try { creq = JSON.parse(props.getProperty('tl_contactRequest') || 'null'); } catch (e) { creq = null; }
  try { cack = JSON.parse(props.getProperty('tl_contactAck') || 'null'); } catch (e) { cack = null; }
  if (req && now - req.at > 120000) req = null; // stale requests are never acted on
  if (creq && now - creq.at > 120000) creq = null;
  var seen = Number(props.getProperty('tl_phoneSeen') || 0);
  return { ok: true, serverTime: now, req: b.phone ? req : null, ack: ack, contactReq: b.phone ? creq : null, contactAck: cack,
    keyReq: b.phone ? kreq : null, keyAck: kack, phoneSeenAgo: seen ? now - seen : -1 };
}
