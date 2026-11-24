const { app, BrowserWindow, ipcMain, screen, shell, globalShortcut, desktopCapturer, nativeImage, Notification, session, powerMonitor, safeStorage, Tray, Menu, clipboard, dialog, net } = require('electron');
const { spawn, exec, execFile } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const createMail = require('./mail');
const createAI = require('./ai');
const createVault = require('./vault');
const planner = require('./planner');
const assistantLib = require('./assistant');
const createAssist = require('./assist');
const Well = require('./wellness');
const createWell = require('./wellmain');
const createTools = require('./toolsmain');
const TL = require('./tools');
const SP = require('./speed');
const APP_VER = require('./package.json').version;   // one source of truth: Settings > About, the tray tooltip, and the check that replaces an older running copy

/* Portable build (electron-builder sets PORTABLE_EXECUTABLE_DIR): keep every file next to the .exe so the folder can be
 * carried on a USB stick. Keys saved in "this Windows account" mode cannot move between PCs; use a passphrase for that. */
if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'DynamicIslandData'));
app.setAppUserModelId('com.example.dynamicisland');   // same as build.appId: Windows notifications and the taskbar show the app's own name and icon
/* One island at a time. If the copy that is already running is OLDER than this one (you installed an update while the old island
 * was still running, or Windows started the old exe at sign-in), this copy stops it and takes over, so the build you installed is
 * the one you see. A copy that is the same or newer just wakes the running island and exits. Each running copy keeps running.json
 * (version + pid); copies from before 1.4 have none, which also counts as "older". */
