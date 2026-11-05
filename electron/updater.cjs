/**
 * Self-updater for the unsigned macOS build.
 *
 * Apple's built-in updater (Squirrel.Mac / electron-updater) refuses to update apps that
 * are not signed with a paid Apple Developer ID, so this does it directly:
 *   1. read latest.json from the newest GitHub release
 *   2. download TradeLink-CRM-mac.zip in the background
 *   3. unzip with `ditto`, then on restart/quit swap the .app bundle in place and
 *      strip the quarantine flag so Gatekeeper never blocks the update.
 */
const { app, BrowserWindow } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = 'dylancleverdon/CRM-TRADEL.';
const BASE = `https://github.com/${REPO}/releases/latest/download`;
const LATEST = `${BASE}/latest.json`;
const ZIP = `${BASE}/TradeLink-CRM-mac.zip`;
const CHECK_EVERY = 3 * 60 * 60 * 1000;

let state = { status: 'idle' };
let readyApp = null; // path to the unzipped new .app
let installing = false;
let busy = false;

function send(s) {
  state = s;
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update-state', s));
}

function attach(win) {
  win.webContents.on('did-finish-load', () => win.webContents.send('update-state', state));
}

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function bundlePath() {
  // .../TradeLink CRM.app/Contents/MacOS/TradeLink CRM
  const p = path.resolve(path.dirname(process.execPath), '..', '..');
  return p.endsWith('.app') ? p : null;
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  const out = fs.createWriteStream(dest);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    if (total) onProgress(got / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

function run(cmd, args) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout))),
  );
}

async function check(manual = false) {
  if (busy) return state;
  if (readyApp) return state;
  busy = true;
  try {
    send({ status: 'checking' });
    const res = await fetch(`${LATEST}?t=${Date.now()}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = await res.json();
    const current = app.getVersion();
    if (!info.version || !newer(info.version, current)) {
      send({ status: 'none', version: info.version });
      return state;
    }
    if (process.platform !== 'darwin' || !bundlePath()) {
      send({ status: 'available', version: info.version, error: 'Download the new version from GitHub Releases.' });
      return state;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradelink-update-'));
    const zip = path.join(dir, 'update.zip');
    send({ status: 'downloading', version: info.version, progress: 0 });
    await download(ZIP, zip, (p) => send({ status: 'downloading', version: info.version, progress: p }));
    const extract = path.join(dir, 'app');
    fs.mkdirSync(extract);
    await run('/usr/bin/ditto', ['-x', '-k', zip, extract]);
    const found = fs.readdirSync(extract).find((f) => f.endsWith('.app'));
    if (!found) throw new Error('Update archive did not contain an app');
    readyApp = path.join(extract, found);
    await run('/usr/bin/xattr', ['-cr', readyApp]).catch(() => {});
    send({ status: 'ready', version: info.version });
  } catch (e) {
    send({ status: manual ? 'error' : 'idle', error: String(e && e.message ? e.message : e) });
  } finally {
    busy = false;
  }
  return state;
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function launchInstaller(relaunch) {
  const target = bundlePath();
  if (!target || !readyApp) return false;
  installing = true;
  const dir = path.dirname(path.dirname(readyApp));
  const core = path.join(dir, 'install-core.sh');
  fs.writeFileSync(core, `#!/bin/bash
NEW="$1"; TARGET="$2"
rm -rf "$TARGET.old"
if mv "$TARGET" "$TARGET.old"; then
  if /usr/bin/ditto "$NEW" "$TARGET"; then rm -rf "$TARGET.old"; else rm -rf "$TARGET"; mv "$TARGET.old" "$TARGET"; fi
fi
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
exit 0
`);
  const coreCmd = `/bin/bash ${q(core)} ${q(readyApp)} ${q(target)}`;
  const applescript = path.join(dir, 'install.applescript');
  fs.writeFileSync(applescript, `do shell script "${coreCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges with prompt "TradeLink CRM wants to install an update."`);
  const wrapper = path.join(dir, 'install.sh');
  fs.writeFileSync(wrapper, `#!/bin/bash
PID=${process.pid}
for i in $(seq 1 240); do kill -0 $PID 2>/dev/null || break; sleep 0.25; done
if [ -w ${q(path.dirname(target))} ] && [ -w ${q(target)} ]; then
  ${coreCmd}
else
  /usr/bin/osascript ${q(applescript)}
fi
${relaunch ? `/usr/bin/open ${q(target)}` : ''}
`);
  fs.chmodSync(wrapper, 0o755);
  fs.chmodSync(core, 0o755);
  spawn('/bin/bash', [wrapper], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

async function installNow() {
  if (!readyApp) {
    await check(true);
    if (!readyApp) return;
  }
  send({ status: 'installing', version: state.version });
  if (launchInstaller(true)) setTimeout(() => app.quit(), 300);
}

function onBeforeQuit() {
  // Auto-install on quit so the next launch is the new version.
  if (readyApp && !installing) launchInstaller(false);
}

function start() {
  setTimeout(() => check(false), 5000);
  setInterval(() => check(false), CHECK_EVERY);
}

module.exports = { attach, check, installNow, onBeforeQuit, start };
