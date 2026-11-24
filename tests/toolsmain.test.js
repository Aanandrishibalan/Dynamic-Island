const fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, m + (s ? '' : '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL_PLATFORM = process.platform;
const setPlatform = (p) => Object.defineProperty(process, 'platform', { value: p });
const RISKY = /\.(exe|com|bat|cmd|ps1|vbs|js|msi|scr|lnk|dll|url)$/i;

function fakeImage(w, h, empty) {
  const o = { isEmpty: () => !!empty, getSize: () => ({ width: w, height: h }), resize: (r) => fakeImage(r.width, Math.round(h * r.width / w)), toPNG: () => Buffer.from('PNG' + w + 'x' + h), toJPEG: () => Buffer.from('JPG'), crop: (r) => fakeImage(r.width, r.height) };
  return o;
}
function harness(platform, over) {
  setPlatform(platform);
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-')), handlers = {}, ons = {}, sent = [], log = [], psLog = [];
  const clip = { text: '', image: fakeImage(0, 0, true) };
  const db = { settings: { clipEnabled: true, clipPaused: false, clipMax: 100, clipDays: 7, dateFormat: 'ymd', clock24: true, expanderOn: false, ocrLang: 'auto', ocrCopy: true, fxOnline: true, receiveFolder: '', captureFolder: '' }, snippets: [], folders: [], favApps: [], layouts: [], calcHistory: [] };
  const psReplies = { clipexcl: '0', winbatch: '{"ok":1,"fail":0}', sendpaste: 'ok', typetext: 'ok', sendleft: 'ok', ping: 'pong' };
  const tps = { run: async (cmd) => { psLog.push(cmd); const k = cmd.split(' ')[0]; const r = (over && over.ps && over.ps(cmd)) ?? psReplies[k]; return r === undefined ? 'ERR' : r; }, kill() {} };
  const wins = [{ isDestroyed: () => false, webContents: { send: (c, p) => sent.push([c, p]) }, isFocused: () => false, focus() {} }];
  const procs = [];
  const electron = {
    app: { getPath: (k) => (k === 'userData' ? ud : (['documents', 'desktop', 'downloads', 'pictures'].includes(k) ? 'C:\\Users\\test\\' + k : path.join(ud, k))) },
    ipcMain: { handle: (c, fn) => { handlers[c] = fn; }, on: (c, fn) => { ons[c] = fn; } },
    clipboard: { readText: () => clip.text, writeText: (t) => { clip.text = t; }, readImage: () => clip.image, writeImage: (i) => { clip.image = i; clip.wroteImage = true; } },
    dialog: { showOpenDialog: async () => (over && over.dialog ? over.dialog() : { canceled: true, filePaths: [] }) },
    shell: { openPath: async (p) => { (over && over.opened || []).push(p); return ''; } },
    nativeImage: { createFromPath: () => fakeImage(10, 10, false), createFromBuffer: (b) => fakeImage(5, 5, b.length < 4) },
    desktopCapturer: {}, screen: {}, BrowserWindow: function () {}, Notification: function () {}
  };
  const shown = [];
  const ctx = {
    electron, getDb: () => db, save() { ctx.saves = (ctx.saves || 0) + 1; }, trusted: (e) => !!(e && e.ok), getWin: () => wins[0], getSettingsWin: () => null,
    harden() {}, WEBPREFS: {}, risky: RISKY, saved: new Set(), makeHelper: () => tps, spawn: (...a) => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stdout.setEncoding = () => {}; p.stderr = new EventEmitter(); p.stderr.setEncoding = () => {}; p.stdin = { sent: [], write(s) { this.sent.push(s.trim()); }, on() {} }; p.kill = () => { p.killed = true; }; p.args = a; procs.push(p); return p; },
    psExe: 'powershell.exe', log: (m) => log.push(m), scriptPath: (n) => path.join(__dirname, '..', 'dynamic-island', n), appIndex: async () => (over && over.apps) || [], launchApp: async (id) => { (over && over.launched || []).push(id); return true; },
    setBlurGuard: (b) => shown.push('guard:' + b), collapseIsland: () => shown.push('collapse'), hideIsland: () => shown.push('hide'), showIslandInactive: () => shown.push('show'), openIsland: (v) => shown.push('open:' + v)
  };
  delete require.cache[require.resolve('../dynamic-island/toolsmain.js')];
  const tools = require('../dynamic-island/toolsmain.js')(ctx);
  tools.init();
  const good = { ok: true }, bad = { ok: false };
  return { ud, handlers, ons, sent, log, psLog, clip, db, tools, ctx, good, bad, shown, procs, wins, psReplies };
}
const cleanup = (h) => { try { h.tools.shutdown(); } catch {} try { fs.rmSync(h.ud, { recursive: true, force: true }); } catch {} };