const RUN_FILE = () => path.join(app.getPath('userData'), 'running.json');
const readRunning = () => { try { return JSON.parse(fs.readFileSync(RUN_FILE(), 'utf8')); } catch { return null; } };
let takeover = false;
if (!app.requestSingleInstanceLock()) {
  const run = readRunning();
  if (process.platform === 'win32' && (!run || SP.cmpVer(APP_VER, run.version) > 0)) takeover = true;
  else app.exit(0);
}
function stopOlderCopies() {   // other main processes of this exe (Electron's helper processes carry --type= and are left alone)
  if (process.platform !== 'win32') return;
  try {
    const exe = path.basename(process.execPath).replace(/'/g, '');
    const psx = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const cmd = `Get-CimInstance Win32_Process -Filter "Name='${exe}'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    spawn(fs.existsSync(psx) ? psx : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, stdio: 'ignore' });
  } catch {}
}
const lockReady = (async () => {   // true when this copy owns the single-instance lock
  if (!takeover) return true;
  stopOlderCopies();
  for (let i = 0; i < 40; i++) {   // up to about 20 s for the old copy to exit
    await new Promise((r) => setTimeout(r, 500));
    if (app.requestSingleInstanceLock()) return true;
    if (i === 8 || i === 20) stopOlderCopies();
  }
  return false;
})();
app.commandLine.appendSwitch('log-level', '3');   // Chromium prints harmless TLS handshake resets (net_error -101) to the console; real failures are logged to wa-debug.log
app.on('second-instance', () => { if (win) { userHidden = false; win.show(); win.focus(); win.webContents.send('toggle'); } });

const W = 900, H = 600;   // transparent window; the island is drawn inside it (largest open size 680x440 at the Large setting x1.25 = 850x550 fits)
const SLIDE_IDS = ['assistant', 'planner', 'habits', 'goals', 'journal', 'expenses', 'music', 'tasks', 'calendar', 'clock', 'connect', 'speed', 'browser', 'pad', 'find', 'photos', 'weather', 'news', 'health', 'system', 'style', 'messages', 'clipboard', 'expander', 'windows', 'launch', 'rename', 'transfer', 'ocr', 'calc', 'qr', 'taskman', 'shopping', 'alarms'];   // Home is always shown
const DEFAULTS = {
  theme: 'dark', accent: '#0a84ff', clock24: true, launchAtStartup: true, startupMigrated: false, hideFullscreen: true, shortcut: 'Control+Alt+Space', captureShortcut: 'Control+Alt+N', voiceShortcut: 'Control+Alt+V', aiAssist: 'cloud', currency: '₹',
  assistMemory: true, assistCloudContext: false, assistWorkStart: 540, assistWorkEnd: 1080, assistLunch: true, assistDefMin: 30, assistBrief: 'first', assistBriefDate: '', assistVoiceRoute: true, assistSuggest: true, assistSpeak: true,
  model: 'llama3.2:1b', ollamaUrl: 'http://localhost:11434',
  systemPrompt: 'You are a concise assistant inside a desktop Dynamic Island. Keep answers short.',
  speakReplies: true, saveHistory: true,
  whisperModel: 'ggml-small.bin', whisperLang: 'auto', visionModel: 'gemma3:4b',
  weatherCity: '', units: 'c', photoFolder: '', newsFeed: 'https://feeds.bbci.co.uk/news/rss.xml',
  islandSize: 'm', islandColor: '', dynamicGlow: true, searchEngine: 'https://www.google.com/search?q=',
  quickLinks: 'YouTube|https://www.youtube.com\nGmail|https://mail.google.com\nGitHub|https://github.com\nMaps|https://maps.google.com',
  captureFolder: '', shotMode: 'hidden', shotDelay: 0,
  aiProvider: 'ollama', claudeModel: 'claude-sonnet-5-5', openaiModel: 'gpt-4o-mini', sttEngine: 'auto', openaiSttModel: 'whisper-1',
  vaultAutoLock: 30, vaultLockOnScreen: true, liveActivity: true,
  focusOn: false, homeButtons: null, homeHide: [], hiddenSlides: [], slideOrder: [], dateFormat: 'auto', netProbe: true, weekStart: 'auto', clockTimer: null, clockSw: null,
  mailOutlook: false, mailGmailUser: '', mailWhatsApp: false,
  mailPopup: true, mailToast: true, mailSound: true, mailPreview: true, mailInterval: 60,
  clipEnabled: true, clipPaused: false, clipMax: 200, clipDays: 30, expanderOn: false, ocrLang: 'auto', ocrCopy: true, ocrShortcut: 'Control+Alt+O', fxOnline: true, receiveFolder: '', foldersSeeded: false, snippetsSeeded: false, speedSeeded: false, lastRunVersion: '',
  ...Well.SETTING_DEFAULTS
};
let db = { settings: { ...DEFAULTS }, conversations: [], tasks: [], events: [], notes: ['', '', ''], usage: null, habits: [], goals: [], journal: [], expenses: [], memory: [], meetings: [], snippets: [], layouts: [], folders: [], favApps: [], calcHistory: [], speedTests: [], shopping: [], alarms: [], countdowns: [], zones: [], pomo: { ...Well.POMO_IDLE } }, dbFile, win, settingsWin, well;

/* ---------- storage (JSON in the user's app-data folder) ---------- */
function load() {
  dbFile = path.join(app.getPath('userData'), 'data.json');
  try { const d = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    db = { settings: { ...DEFAULTS, ...d.settings }, conversations: d.conversations || [], tasks: d.tasks || [], events: planner.sanitizeList(d.events, Well.sanitizeEvent, 5000), notes: d.notes || ['', '', ''], usage: d.usage || null,
      habits: Array.isArray(d.habits) ? d.habits : [], goals: Array.isArray(d.goals) ? d.goals : [], journal: Array.isArray(d.journal) ? d.journal : [], expenses: Array.isArray(d.expenses) ? d.expenses : [],
      memory: planner.sanitizeList(d.memory, assistantLib.sanitizeMemory, 200), meetings: planner.sanitizeList(d.meetings, assistantLib.sanitizeMeeting, 50),
      snippets: TL.sanitizeSnippets(d.snippets), layouts: TL.sanitizeLayouts(d.layouts), folders: TL.sanitizeFolders(d.folders), favApps: TL.sanitizeFavs(d.favApps), calcHistory: TL.sanitizeCalcHistory(d.calcHistory), speedTests: SP.sanitizeTests(d.speedTests),
      shopping: planner.sanitizeList(d.shopping, Well.sanitizeShopItem, 500), alarms: planner.sanitizeList(d.alarms, (a) => Well.sanitizeAlarm(a, Date.now()), 30), countdowns: planner.sanitizeList(d.countdowns, Well.sanitizeCountdown, 50), zones: planner.sanitizeList(d.zones, Well.sanitizeZone, 12), pomo: Well.sanitizePomo(d.pomo) }; } catch {}
}
function save() {
  try { fs.writeFileSync(dbFile, JSON.stringify(db)); } catch {}
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('store', db));
}

/* ---------- PowerShell helpers: volume, brightness, running apps, Wi-Fi, Bluetooth ---------- */
// Two long-running copies of helper.ps1: the main one answers quick things (volume, media, usage), the "net" one
// handles slow network work (Wi-Fi scan/connect, Bluetooth list) so those never make the sliders or music lag.
const hLog = (m) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'helper-debug.log'), new Date().toISOString() + ' ' + m + '\n'); } catch {} };   // why Wi-Fi / Bluetooth / music do not work
const PS_EXE = (() => { const p = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); try { return fs.existsSync(p) ? p : 'powershell.exe'; } catch { return 'powershell.exe'; } })();
function scriptPath(name) { return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, name); }   // helper scripts always run from the install folder, never from AppData
function makeHelper(scriptName) {
  let proc = null, queue = [];
  function fail() { proc = null; queue.splice(0).forEach((w) => w('ERR')); }
  function start() {
    // Run the helper straight from the install folder (extraResources when packaged) instead of
    // writing a fresh copy into the AppData folder on every launch and executing it from there.
    const script = scriptPath(scriptName || 'helper.ps1');
    // Remove the copy that earlier versions left in the data folder so it is not scanned/flagged again.
    try { fs.rmSync(path.join(app.getPath('userData'), scriptName || 'helper.ps1'), { force: true }); } catch {}
    if (!fs.existsSync(script)) hLog('helper script missing: ' + script);
    const p = spawn(PS_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    proc = p;
    p.stderr.setEncoding('utf8'); p.stderr.on('data', (d) => hLog('stderr: ' + String(d).trim().slice(0, 600)));
    let buf = ''; p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); const w = queue.shift(); if (w) w(l); } });
    p.stdin.on('error', () => {}); p.on('exit', (c) => { hLog('helper exited, code ' + c); if (proc === p) fail(); }); p.on('error', (e) => { hLog('helper spawn error: ' + e.message); if (proc === p) fail(); });
  }
  // timeoutMs: if the helper has not answered by then it is restarted (a late answer would otherwise be matched to the wrong request).
  const run = (cmd, timeoutMs) => new Promise((res) => {
    if (!proc) start();
    let t = null;
    const fresh = !proc;   // a helper that is still starting (compiling its C# parts) gets extra time before it counts as hung
    queue.push((v) => { clearTimeout(t); res(v); });
    if (timeoutMs) t = setTimeout(() => { try { proc && proc.kill(); } catch {} }, timeoutMs + (fresh ? 60000 : 0));
    proc.stdin.write(cmd + '\n');
  });
  return { run, kill: () => { try { proc && proc.kill(); } catch {} }, pid: () => (proc && proc.pid) || 0 };
}
const mainPS = makeHelper(), netPS = makeHelper(), wifiPS = makeHelper();   // wifiPS: its own process, so a slow radio / Bluetooth call can never block the Wi-Fi list
const ps = (cmd) => mainPS.run(cmd);

/* ---------- security helpers ---------- */
// Only our own pages (file://) may use the privileged IPC below.
const trusted = (e) => { try { return /^file:\/\//i.test((e.senderFrame && e.senderFrame.url) || e.sender.getURL()); } catch { return false; } };
function harden(wc) {   // no pop-ups, no navigating away from the app's own pages, no <webview>
  wc.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (ev, url) => { if (!/^file:\/\//i.test(url)) { ev.preventDefault(); if (/^https:\/\//i.test(url)) shell.openExternal(url); } });
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
}
const RISKY = /\.(exe|com|bat|cmd|ps1|psm1|psd1|ps1xml|psc1|vbs|vbe|js|jse|wsf|wsh|wsc|sct|msi|msp|mst|scr|pif|lnk|hta|cpl|reg|jar|dll|url|msc|appx|msix|appxbundle|msixbundle|application|appref-ms|gadget|scf|chm|inf|sys|ocx|iso|vhd|vhdx)$/i;
// Pure decision function (Windows path rules on every host, so it can be tested anywhere): returns the path to open, or null.
function checkOpenPath(p, appdata) {
  const w = require('path').win32;
  if (typeof p !== 'string' || p.length > 1024 || p.includes('\0')) return null;
  if (p.startsWith('\\\\') || p.startsWith('//')) return null;               // UNC and device paths (\\server, \\?\, \\.\)
  if (!/^[a-zA-Z]:[\\/]/.test(p)) return null;                                // must be drive-letter absolute
  if (p.indexOf(':', 2) !== -1) return null;                                  // NTFS alternate data streams (file.pdf:evil.exe)
  const n = w.normalize(p);
  const leaf = n.replace(/[. ]+$/, '');                                       // Windows ignores trailing dots and spaces
  const recent = appdata ? w.join(appdata, 'Microsoft', 'Windows', 'Recent').toLowerCase() + '\\' : null;
  const inRecent = !!recent && n.toLowerCase().startsWith(recent);
  if ((RISKY.test(n) || RISKY.test(leaf)) && !(inRecent && /\.lnk$/i.test(leaf))) return null;   // Recent: shortcuts only
  return n;
}
function safeOpenPath(p) {   // documents and photos only; shortcuts only from the Windows "Recent" folder
  const n = checkOpenPath(p, process.env.APPDATA || '');
  if (n) shell.openPath(n);
}
const WEBPREFS = { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false };

/* ---------- windows ---------- */
function createWindow() {
  const { bounds, workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: W, height: Math.min(H, workArea.height), x: Math.round(bounds.x + (bounds.width - W) / 2), y: bounds.y,
    icon: path.join(__dirname, 'build', 'icon.png'), frame: false, transparent: true, resizable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { ...WEBPREFS, preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' }
  });
  harden(win.webContents);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true);   // the island never appears in screen captures
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
  win.on('blur', () => { if (!copyBusy) win.webContents.send('collapse'); });
}
/* ---------- hide in full screen + tray icon ---------- */
let tray = null, userHidden = false, fsHidden = false, lastFull = false;
function showIsland(open) { if (!win || win.isDestroyed()) return; userHidden = false; win.show(); if (open) { win.focus(); win.webContents.send('toggle'); } }
function setSetting(k, v) { db.settings[k] = v; if (k === 'launchAtStartup') applyStartup(!!v); save(); }
function trayMenu() {
  const s = db.settings, visible = !!win && win.isVisible();
  return Menu.buildFromTemplate([
    { label: 'Open Dynamic Island', click: () => showIsland(true) },
    { label: visible ? 'Hide island' : 'Show island', click: () => { if (visible) { userHidden = true; win.hide(); } else showIsland(false); } },
    { label: 'Settings', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: s.launchAtStartup !== false && !!s.launchAtStartup, click: (i) => setSetting('launchAtStartup', i.checked) },
    { label: 'Hide in full screen', type: 'checkbox', checked: s.hideFullscreen !== false, click: (i) => setSetting('hideFullscreen', i.checked) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}
function createTray() {
  try {
    let img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
    if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 32, height: 32 });
    tray = new Tray(img);
    tray.setToolTip('Dynamic Island ' + APP_VER);
    tray.on('click', () => showIsland(true));
    tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  } catch (e) { hLog('tray failed: ' + e.message); }
}
function startFullscreenWatch() {
  setInterval(async () => {
    if (!win || win.isDestroyed() || shotBusy) return;
    if (db.settings.hideFullscreen === false) { if (fsHidden) { fsHidden = false; lastFull = false; if (!userHidden) win.showInactive(); } return; }
    const r = await mainPS.run('fs', 5000);
    if (r !== '0' && r !== '1') return;
    const full = r === '1';
    if (full === lastFull) return;   // act only when the state changes, so the shortcut can still show the island over a full-screen app
    lastFull = full;
    if (full) { if (win.isVisible()) { fsHidden = true; win.hide(); } }
    else if (fsHidden) { fsHidden = false; if (!userHidden) win.showInactive(); }
  }, 2000);
}

function openSettings(tab) {
  tab = ['general', 'menus', 'tools', 'ai', 'assistant', 'wellness', 'security', 'messages', 'history', 'about'].includes(tab) ? tab : '';
  if (settingsWin) { if (tab) settingsWin.loadFile('settings.html', { hash: tab }); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 800, height: 580, minWidth: 660, minHeight: 460, title: 'Dynamic Island Settings', icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { ...WEBPREFS, preload: path.join(__dirname, 'preload.js') }
  });
  harden(settingsWin.webContents);
  settingsWin.removeMenu(); settingsWin.loadFile('settings.html', tab ? { hash: tab } : undefined);
  settingsWin.on('closed', () => (settingsWin = null));
}
function registerShortcuts() {   // the island toggle, and Quick Capture (a second shortcut that opens the planner ready to type)
  globalShortcut.unregisterAll();
  const res = { open: false, capture: false, voice: false, ocr: false };
  const bring = () => { userHidden = false; if (!win.isVisible()) win.show(); win.focus(); };
  try { res.open = !!globalShortcut.register(db.settings.shortcut, () => { bring(); win.webContents.send('toggle'); }); } catch {}
  try { const c = db.settings.captureShortcut; if (c && c !== db.settings.shortcut) res.capture = !!globalShortcut.register(c, () => { bring(); win.webContents.send('capture'); }); } catch {}
  try { const v = db.settings.voiceShortcut; if (v && v !== db.settings.shortcut && v !== db.settings.captureShortcut) res.voice = !!globalShortcut.register(v, () => { bring(); win.webContents.send('voice'); }); } catch {}
  try { const o = db.settings.ocrShortcut; if (o && ![db.settings.shortcut, db.settings.captureShortcut, db.settings.voiceShortcut].includes(o)) res.ocr = !!globalShortcut.register(o, () => { if (tools) tools.ocrSnip(); }); } catch {}   // Screenshot OCR: drag around text on screen
  return res;
}

/* Start with Windows: registers the exe in the user's Run key (no admin needed). The portable build runs from a temp folder,
 * so it registers the real portable .exe instead. Only for packaged builds, so `npm start` never adds an Electron entry. */
function applyStartup(on) {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    app.setLoginItemSettings({ openAtLogin: on, path: exe, args: ['--startup'] });
    hLog('start with Windows ' + (on ? 'on' : 'off') + ' -> ' + exe + ' (registered: ' + app.getLoginItemSettings({ path: exe, args: ['--startup'] }).openAtLogin + ')');
  } catch {}
}

let mail, ai, vault, assistant, tools, copyBusy = false, lastExternal = { name: '', hwnd: 0 };
let updatedFrom = '';   // previous version when this launch is the first one after an update
app.whenReady().then(async () => {
  if (!(await lockReady)) { app.exit(0); return; }
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(RUN_FILE(), JSON.stringify({ version: APP_VER, pid: process.pid, started: Date.now() })); } catch {}
  // camera / microphone only for our own pages; everything else the web platform can ask for is refused
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && /^file:\/\//i.test(wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => perm === 'media' && ((wc && /^file:\/\//i.test(wc.getURL())) || /^file:/i.test(String(origin))));
  load();
  const prevVer = db.settings.lastRunVersion;
  if (prevVer && prevVer !== APP_VER) updatedFrom = prevVer;
  db.settings.lastRunVersion = APP_VER;
  if (Array.isArray(db.settings.homeButtons) && !db.settings.speedSeeded && !db.settings.homeButtons.includes('speed')) {   // customised Home layouts get the new Speed button once, next to Devices
    const hb = db.settings.homeButtons.slice(), i = hb.indexOf('connect');
    hb.splice(i >= 0 ? i + 1 : hb.length, 0, 'speed'); db.settings.homeButtons = hb;
  }
  db.settings.speedSeeded = true; save();
  if (!db.settings.startupMigrated) { db.settings.launchAtStartup = true; db.settings.startupMigrated = true; save(); }   // earlier versions saved 'off'; switch it on once, the user can still turn it off
  applyStartup(db.settings.launchAtStartup !== false);   // keep the Run entry in step with the setting (also repairs it after an update or a moved portable exe)
  vault = createVault({ dir: app.getPath('userData'), safeStorage });
  vault.configure({ autoLockMin: db.settings.vaultAutoLock });
  vault.migrate([path.join(app.getPath('userData'), 'ai-keys.bin'), path.join(app.getPath('userData'), 'secrets.bin')]);   // older DPAPI-only files
  vault.onChange((st) => [win, settingsWin].forEach((w) => { try { if (w && !w.isDestroyed()) w.webContents.send('vault', st); } catch {} }));
  const lockNow = () => { if (db.settings.vaultLockOnScreen !== false) vault.lock(); };
  powerMonitor.on('lock-screen', lockNow); powerMonitor.on('suspend', lockNow);
  powerMonitor.on('unlock-screen', () => { unlockFlag = true; });   // "remind me when I unlock"
  ai = createAI({ getDb: () => db, vault }); createWindow(); createTray();
  if (updatedFrom) { try { if (Notification.isSupported()) new Notification({ title: 'Dynamic Island updated', body: 'Now running version ' + APP_VER + ' (was ' + updatedFrom + ').', silent: true }).show(); } catch {} }   // the first launch after an update says so, so it is clear the new build is the one running
  startFullscreenWatch(); registerShortcuts(); ps('get'); startTracking(); startReminders();
  mail = createMail({
    getDb: () => db,
    vault,
    getWins: () => [win, settingsWin].filter((w) => w && !w.isDestroyed()),
    goToMessages: (src) => { if (!win) return; win.show(); win.focus(); win.webContents.send('goto', { view: 'messages', src }); }
  });
  mail.start();
  well = createWell({ getDb: () => db, save, now: () => Date.now(), trusted, notify: (title, body) => { try { if (Notification.isSupported()) new Notification({ title, body, silent: true }).show(); } catch {} },
    send: (ch, payload) => { if (win && !win.isDestroyed()) { win.webContents.send(ch, payload); if (ch === 'alert' || ch === 'reminder') { try { if (!win.isVisible() && !userHidden && !fsHidden) win.showInactive(); } catch {} } } },
    idleSec: () => lastIdle, drives: () => driveList() });
  well.register(ipcMain); well.start();
  assistant = createAssist({
    pomo: (a) => well.pomoAction(a), locale: () => { try { return app.getLocale(); } catch { return ''; } },
    getDb: () => db, save, now: () => Date.now(), provider: () => ai.provider(), chat: (m, o) => chatOnce(m, o), vision: (q, img) => visionCall(q, img), grabScreen: grabScreenJpeg,
    clipboard, ps: (c) => ps(c), getFg: () => lastExternal, setCopyBusy: (b) => { copyBusy = b; }, focusIsland: () => { if (win && !win.isDestroyed()) win.focus(); },
    appIndex: (f) => appIndex(f), launchApp: (id) => launchAppById(id), openPath: (p) => safeOpenPath(p), mail: () => (mail ? mail.snapshot().messages : []), usage: () => ({ ...usage(), idleNow: lastIdle }), weather: () => (wxCache && wxCache.data),
    setTasks: (list) => { db.tasks = planner.spawnNext(db.tasks, planner.sanitizeList(list, planner.sanitizeTask, 2000)).tasks; }, captureAdd: (raw) => captureAdd(raw),
    pickFile: async () => { const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['txt', 'md', 'csv', 'json', 'html', 'htm', 'xml', 'log', 'docx'] }] }); return r.canceled ? '' : r.filePaths[0]; }
  });
  /* Productivity tools (clipboard history, text expander, window layouts, quick launch, renamer, file transfer, OCR, calculator, QR). See toolsmain.js. */
  tools = createTools({
    electron: require('electron'), getDb: () => db, save, trusted, harden, WEBPREFS, risky: RISKY, saved, log: hLog, psExe: PS_EXE, spawn,
    getWin: () => win, getSettingsWin: () => settingsWin,
    makeHelper: (name) => makeHelper(name), scriptPath,
    helperPids: () => [mainPS, netPS, wifiPS].map((h) => h.pid()).filter(Boolean),   // the island's own PowerShell helpers: the Task manager slide never lists or ends them
    appIndex: (f) => appIndex(f), launchApp: (id) => launchAppById(id),
    setBlurGuard: (b) => { copyBusy = !!b; },   // while a file dialog is open the island must not collapse
    collapseIsland: () => { if (win && !win.isDestroyed()) win.webContents.send('collapse'); },
    hideIsland: () => { if (win && !win.isDestroyed()) win.hide(); },   // hiding gives focus back to the app the person was in
    showIslandInactive: () => { if (win && !win.isDestroyed() && !userHidden && !fsHidden) win.showInactive(); },
    openIsland: (view) => { if (!win || win.isDestroyed()) return; userHidden = false; if (!win.isVisible()) win.show(); win.focus(); win.webContents.send('goto', { view }); }
  });
  tools.init();
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { const r = readRunning(); if (r && r.pid === process.pid) fs.rmSync(RUN_FILE(), { force: true }); } catch {} globalShortcut.unregisterAll(); try { tools && tools.shutdown(); } catch {} mainPS.kill(); netPS.kill(); wifiPS.kill(); });

/* ---------- IPC ---------- */
ipcMain.on('set-ignore', (_e, v) => win && win.setIgnoreMouseEvents(v, { forward: true }));
ipcMain.on('open-settings', (_e, tab) => openSettings(tab));
ipcMain.on('open-conv', (_e, id) => { win.focus(); win.webContents.send('open-conv', id); });
ipcMain.handle('db:get', () => db);
ipcMain.handle('data:set', (e, p) => {
  if (!trusted(e) || !p || typeof p !== 'object') return db;
  if (Array.isArray(p.conversations)) db.conversations = p.conversations;
  if (Array.isArray(p.tasks)) db.tasks = planner.spawnNext(db.tasks, planner.sanitizeList(p.tasks, planner.sanitizeTask, 2000)).tasks;   // rebuilt field by field; a repeating task that was just ticked gets its next copy
  if (Array.isArray(p.events)) {   // rebuilt field by field; an event that is new or whose date / time / repeat changed gets its alert re-armed
    const was = new Map((db.events || []).map((x) => [x.id, x])), n = Date.now();
    db.events = planner.sanitizeList(p.events, Well.sanitizeEvent, 5000).map((x) => { const o = was.get(x.id); return !o || o.date !== x.date || o.time !== x.time || o.repeat !== x.repeat || o.kind !== x.kind ? Well.armEvent(x, n) : x; });
  }
  if (Array.isArray(p.shopping)) db.shopping = planner.sanitizeList(p.shopping, Well.sanitizeShopItem, 500);
  if (Array.isArray(p.alarms)) {   // an alarm that is new, switched on or changed is re-armed for its next ring
    const was = new Map((db.alarms || []).map((x) => [x.id, x])), n = Date.now();
    db.alarms = planner.sanitizeList(p.alarms, (a) => Well.sanitizeAlarm(a, n), 30).map((a) => { const o = was.get(a.id); return a.on && (!o || !o.on || o.time !== a.time || o.days.join() !== a.days.join() || a.next <= n && !a.snoozed) ? { ...a, next: Well.alarmNext(a, n) || 0 } : a; });
  }
  if (Array.isArray(p.countdowns)) db.countdowns = planner.sanitizeList(p.countdowns, Well.sanitizeCountdown, 50);
  if (Array.isArray(p.zones)) db.zones = planner.sanitizeList(p.zones, Well.sanitizeZone, 12);
  if (Array.isArray(p.notes)) db.notes = p.notes;
  if (Array.isArray(p.habits)) db.habits = planner.sanitizeList(p.habits, planner.sanitizeHabit, 60);
  if (Array.isArray(p.goals)) db.goals = planner.sanitizeList(p.goals, planner.sanitizeGoal, 40);
  if (Array.isArray(p.journal)) db.journal = planner.sanitizeList(p.journal, planner.sanitizeEntry, 2000);
  if (Array.isArray(p.expenses)) db.expenses = planner.sanitizeList(p.expenses, planner.sanitizeExpense, 5000);
  if (Array.isArray(p.memory)) db.memory = planner.sanitizeList(p.memory, assistantLib.sanitizeMemory, 200);
  if (Array.isArray(p.meetings)) db.meetings = planner.sanitizeList(p.meetings, assistantLib.sanitizeMeeting, 50);
  if (Array.isArray(p.snippets)) { db.snippets = TL.sanitizeSnippets(p.snippets); if (tools) tools.syncExpander(); }   // the keyboard helper learns the new triggers
  if (Array.isArray(p.layouts)) db.layouts = TL.sanitizeLayouts(p.layouts);
  if (Array.isArray(p.folders)) db.folders = TL.sanitizeFolders(p.folders);
  if (Array.isArray(p.favApps)) db.favApps = TL.sanitizeFavs(p.favApps);
  if (Array.isArray(p.calcHistory)) db.calcHistory = TL.sanitizeCalcHistory(p.calcHistory);
  if (Array.isArray(p.speedTests)) db.speedTests = SP.sanitizeTests(p.speedTests);
  save(); return db;
});
ipcMain.handle('settings:set', (e, p) => {
  if (!trusted(e) || !p || typeof p !== 'object') return db;
  const clean = {};   // only known settings, never arbitrary keys
  for (const k of Object.keys(p)) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) clean[k] = p[k];
  p = clean;
  if ('aiProvider' in p && !['ollama', 'claude', 'openai'].includes(p.aiProvider)) delete p.aiProvider;
  if ('shotMode' in p) p.shotMode = shotPlan({ mode: p.shotMode }).mode;
  if ('shotDelay' in p) p.shotDelay = shotPlan({ delay: p.shotDelay }).delay;
  if ('hiddenSlides' in p) p.hiddenSlides = Array.isArray(p.hiddenSlides) ? [...new Set(p.hiddenSlides.filter((x) => SLIDE_IDS.includes(x)))] : [];   // only known slides, never Home
  if ('slideOrder' in p) p.slideOrder = Array.isArray(p.slideOrder) ? [...new Set(p.slideOrder.filter((x) => SLIDE_IDS.includes(x)))] : [];   // custom slide order; Home is always first
  if (well) well.cleanSettings(p, db.settings);
  if ('dateFormat' in p && !['auto', 'dmy', 'mdy', 'ymd', 'long'].includes(p.dateFormat)) p.dateFormat = 'auto';
  if ('captureShortcut' in p) p.captureShortcut = String(p.captureShortcut || '').trim().slice(0, 40);
  if ('aiAssist' in p && !['cloud', 'always', 'off'].includes(p.aiAssist)) delete p.aiAssist;
  if ('voiceShortcut' in p) p.voiceShortcut = String(p.voiceShortcut || '').trim().slice(0, 40);
  for (const k of ['assistWorkStart', 'assistWorkEnd']) if (k in p) p[k] = Math.max(0, Math.min(1440, Math.round(+p[k]) || DEFAULTS[k]));
  if ('assistWorkStart' in p || 'assistWorkEnd' in p) { const a = 'assistWorkStart' in p ? p.assistWorkStart : db.settings.assistWorkStart, b = 'assistWorkEnd' in p ? p.assistWorkEnd : db.settings.assistWorkEnd; if (b <= a) { delete p.assistWorkStart; delete p.assistWorkEnd; } }
  if ('assistDefMin' in p) p.assistDefMin = Math.max(5, Math.min(240, Math.round(+p.assistDefMin) || 30));
  if ('assistBrief' in p && !['first', 'off'].includes(p.assistBrief)) p.assistBrief = 'first';
  delete p.assistBriefDate;
  if ('currency' in p) p.currency = String(p.currency || '').trim().slice(0, 4) || '₹';
  delete p.foldersSeeded; delete p.snippetsSeeded; delete p.speedSeeded; delete p.lastRunVersion;   // internal flags, not for the page to change
  for (const k of ['clipEnabled', 'clipPaused', 'expanderOn', 'ocrCopy', 'fxOnline']) if (k in p) p[k] = !!p[k];
  if ('clipMax' in p) p.clipMax = Math.max(10, Math.min(500, Math.round(+p.clipMax) || DEFAULTS.clipMax));
  if ('clipDays' in p) p.clipDays = Math.max(0, Math.min(365, Math.round(+p.clipDays) || 0));   // 0 = keep until deleted
  if ('ocrLang' in p) p.ocrLang = /^(auto|[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2})$/.test(String(p.ocrLang)) ? String(p.ocrLang) : 'auto';
  if ('ocrShortcut' in p) p.ocrShortcut = String(p.ocrShortcut || '').trim().slice(0, 40);
  if ('receiveFolder' in p) { const f = String(p.receiveFolder || '').trim().slice(0, 500); p.receiveFolder = /^[a-zA-Z]:[\\/]/.test(f) && f.indexOf(':', 2) === -1 ? f : ''; }
  const old = db.settings.shortcut, oldCap = db.settings.captureShortcut, oldVoice = db.settings.voiceShortcut, oldOcr = db.settings.ocrShortcut;
  Object.assign(db.settings, p);
  if ('vaultAutoLock' in p) vault.configure({ autoLockMin: p.vaultAutoLock });
  if ('launchAtStartup' in p) applyStartup(!!p.launchAtStartup);
  if ((p.shortcut && p.shortcut !== old) || 'captureShortcut' in p || 'voiceShortcut' in p || 'ocrShortcut' in p) {   // a shortcut Windows refuses is put back
    const r = registerShortcuts();
    if (p.shortcut && p.shortcut !== old && !r.open) { db.settings.shortcut = old; registerShortcuts(); }
    else if (p.captureShortcut && !r.capture) { db.settings.captureShortcut = oldCap; registerShortcuts(); }
    else if (p.voiceShortcut && !r.voice) { db.settings.voiceShortcut = oldVoice; registerShortcuts(); }
    else if (p.ocrShortcut && !r.ocr) { db.settings.ocrShortcut = oldOcr; registerShortcuts(); }
  }
  save();
  if (tools && 'expanderOn' in p) tools.syncExpander();
  if (mail && Object.keys(p).some((k) => k.startsWith('mail'))) mail.settingsChanged(p);
  return db;
});

ipcMain.on('action', (_e, name) => {
  const open = { wifi: 'ms-settings:network-wifi', bluetooth: 'ms-settings:bluetooth', 'bluetooth-add': 'ms-settings:bluetooth', airplane: 'ms-settings:network-airplanemode', location: 'ms-settings:privacy-location', focus: 'ms-settings:quietmomentshome' };
  if (open[name]) return shell.openExternal(open[name]);
  const prog = { notepad: 'notepad.exe', calc: 'calc.exe', taskmgr: 'taskmgr.exe', explorer: 'explorer.exe', snip: 'SnippingTool.exe' };
  if (prog[name]) spawn(prog[name], [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  if (name === 'lock') exec('rundll32.exe user32.dll,LockWorkStation');
  if (name === 'sleep') exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
  if (name === 'quit') app.quit();
});

ipcMain.handle('sys:get', async () => {
  const r = (await ps('get')).split(',').map(Number);
  return r.length === 3 && r.every((n) => !isNaN(n)) ? { vol: r[0], muted: !!r[1], bright: r[2] } : null;
});
ipcMain.on('sys:vol', (_e, n) => ps('setvol ' + Math.round(n)));
ipcMain.on('sys:bright', (_e, n) => ps('setbright ' + Math.round(n)));
ipcMain.on('sys:focus', (_e, id) => ps('focus ' + (id | 0)));
const icons = {};
ipcMain.handle('sys:apps', async () => {
  try {
    const list = JSON.parse(await ps('apps'));
    return await Promise.all(list.map(async (a) => {
      const icon = a.path ? await iconFor(a.path) : '';
      return { id: a.id, name: a.name, title: a.title, icon };
    }));
  } catch { return []; }
});

/* ---------- vault (encrypted keys; the windows only ever see status, never a secret) ---------- */
ipcMain.handle('vault:status', (e) => (trusted(e) ? vault.status() : null));
ipcMain.handle('vault:unlock', async (e, pass) => {
  if (!trusted(e)) return { ok: false, text: 'Blocked.' };
  const r = await vault.unlock(String(pass || '')); if (r.ok && mail) mail.pollAll();
  return { ...r, status: vault.status() };
});
ipcMain.handle('vault:lock', (e) => { if (!trusted(e)) return null; vault.lock(); return vault.status(); });
ipcMain.handle('vault:set-passphrase', async (e, pass, old) => {
  if (!trusted(e)) return { ok: false, text: 'Blocked.' };
  const r = await vault.setPassphrase(String(pass || ''), String(old || '')); return { ...r, status: vault.status() };
});
ipcMain.handle('vault:remove-passphrase', async (e, pass) => {
  if (!trusted(e)) return { ok: false, text: 'Blocked.' };
  const r = await vault.removePassphrase(String(pass || '')); return { ...r, status: vault.status() };
});
ipcMain.handle('vault:wipe', (e) => {
  if (!trusted(e)) return null;
  vault.wipe(); db.settings.mailGmailUser = ''; if (db.settings.aiProvider !== 'ollama') db.settings.aiProvider = 'ollama';
  if (mail) mail.clearGmail(); save(); return vault.status();
});

/* ---------- AI accounts (Claude / ChatGPT API keys; the key never reaches the windows) ---------- */
ipcMain.handle('ai:status', () => ({ ...ai.status(), provider: ai.provider(), stt: ai.sttEngine() }));
ipcMain.handle('ai:connect', async (e, p, key) => { if (!trusted(e)) return { ok: false, text: 'Blocked.' }; const r = await ai.connect(String(p), key); if (r.ok) save(); return { ...r, ...ai.status() }; });
ipcMain.handle('ai:disconnect', (_e, p) => {
  const st = ai.disconnect(String(p));
  if (db.settings.aiProvider === String(p)) { db.settings.aiProvider = 'ollama'; }
  save(); return { ...st, provider: ai.provider(), stt: ai.sttEngine() };
});
ipcMain.handle('ai:models', (_e, p) => ai.models(String(p)));

/* ---------- Wi-Fi + Bluetooth (second helper process; see helper.ps1) ---------- */
const jparse = (t, d) => { try { return JSON.parse(t); } catch { return d; } };
ipcMain.handle('net:radios', async () => jparse(await netPS.run('radios', 20000), null));
ipcMain.handle('net:radio', async (_e, kind, on) => {
  if (!['wifi', 'bluetooth'].includes(kind)) return 'ERR';
  return netPS.run(`radio ${kind} ${on ? 'on' : 'off'}`, 20000);
});
ipcMain.handle('net:airplane', async (_e, on) => netPS.run('airplane ' + (on ? 'on' : 'off'), 30000));
let wifiBusy = null;
ipcMain.handle('wifi:scan', async () => {
  if (!wifiBusy) {
    const t0 = Date.now();
    wifiBusy = wifiPS.run('wifi', 40000).then((t) => {
      const d = jparse(t, null);
      netLog('wifi scan ' + (Date.now() - t0) + 'ms ' + (d ? 'networks=' + (d.networks || []).length + ' native=' + d.native + ' reason=' + (d.reason || '') + ' hint=' + String(d.hint || '').slice(0, 160) : 'no answer, raw=' + String(t).slice(0, 160)));
      return d || { error: 'The Wi-Fi helper (PowerShell) did not answer. Press Refresh to try again.' };
    }).finally(() => { wifiBusy = null; });
  }
  return wifiBusy;
});
// Real internet check (navigator.onLine stays true on virtual adapters such as WSL/Hyper-V/VPN). Uses Windows' own connectivity-test address.
async function probeOnline() {
  for (const u of ['https://www.msftconnecttest.com/connecttest.txt', 'http://www.gstatic.com/generate_204']) {
    try { const r = await fetch(u, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(3500) }); if (r.ok || r.status === 204) return true; } catch {}
  }
  return false;
}
ipcMain.handle('net:online', async () => (db.settings.netProbe === false ? null : probeOnline()));
const netLog = (m) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'wifi-debug.log'), new Date().toISOString() + ' ' + m + '\n'); } catch {} };   // small log to help diagnose scan problems
ipcMain.handle('wifi:connect', async (_e, ssid, password, auth) => {
  ssid = String(ssid || '').slice(0, 64); password = password == null ? '' : String(password).slice(0, 128); auth = String(auth || '').slice(0, 40);
  if (!ssid) return { ok: false, text: 'No network chosen.' };
  return jparse(await wifiPS.run('wificonnect ' + JSON.stringify({ ssid, password, auth }), 45000), { ok: false, text: 'The Wi-Fi helper did not answer.' });
});
ipcMain.handle('wifi:disconnect', async () => wifiPS.run('wifidisc', 15000));
ipcMain.handle('wifi:forget', async (_e, ssid) => jparse(await wifiPS.run('wififorget ' + JSON.stringify({ ssid: String(ssid || '').slice(0, 64) }), 15000), { ok: false }));
ipcMain.handle('bt:list', async () => jparse(await netPS.run('btlist', 40000), null));

/* ---------- Whisper: speech to text (whisper.cpp command-line) ---------- */
ipcMain.handle('stt', (_e, wav) => new Promise((res) => {
  if (ai.sttEngine() === 'openai') return ai.transcribe(wav).then(res);   // OpenAI transcription when a key is saved
  const s = db.settings, dir = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'whisper');
  const exe = ['whisper-cli.exe', 'main.exe'].map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
  const model = path.join(dir, s.whisperModel);
  if (!exe) return res({ ok: false, text: 'whisper-cli.exe was not found in the whisper folder. See whisper/README.txt.' });
  if (!fs.existsSync(model)) return res({ ok: false, text: `Whisper model "${s.whisperModel}" was not found in the whisper folder.` });
  const f = path.join(os.tmpdir(), `island-${Date.now()}.wav`);
  fs.writeFileSync(f, Buffer.from(wav));
  execFile(exe, ['-m', model, '-f', f, '-l', s.whisperLang, '-nt', '-np'], { windowsHide: true, timeout: 90000 }, (err, out) => {
    fs.unlink(f, () => {});
    res(err ? { ok: false, text: 'Whisper failed: ' + err.message } : { ok: true, text: out.trim() });
  });
}));

/* ---------- Vision: screenshot + question to a vision model in Ollama ---------- */
// The model is told to give next steps, not to describe the screen (small vision models otherwise read out the clock, date and taskbar).
const VISION_RULES = 'You are a screen assistant. The image is the user\'s screen right now. Your job: tell the user what to do NEXT.\n' +
  'Rules:\n- Answer with at most 4 short numbered steps. Each step is one concrete action that names the exact button, field, menu or text as it appears on screen. Put the most important step first.\n' +
  '- Do not describe the screen or list what is visible.\n- Never mention the date, time, clock, battery, Wi-Fi icons, taskbar, wallpaper, window decorations or notifications, unless the question is about them.\n' +
  '- If the question is specific, answer it in one sentence first, then give the next steps.\n- If the screen shows an error, give the fix first.\n- If nothing needs doing, say so in one line.';
const visionPrompt = (q) => VISION_RULES + '\n\nUser question: ' + String(q || 'What should I do next?').slice(0, 1000);
async function grabScreenJpeg() {
  const d = screen.getPrimaryDisplay(), w = 1568, h = Math.round(w * d.size.height / d.size.width);
  {
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
    const src = srcs.find((x) => x.display_id === String(d.id)) || srcs[0];
    let th = src.thumbnail;
    try {   // crop away the Windows taskbar (clock, date, tray icons): only the work area is sent
      const b = d.bounds, a = d.workArea, k = th.getSize().width / b.width;
      if (a && (a.height < b.height || a.width < b.width)) th = th.crop({ x: Math.round((a.x - b.x) * k), y: Math.round((a.y - b.y) * k), width: Math.round(a.width * k), height: Math.round(a.height * k) });
    } catch {}
    return th.toJPEG(80).toString('base64');
  }
}
async function visionCall(q, img) {   // the selected provider reads the picture
  const s = db.settings;
  try {
    if (ai.provider() !== 'ollama') return await ai.vision(q, img);   // Claude / ChatGPT
    const r = await fetch(s.ollamaUrl.replace(/\/$/, '') + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.visionModel, stream: false, options: { temperature: 0.2 }, messages: [{ role: 'user', content: q, images: [img] }] })
    });
    if (r.status === 404) return { ok: false, text: `Vision model "${s.visionModel}" isn't installed. Run: ollama pull ${s.visionModel}` };
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { ok: true, text: (await r.json()).message.content };
  } catch (e) { return { ok: false, text: 'Screen question failed: ' + e.message }; }
}
ipcMain.handle('vision', async (_e, question) => {
  try { return await visionCall(visionPrompt(question), await grabScreenJpeg()); }
  catch (e) { return { ok: false, text: 'Screen question failed: ' + e.message }; }
});

// Chat runs in the main process so Ollama's CORS rules never matter.
const chatOnce = async (messages, opts) => {
  if (ai.provider() !== 'ollama') return ai.chat(messages, opts);   // Claude / ChatGPT
  const s = db.settings, model = s.model || 'llama3.2:1b';
  const body = { model, stream: false, messages: [...(s.systemPrompt ? [{ role: 'system', content: s.systemPrompt }] : []), ...messages] };
  if (opts && opts.numCtx) body.options = { num_ctx: opts.numCtx, ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) };   // long texts need a bigger window than Ollama's default
  try {
    const r = await fetch(s.ollamaUrl.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 404) return { ok: false, text: `Model "${model}" isn't installed. Run: ollama pull ${model}` };
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { ok: true, text: (await r.json()).message.content };
  } catch (e) {
    return { ok: false, text: `Can't reach Ollama at ${s.ollamaUrl}. Start it with "ollama serve". (${e.message})` };
  }
};
ipcMain.handle('chat', (_e, messages) => chatOnce(messages));


