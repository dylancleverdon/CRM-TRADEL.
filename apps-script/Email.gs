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
 *   textRequest / contactRequest / textPoll - the Mac asks your phone to send a follow-up text or to save
 *             people to the phone's contacts. This goes through this
 *             connector (its URL is private to your devices) rather than the sheet's public sync URL.
 * Messages are returned to the CRM app; only emails matching a CRM lead/contact are saved by the app.
 */
var TL_EMAIL_VERSION = '__CODE_VERSION__';

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
    if (b.action === 'ping') return { ok: true, email: tlMe_(), version: TL_EMAIL_VERSION, quota: MailApp.getRemainingDailyQuota() };
    if (b.action === 'recent') return tlRecent_(b);
    if (b.action === 'search') return tlSearch_(b);
    if (b.action === 'send') return tlSend_(b);
    if (b.action === 'get') return tlGet_(b);
    if (b.action === 'markRead') return tlMarkRead_(b);
    if (b.action === 'readState') return tlReadState_(b);
    if (b.action === 'textRequest') return tlTextRequest_(b);
    if (b.action === 'contactRequest') return tlContactRequest_(b);
    if (b.action === 'textPoll') return tlTextPoll_(b);
    return { ok: false, error: 'Unknown action' };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
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

/** The phone polls with phone:true (and acks what it did); the Mac polls without it to read the acks. */
function tlTextPoll_(b) {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  if (b.phone) props.setProperty('tl_phoneSeen', String(now));
  if (b.ack) props.setProperty('tl_textAck', JSON.stringify({ id: String(b.ack), ok: b.ok !== false, error: String(b.error || ''), at: now }));
  if (b.contactAck) props.setProperty('tl_contactAck', JSON.stringify({ id: String(b.contactAck), ok: b.contactOk !== false, error: String(b.contactError || ''),
    saved: Number(b.contactSaved || 0), existing: Number(b.contactExisting || 0), phoneOnly: Number(b.contactPhoneOnly || 0), at: now }));
  var req = null, ack = null, creq = null, cack = null;
  try { req = JSON.parse(props.getProperty('tl_textRequest') || 'null'); } catch (e) { req = null; }
  try { ack = JSON.parse(props.getProperty('tl_textAck') || 'null'); } catch (e) { ack = null; }
  try { creq = JSON.parse(props.getProperty('tl_contactRequest') || 'null'); } catch (e) { creq = null; }
  try { cack = JSON.parse(props.getProperty('tl_contactAck') || 'null'); } catch (e) { cack = null; }
  if (req && now - req.at > 120000) req = null; // stale requests are never acted on
  if (creq && now - creq.at > 120000) creq = null;
  var seen = Number(props.getProperty('tl_phoneSeen') || 0);
  return { ok: true, serverTime: now, req: b.phone ? req : null, ack: ack, contactReq: b.phone ? creq : null, contactAck: cack,
    phoneSeenAgo: seen ? now - seen : -1 };
}