(async () => {
  /* ===================== Linux-mode instance: real files ===================== */
  let H = harness('linux'); const { good, bad } = H; const hd = new Proxy({}, { get: (_t, k) => H.handlers[k] });   // always the current instance's handlers
  ok(H.db.folders.length === 4 && H.db.folders.every((x) => x.path) && H.db.snippets.some((s) => s.trigger === ';date') && H.db.settings.foldersSeeded && H.db.settings.snippetsSeeded, 'first run seeds example folders and snippets');
  const nF = H.db.folders.length; cleanup(H); H = harness('linux'); H.db.settings.foldersSeeded = true; H.db.folders = []; H.tools.init(); ok(H.db.folders.length === 0, 'seeding happens once, not again after the user deletes everything');
  cleanup(H); H = harness('linux');

  // ---- clipboard history ----
  const copy = async (t) => { H.clip.text = t; await H.tools._test.pollClip(); };
  await copy('+91 98765 43210'); await copy('INV-2026-0042'); await copy('INV-2026-0042'); await copy('No. 12, Gandhi Road, Anna Nagar, Chennai 600040');
  let L = await hd['clip:list'](good, '', 'all'); eq(L.items.map((i) => i.type), ['address', 'invoice', 'phone'], 'copied items recorded newest first, classified, duplicates merged');
  L = await hd['clip:list'](good, 'invoice', 'all'); eq(L.items.length, 1, 'search'); L = await hd['clip:list'](good, '', 'phone'); eq(L.items.length, 1, 'type filter');
  ok((await hd['clip:list'](bad, '', 'all')).items.length === 0, 'untrusted pages cannot read the clipboard history');
  await copy('   '); await copy(''); ok(H.tools._test.clips.length === 3, 'blank copies are ignored');
  H.db.settings.clipPaused = true; await copy('secret while paused'); ok(!H.tools._test.clips.some((c) => c.text.includes('paused')), 'paused: nothing is recorded'); H.db.settings.clipPaused = false;
  H.db.settings.clipEnabled = false; await copy('disabled copy'); ok(!H.tools._test.clips.some((c) => c.text === 'disabled copy'), 'switched off: nothing is recorded'); H.db.settings.clipEnabled = true;
  await copy('x'.repeat(20001)); ok(!H.tools._test.clips.some((c) => c.text.length > 20000), 'oversized copy ignored');
  const phone = (await hd['clip:list'](good, '', 'phone')).items[0];
  ok(await hd['clip:pin'](good, phone.id, true) && await hd['clip:label'](good, phone.id, 'My number'), 'save + label an item');
  L = await hd['clip:list'](good, 'my number', 'saved'); eq(L.items.map((i) => i.label), ['My number'], 'saved items found by label'); eq(L.saved, 1, 'saved count');
  ok(await hd['clip:copy'](good, phone.id) && H.clip.text === '+91 98765 43210', 'copy puts the full text back on the clipboard'); await H.tools._test.pollClip();
  ok((await hd['clip:list'](good, '', 'all')).items[0].id === phone.id, 'using an item moves it to the top');
  eq(await hd['clip:full'](good, phone.id), '+91 98765 43210', 'full text'); eq(await hd['clip:full'](bad, phone.id), '', 'full text refused for untrusted');
  const r1 = await hd['clip:add'](good, 'Bank a/c 1234', 'Bank'); ok(r1.ok, 'manual save'); ok((await hd['clip:add'](good, '  ', '')).ok === false, 'blank manual save refused');
  await hd['clip:clear'](good, true); L = await hd['clip:list'](good, '', 'all'); ok(L.items.length === 2 && L.items.every((i) => i.pinned), 'clear keeps saved items'); await hd['clip:clear'](good, false); eq((await hd['clip:list'](good, '', 'all')).total, 0, 'clear all');
  await copy('keep me'); const kid = (await hd['clip:list'](good, 'keep', 'all')).items[0].id; ok(await hd['clip:delete'](good, kid) && !(await hd['clip:delete'](good, kid)), 'delete one');
  // persistence + retention
  await copy('persist me'); await hd['clip:pin'](good, (await hd['clip:list'](good, 'persist', 'all')).items[0].id, true); H.tools.shutdown();
  ok(fs.existsSync(path.join(H.ud, 'clips.json')), 'history is stored in clips.json (not in data.json)');
  const old = JSON.parse(fs.readFileSync(path.join(H.ud, 'clips.json'), 'utf8')); old.items.push({ id: 'o1', t: 1, text: 'ancient', type: 'text', pinned: false }, { id: 'o2', t: 1, text: 'ancient saved', type: 'text', pinned: true }); fs.writeFileSync(path.join(H.ud, 'clips.json'), JSON.stringify(old));
  const ud1 = H.ud, H2 = harness('linux'); fs.copyFileSync(path.join(ud1, 'clips.json'), path.join(H2.ud, 'clips.json')); H2.tools.init();
  const texts = H2.tools._test.clips.map((c) => c.text); ok(texts.includes('persist me') && texts.includes('ancient saved') && !texts.includes('ancient'), 'reload: history comes back, old unpinned items are purged by retention, saved ones stay');
  fs.writeFileSync(path.join(H2.ud, 'clips.json'), '{not json'); H2.tools.init(); ok(H2.tools._test.clips.length === 0, 'corrupt history file does not crash'); cleanup(H2);
  H.clip.text = 'first'; await H.tools._test.pollClip();
  // text the island puts on the clipboard itself is not re-recorded (checked via insert on win32 below)

  // ---- batch rename on real files ----
  const dir = path.join(H.ud, 'pics'); fs.mkdirSync(dir);
  const mk = (n, c) => { fs.writeFileSync(path.join(dir, n), c || n); return path.join(dir, n); };
  const A = mk('IMG 1.jpg'), B = mk('IMG 2.jpg'), C = mk('IMG 3.jpg');
  const rules = { find: 'IMG ', replace: 'Holiday_' };
  let pl = await hd['rename:plan'](good, [A, B, C], rules); ok(pl.canApply && pl.ok === 3 && pl.items[0].newName === 'Holiday_1.jpg', 'plan for real files');
  ok((await hd['rename:plan'](bad, [A], rules)).items.length === 0, 'untrusted cannot plan');
  pl = await hd['rename:plan'](good, [A, path.join(dir, 'ghost.jpg'), dir, 'relative.txt', 42, null], rules); eq(pl.items.length, 1, 'missing files, folders, relative paths and junk are ignored');
  let res = await hd['rename:apply'](good, [A, B, C], rules); ok(res.ok && res.renamed === 3 && fs.existsSync(path.join(dir, 'Holiday_1.jpg')) && !fs.existsSync(A) && fs.readFileSync(path.join(dir, 'Holiday_2.jpg'), 'utf8') === 'IMG 2.jpg', 'rename applied, contents intact');
  ok(!fs.readdirSync(dir).some((n) => n.startsWith('.di-tmp')), 'no temporary names left behind');
  let u = await hd['rename:undoInfo'](good); eq(u.count, 3, 'undo available'); res = await hd['rename:undo'](good); ok(res.ok && fs.existsSync(A) && fs.existsSync(B) && fs.existsSync(C) && !fs.existsSync(path.join(dir, 'Holiday_1.jpg')), 'undo restores the original names'); eq(await hd['rename:undoInfo'](good), null, 'undo is single-use');
  // clashes
  const D = mk('taken.txt'), E2 = mk('other.txt');
  res = await hd['rename:apply'](good, [E2], { base: 'custom', custom: 'taken' }); ok(!res.ok && fs.existsSync(E2) && fs.readFileSync(D, 'utf8') === 'taken.txt', 'refuses to overwrite an existing file; nothing touched');
  res = await hd['rename:apply'](good, [A, B], { base: 'custom', custom: 'same' }); ok(!res.ok && fs.existsSync(A) && fs.existsSync(B), 'two files to one name: nothing renamed');
  res = await hd['rename:apply'](good, [A], { find: 'zzz', replace: 'y' }); ok(!res.ok, 'nothing to change = not applied');
  res = await hd['rename:apply'](bad, [A], rules); ok(!res.ok && fs.existsSync(A), 'untrusted cannot rename');
  // swap + chain through temp names, and rollback on failure
  const S1 = mk('s1.txt', 'one'), S2 = mk('s2.txt', 'two');
  res = H.tools._test.renamePairs([{ from: S1, to: S2 }, { from: S2, to: S1 }]); ok(res.ok && fs.readFileSync(S1, 'utf8') === 'two' && fs.readFileSync(S2, 'utf8') === 'one', 'swap two names works via temporary names');
  const X1 = mk('x1.txt', 'x1'), X2 = mk('x2.txt', 'x2'), BLOCK = mk('blocker.txt', 'b');
  res = H.tools._test.renamePairs([{ from: X1, to: path.join(dir, 'new1.txt') }, { from: X2, to: BLOCK }]); ok(!res.ok && fs.readFileSync(X1, 'utf8') === 'x1' && fs.readFileSync(X2, 'utf8') === 'x2' && fs.readFileSync(BLOCK, 'utf8') === 'b' && !fs.existsSync(path.join(dir, 'new1.txt')) && !fs.readdirSync(dir).some((n) => n.startsWith('.di-tmp')), 'a failure half-way rolls everything back');
  // undo safety
  const U1 = mk('u1.txt', 'u'); await hd['rename:apply'](good, [U1], { prefix: 'new_' }); fs.renameSync(path.join(dir, 'new_u1.txt'), path.join(dir, 'moved.txt'));
  res = await hd['rename:undo'](good); ok(!res.ok && /not safe/.test(res.text) && fs.existsSync(path.join(dir, 'moved.txt')), 'undo refuses when the file has changed since');
  // extension is never touched
  const EX = mk('doc.pdf'); res = await hd['rename:apply'](good, [EX], { base: 'custom', custom: 'evil.exe' }); ok(res.ok && fs.existsSync(path.join(dir, 'evil.exe.pdf')) && !fs.existsSync(path.join(dir, 'evil.exe')), 'cannot turn a document into a program');
  // picking
  H = (cleanup(H), harness('linux', { dialog: () => ({ canceled: false, filePaths: [] }) })); const dir2 = path.join(H.ud, 'p2'); fs.mkdirSync(dir2); ['b10.txt', 'b2.txt', 'a1.txt'].forEach((n) => fs.writeFileSync(path.join(dir2, n), 'x')); fs.mkdirSync(path.join(dir2, 'sub'));
  const H3 = harness('linux', { dialog: () => ({ canceled: false, filePaths: [dir2] }) });
  const pf = await H3.handlers['rename:pickFolder'](H3.good); eq(pf.map((x) => x.name), ['a1.txt', 'b2.txt', 'b10.txt'], 'folder pick: files only, natural order (b2 before b10)');
  ok(H3.shown.includes('guard:true') && H3.shown.includes('guard:false'), 'island is protected from collapsing while the dialog is open'); cleanup(H3);
  const H4 = harness('linux'); ok((await H4.handlers['rename:pick'](H4.good)).length === 0, 'cancelled dialog = empty list'); cleanup(H4);

  // ---- folders ----
  const opened = []; H = (cleanup(H), harness('linux', { opened, dialog: () => ({ canceled: false, filePaths: ['C:\\Users\\test\\Docs'] }) }));
  const fd = path.join(H.ud, 'myfolder'); fs.mkdirSync(fd); H.db.folders = [{ id: 'f1', name: 'Mine', path: fd }, { id: 'f2', name: 'Gone', path: path.join(H.ud, 'nope') }, { id: 'f3', name: 'File', path: path.join(fd, '..', 'clips.json') }];
  eq(await H.handlers['folder:open'](H.good, 'f1'), { ok: true }, 'open a folder'); eq(opened, [fd], 'Explorer asked to open exactly that folder');
  ok((await H.handlers['folder:open'](H.good, 'f2')).ok === false, 'missing folder reported, not thrown'); ok((await H.handlers['folder:open'](H.good, 'nope')) === false && (await H.handlers['folder:open'](H.bad, 'f1')) === false, 'unknown id / untrusted refused');
  fs.writeFileSync(path.join(H.ud, 'clips.json'), '{}'); ok((await H.handlers['folder:open'](H.good, 'f3')) === false, 'a file is not opened as a folder');
  ok(await H.handlers['folder:copy'](H.good, 'f1') && H.clip.text === fd, 'copy folder path');
  eq((await H.handlers['folder:pick'](H.good)).path, 'C:\\Users\\test\\Docs', 'pick a folder'); ok((await H.handlers['folder:pick'](H.bad)) === null, 'untrusted pick refused');

  // ---- favourite apps ----
  const launched = []; H = (cleanup(H), harness('linux', { launched, apps: [{ id: 'a1', name: 'Notepad', path: 'C:\\n.exe' }, { id: 'a2', name: 'Google Chrome', path: '' }] }));
  H.db.favApps = [{ name: 'notepad' }, { name: 'Missing App' }];
  eq(await H.handlers['fav:list'](H.good), [{ name: 'notepad', id: 'a1', hasIcon: true }, { name: 'Missing App', id: null, hasIcon: false }], 'favourites resolved by name (ids change between index rebuilds)');
  ok(await H.handlers['fav:launch'](H.good, 'GOOGLE CHROME') && launched[0] === 'a2', 'launch by name, case-insensitive'); ok(!(await H.handlers['fav:launch'](H.good, 'Missing App')) && !(await H.handlers['fav:launch'](H.bad, 'Notepad')), 'unknown app / untrusted: nothing launched');

  // ---- transfer through IPC ----
  const sdir = path.join(H.ud, 'share'); fs.mkdirSync(sdir); const sf = path.join(sdir, 'a.txt'); fs.writeFileSync(sf, 'hello');
  const H5 = harness('linux', { dialog: () => ({ canceled: false, filePaths: [sf, path.join(sdir, 'ghost.txt')] }) });
  let xs = await H5.handlers['xfer:pick'](H5.good); eq(xs.picked.map((p) => p.name), ['a.txt'], 'only real files can be picked for sharing');
  xs = await H5.handlers['xfer:pick'](H5.good); eq(xs.picked.length, 1, 'picking the same file twice does not duplicate');
  const st = await H5.handlers['xfer:start'](H5.good, { receive: true, minutes: 5 }); ok(st.ok && st.running && st.files.length === 1 && st.urls[0].startsWith('http://'), 'transfer starts with the picked files');
  ok(st.receiveDir === path.join('C:\\Users\\test\\downloads', 'Dynamic Island'), 'default receive folder is Downloads\\Dynamic Island');
  ok(await H5.handlers['xfer:copyLink'](H5.good, 0) && H5.clip.text === st.urls[0], 'link copied'); ok(H5.sent.some((s) => s[0] === 'xfer'), 'windows are told about transfer changes');
  const ST2 = await H5.handlers['xfer:start'](H5.bad, {}); ok(ST2.ok === false, 'untrusted cannot start sharing');
  const stopped = await H5.handlers['xfer:stop'](H5.good); ok(!stopped.running, 'stop'); cleanup(H5);
  H5.tools.shutdown();

  // ---- exchange rates (fetch is faked) ----
  const realFetch = global.fetch; let calls = 0, mode = 'ok';
  global.fetch = async () => { calls++; if (mode === 'down') throw new Error('network down'); if (mode === 'bad') return { ok: true, json: async () => ({ result: 'error' }) }; if (mode === 'junk') return { ok: true, json: async () => ({ result: 'success', rates: { USD: 1, INR: 84.5, EVIL: 'x', '$$$': 3, EUR: -2 } }) }; return { ok: true, json: async () => ({ result: 'success', rates: { USD: 1, INR: 84.5, EUR: 0.92 } }) }; };
  H = (cleanup(H), harness('linux'));
  let fx = await H.handlers['fx:rates'](H.good); ok(fx.ok && fx.rates.INR === 84.5 && !fx.stale && calls === 1, 'rates fetched'); fx = await H.handlers['fx:rates'](H.good); ok(fx.ok && calls === 1, 'second call uses the cache (no new request)');
  fx = await H.handlers['fx:rates'](H.good, true); ok(calls === 2, 'forced refresh asks again');
  mode = 'down'; const c = JSON.parse(fs.readFileSync(path.join(H.ud, 'fx.json'), 'utf8')); c.t -= 13 * 3600 * 1000; fs.writeFileSync(path.join(H.ud, 'fx.json'), JSON.stringify(c));
  fx = await H.handlers['fx:rates'](H.good); ok(fx.ok && fx.stale && /Offline/.test(fx.text) && fx.rates.INR === 84.5, 'offline: old rates are shown and labelled'); fs.unlinkSync(path.join(H.ud, 'fx.json'));
  fx = await H.handlers['fx:rates'](H.good); ok(!fx.ok && /Could not load/.test(fx.text), 'offline with no cache: clear message');
  mode = 'bad'; fx = await H.handlers['fx:rates'](H.good); ok(!fx.ok, 'error answer rejected'); mode = 'junk'; fx = await H.handlers['fx:rates'](H.good); ok(fx.ok && Object.keys(fx.rates).sort().join() === 'INR,USD', 'junk entries (bad codes, negatives, non-numbers) are dropped');
  H.db.settings.fxOnline = false; calls = 0; fs.unlinkSync(path.join(H.ud, 'fx.json')); fx = await H.handlers['fx:rates'](H.good); ok(!fx.ok && calls === 0, 'online rates switched off: no request is made'); ok((await H.handlers['fx:rates'](H.bad)).ok === false, 'untrusted refused');
  global.fetch = realFetch;

  // ---- QR ----
  const qm = await H.handlers['qr:make'](H.good, 'https://example.com'); ok(qm.ok && qm.rows.length === qm.size && /^[01]+$/.test(qm.rows[0]), 'qr matrix'); ok(!(await H.handlers['qr:make'](H.bad, 'x')).ok && !(await H.handlers['qr:make'](H.good, '')).ok, 'untrusted / empty refused');
  const png = 'data:image/png;base64,' + Buffer.from('PNGDATA').toString('base64');
  ok(await H.handlers['qr:copy'](H.good, png) && H.clip.wroteImage, 'qr image copied'); ok(!(await H.handlers['qr:copy'](H.good, 'data:text/html;base64,PHNjcmlwdD4=')) && !(await H.handlers['qr:copy'](H.good, 'javascript:alert(1)')) && !(await H.handlers['qr:copy'](H.bad, png)), 'only PNG data URLs, only from our pages');
  const sv = await H.handlers['qr:save'](H.good, png); ok(sv.ok && fs.readFileSync(sv.path).toString() === 'PNGDATA' && /QR codes/.test(sv.path) && H.ctx.saved.has(sv.path), 'qr saved and registered so the island may reveal it');
  ok(!(await H.handlers['qr:save'](H.good, 'data:image/png;base64,@@@')).ok && !(await H.handlers['qr:save'](H.bad, png)).ok, 'bad / untrusted save refused');

  // ---- every handler refuses untrusted callers ----
  const names = Object.keys(H.handlers); let leaked = [];
  for (const n of names) { try { const r = await H.handlers[n](bad, 'x', 'y'); const s = JSON.stringify(r === undefined ? null : r); if (r && r.ok === true) leaked.push(n); if (/"items":\[\{/.test(s)) leaked.push(n); } catch (e) { /* throwing is also a refusal */ } }
  eq(leaked, [], 'no handler does real work for an untrusted caller (' + names.length + ' handlers checked)');
  cleanup(H);

  /* ===================== Windows-mode instance: fake PowerShell ===================== */
  const MONS = [{ i: 0, x: 0, y: 0, w: 1920, h: 1040, primary: true }, { i: 1, x: 1920, y: 0, w: 1280, h: 984, primary: false }];
  const WINS = [
    { h: '101', title: 'Report - Word', proc: 'WINWORD', x: 100, y: 100, w: 800, hh: 600, mon: 0, max: false, min: false },
    { h: '102', title: 'Inbox - Outlook', proc: 'OUTLOOK', x: 300, y: 200, w: 900, hh: 700, mon: 0, max: false, min: false },
    { h: '103', title: 'Docs - Chrome', proc: 'chrome', x: 2000, y: 50, w: 1000, hh: 800, mon: 1, max: false, min: false },
    { h: '104', title: 'Old - Notepad', proc: 'notepad', x: -32000, y: -32000, w: 160, hh: 28, mon: 0, max: false, min: true },
    { h: '105', title: 'Sheet - Excel', proc: 'EXCEL', x: 50, y: 50, w: 700, hh: 500, mon: 0, max: false, min: false }
  ];
  const batches = []; let breakBatch = false;
  const ps = (cmd) => { if (breakBatch && cmd.startsWith('winbatch ')) return 'ERR boom'; if (cmd === 'winlist') return JSON.stringify({ mons: MONS, wins: WINS }); if (cmd.startsWith('winbatch ')) { const a = JSON.parse(cmd.slice(9)); batches.push(a); return JSON.stringify({ ok: a.length, fail: 0 }); } return undefined; };
  let W = harness('win32', { ps }); const wh = W.handlers;
  let wl = await wh['win:list'](W.good); ok(wl.ok && wl.wins.length === 5 && wl.mons.length === 2, 'window list'); ok(!(await wh['win:list'](W.bad)).ok, 'untrusted refused');
  let r = await wh['win:snap'](W.good, '101', 'left'); eq(batches.pop(), [{ h: '101', x: 0, y: 0, w: 960, hh: 1040, max: false }], 'snap left = left half of its own monitor');
  await wh['win:snap'](W.good, '103', 'right'); eq(batches.pop(), [{ h: '103', x: 2560, y: 0, w: 640, hh: 984, max: false }], 'snap right on the second monitor uses that monitor\'s work area');
  await wh['win:snap'](W.good, '101', 'max'); eq(batches.pop(), [{ h: '101', x: 0, y: 0, w: 0, hh: 0, max: true }], 'maximise');
  ok(!(await wh['win:snap'](W.good, '999', 'left')).ok && !(await wh['win:snap'](W.good, '101', 'diagonal')).ok && !(await wh['win:snap'](W.bad, '101', 'left')).ok, 'unknown window / unknown position / untrusted refused'); ok(batches.length === 0, '... and nothing was sent to Windows');
  r = await wh['win:layout'](W.good, 'side'); ok(r.ok && r.moved === 2, 'layout applied'); eq(batches.pop(), [{ h: '101', x: 0, y: 0, w: 960, hh: 1040, max: false }, { h: '102', x: 960, y: 0, w: 960, hh: 1040, max: false }], 'side by side: the two top windows on the first monitor (the other monitor and the minimised window are left alone)');
  await wh['win:layout'](W.good, 'grid'); const g = batches.pop(); eq(g.map((x) => x.h), ['101', '102', '105'], 'grid: only windows that exist (3 here, minimised one skipped)');
  ok(!(await wh['win:layout'](W.good, 'nope')).ok && !(await wh['win:layout'](W.bad, 'side')).ok, 'unknown layout / untrusted refused');
  ok(await wh['win:focus'](W.good, '101') && W.psLog.includes('winfocus 101') && !(await wh['win:focus'](W.good, '555')) && !(await wh['win:focus'](W.good, '1;calc')) && !(await wh['win:focus'](W.bad, '101')), 'focus: only handles from the last list, digits only');
  // save + apply
  r = await wh['win:save'](W.good, 'Work'); ok(r.ok && W.db.layouts.length === 1 && W.db.layouts[0].items.length === 4 && !W.db.layouts[0].items.some((i) => i.proc === 'notepad'), 'save layout (minimised windows are not saved)');
  const it = W.db.layouts[0].items.find((i) => i.proc === 'chrome'); ok(it.mon === 1 && Math.abs(it.x - 80 / 1280) < 1e-3 && Math.abs(it.w - 1000 / 1280) < 1e-3, 'saved as fractions of the monitor, with the monitor number');
  ok(!(await wh['win:save'](W.good, '   ')).ok, 'a name is required'); await wh['win:save'](W.good, 'work'); eq(W.db.layouts.length, 1, 'same name (any case) replaces the old layout');
  batches.length = 0; r = await wh['win:apply'](W.good, W.db.layouts[0].id); ok(r.ok && r.moved === 4, 'apply layout'); const ap = batches.pop(); const chromeMove = ap.find((x) => x.h === '103'); ok(chromeMove && chromeMove.x === 2000 && chromeMove.w === 1000, 'applied back to the same place');
  WINS.splice(2, 1); r = await wh['win:apply'](W.good, W.db.layouts[0].id); ok(r.ok && r.missing.includes('chrome') && /Not open: chrome/.test(r.text), 'apps that are not open are reported, the rest are arranged'); WINS.splice(2, 0, { h: '103', title: 'Docs - Chrome', proc: 'chrome', x: 2000, y: 50, w: 1000, hh: 800, mon: 1, max: false, min: false });
  ok(!(await wh['win:apply'](W.good, 'ghost')).ok && !(await wh['win:apply'](W.bad, W.db.layouts[0].id)).ok, 'unknown / untrusted apply refused');
  // fails gracefully when the helper is broken
  breakBatch = true; r = await wh['win:snap'](W.good, '101', 'left'); breakBatch = false; ok(!r.ok && /administrator/.test(r.text), 'helper failure becomes a friendly message');
  const Wbroken = harness('win32', { ps: () => 'ERR no' }); ok((await Wbroken.handlers['win:list'](Wbroken.good)).ok === false, 'broken helper: list fails cleanly'); cleanup(Wbroken);

  // ---- password managers are not recorded ----
  W.psReplies.clipexcl = '1'; W.clip.text = 'pm-secret-123'; await W.tools._test.pollClip(); ok(!W.tools._test.clips.some((c) => c.text === 'pm-secret-123'), 'copies marked "exclude from monitoring" (password managers) are never recorded');
  W.psReplies.clipexcl = '0'; W.clip.text = 'normal copy'; await W.tools._test.pollClip(); ok(W.tools._test.clips.some((c) => c.text === 'normal copy'), '... normal copies are');

  // ---- paste into the previous app ----
  W.shown.length = 0; W.psLog.length = 0; W.clip.text = 'hello from history'; await W.tools._test.pollClip();
  const it2 = (await wh['clip:list'](W.good, 'hello', 'all')).items[0]; r = await wh['clip:paste'](W.good, it2.id);
  ok(r.ok && W.shown.join() === 'collapse,hide,show' && W.psLog.includes('sendpaste'), 'paste: island steps aside, Ctrl+V is sent, island comes back');
  W.shown.length = 0; W.psLog.length = 0; W.clip.text = 'original clipboard'; await W.tools._test.pollClip();
  await W.tools._test.insertText('snippet body line1\nline2', { restore: true }); ok(W.clip.text === 'original clipboard' && W.psLog.includes('sendpaste'), 'multi-line insert pastes, then puts your clipboard back');
  W.psLog.length = 0; W.clip.text = 'keep'; await W.tools._test.pollClip(); await W.tools._test.insertText('short text', { type: true, restore: true, left: 3 }); ok(W.clip.text === 'keep' && W.psLog.some((c) => c.startsWith('typetext ')) && !W.psLog.includes('sendpaste') && W.psLog.includes('sendleft 3'), 'short single-line text is typed (clipboard untouched) and the caret moved back for {cursor}');
  ok(!W.tools._test.clips.some((c) => c.text === 'snippet body line1\nline2' || c.text === 'short text'), 'text the island puts on the clipboard is not recorded as a copy');
  W.psReplies.sendpaste = 'ERR x'; r = await W.tools._test.insertText('zzz', {}); ok(!r.ok && W.shown[W.shown.length - 1] === 'show', 'if Windows refuses the keys the island still comes back'); W.psReplies.sendpaste = 'ok';
  const lin = harness('linux'); r = await lin.tools._test.insertText('x', {}); ok(!r.ok && /Windows only/.test(r.text), 'not on Windows: clear message'); cleanup(lin);

  // snippets from the island
  W.db.snippets = [{ id: 's1', trigger: ';d', text: 'Date: {date}', label: '' }, { id: 's2', trigger: ';long', text: 'a\nb', label: '' }];
  W.psLog.length = 0; r = await wh['snip:insert'](W.good, 's1'); ok(r.ok && W.psLog.some((c) => c.includes('Date: ')) && /typetext/.test(W.psLog.join()), 'snippet typed with the date filled in');
  ok(await wh['snip:copy'](W.good, 's2') && W.clip.text === 'a\nb', 'copy a snippet'); ok(!(await wh['snip:insert'](W.good, 'ghost')).ok && !(await wh['snip:insert'](W.bad, 's1')).ok, 'unknown / untrusted refused');

  // ---- OCR ----
  W.psLog.length = 0; W.clip.image = fakeImage(300, 100, false); let ocrReply = JSON.stringify({ ok: true, text: 'Invoice 4521\nTotal 99.00', lang: 'en-US' });
  const W2 = harness('win32', { ps: (c) => (c.startsWith('ocr ') ? ocrReply : undefined) }); W2.clip.image = fakeImage(300, 100, false);
  r = await W2.handlers['ocr:clipboard'](W2.good); ok(r.ok && r.text === 'Invoice 4521\nTotal 99.00' && r.copied && W2.clip.text === r.text, 'clipboard picture -> text, copied to the clipboard');
  const cmd = W2.psLog.find((c) => c.startsWith('ocr ')); const arg = JSON.parse(cmd.slice(4)); ok(/di-ocr-.*\.png$/.test(arg.path) && arg.lang === 'auto' && !fs.existsSync(arg.path), 'image is passed as a temp PNG and deleted afterwards (not left in the temp folder)');
  ok(!/[^\x00-\x7f]/.test(cmd), 'helper command is pure ASCII');
  W2.db.settings.ocrCopy = false; W2.clip.text = 'before'; r = await W2.handlers['ocr:clipboard'](W2.good); ok(r.ok && W2.clip.text === 'before', 'auto-copy can be switched off'); W2.db.settings.ocrCopy = true;
  W2.clip.image = fakeImage(0, 0, true); r = await W2.handlers['ocr:clipboard'](W2.good); ok(!r.ok && /Win\+Shift\+S/.test(r.text), 'no picture on the clipboard: tells you how to take one');
  W2.clip.image = fakeImage(300, 100, false); ocrReply = JSON.stringify({ ok: false, text: 'No OCR language is installed.' }); r = await W2.handlers['ocr:clipboard'](W2.good); ok(!r.ok && /language/.test(r.text), 'OCR engine problems are passed on in plain words');
  ocrReply = JSON.stringify({ ok: true, text: '   ', lang: 'en' }); r = await W2.handlers['ocr:clipboard'](W2.good); ok(!r.ok && /No text found/.test(r.text), 'blank result = "No text found"');
  ocrReply = 'garbage'; r = await W2.handlers['ocr:clipboard'](W2.good); ok(!r.ok && /did not answer/.test(r.text), 'garbage from the helper does not crash');
  W2.db.settings.ocrLang = 'ta'; ocrReply = JSON.stringify({ ok: true, text: 'வணக்கம்', lang: 'ta' }); W2.psLog.length = 0; r = await W2.handlers['ocr:clipboard'](W2.good); ok(r.ok && JSON.parse(W2.psLog.find((c) => c.startsWith('ocr ')).slice(4)).lang === 'ta' && !/[^\x00-\x7f]/.test(W2.psLog.join()), 'chosen language is passed on; non-ASCII results (Tamil) survive');
  ok(!(await W2.handlers['ocr:clipboard'](W2.bad)).ok && !(await W2.handlers['ocr:snip'](W2.bad)).ok && !(await W2.handlers['ocr:file'](W2.bad)).ok, 'untrusted callers refused');
  const W3 = harness('win32', { dialog: () => ({ canceled: false, filePaths: [path.join(os.tmpdir(), 'x.png')] }), ps: (c) => (c.startsWith('ocr ') ? JSON.stringify({ ok: true, text: 'from file', lang: 'en' }) : undefined) }); r = await W3.handlers['ocr:file'](W3.good); ok(r.ok && r.text === 'from file', 'OCR from a picture file'); cleanup(W3);
  const W4 = harness('win32', { dialog: () => ({ canceled: true, filePaths: [] }) }); r = await W4.handlers['ocr:file'](W4.good); ok(r.cancelled, 'cancelled file dialog'); cleanup(W4);
  const lang = harness('win32', { ps: (c) => (c === 'ocrlangs' ? JSON.stringify({ ok: true, langs: [{ tag: 'en-US', name: 'English' }] }) : undefined) }); eq((await lang.handlers['ocr:langs'](lang.good)).langs.length, 1, 'OCR languages listed'); cleanup(lang);
  const lo = harness('linux'); lo.clip.image = fakeImage(100, 100, false); r = await lo.handlers['ocr:clipboard'](lo.good); ok(!r.ok && /Windows/.test(r.text), 'OCR off Windows: clear message'); cleanup(lo);
  cleanup(W2);

  // ---- text expander (fake keyboard helper) ----
  const E = harness('win32'); E.db.snippets = [{ id: 'a', trigger: ';date', text: '{date}', label: '' }, { id: 'b', trigger: ';sig', text: 'Regards,\nRavi', label: '' }, { id: 'c', trigger: ';ty', text: 'Thanks{cursor}!', label: '' }];
  E.tools.syncExpander(); ok(E.procs.length === 0, 'expander off by default: no keyboard helper is started');
  E.db.settings.expanderOn = true; E.tools.syncExpander(); ok(E.procs.length === 1 && E.procs[0].args[1].includes('-NonInteractive') && /expander\.ps1$/.test(E.procs[0].args[1][E.procs[0].args[1].length - 1]), 'switched on: helper started from expander.ps1');
  const P = E.procs[0]; const trig = JSON.parse(P.stdin.sent.find((s) => s.startsWith('triggers ')).slice(9)); eq(trig, [';date', ';sig', ';ty'], 'trigger list sent');
  P.stdin.sent.length = 0; E.tools.syncExpander(); ok(E.procs.length === 1 && P.stdin.sent[0].startsWith('triggers '), 'syncing again updates the list, no second helper');
  const feed = (l) => P.stdout.emit('data', l + '\n'); const reply = () => { const rp = (cmd) => { if (cmd) E.tools._test.expLine('done'); }; return rp; };
  P.stdin.sent.length = 0; feed('hit\t;date'); await sleep(30); let rep = P.stdin.sent.find((s) => s.startsWith('replace ')); ok(!!rep, 'a hit makes the helper replace the trigger'); let a = JSON.parse(rep.slice(8)); ok(a.back === 5 && a.mode === 'type' && /^\d{4}-\d{2}-\d{2}$/.test(a.text) && a.left === 0, 'delete 5 characters, type today\'s date'); ok(!/[^\x00-\x7f]/.test(rep), 'command is ASCII only');
  feed('hit\t;sig'); await sleep(20); ok(P.stdin.sent.filter((s) => s.startsWith('replace ')).length === 1, 'a second hit while one is in progress is ignored (no double typing)');
  E.tools._test.expLine('done'); await sleep(30);
  P.stdin.sent.length = 0; E.clip.text = 'MY CLIPBOARD'; feed('hit\t;sig'); await sleep(30); rep = P.stdin.sent.find((s) => s.startsWith('replace ')); a = JSON.parse(rep.slice(8)); ok(a.mode === 'paste' && a.text === 'Regards,\nRavi' && a.back === 4 && E.clip.text === 'Regards,\nRavi', 'multi-line snippet is pasted (text placed on the clipboard first)');
  E.tools._test.expLine('done'); await sleep(400); ok(E.clip.text === 'MY CLIPBOARD', 'your clipboard is put back after the paste'); ok(!E.tools._test.clips.some((c) => c.text === 'Regards,\nRavi'), 'the pasted snippet is not recorded as a copy');
  P.stdin.sent.length = 0; feed('hit\t;ty'); await sleep(30); a = JSON.parse(P.stdin.sent.find((s) => s.startsWith('replace ')).slice(8)); ok(a.text === 'Thanks!' && a.left === 1, '{cursor}: caret goes back one place'); E.tools._test.expLine('done'); await sleep(20);
  P.stdin.sent.length = 0; feed('hit\t;unknown'); await sleep(20); ok(!P.stdin.sent.some((s) => s.startsWith('replace ')), 'unknown trigger ignored');
  E.wins[0].isFocused = () => true; feed('hit\t;date'); await sleep(20); ok(!P.stdin.sent.some((s) => s.startsWith('replace ')), 'typing a trigger inside the island itself does not expand it (so you can edit snippets)'); E.wins[0].isFocused = () => false;
  feed('error hook 5'); ok(E.sent.some((s) => s[0] === 'expander' && /keyboard hook/.test(s[1].error)), 'hook failure is reported to the settings page');
  feed('ready'); feed('some garbage'); ok(true, 'unexpected helper output is harmless');
  E.db.settings.expanderOn = false; E.tools.syncExpander(); ok(P.stdin.sent.includes('quit') && P.killed, 'switched off: helper told to quit and killed');
  E.db.settings.expanderOn = true; E.db.snippets = []; E.tools.syncExpander(); ok(E.procs.length === 1, 'no snippets: no keyboard helper needed');
  ok((await E.handlers['expander:status'](E.good)).supported && (await E.handlers['expander:status'](E.bad)) === null, 'status for the settings page, hidden from untrusted');
  const Ln = harness('linux'); Ln.db.settings.expanderOn = true; Ln.db.snippets = [{ id: 'a', trigger: ';a', text: 'x' }]; Ln.tools.syncExpander(); ok(Ln.procs.length === 0, 'not on Windows: expander never starts'); cleanup(Ln);

  /* ---------- task manager (proc:list / proc:end) ---------- */
  {
    const raw = [{ pid: 10, name: 'chrome', title: 'GitHub', mem: 5e8, path: 'C:\\c\\chrome.exe', desc: 'Google Chrome' }, { pid: 11, name: 'chrome', title: '', mem: 1e8 }, { pid: 20, name: 'notepad', title: 'a.txt', mem: 2e7 },
      { pid: 30, name: 'explorer', title: 'Downloads', mem: 1e8 }, { pid: 60, name: 'OneDrive', title: '', mem: 9e7 }, { pid: 99, name: 'Dynamic Island', title: 'x', mem: 1e8 }];
    let endReply = '{"closed":[10,11,20],"left":[],"denied":[]}', endCmd = '';
    const PM = harness('win32', { ps: (c) => { if (c === 'proclist') return JSON.stringify(raw); if (c.startsWith('procend ')) { endCmd = c; return endReply; } return undefined; } });
    PM.tools.init();
    const lst = await PM.handlers['proc:list'](PM.good);
    ok(lst.ok && ['chrome', 'explorer', 'notepad'].every((id) => lst.apps.some((a) => a.id === id)), 'proc:list returns the apps that have a window'); ok(lst.apps.find((a) => a.id === 'explorer').protected === true, 'Explorer is marked protected');
    ok(lst.apps.find((a) => a.id === 'chrome').n === 2 && lst.apps.find((a) => a.id === 'chrome').name === 'Google Chrome', 'chrome grouped: 2 processes, friendly name');
    ok(lst.bg.some((a) => a.id === 'onedrive') && !lst.apps.some((a) => a.id === 'onedrive'), 'OneDrive is a background process');
    ok((await PM.handlers['proc:list'](PM.bad)).ok === false, 'untrusted pages cannot list');
    ok(!(await PM.handlers['proc:end'](PM.bad, ['chrome'], false)).ok && endCmd === '', 'untrusted pages cannot end anything');
    let r = await PM.handlers['proc:end'](PM.good, ['chrome', 'notepad'], false);
    const sent = JSON.parse(endCmd.slice(8)); eq(sent.force, false, 'polite close by default'); eq(sent.items.map((x) => x.pid), [10, 11, 20], 'all pids of the ticked apps are sent, with their names');
    ok(r.ok && r.closed.length === 2 && r.still.length === 0 && /Ended 2 apps/.test(r.text), 'both apps reported ended');
    endCmd = ''; r = await PM.handlers['proc:end'](PM.good, ['explorer'], true); ok(!r.ok && endCmd === '' && /Windows/.test(r.text), 'Explorer is refused and the helper is never called');
    endCmd = ''; r = await PM.handlers['proc:end'](PM.good, ['not-in-the-list'], true); ok(!r.ok && endCmd === '', 'an id that was never listed is ignored (the page cannot choose pids)');
    endReply = '{"closed":[20],"left":[10,11],"denied":[]}'; r = await PM.handlers['proc:end'](PM.good, ['chrome', 'notepad'], false);
    ok(r.ok && eq2(r.closed, ['notepad']) && eq2(r.still, ['chrome']) && /still open/.test(r.text), 'an app that asks to save first is reported as still open, so the page can offer Force end');
    endReply = '{"closed":[],"left":[10,11],"denied":[10]}'; r = await PM.handlers['proc:end'](PM.good, ['chrome'], true); ok(r.noAccess.includes('chrome') && /administrator/.test(r.text), 'access denied is explained');
    endReply = 'ERR'; r = await PM.handlers['proc:end'](PM.good, ['notepad'], false); ok(!r.ok && /nothing was changed/.test(r.text), 'helper failure changes nothing and says so');
    cleanup(PM);
    const PL = harness('linux'); ok((await PL.handlers['proc:list'](PL.good)).ok === false, 'not on Windows: the task manager says so'); cleanup(PL);
    function eq2(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  }
  cleanup(E); cleanup(W);
  setPlatform(REAL_PLATFORM);
  if (process.platform !== 'win32') { try { for (const n of fs.readdirSync('.')) if (n.startsWith('C:\\')) fs.rmSync(n, { recursive: true, force: true }); } catch {} }   // the mocked 'C:\\Users\\...' folders are relative paths on Linux/macOS; remove what the run created
  console.log(f ? '\n' + f + ' TOOLSMAIN TEST(S) FAILED' : '\nTOOLSMAIN TESTS PASSED'); process.exit(f ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