/* ---------- Quick Capture: one sentence becomes a task (or an idea, or an expense) ---------- */
const aiAssistOn = () => { const mode = db.settings.aiAssist || 'cloud'; return mode !== 'off' && (ai.provider() !== 'ollama' || mode === 'always'); };
async function refineWithAi(id, raw, rules) {   // runs after the task is already saved, so capture never waits for the network
  try {
    const r = await Promise.race([chatOnce(planner.aiMessages(raw, new Date())), new Promise((res) => setTimeout(() => res(null), 20000))]);
    if (!r || !r.ok) return;
    const mg = planner.mergeAi(rules, planner.parseAiJson(r.text), new Date());
    const t = mg && db.tasks.find((x) => x.id === id);
    if (!t || t.done || t.text !== rules.text) return;   // finished or edited in the meantime
    t.text = mg.text; t.cat = mg.cat; t.pri = mg.pri; t.repeat = mg.repeat; t.date = mg.date; if (!t.notified) t.due = mg.due;
    save();
  } catch {}
}
async function captureAdd(text) {
  const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!raw) return { ok: false, text: 'Type something first.' };
  const now = Date.now(), p = planner.parseCapture(raw, new Date(now));
  if (p.kind === 'idea') { db.journal = [planner.sanitizeEntry({ t: now, text: p.text, kind: 'idea' }), ...db.journal].slice(0, 2000); save(); return { ok: true, kind: 'idea', text: 'Idea saved to your Journal' }; }
  if (p.kind === 'expense') { const x = planner.sanitizeExpense({ t: now, amount: p.amount, cat: p.cat, note: p.text }); db.expenses = [x, ...db.expenses].slice(0, 5000); save(); return { ok: true, kind: 'expense', text: 'Expense saved: ' + (db.settings.currency || '₹') + x.amount + ' · ' + x.cat }; }
  const task = planner.makeTask(p, now); db.tasks = [task, ...db.tasks]; save();
  if (aiAssistOn()) refineWithAi(task.id, raw, p);
  return { ok: true, kind: 'task', task, text: 'Added to your planner' };
}
ipcMain.handle('capture:add', (e, text) => (trusted(e) ? captureAdd(text) : { ok: false, text: 'Blocked.' }));


