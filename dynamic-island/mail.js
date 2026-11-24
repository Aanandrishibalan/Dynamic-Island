/* Messages for the island: Outlook (desktop app), Gmail (IMAP + app password) and WhatsApp (WhatsApp Web).
 *
 * Everything is polled/observed in the main process. The renderer only ever receives message summaries
 * (sender, subject/preview, time) - never passwords. The Gmail app password is kept in the encrypted vault
 * (AES-256-GCM, optional passphrase; see vault.js), outside the settings the windows can read.
 *
 * The first check of every source is silent (it only records what is already unread), so you are only
 * notified about messages that arrive while the island is running.
 */
const { app, BrowserWindow, Notification, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs'), path = require('path');

const LABEL = { outlook: 'Outlook', gmail: 'Gmail', whatsapp: 'WhatsApp' };
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = function createMail({ getDb, getWins, goToMessages, vault }) {
  const S = () => getDb().settings;
  const status = {
    outlook: { state: 'off', detail: 'Off', unread: 0 },
    gmail: { state: 'off', detail: 'Not connected', unread: 0 },
    whatsapp: { state: 'off', detail: 'Off', unread: 0 }
  };
  const lists = { outlook: [], gmail: [], whatsapp: [] };
  const seen = { outlook: null, gmail: null };   // null = first check not done yet (silent baseline)
  let timer = null, polling = false, quitting = false;
  app.on('before-quit', () => { quitting = true; });

  /* ---------- state -> renderer ---------- */
  const snapshot = () => ({
    status,
    messages: [].concat(lists.outlook, lists.gmail, lists.whatsapp).sort((a, b) => b.date - a.date).slice(0, 80)
  });
  function push() { const st = snapshot(); getWins().forEach((w) => { try { w.webContents.send('mail:update', st); } catch {} }); }
  function setStatus(src, state, detail, unread) {
    status[src] = { state, detail, unread: unread == null ? status[src].unread : unread };
    push();
  }

  /* ---------- notifications ---------- */
  function notify(m) {
    const s = S();
    if (s.focusOn) return;   // Focus is on: the message is still listed and counted, but nothing pops up or makes a sound
    if (s.mailPopup !== false) getWins().forEach((w) => { try { if (w.webContents.getURL().endsWith('index.html')) w.webContents.send('mail:new', m); } catch {} });
    if (s.mailToast !== false && Notification.isSupported()) {
      try {
        const n = new Notification({
          title: `${LABEL[m.src]} · ${m.from || 'New message'}`,
          body: s.mailPreview === false ? 'New message' : (m.subject || m.preview || ''),
          silent: s.mailPopup !== false || s.mailSound === false
        });
        n.on('click', () => goToMessages(m.src));
        n.show();
      } catch {}
    }
  }
  function announce(src, fresh) {
    if (!fresh.length) return;
    if (fresh.length > 3) {
      notify({ id: src + '-many-' + Date.now(), src, from: `${fresh.length} new messages`, subject: '', preview: '', date: Date.now(), unread: true });
    } else fresh.forEach(notify);
  }
  function diff(src, items) {
    const prev = seen[src], ids = items.map((i) => i.id);
    const fresh = prev ? items.filter((i) => !prev.has(i.id)) : [];
    seen[src] = new Set([...ids, ...(prev || [])].slice(0, 600));
    return fresh;
  }

  /* ---------- Outlook (classic desktop app, via outlook.ps1) ---------- */
  const olScript = () => app.isPackaged ? path.join(process.resourcesPath, 'outlook.ps1') : path.join(__dirname, 'outlook.ps1');
  const runOutlook = (...args) => new Promise((res) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', olScript(), ...args],
      { windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
        try { res(JSON.parse(String(out).trim().split('\n').pop())); } catch { res({ ok: false, error: err ? err.message : 'no answer' }); }
      });
  });
  async function pollOutlook() {
    if (!S().mailOutlook) { lists.outlook = []; seen.outlook = null; return setStatus('outlook', 'off', 'Off', 0); }
    const r = await runOutlook('list');
    if (!r.ok) {
      lists.outlook = [];
      return setStatus('outlook', 'error', r.error === 'not-running'
        ? 'Open the Outlook desktop app to receive mail here'
        : /class not registered|0x80040154|80040154/i.test(r.error || '') ? 'Classic Outlook was not found (the "new Outlook" is not supported)' : 'Could not read Outlook: ' + clip(r.error, 90), 0);
    }
    const items = (r.items || []).map((x) => ({ id: 'o' + x.id, ref: x.id, src: 'outlook', from: clip(x.from, 80), subject: clip(x.subject, 160), preview: clip(x.preview, 160), date: Date.parse(x.date) || Date.now(), unread: true }));
    lists.outlook = items;
    const fresh = diff('outlook', items);
    setStatus('outlook', 'ok', (r.unread || 0) + ' unread', r.unread || 0);
    announce('outlook', fresh);
  }

  /* ---------- Gmail (IMAP, app password) ---------- */
  const getGmailPass = () => vault.get('gmail', true);   // background read: polling must not postpone the vault's idle auto-lock
  const putGmailPass = (p) => vault.set('gmail', p);
  async function fetchGmail(user, pass) {
    const { ImapFlow } = require('imapflow');
    const c = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false, socketTimeout: 30000, greetingTimeout: 15000 });
    c.on('error', () => {});
    await c.connect();
    try {
      const lock = await c.getMailboxLock('INBOX', { readOnly: true });
      try {
        const uids = (await c.search({ seen: false }, { uid: true })) || [];
        const newest = uids.slice(-20).reverse(), items = [];
        if (newest.length) {
          for await (const m of c.fetch(newest, { uid: true, envelope: true }, { uid: true })) {
            const f = (m.envelope.from || [])[0] || {};
            items.push({ id: 'g' + m.uid, src: 'gmail', from: clip(f.name || f.address, 80), subject: clip(m.envelope.subject || '(no subject)', 160), preview: '', date: (m.envelope.date ? new Date(m.envelope.date).getTime() : Date.now()), unread: true });
          }
        }
        return { unread: uids.length, items: items.sort((a, b) => b.date - a.date) };
      } finally { lock.release(); }
    } finally { try { await c.logout(); } catch { try { c.close(); } catch {} } }
  }
  const gmailError = (e) => e && (e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|Application-specific password/i.test(String(e.response || e.message)))
    ? 'Sign-in failed. Use a Google app password (not your normal password).'
    : 'Could not reach Gmail: ' + clip(e && e.message, 90);
  async function pollGmail() {
    const user = S().mailGmailUser, pass = user ? getGmailPass() : '';
    if (user && !pass && vault.status().locked) { lists.gmail = []; return setStatus('gmail', 'warn', 'Locked · unlock your keys in Settings > Security', 0); }
    if (!user || !pass) { lists.gmail = []; seen.gmail = null; return setStatus('gmail', 'off', 'Not connected', 0); }
    try {
      const r = await fetchGmail(user, pass);
      lists.gmail = r.items;
      const fresh = diff('gmail', r.items);
      setStatus('gmail', 'ok', `${user} · ${r.unread} unread`, r.unread);
      announce('gmail', fresh);
    } catch (e) { lists.gmail = []; setStatus('gmail', 'error', gmailError(e), 0); }
  }
  async function setGmail(user, pass) {
    user = clip(user, 120); pass = String(pass || '').replace(/\s+/g, '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) return { ok: false, text: 'Enter your full Gmail address.' };
    if (!pass) return { ok: false, text: 'Enter the app password.' };
    const vs = vault.status();
    if (vs.locked) return { ok: false, text: 'Your saved keys are locked. Unlock them in Settings > Security first.' };
    if (!vs.canStore) return { ok: false, text: 'Secure storage is not available on this PC. Set a passphrase in Settings > Security to store passwords.' };
    try { await fetchGmail(user, pass); } catch (e) { return { ok: false, text: gmailError(e) }; }
    putGmailPass(pass);
    getDb().settings.mailGmailUser = user; seen.gmail = null;
    await pollGmail(); return { ok: true, text: 'Connected.' };
  }
  function clearGmail() {
    try { putGmailPass(''); } catch {}
    getDb().settings.mailGmailUser = ''; lists.gmail = []; seen.gmail = null;
    setStatus('gmail', 'off', 'Not connected', 0);
  }

  /* ---------- WhatsApp (WhatsApp Web in its own window; the site's notifications feed the island) ---------- */
  let wa = null, waCount = 0, waReady = false, waLastNote = 0, waTimer = null;
  const isWA = (u) => { try { return /(^|\.)whatsapp\.com$/.test(new URL(u).hostname); } catch { return false; } };
  function ensureWA(show) {
    if (wa && !wa.isDestroyed()) { if (show) { wa.show(); wa.focus(); } return wa; }
    waCount = 0; waReady = false;
    wa = new BrowserWindow({
      width: 1000, height: 720, show: !!show, title: 'WhatsApp - Dynamic Island', icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
      webPreferences: { partition: 'persist:whatsapp', preload: path.join(__dirname, 'wa-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
    });
    wa.removeMenu();
    const wc = wa.webContents;
    // WhatsApp Web only runs in recent Chrome-like browsers, so present the plain Chromium identity.
    const ua = wc.userAgent.replace(/\s*Electron\/\S+/i, '').replace(/\s*windows-dynamic-island\/\S+/i, '');
    wc.setUserAgent(ua);
    wc.session.setPermissionRequestHandler((_w, perm, cb) => cb(perm === 'notifications'));
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    wc.on('will-navigate', (e, url) => { if (!isWA(url)) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
    wc.on('page-title-updated', (_e, title) => onWATitle(title));
    wc.on('did-finish-load', () => { clearTimeout(waTimer); waTimer = setTimeout(() => { waReady = true; }, 20000); });   // ignore the unread backlog at start-up
    // Log which hosts fail (TLS resets from a VPN / antivirus / ISP block show up here) and retry the page with a back-off.
    const waLog = (m) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'wa-debug.log'), new Date().toISOString() + ' ' + m + '\n'); } catch {} };
    const waSeen = new Map();
    wc.session.webRequest.onErrorOccurred({ urls: ['*://*.whatsapp.com/*', '*://*.whatsapp.net/*'] }, (d) => {
      let h = ''; try { h = new URL(d.url).hostname; } catch {}
      const k = h + d.error, t = Date.now();
      if (t - (waSeen.get(k) || 0) > 60000) { waSeen.set(k, t); waLog(`${d.error} ${h}`); }
    });
    let waRetry = 0;
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3 || !wa || wa.isDestroyed()) return;   // -3 = aborted (normal navigation)
      waLog(`load failed ${code} ${desc} ${url}`);
      const delay = Math.min(60000, 5000 * 2 ** waRetry++);
      setStatus('whatsapp', 'error', `Could not reach WhatsApp Web (${desc}) · retrying`);
      setTimeout(() => { if (wa && !wa.isDestroyed()) wa.loadURL('https://web.whatsapp.com/', { userAgent: ua }).catch(() => {}); }, delay);
    });
    wc.on('did-finish-load', () => { waRetry = 0; });
    wa.on('close', (e) => { if (!quitting) { e.preventDefault(); wa.hide(); } });
    wa.loadURL('https://web.whatsapp.com/', { userAgent: ua }).catch(() => setStatus('whatsapp', 'error', 'Could not load WhatsApp Web (offline?)'));
    setStatus('whatsapp', 'ok', 'Starting…');
    return wa;
  }
  function onWATitle(title) {
    if (!wa || wa.isDestroyed()) return;
    const m = /^\((\d+)\)/.exec(title), n = m ? +m[1] : 0, prev = waCount; waCount = n;
    if (!n) lists.whatsapp.forEach((x) => { x.unread = false; });
    setStatus('whatsapp', 'ok', n ? n + ' unread' : 'Connected · no unread', n);
    if (waReady && n > prev && !(wa.isVisible() && wa.isFocused())) {
      // If the page raised a notification we already announced it; otherwise announce the bare count.
      const at = Date.now();
      setTimeout(() => {
        if (waLastNote >= at) return;
        notify({ id: 'w-count-' + at, src: 'whatsapp', from: 'WhatsApp', subject: '', preview: `${waCount} unread message${waCount === 1 ? '' : 's'}`, date: at, unread: true });
      }, 1500);
    }
    checkWALinked();
  }
  async function checkWALinked() {   // best effort: the QR code is only on screen while the phone is not linked
    try {
      if (!wa || wa.isDestroyed()) return;
      const qr = await wa.webContents.executeJavaScript(`!!document.querySelector('canvas[aria-label], [data-ref]')`);
      if (qr) setStatus('whatsapp', 'warn', 'Not linked yet · open WhatsApp and scan the QR code', 0);
    } catch {}
  }
  function onWANote(sender, n) {
    if (!wa || wa.isDestroyed() || sender !== wa.webContents || !isWA(sender.getURL())) return;
    waLastNote = Date.now();
    if (!waReady || (wa.isVisible() && wa.isFocused())) return;
    const m = { id: 'w' + waLastNote + Math.random().toString(36).slice(2, 6), src: 'whatsapp', from: clip(n.title, 80), subject: '', preview: clip(n.body, 200), date: waLastNote, unread: true };
    lists.whatsapp = [m, ...lists.whatsapp].slice(0, 30);
    push(); notify(m);
  }
  function setWhatsApp(on, show) {
    if (on) { ensureWA(show); }
    else {
      if (wa && !wa.isDestroyed()) { wa.removeAllListeners('close'); wa.destroy(); }
      wa = null; lists.whatsapp = []; waCount = 0; setStatus('whatsapp', 'off', 'Off', 0);
    }
  }

  /* ---------- scheduling ---------- */
  async function pollAll() {
    if (polling) return; polling = true;
    try { await Promise.all([pollOutlook(), pollGmail()]); } finally { polling = false; }
    push();
  }
  function schedule() {
    clearInterval(timer);
    const secs = Math.max(30, Math.min(900, Number(S().mailInterval) || 60));
    timer = setInterval(pollAll, secs * 1000);
  }
  function start() {
    schedule(); pollAll();
    if (S().mailWhatsApp) ensureWA(false);
  }
  function settingsChanged(p) {
    if ('mailInterval' in p) schedule();
    if ('mailOutlook' in p) { seen.outlook = null; pollOutlook(); }
    if ('mailWhatsApp' in p) setWhatsApp(!!p.mailWhatsApp, true);
  }

  /* ---------- opening a message ---------- */
  function open(id, src) {
    const m = snapshot().messages.find((x) => x.id === id);
    if (!m) return src && openSource(src);   // e.g. a "5 new messages" summary: open the account instead
    if (m.src === 'gmail') shell.openExternal('https://mail.google.com/mail/u/0/#inbox');
    else if (m.src === 'outlook' && m.ref) runOutlook('open', m.ref);
    else if (m.src === 'whatsapp') ensureWA(true);
  }
  function openSource(src) {
    if (src === 'gmail') shell.openExternal('https://mail.google.com/mail/u/0/#inbox');
    else if (src === 'outlook') shell.openPath('outlook.exe');
    else if (src === 'whatsapp' && S().mailWhatsApp) ensureWA(true);
  }

  return { start, snapshot, pollAll, setGmail, clearGmail, settingsChanged, open, openSource, ensureWA, onWANote,
    _test: { diff, seen, lists, notify, announce } };
};
