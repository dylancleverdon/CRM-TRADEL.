/**
 * TradeLink CRM - Gmail / Google Workspace email connector.
 *
 * Runs inside an Apps Script project owned by the mailbox you want to connect (e.g. Dylan@tradelink.marketing),
 * loaded and kept up to date by EmailLoader.gs. It only does what the CRM asks:
 *   ping    - which mailbox is connected
 *   recent  - recent messages (after a timestamp) so the CRM can log emails with leads/contacts
 *   search  - messages to/from specific addresses
 *   send    - send a new email or reply in a thread
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