/* ---------- usage tracking: screen time, idle time, time per app ---------- */
const today = () => new Date().toLocaleDateString('en-CA');
function usage() { const d = today(); if (!db.usage || db.usage.date !== d) db.usage = { date: d, screen: 0, idle: 0, apps: {} }; return db.usage; }
let lastIdle = 0, ticks = 0;
function startTracking() {
  setInterval(async () => {
    const r = (await ps('fg')).split('|');
    if (r.length < 2) return;
    const idle = +r[0] || 0, name = r[1], u = usage(); lastIdle = idle;
    if (name && !/^(electron|Dynamic Island)$/i.test(name)) lastExternal = { name, hwnd: +r[2] || 0 };   // the app the user was in before the island (for "selected text")
    if (idle < 60) { u.screen += 5; if (name && !/^(electron|Dynamic Island)$/i.test(name)) u.apps[name] = (u.apps[name] || 0) + 5; }
    else u.idle += 5;
    if (++ticks % 12 === 0) { try { fs.writeFileSync(dbFile, JSON.stringify(db)); } catch {} }
  }, 5000);
}
ipcMain.handle('usage:get', () => ({ ...usage(), idleNow: lastIdle }));

/* ---------- CPU, memory, storage ---------- */
let prevCpu = null;
function cpuPct() {
  const t = os.cpus().reduce((a, c) => { const x = c.times; a.idle += x.idle; a.total += x.user + x.nice + x.sys + x.idle + x.irq; return a; }, { idle: 0, total: 0 });
  let p = 0;
  if (prevCpu) { const di = t.idle - prevCpu.idle, dt = t.total - prevCpu.total; p = dt > 0 ? Math.round(100 * (1 - di / dt)) : 0; }
  prevCpu = t; return p;
}
function driveList() { const drives = []; for (const L of 'CDEFGH') { try { const s = fs.statfsSync(L + ':\\'); drives.push({ l: L, total: s.blocks * s.bsize, free: s.bavail * s.bsize }); } catch {} } return drives; }
ipcMain.handle('sys:stats', () => {
  const drives = driveList();
  return { cpu: cpuPct(), memTotal: os.totalmem(), memFree: os.freemem(), drives, uptime: os.uptime() };
});

/* ---------- network speed: live throughput + speed test ---------- */
const speedFetch = (u, o) => (net && typeof net.fetch === 'function' ? net.fetch(u, o) : fetch(u, o));   // Electron's net.fetch honours the system proxy
const speedSend = (ch, p) => { if (win && !win.isDestroyed()) win.webContents.send(ch, p); };
const tester = SP.createTester({ fetch: speedFetch, send: (p) => speedSend('speed:progress', p) });
let prevIO = null, lastNet = { name: '', type: '', link: 0 };
function localIp() { try { for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) return a.address; } catch {} return ''; }
ipcMain.handle('speed:live', async (e, reset) => {
  if (!trusted(e)) return null;
  if (reset) prevIO = null;
  const raw = jparse(await mainPS.run('netio', 8000), null);
  if (!raw || typeof raw.rx !== 'number') return { error: true };
  const cur = { t: Date.now(), rx: raw.rx, tx: raw.tx }, r = SP.rate(prevIO, cur); prevIO = cur;
  lastNet = { name: String(raw.name || ''), type: String(raw.type || ''), link: +raw.link || 0 };
  return { down: r.down, up: r.up, name: lastNet.name, type: lastNet.type, link: lastNet.link, ip: localIp() };
});
ipcMain.handle('speed:start', async (e) => {
  if (!trusted(e)) return { error: 'Blocked.' };
  const r = await tester.run();
  if (r && r.ok) {
    const label = (lastNet.type || 'Network') + (lastNet.name && lastNet.type !== lastNet.name ? ' · ' + lastNet.name : '');
    db.speedTests = SP.sanitizeTests([{ ...r.result, net: label }, ...(db.speedTests || [])]); save();
    r.result.net = label;
  }
  return r;
});
ipcMain.handle('speed:cancel', (e) => { if (trusted(e)) tester.cancel(); return true; });
ipcMain.handle('speed:clear', (e) => { if (!trusted(e)) return db; db.speedTests = []; save(); return db; });
ipcMain.handle('app:info', (e) => (trusted(e) ? { version: APP_VER, updatedFrom, packaged: !!app.isPackaged } : null));
ipcMain.handle('app:ack', (e) => { if (trusted(e)) updatedFrom = ''; return true; });

/* ---------- music, browser ---------- */
ipcMain.handle('media', (_e, action) => ps('media ' + String(action).replace(/[^a-z]/g, '')));
ipcMain.on('open-url', (_e, u) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); });
ipcMain.on('open-path', (e, p) => { if (trusted(e)) safeOpenPath(p); });

/* ---------- all-apps list + launcher, and file search (Windows Search index) ---------- */
let appIdx = null, appIdxT = 0, appIdxP = null;
async function walk(dir, out) {
  try { for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out); else if (/\.lnk$/i.test(e.name)) out.push({ name: e.name.replace(/\.lnk$/i, ''), path: p });
  } } catch {}
}
// Microsoft Store apps have no shortcut to take an icon from: the helper reads the logo each one declares in its manifest (slow, so once, in the background).
let logoCache = null, logoP = null;
function loadLogos() {
  if (!logoP) logoP = ps('applogos').then((t) => {
    try { const j = JSON.parse(t); if (j && typeof j === 'object' && !Array.isArray(j)) logoCache = j; } catch {}
    if (logoCache && appIdx) for (const a of appIdx) if (!a.logo && a.appId && /\.(png|jpe?g)$/i.test(String(logoCache[a.appId] || ''))) a.logo = logoCache[a.appId];
  }).catch(() => {});
  return logoP;
}
// Every installed app: Get-StartApps (desktop + Microsoft Store apps) merged with the Start Menu shortcuts.
async function buildAppIndex() {
  const lnks = [];
  await walk(path.join(process.env.ProgramData || '', 'Microsoft/Windows/Start Menu/Programs'), lnks);
  await walk(path.join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs'), lnks);
  let start = [], logos = {};
  try { const j = JSON.parse(await ps('allapps')); if (Array.isArray(j)) start = j; } catch {}
  await Promise.race([loadLogos(), new Promise((r) => setTimeout(r, 5000))]);   // never hold the list back more than 5 s for icons; late logos are patched in below
  logos = logoCache || {};
  const byName = new Map(lnks.map((l) => [l.name.toLowerCase(), l]));
  const seen = new Set(), out = [];
  const add = (name, appId, p, logo) => {
    const k = String(name || '').trim().toLowerCase();
    if (!k || seen.has(k) || /uninstall/.test(k)) return;
    seen.add(k); out.push({ id: 'a' + out.length, name: String(name).trim(), appId: appId || '', path: p || '', logo: typeof logo === 'string' && /\.(png|jpe?g)$/i.test(logo) ? logo : '' });
  };
  for (const s of start) add(s.name, s.id, (byName.get(String(s.name).toLowerCase()) || {}).path, logos[s.id]);
  for (const l of lnks) add(l.name, '', l.path);
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}
async function appIndex(force) {
  if (!force && appIdx && Date.now() - appIdxT < 300000) return appIdx;
  if (!appIdxP) appIdxP = buildAppIndex().then((r) => { appIdx = r; appIdxT = Date.now(); return r; }).finally(() => (appIdxP = null));
  return appIdxP;
}
// One icon per file, cached. 'large' (48 px) stays sharp when the page draws it at 24-36 px; Store apps give a .png logo instead of an .exe/.lnk.
async function iconFor(p) {
  if (!(p in icons)) {
    icons[p] = '';
    try {
      let img = /\.(png|jpe?g)$/i.test(p) ? nativeImage.createFromPath(p) : await app.getFileIcon(p, { size: 'large' });
      if (img && !img.isEmpty()) { const sz = img.getSize(); if (sz.width > 64) img = img.resize({ width: 48, height: 48, quality: 'best' }); icons[p] = img.toDataURL(); }
    } catch {}
  }
  return icons[p];
}
// All apps (or the ones matching q), A-Z. Icons are fetched lazily with apps:icons.
ipcMain.handle('apps:list', async (_e, q, force) => {
  q = String(q || '').trim().toLowerCase();
  let list = await appIndex(!!force);
  if (q) list = list.filter((a) => a.name.toLowerCase().includes(q))
    .sort((a, b) => (a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q)) || a.name.localeCompare(b.name));
  return list.slice(0, 1000).map((a) => ({ id: a.id, name: a.name, hasIcon: !!(a.path || a.logo) }));
});
ipcMain.handle('apps:icons', async (_e, ids) => {
  const out = {}, list = appIdx || [];
  await Promise.all((Array.isArray(ids) ? ids : []).slice(0, 60).map(async (id) => {
    const a = list.find((x) => x.id === id), src = a && (a.path || a.logo); if (src) { out[id] = await iconFor(src); if (!out[id] && a.logo && src !== a.logo) out[id] = await iconFor(a.logo); }
  }));
  return out;
});
// Launch by id: the id is looked up in our own index, so the renderer can never pass an arbitrary command.
ipcMain.handle('apps:launch', async (_e, id) => {
  const a = (appIdx || []).find((x) => x.id === id); if (!a) return false;
  if (a.path) { const err = await shell.openPath(a.path); if (!err) return true; }
  if (a.appId) { spawn('explorer.exe', ['shell:AppsFolder\\' + a.appId], { detached: true, stdio: 'ignore' }).unref(); return true; }
  return false;
});
ipcMain.handle('files:recent', async () => {
  try {
    const dir = path.join(process.env.APPDATA, 'Microsoft/Windows/Recent');
    const names = (await fs.promises.readdir(dir)).filter((n) => /\.lnk$/i.test(n));
    const st = await Promise.all(names.map(async (n) => ({ n, t: (await fs.promises.stat(path.join(dir, n))).mtimeMs })));
    const out = [];
    for (const x of st.sort((a, b) => b.t - a.t)) {
      try { const tg = shell.readShortcutLink(path.join(dir, x.n)).target; if (tg && fs.existsSync(tg) && !fs.statSync(tg).isDirectory()) out.push(tg); } catch {}
      if (out.length >= 15) break;
    }
    return out;
  } catch { return []; }
});
ipcMain.handle('files:search', async (_e, q) => { try { return JSON.parse(await ps('files ' + q)); } catch { return []; } });



/* ---------- messages: Outlook, Gmail, WhatsApp ---------- */
ipcMain.handle('mail:state', () => (mail ? mail.snapshot() : { status: {}, messages: [] }));
ipcMain.handle('mail:refresh', async () => { if (mail) await mail.pollAll(); return mail ? mail.snapshot() : null; });
ipcMain.on('mail:open', (_e, id, src) => mail && mail.open(String(id), ['outlook', 'gmail', 'whatsapp'].includes(src) ? src : ''));
ipcMain.on('mail:open-source', (_e, src) => mail && ['outlook', 'gmail', 'whatsapp'].includes(src) && mail.openSource(src));
ipcMain.handle('mail:setGmail', async (e, user, pass) => { if (!trusted(e)) return { ok: false, text: 'Blocked.' }; const r = await mail.setGmail(user, pass); if (r.ok) save(); return r; });
ipcMain.handle('mail:clearGmail', (e) => {
  if (!trusted(e)) return false;
  if (vault.status().locked) return false;   // the saved password could not be deleted while the vault is locked
  mail.clearGmail(); save(); return true;
});
ipcMain.on('wa:notify', (e, n) => mail && mail.onWANote(e.sender, n || {}));
ipcMain.on('mail:link-whatsapp', () => { if (mail && db.settings.mailWhatsApp) mail.ensureWA(true); });

/* ---------- reminders: expand the island with a sound when a task or a timed calendar event is due ---------- */
let unlockFlag = false, onlineNow = false, lastProbe = 0;
function condMet(c) {   // smart reminders: wait for a condition as well as (or instead of) a time
  if (c === 'charging') { try { return typeof powerMonitor.isOnBatteryPower === 'function' && !powerMonitor.isOnBatteryPower(); } catch { return false; } }
  if (c === 'online') return onlineNow;
  if (c === 'unlock') return unlockFlag;
  return true;
}
function startReminders() {
  setInterval(() => {
    const now = Date.now(); let changed = false;
    if (db.tasks.some((t) => !t.done && !t.notified && t.cond === 'online' && (!t.due || t.due <= now)) && now - lastProbe > 20000) { lastProbe = now; probeOnline().then((v) => { onlineNow = !!v; }); }
    for (const t of db.tasks) {   // same objects, so setting notified sticks (calendar events are handled by wellmain.js)
      const cond = t.cond && t.cond !== 'none' ? t.cond : null;
      const due = cond ? !t.due || t.due <= now : t.due && t.due <= now;
      if (!t.done && !t.notified && due && (!cond || condMet(cond))) {
        t.notified = true; changed = true;
        const text = String(t.text || t.title || 'Reminder');
        if (win) win.webContents.send('reminder', { id: t.id, text, kind: t.title ? 'event' : 'task' });
        try { new Notification({ title: t.title ? 'Event' : 'Reminder', body: text, silent: true }).show(); } catch {}
      }
    }
    unlockFlag = false;   // an unlock only counts for the tick right after it
    if (changed) save();
  }, 5000);
}


/* ---------- capture: photos, video, voice notes, screenshots ---------- */
const saved = new Set();   // files saved this session; only these can be revealed from the island
function capDir(kind) {
  const base = db.settings.captureFolder && db.settings.captureFolder.trim();
  const sub = { photo: 'Photos', video: 'Videos', audio: 'Voice notes', screenshot: 'Screenshots' }[kind];
  const dir = base ? path.join(base, sub) : path.join(app.getPath({ photo: 'pictures', screenshot: 'pictures', video: 'videos', audio: 'music' }[kind]), 'Dynamic Island', kind === 'screenshot' ? 'Screenshots' : kind === 'photo' ? '' : kind === 'video' ? '' : 'Voice notes');
  fs.mkdirSync(dir, { recursive: true }); return dir;
}
async function saveCapture(kind, ext, buf) {
  const stamp = new Date().toLocaleString('sv').replace(/[: ]/g, (c) => (c === ' ' ? '_' : '-'));
  const label = { photo: 'Photo', video: 'Video', audio: 'Voice', screenshot: 'Screenshot' }[kind];
  const file = path.join(capDir(kind), `${label}_${stamp}.${ext}`);
  await fs.promises.writeFile(file, buf); saved.add(file); return file;
}
const CAP_EXT = { photo: ['jpg', 'png'], video: ['webm', 'mp4'], audio: ['webm', 'ogg', 'wav'] };
ipcMain.handle('media:save', async (_e, kind, ext, data) => {
  try {
    if (!CAP_EXT[kind] || !CAP_EXT[kind].includes(ext)) throw new Error('unsupported type');
    return { ok: true, path: await saveCapture(kind, ext, Buffer.from(data)) };
  } catch (e) { return { ok: false, text: 'Could not save: ' + e.message }; }
});
// Screenshot options: mode 'hidden' = the island window is hidden for the shot (nothing of it is visible);
// 'collapsed' = the island shrinks to its small pill and the pill is included in the picture. delay = 0-10 s.
function shotPlan(o) {
  o = o || {};
  const mode = o.mode === 'collapsed' ? 'collapsed' : 'hidden';
  let delay = Math.round(Number(o.delay)); if (!Number.isFinite(delay)) delay = 0;
  return { mode, delay: Math.max(0, Math.min(10, delay)) };
}
let shotBusy = false;
ipcMain.handle('capture:screen', async (e, opts) => {
  if (!trusted(e)) return { ok: false, text: 'Blocked' };
  if (shotBusy) return { ok: false, text: 'A screenshot is already in progress' };
  shotBusy = true;
  const plan = shotPlan(opts || { mode: db.settings.shotMode, delay: db.settings.shotDelay });
  const alive = () => win && !win.isDestroyed();
  try {
    if (alive()) { if (plan.mode === 'hidden') win.hide(); else win.setContentProtection(false); }
    await new Promise((r) => setTimeout(r, plan.delay * 1000 + 450));   // 450 ms: the island finishes collapsing / the window is gone
    const d = screen.getPrimaryDisplay(), f = d.scaleFactor || 1;
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * f), height: Math.round(d.size.height * f) } });
    const src = srcs.find((x) => x.display_id === String(d.id)) || srcs[0];
    if (!src) throw new Error('no screen found');
    return { ok: true, path: await saveCapture('screenshot', 'png', src.thumbnail.toPNG()), mode: plan.mode };
  } catch (err) { return { ok: false, text: 'Screenshot failed: ' + err.message }; }
  finally {
    shotBusy = false;
    if (alive()) { win.setContentProtection(true); if (plan.mode === 'hidden' && !fsHidden && !userHidden) win.showInactive(); }
  }
});
ipcMain.on('file:show', (_e, p) => { if (saved.has(p)) shell.showItemInFolder(p); });

/* ---------- photos ---------- */
const IMG = /\.(jpe?g|png|gif|webp|bmp)$/i, thumbs = {};
let photoCache = { t: 0, list: null };
async function scanImages(dir, depth, out) {
  try {
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (out.length > 600) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0 && !e.name.startsWith('.')) await scanImages(p, depth - 1, out); }
      else if (IMG.test(e.name)) out.push({ p, t: (await fs.promises.stat(p)).mtimeMs });
    }
  } catch {}
}
async function thumbFor(p) {
  if (thumbs[p]) return thumbs[p];
  try {
    const i = await nativeImage.createThumbnailFromPath(p, { width: 200, height: 200 });
    return (thumbs[p] = 'data:image/jpeg;base64,' + i.toJPEG(75).toString('base64'));
  } catch {
    try { return (thumbs[p] = 'data:image/jpeg;base64,' + nativeImage.createFromPath(p).resize({ width: 200 }).toJPEG(75).toString('base64')); }
    catch { return ''; }
  }
}
ipcMain.handle('photos:list', async () => {
  if (photoCache.list && Date.now() - photoCache.t < 60000) return photoCache.list;
  const out = []; await scanImages(db.settings.photoFolder || app.getPath('pictures'), 2, out);
  out.sort((a, b) => b.t - a.t);
  const list = await Promise.all(out.slice(0, 40).map(async (x) => ({ path: x.p, thumb: await thumbFor(x.p) })));
  photoCache = { t: Date.now(), list }; return list;
});
ipcMain.handle('photo:full', (_e, p) => {
  try { let i = nativeImage.createFromPath(p); if (i.getSize().width > 900) i = i.resize({ width: 900 }); return 'data:image/jpeg;base64,' + i.toJPEG(85).toString('base64'); }
  catch { return ''; }
});

/* ---------- weather (Open-Meteo, no key) and news (RSS) ---------- */
const jget = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
let wxCache = null;
ipcMain.handle('location:detect', async () => {
  try {
    const g = await jget('https://ipwho.is/');
    if (g.success === false || !g.city) throw new Error('not found');
    return { ok: true, city: g.city, region: g.region || '', country: g.country || '' };
  } catch (e) { return { ok: false, text: 'Could not detect your location (' + e.message + '). Type a city instead.' }; }
});
ipcMain.handle('weather', async (_e, force) => {
  const s = db.settings, key = [s.weatherCity, s.units].join('|');
  if (!force && wxCache && wxCache.key === key && Date.now() - wxCache.t < 900000) return wxCache.data;
  try {
    let lat, lon, name;
    if (s.weatherCity) {
      const g = (await jget('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(s.weatherCity))).results;
      if (!g || !g[0]) throw new Error('City not found: ' + s.weatherCity);
      ({ latitude: lat, longitude: lon, name } = g[0]);
    } else {
      const g = await jget('https://ipwho.is/');
      if (g.success === false) throw new Error('Could not detect your location. Set a city in Settings.');
      lat = g.latitude; lon = g.longitude; name = g.city;
    }
    const f = s.units === 'f' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
    const w = await jget(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5${f}`);
    const data = { ok: true, name, unit: s.units === 'f' ? '°F' : '°C', current: w.current, daily: w.daily };
    wxCache = { key, t: Date.now(), data }; return data;
  } catch (e) { return { ok: false, text: 'Weather unavailable: ' + e.message }; }
});
const dec = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").trim();
let newsCache = null;
ipcMain.handle('news', async (_e, force) => {
  const url = db.settings.newsFeed || DEFAULTS.newsFeed;
  if (!force && newsCache && newsCache.url === url && Date.now() - newsCache.t < 600000) return newsCache.data;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 DynamicIsland' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await r.text();
    const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, 20).map((m) => {
      const g = (t) => { const x = m[0].match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return x ? dec(x[1]) : ''; };
      return { title: g('title'), link: g('link'), date: g('pubDate') };
    }).filter((i) => i.title && /^https?:/.test(i.link));
    if (!items.length) throw new Error('no headlines found (the feed must be RSS 2.0)');
    const data = { ok: true, items }; newsCache = { url, t: Date.now(), data }; return data;
  } catch (e) { return { ok: false, text: 'Could not load news: ' + e.message }; }
});

/* ---------- smart assistant ---------- */
async function launchAppById(id) {
  const a = (appIdx || []).find((x) => x.id === id); if (!a) return false;
  if (a.path) { const err = await shell.openPath(a.path); if (!err) return true; }
  if (a.appId) { spawn('explorer.exe', ['shell:AppsFolder\\' + a.appId], { detached: true, stdio: 'ignore' }).unref(); return true; }
  return false;
}
const NOPE = { ok: false, reply: 'Blocked.' };
ipcMain.handle('assist:ask', async (e, text, extra) => (trusted(e) ? assistant.ask(text, extra && typeof extra === 'object' ? extra : {}) : NOPE));
ipcMain.handle('assist:act', async (e, id) => (trusted(e) ? assistant.act(id) : NOPE));
ipcMain.handle('assist:brief', (e) => (trusted(e) ? assistant.brief() : null));
ipcMain.handle('assist:suggest', async (e, extra) => (trusted(e) ? assistant.suggestions(extra && typeof extra === 'object' ? extra : {}) : []));
ipcMain.handle('assist:meeting-finish', async (e, p) => (trusted(e) ? assistant.meetingFinish(p || {}) : { ok: false, text: 'Blocked.' }));
ipcMain.handle('assist:meeting-save', (e, d) => (trusted(e) ? assistant.meetingSave(d) : null));
ipcMain.handle('assist:meeting-tasks', async (e, id, idx) => (trusted(e) ? assistant.meetingTasks(id, idx) : { ok: false, text: 'Blocked.' }));
ipcMain.handle('assist:meeting-export', async (e, id) => {
  if (!trusted(e)) return { ok: false, text: 'Blocked.' };
  const m = (db.meetings || []).find((x) => x.id === String(id)); if (!m) return { ok: false, text: 'Meeting not found.' };
  const r = await dialog.showSaveDialog({ defaultPath: m.title.replace(/[^\w .-]/g, '').trim().slice(0, 50) + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (r.canceled || !r.filePath) return { ok: false, text: 'Cancelled.' };
  fs.writeFileSync(r.filePath, assistantLib.meetingMarkdown(m)); return { ok: true, text: 'Saved.' };
});
ipcMain.handle('assist:remember', (e, text) => (trusted(e) ? assistant.addMemory(String(text || '')) : { ok: false, text: 'Blocked.' }));
ipcMain.on('assist:copy', (e, text) => { if (trusted(e) && typeof text === 'string') clipboard.writeText(text.slice(0, 60000)); });

module.exports = { checkOpenPath, shotPlan };
