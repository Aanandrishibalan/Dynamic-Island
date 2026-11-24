/* Main-process side of the productivity tools. Pure logic lives in tools.js; this file does the things that need Electron,
 * the file system, the network or Windows: clipboard watching, typing into other apps, window moves, renaming files, the transfer server, OCR.
 * Everything arrives through `ctx`, so tests can run it with fake Electron objects. IPC handlers accept only our own pages (trusted()). */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const T = require('./tools');
const createTransfer = require('./transfer');
const QR = require('./qr');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asciiJson = (o) => JSON.stringify(o).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));   // helpers read stdin in the OEM code page: send ASCII only
const parse = (s, d) => { try { return JSON.parse(String(s).replace(/^\uFEFF/, '')); } catch { return d; } };
const clamp = (v, a, b, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };

module.exports = function createTools(ctx) {
  const { app, ipcMain, clipboard, dialog, shell, nativeImage, desktopCapturer, screen, BrowserWindow, Notification } = ctx.electron;
  const db = () => ctx.getDb(), S = () => db().settings, win = () => ctx.getWin();
  const trusted = ctx.trusted, win32 = process.platform === 'win32';
  const tps = ctx.makeHelper('tools.ps1');
  const dataDir = () => app.getPath('userData');
  const tell = (ch, payload) => [ctx.getWin(), ctx.getSettingsWin()].forEach((w) => { try { if (w && !w.isDestroyed()) w.webContents.send(ch, payload); } catch {} });
  const okPath = (p) => typeof p === 'string' && p.length < 1024 && !p.includes('\0') && (win32 ? /^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith('\\\\') && p.indexOf(':', 2) === -1 : path.isAbsolute(p));
  const timers = [];
  const every = (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); timers.push(t); return t; };

  /* ---------- dialogs: the island must not collapse while a file dialog is open ---------- */
  async function pick(opts) {
    const w = win(); ctx.setBlurGuard(true);
    try { const r = await dialog.showOpenDialog(w && !w.isDestroyed() ? w : undefined, opts); return r.canceled ? [] : r.filePaths; }
    finally { ctx.setBlurGuard(false); try { if (w && !w.isDestroyed()) w.focus(); } catch {} }
  }

  /* =====================================================================================================
   * Clipboard manager + history (text only). Stored in clips.json, not in data.json, so the big history is not broadcast to every window.
   * ===================================================================================================== */
  let clips = [], lastText = null, suppress = null, suppressT = null, clipSaveT = null, clipBusy = false;
  const clipFile = () => path.join(dataDir(), 'clips.json');
  function loadClips() { try { clips = T.sanitizeClips(JSON.parse(fs.readFileSync(clipFile(), 'utf8')).items, 700); } catch { clips = []; } purgeClips(); }
  function writeClips() { try { fs.writeFileSync(clipFile(), JSON.stringify({ v: 1, items: clips })); } catch {} }
  const saveClipsSoon = () => { clearTimeout(clipSaveT); clipSaveT = setTimeout(writeClips, 600); if (clipSaveT.unref) clipSaveT.unref(); };
  const purgeClips = () => { const n = clips.length; clips = T.purgeClips(clips, Number(S().clipDays) || 0, Date.now()); if (clips.length !== n) saveClipsSoon(); };
  const quiet = (text) => { suppress = text; clearTimeout(suppressT); suppressT = setTimeout(() => { suppress = null; }, 2500); if (suppressT.unref) suppressT.unref(); };   // do not record text the island itself puts on the clipboard
  const readClip = () => { try { return clipboard.readText(); } catch { return ''; } };
  async function pollClip() {
    if (clipBusy) return;
    const text = readClip();
    if (text === lastText) return;
    lastText = text;
    if (!text || !text.trim()) return;
    if (suppress !== null && text === suppress) { suppress = null; return; }
    const s = S();
    if (s.clipEnabled === false || s.clipPaused || text.length > T.CLIP_MAX_LEN) return;
    clipBusy = true;
    try { if (win32 && (await tps.run('clipexcl', 3000)) === '1') return; }   // a password manager asked not to be recorded
    finally { clipBusy = false; }
    clips = T.addClip(clips, text, Date.now(), { max: s.clipMax }).list; saveClipsSoon(); tell('clip', 1);
  }
  const clipById = (id) => clips.find((c) => c.id === String(id));
  const listClips = (q, filter) => {
    const hits = T.searchClips(clips, q, filter || 'all');
    return { ok: true, items: hits.slice(0, 120).map((c) => T.clipPreview(c)), shown: Math.min(hits.length, 120), total: clips.length, saved: clips.filter((c) => c.pinned).length, paused: !!S().clipPaused, enabled: S().clipEnabled !== false };
  };
  /** Type or paste text into the app the user was just in (the island steps aside, Windows hands focus back, then we send the keys). */
  async function insertText(text, o) {
    o = o || {};
    if (!win32) return { ok: false, text: 'Pasting into other apps works on Windows only.' };
    const typed = o.type && T.typeable(text);
    const prevT = !typed && o.restore ? readClip() : null, prevI = !typed && o.restore && !prevT ? clipboard.readImage() : null;
    if (!typed) { quiet(text); clipboard.writeText(text); }
    ctx.collapseIsland(); ctx.hideIsland(); await sleep(170);
    try {
      const r = typed ? await tps.run('typetext ' + asciiJson({ text }), 8000) : await tps.run('sendpaste', 5000);
      if (/^ERR/.test(r)) return { ok: false, text: 'Windows would not send the keys.' };
      await sleep(260);
      if (o.left > 0) await tps.run('sendleft ' + clamp(o.left, 0, 5000, 0), 5000);   // {cursor}: put the caret back where the snippet asked
    } finally {
      if (!typed && o.restore) { if (prevT) { quiet(prevT); clipboard.writeText(prevT); } else if (prevI && !prevI.isEmpty()) clipboard.writeImage(prevI); }
      ctx.showIslandInactive();
    }
    return { ok: true };
  }
  ipcMain.handle('clip:list', (e, q, f) => (trusted(e) ? listClips(String(q || '').slice(0, 100), String(f || 'all')) : { ok: false, items: [] }));
  ipcMain.handle('clip:full', (e, id) => { const c = trusted(e) && clipById(id); return c ? c.text : ''; });
  ipcMain.handle('clip:copy', (e, id) => { const c = trusted(e) && clipById(id); if (!c) return false; clipboard.writeText(c.text); return true; });
  ipcMain.handle('clip:paste', async (e, id) => { const c = trusted(e) && clipById(id); if (!c) return { ok: false, text: 'That item is gone.' }; clipboard.writeText(c.text); lastText = c.text; return insertText(c.text, {}); });
  ipcMain.handle('clip:pin', (e, id, on) => { const c = trusted(e) && clipById(id); if (!c) return false; c.pinned = !!on; saveClipsSoon(); return true; });
  ipcMain.handle('clip:label', (e, id, label) => { const c = trusted(e) && clipById(id); if (!c) return false; c.label = String(label || '').slice(0, 60).trim(); saveClipsSoon(); return true; });
  ipcMain.handle('clip:delete', (e, id) => { if (!trusted(e)) return false; const n = clips.length; clips = clips.filter((c) => c.id !== String(id)); saveClipsSoon(); return clips.length !== n; });
  ipcMain.handle('clip:clear', (e, keepSaved) => { if (!trusted(e)) return false; clips = keepSaved ? clips.filter((c) => c.pinned) : []; saveClipsSoon(); return true; });
  ipcMain.handle('clip:add', (e, text, label) => {   // "Save text": typed by the user, kept as a saved item
    if (!trusted(e)) return { ok: false };
    text = String(text == null ? '' : text);
    if (!text.trim() || text.length > T.CLIP_MAX_LEN) return { ok: false, text: 'Type something to save (up to 20,000 characters).' };
    const r = T.addClip(clips, text, Date.now(), { max: S().clipMax }); clips = r.list;
    const it = clipById(r.added.id); it.pinned = true; if (label) it.label = String(label).slice(0, 60).trim();
    saveClipsSoon(); return { ok: true };
  });

  /* =====================================================================================================
   * Text expander: expander.ps1 reports "hit <trigger>"; we delete the trigger and type / paste the snippet.
   * ===================================================================================================== */
  let exp = null, expState = { running: false, error: '' }, expBusy = false, expTries = 0, expBuf = '';
  const expSend = (cmd) => { try { exp && exp.stdin.write(cmd + '\n'); } catch {} };
  function expWanted() { return win32 && S().expanderOn === true && (db().snippets || []).length > 0; }
  function expTriggers() { return (db().snippets || []).map((s) => s.trigger); }
  function syncExpander() {
    if (!expWanted()) { stopExpander(); return; }
    if (exp) { expSend('triggers ' + asciiJson(expTriggers())); return; }
    const script = ctx.scriptPath('expander.ps1');
    if (!fs.existsSync(script)) { expState = { running: false, error: 'expander.ps1 is missing' }; tell('expander', expState); return; }
    let p;
    try { p = ctx.spawn(ctx.psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true }); }
    catch (e) { expState = { running: false, error: e.message }; tell('expander', expState); return; }
    exp = p; expBuf = ''; expState = { running: true, error: '' };
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => ctx.log('expander stderr: ' + String(d).trim().slice(0, 400)));
    p.stdout.on('data', (d) => { expBuf += d; let i; while ((i = expBuf.indexOf('\n')) >= 0) { const l = expBuf.slice(0, i).replace(/^\uFEFF/, '').replace(/\r$/, ''); expBuf = expBuf.slice(i + 1); expLine(l); } });
    p.stdin.on('error', () => {});
    p.on('error', (e) => { if (exp === p) { exp = null; expState = { running: false, error: e.message }; tell('expander', expState); } });
    p.on('exit', (c) => {
      ctx.log('expander exited ' + c); if (exp !== p) return; exp = null; expState = { running: false, error: expState.error };
      if (expWanted() && expTries++ < 3) setTimeout(syncExpander, 1500); else if (expWanted()) expState.error = expState.error || 'The keyboard helper stopped.';
      tell('expander', expState);
    });
    expSend('triggers ' + asciiJson(expTriggers()));
  }
  function stopExpander() { if (exp) { const p = exp; exp = null; try { p.stdin.write('quit\n'); } catch {} try { p.kill(); } catch {} } expState = { running: false, error: '' }; expTries = 0; tell('expander', expState); }
  let expPending = null;   // resolves when the helper answers a "replace" command
  function expLine(l) {
    if (l === 'ready') { expTries = 0; return; }
    if (l === 'done' || /^ERR/.test(l)) { if (expPending) { const d = expPending; expPending = null; d(); } return; }
    if (/^error hook/.test(l)) { expState = { running: true, error: 'Windows would not start the keyboard hook (' + l + ').' }; tell('expander', expState); return; }
    const m = /^hit\t(.+)$/.exec(l);
    if (m) expand(m[1]);
  }
  async function expand(trigger) {
    if (expBusy) return;
    const sn = (db().snippets || []).find((s) => s.trigger === trigger); if (!sn) return;
    const w = win(), sw = ctx.getSettingsWin();
    try { if ((w && !w.isDestroyed() && w.isFocused()) || (sw && !sw.isDestroyed() && sw.isFocused())) return; } catch {}   // typing a trigger inside the island's own boxes (the snippet editor) must not expand it
    expBusy = true;
    try {
      const x = T.expandTemplate(sn.text, new Date(), { clipboard: readClip(), dateFormat: S().dateFormat, clock24: S().clock24 !== false });
      const typed = T.typeable(x.text);
      const prevT = typed ? null : readClip(), prevI = typed || prevT ? null : clipboard.readImage();
      if (!typed) { quiet(x.text); clipboard.writeText(x.text); }
      await new Promise((res) => {
        const t = setTimeout(() => { expPending = null; res(); }, 6000);
        expPending = () => { clearTimeout(t); res(); };
        expSend('replace ' + asciiJson({ back: trigger.length, mode: typed ? 'type' : 'paste', text: x.text, left: x.back }));
      });
      if (!typed) { await sleep(300); if (prevT) { quiet(prevT); clipboard.writeText(prevT); } else if (prevI && !prevI.isEmpty()) clipboard.writeImage(prevI); }
    } finally { expBusy = false; }
  }

  /** Insert a snippet from the island (clicking it in the Text expander slide). */
  async function insertSnippet(id) {
    const sn = (db().snippets || []).find((s) => s.id === id); if (!sn) return { ok: false, text: 'That snippet is gone.' };
    const x = T.expandTemplate(sn.text, new Date(), { clipboard: readClip(), dateFormat: S().dateFormat, clock24: S().clock24 !== false });
    return insertText(x.text, { type: true, restore: true, left: x.back });
  }
  ipcMain.handle('snip:insert', (e, id) => (trusted(e) ? insertSnippet(String(id)) : { ok: false }));
  ipcMain.handle('snip:copy', (e, id) => {   // copy the expanded text without typing it anywhere
    const sn = trusted(e) && (db().snippets || []).find((s) => s.id === String(id)); if (!sn) return false;
    clipboard.writeText(T.expandTemplate(sn.text, new Date(), { clipboard: readClip(), dateFormat: S().dateFormat, clock24: S().clock24 !== false }).text); return true;
  });
  ipcMain.handle('expander:status', (e) => (trusted(e) ? { ...expState, on: S().expanderOn === true, supported: win32, count: (db().snippets || []).length } : null));

  /* =====================================================================================================
   * Window manager
   * ===================================================================================================== */
  let handles = new Set();
  async function winList() {
    if (!win32) return { ok: false, text: 'Window layouts work on Windows only.' };
    const r = parse(await tps.run('winlist', 20000), null);
    if (!r || !Array.isArray(r.wins)) return { ok: false, text: 'Windows did not return the window list.' };
    r.wins.forEach((w) => { w.h = String(w.h); });
    handles = new Set(r.wins.map((w) => w.h));
    return { ok: true, mons: r.mons || [], wins: r.wins };
  }
  const workOf = (mons, i) => { const m = mons.find((x) => x.i === i) || mons.find((x) => x.primary) || mons[0]; return m ? { x: m.x, y: m.y, w: m.w, h: m.h } : null; };
  async function moveBatch(items) {
    if (!items.length) return { ok: 0, fail: 0 };
    return parse(await tps.run('winbatch ' + asciiJson(items), 20000), { ok: 0, fail: items.length });
  }
  const toMove = (h, rect) => (rect.max ? { h, x: 0, y: 0, w: 0, hh: 0, max: true } : { h, x: rect.x, y: rect.y, w: rect.w, hh: rect.h, max: false });
  ipcMain.handle('win:list', async (e) => (trusted(e) ? winList() : { ok: false }));
  ipcMain.handle('win:snap', async (e, h, zone) => {
    if (!trusted(e)) return { ok: false };
    h = String(h);
    if (!T.ZONES.includes(zone)) return { ok: false, text: 'Unknown position.' };
    const L = await winList(); if (!L.ok) return L;
    const w = L.wins.find((x) => x.h === h); if (!w) return { ok: false, text: 'That window has closed.' };
    const work = workOf(L.mons, w.mon); if (!work) return { ok: false, text: 'No screen found.' };
    const r = await moveBatch([toMove(h, T.zoneRect(zone, work))]);
    return { ok: r.ok > 0, text: r.ok > 0 ? '' : 'Windows would not move that window (programs running as administrator cannot be moved).' };
  });
  ipcMain.handle('win:layout', async (e, id) => {
    if (!trusted(e)) return { ok: false };
    const lay = T.LAYOUTS.find((l) => l.id === id); if (!lay) return { ok: false, text: 'Unknown layout.' };
    const L = await winList(); if (!L.ok) return L;
    const live = L.wins.filter((w) => !w.min); if (!live.length) return { ok: false, text: 'There are no open windows to arrange.' };
    const mon = live[0].mon, same = live.filter((w) => w.mon === mon).slice(0, lay.zones.length), work = workOf(L.mons, mon);
    const r = await moveBatch(same.map((w, i) => toMove(w.h, T.zoneRect(lay.zones[i], work))));
    return { ok: r.ok > 0, moved: r.ok, failed: r.fail, text: r.ok ? 'Arranged ' + r.ok + ' window' + (r.ok > 1 ? 's' : '') + (r.fail ? ' (' + r.fail + ' could not be moved)' : '') + '.' : 'Windows would not move them.' };
  });
  ipcMain.handle('win:focus', async (e, h) => { if (!trusted(e) || !/^\d{1,20}$/.test(String(h)) || !handles.has(String(h))) return false; await tps.run('winfocus ' + String(h), 5000); return true; });
  ipcMain.handle('win:save', async (e, name) => {
    if (!trusted(e)) return { ok: false };
    name = String(name || '').trim().slice(0, 40); if (!name) return { ok: false, text: 'Give the layout a name.' };
    const L = await winList(); if (!L.ok) return L;
    const items = L.wins.filter((w) => !w.min).slice(0, 24).map((w) => { const work = workOf(L.mons, w.mon); return { proc: w.proc, mon: w.mon, max: !!w.max, ...T.relRect({ x: w.x, y: w.y, w: w.w, h: w.hh }, work) }; });
    const lay = T.sanitizeLayout({ name, items }); if (!lay) return { ok: false, text: 'There are no open windows to save.' };
    db().layouts = T.sanitizeLayouts([lay, ...(db().layouts || []).filter((l) => l.name.toLowerCase() !== name.toLowerCase())]); ctx.save();
    return { ok: true, text: 'Saved ' + lay.items.length + ' window' + (lay.items.length > 1 ? 's' : '') + ' as “' + name + '”.' };
  });
  ipcMain.handle('win:apply', async (e, id) => {
    if (!trusted(e)) return { ok: false };
    const lay = (db().layouts || []).find((l) => l.id === String(id)); if (!lay) return { ok: false, text: 'That layout is gone.' };
    const L = await winList(); if (!L.ok) return L;
    const used = new Set(), moves = [], missing = [];
    for (const it of lay.items) {
      const w = L.wins.find((x) => x.proc.toLowerCase() === it.proc.toLowerCase() && !used.has(x.h));
      if (!w) { missing.push(it.proc); continue; }
      used.add(w.h);
      const work = workOf(L.mons, L.mons.some((m) => m.i === it.mon) ? it.mon : -1);
      moves.push(toMove(w.h, it.max ? { max: true } : T.absRect(it, work)));
    }
    const r = await moveBatch(moves);
    return { ok: r.ok > 0, moved: r.ok, missing, text: r.ok ? 'Arranged ' + r.ok + ' window' + (r.ok > 1 ? 's' : '') + (missing.length ? '. Not open: ' + [...new Set(missing)].join(', ') : '') + '.' : (missing.length ? 'None of these apps are open: ' + [...new Set(missing)].join(', ') + '.' : 'Windows would not move them.') };
  });

  /* =====================================================================================================
   * Task manager: running apps and background processes, tick and end.
   * The page only ever sends back the ids of the last listing; pids are resolved here, Windows' own programs and the island's helpers are never offered,
   * and the helper refuses a pid whose program name changed since the listing (a number reused by something else).
   * ===================================================================================================== */
  let procKnown = new Map();
  const procIcons = {};
  async function procIcon(p) {
    if (!p) return '';
    if (!(p in procIcons)) { procIcons[p] = ''; try { const img = await app.getFileIcon(p, { size: 'normal' }); if (img && !img.isEmpty()) procIcons[p] = img.toDataURL(); } catch {} }
    return procIcons[p];
  }
  async function procList() {
    if (!win32) return { ok: false, text: 'The task manager works on Windows only.' };
    const raw = parse(await tps.run('proclist', 25000), null);
    if (!Array.isArray(raw)) return { ok: false, text: 'Windows did not return the list of running programs.' };
    const self = new Set([process.pid]);
    try { if (typeof app.getAppMetrics === 'function') app.getAppMetrics().forEach((m) => self.add(m.pid)); } catch {}
    try { if (typeof ctx.helperPids === 'function') ctx.helperPids().forEach((x) => self.add(x)); } catch {}
    const g = T.groupProcs(raw, self);
    procKnown = new Map([...g.apps, ...g.bg].map((x) => [x.id, x]));
    const apps = g.apps.slice(0, 60), bg = g.bg.slice(0, 80);
    await Promise.all([...apps, ...bg.slice(0, 30)].map(async (x) => { x.icon = await procIcon(x.path); }));
    const view = (x) => ({ id: x.id, name: x.name, title: x.title, n: x.n, mem: x.mem, protected: x.protected, icon: x.icon || '' });
    return { ok: true, apps: apps.map(view), bg: bg.map(view), total: g.apps.length + g.bg.length, shown: apps.length + bg.length };
  }
  ipcMain.handle('proc:list', async (e) => (trusted(e) ? procList() : { ok: false }));
  ipcMain.handle('proc:end', async (e, ids, force) => {
    if (!trusted(e)) return { ok: false };
    if (!win32) return { ok: false, text: 'The task manager works on Windows only.' };
    if (!procKnown.size) { const l = await procList(); if (!l.ok) return l; }
    const ask = (Array.isArray(ids) ? ids : []).map(String);
    const { items, skipped } = T.procTargets(ask, procKnown);
    if (!items.length) return { ok: false, text: skipped.length ? skipped.join(', ') + ' belongs to Windows and cannot be ended here.' : 'Nothing selected to end.', skipped };
    const r = parse(await tps.run('procend ' + asciiJson({ force: !!force, items }), 30000), null);
    if (!r || !Array.isArray(r.closed)) return { ok: false, text: 'Windows did not answer, so nothing was changed.' };
    const left = new Set([...(r.left || []), ...(r.denied || [])]), denied = new Set(r.denied || []);
    const closed = [], still = [], noAccess = [];
    for (const id of new Set(ask)) {
      const g = procKnown.get(id); if (!g || g.protected) continue;
      if (g.pids.some((x) => left.has(x))) { still.push(id); if (g.pids.some((x) => denied.has(x))) noAccess.push(id); } else closed.push(id);
    }
    const nm = (id) => (procKnown.get(id) || {}).name || id;
    let text = closed.length ? 'Ended ' + closed.length + (closed.length === 1 ? ' app' : ' apps') + '.' : '';
    if (noAccess.length) text += (text ? ' ' : '') + noAccess.map(nm).join(', ') + ' needs administrator rights, so Windows refused.';
    const waiting = still.filter((id) => !noAccess.includes(id));
    if (waiting.length) text += (text ? ' ' : '') + waiting.map(nm).join(', ') + (waiting.length === 1 ? ' is' : ' are') + ' still open (maybe asking to save first).';
    if (skipped.length) text += (text ? ' ' : '') + 'Skipped ' + skipped.join(', ') + ' (part of Windows).';
    return { ok: true, closed, still, noAccess, skipped, text: text || 'Done.' };
  });

  /* =====================================================================================================
   * Quick launch (favourite apps) and folder shortcuts
   * ===================================================================================================== */
  ipcMain.handle('fav:list', async (e) => {
    if (!trusted(e)) return [];
    const idx = await ctx.appIndex(false);
    return (db().favApps || []).map((f) => { const a = idx.find((x) => x.name.toLowerCase() === f.name.toLowerCase()); return { name: f.name, id: a ? a.id : null, hasIcon: !!(a && (a.path || a.logo)) }; });
  });
  ipcMain.handle('fav:launch', async (e, name) => {
    if (!trusted(e)) return false;
    const idx = await ctx.appIndex(false), a = idx.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!a) return false;
    return ctx.launchApp(a.id);
  });
  ipcMain.handle('folder:pick', async (e) => {
    if (!trusted(e)) return null;
    const p = (await pick({ properties: ['openDirectory'] }))[0]; if (!p) return null;
    const f = T.sanitizeFolder({ path: p }); return f ? { path: f.path, name: f.name } : null;
  });
  ipcMain.handle('folder:open', async (e, id) => {
    if (!trusted(e)) return false;
    const f = (db().folders || []).find((x) => x.id === String(id)); if (!f) return false;
    try { if (!fs.statSync(f.path).isDirectory()) return false; } catch { return { ok: false, text: 'That folder is not available right now.' }; }
    const err = await shell.openPath(f.path); return err ? { ok: false, text: err } : { ok: true };
  });
  ipcMain.handle('folder:copy', (e, id) => { const f = trusted(e) && (db().folders || []).find((x) => x.id === String(id)); if (!f) return false; clipboard.writeText(f.path); return true; });

  /* =====================================================================================================
   * Batch file renamer (the plan is always recomputed here from the real files; the page is never trusted for names or dates)
   * ===================================================================================================== */
  const undoFile = () => path.join(dataDir(), 'rename-undo.json');
  const keyOf = (dir, name) => (dir + '\\' + name).toLowerCase().replace(/\//g, '\\');
  function statFiles(list) {
    const out = [];
    for (const p of (Array.isArray(list) ? list : []).slice(0, 500)) {
      const fp = typeof p === 'string' ? p : p && p.path;
      if (!okPath(fp)) continue;
      try { const st = fs.statSync(fp); if (st.isFile()) out.push({ path: fp, name: path.basename(fp), size: st.size, mtime: st.mtimeMs }); } catch {}
    }
    return out;
  }
  function buildPlan(files, rules) {
    const real = statFiles(files), existing = new Set(), dirs = new Set(real.map((f) => path.dirname(f.path)));
    for (const d of dirs) { try { fs.readdirSync(d).forEach((n) => existing.add(keyOf(d, n))); } catch {} }
    return { real, plan: T.planRename(real, rules, existing) };
  }
  const clientPlan = (plan) => ({ items: plan.items.map((i) => ({ oldName: i.oldName, newName: i.newName, status: i.status, reason: i.reason })), ok: plan.ok, bad: plan.bad, same: plan.same, canApply: plan.canApply });
  ipcMain.handle('rename:pick', async (e) => { if (!trusted(e)) return []; return statFiles(await pick({ properties: ['openFile', 'multiSelections'] })); });
  ipcMain.handle('rename:pickFolder', async (e) => {
    if (!trusted(e)) return [];
    const d = (await pick({ properties: ['openDirectory'] }))[0]; if (!d) return [];
    try { return statFiles(fs.readdirSync(d).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((n) => path.join(d, n))); } catch { return []; }
  });
  ipcMain.handle('rename:plan', (e, files, rules) => (trusted(e) ? clientPlan(buildPlan(files, rules).plan) : { items: [], canApply: false }));
  function renamePairs(pairs) {   // two phases through temporary names, so swaps and chains (a->b, b->c) work; undone on any failure
    const done = [], tmp = [];
    try {
      pairs.forEach((p, i) => { const t = path.join(path.dirname(p.from), '.di-tmp-' + crypto.randomBytes(5).toString('hex') + '-' + i); fs.renameSync(p.from, t); tmp.push({ t, p }); });
      tmp.forEach((x) => { if (fs.existsSync(x.p.to) && keyOf(path.dirname(x.p.to), path.basename(x.p.to)) !== keyOf(path.dirname(x.p.from), path.basename(x.p.from)) && !pairs.some((q) => q.from === x.p.to)) throw new Error('“' + path.basename(x.p.to) + '” already exists'); fs.renameSync(x.t, x.p.to); done.push(x); });
      return { ok: true };
    } catch (err) {
      for (const x of done.reverse()) { try { fs.renameSync(x.p.to, x.t); } catch {} }
      for (const x of tmp) { try { if (fs.existsSync(x.t)) fs.renameSync(x.t, x.p.from); } catch {} }
      return { ok: false, text: 'Nothing was renamed: ' + err.message };
    }
  }
  ipcMain.handle('rename:apply', (e, files, rules) => {
    if (!trusted(e)) return { ok: false, text: 'Blocked.' };
    const { real, plan } = buildPlan(files, rules);
    if (!plan.canApply) return { ok: false, text: plan.bad ? 'Fix the highlighted names first.' : 'Nothing to rename.' };
    const pairs = plan.items.filter((i) => i.status === 'ok').map((i) => ({ from: i.path, to: path.join(path.dirname(i.path), i.newName) }));
    const r = renamePairs(pairs); if (!r.ok) return r;
    try { fs.writeFileSync(undoFile(), JSON.stringify({ t: Date.now(), pairs })); } catch {}
    return { ok: true, renamed: pairs.length, text: 'Renamed ' + pairs.length + ' file' + (pairs.length > 1 ? 's' : '') + '.', files: real.length };
  });
  ipcMain.handle('rename:undoInfo', (e) => { if (!trusted(e)) return null; const u = parse(fs.existsSync(undoFile()) ? fs.readFileSync(undoFile(), 'utf8') : '', null); return u && Array.isArray(u.pairs) ? { count: u.pairs.length, t: u.t } : null; });
  ipcMain.handle('rename:undo', (e) => {
    if (!trusted(e)) return { ok: false };
    const u = parse(fs.existsSync(undoFile()) ? fs.readFileSync(undoFile(), 'utf8') : '', null);
    if (!u || !Array.isArray(u.pairs) || !u.pairs.length) return { ok: false, text: 'Nothing to undo.' };
    const back = u.pairs.filter((p) => okPath(p.from) && okPath(p.to)).map((p) => ({ from: p.to, to: p.from }));
    for (const p of back) { if (!fs.existsSync(p.from)) return { ok: false, text: '“' + path.basename(p.from) + '” has been moved or renamed since, so undo is not safe.' }; }
    const r = renamePairs(back); if (!r.ok) return r;
    try { fs.unlinkSync(undoFile()); } catch {}
    return { ok: true, text: 'Restored ' + back.length + ' name' + (back.length > 1 ? 's' : '') + '.' };
  });

  /* =====================================================================================================
   * Quick file transfer. The files to share are chosen in this process (the page cannot name arbitrary paths to share).
   * ===================================================================================================== */
  let shared = [];
  const recvDir = () => { const f = String(S().receiveFolder || '').trim(); return f && okPath(f) ? f : path.join(app.getPath('downloads'), 'Dynamic Island'); };
  const xfer = createTransfer({ receiveDir: recvDir, risky: ctx.risky, onChange: (st) => tell('xfer', st) });
  const xferInfo = () => ({ ...xfer.state(), picked: shared.map((f, i) => ({ i, name: f.name, size: f.size })), receiveDir: recvDir() });
  ipcMain.handle('xfer:pick', async (e) => {
    if (!trusted(e)) return null;
    shared = [...shared, ...statFiles(await pick({ properties: ['openFile', 'multiSelections'] }))].filter((f, i, a) => a.findIndex((x) => x.path === f.path) === i).slice(0, 200);
    return xferInfo();
  });
  ipcMain.handle('xfer:remove', (e, i) => { if (!trusted(e)) return null; shared.splice(clamp(i, 0, 1e6, -1), 1); return xferInfo(); });
  ipcMain.handle('xfer:state', (e) => (trusted(e) ? xferInfo() : null));
  ipcMain.handle('xfer:start', async (e, o) => {
    if (!trusted(e)) return { ok: false };
    o = o || {};
    try { await xfer.start({ files: shared.map((f) => f.path), receive: o.receive !== false, minutes: clamp(o.minutes, 1, 120, 10) }); return { ok: true, ...xferInfo() }; }
    catch (err) { return { ok: false, text: 'Could not start sharing: ' + err.message }; }
  });
  ipcMain.handle('xfer:stop', (e) => { if (!trusted(e)) return null; xfer.stop(); return xferInfo(); });
  ipcMain.handle('xfer:copyLink', (e, i) => { if (!trusted(e)) return false; const u = xfer.state().urls[clamp(i, 0, 20, 0)]; if (!u) return false; quiet(u); clipboard.writeText(u); return true; });
  ipcMain.handle('xfer:openFolder', async (e) => { if (!trusted(e)) return false; const d = recvDir(); try { fs.mkdirSync(d, { recursive: true }); } catch {} await shell.openPath(d); return true; });

  /* =====================================================================================================
   * Screenshot OCR (Windows' own OCR engine through tools.ps1: offline, nothing is uploaded)
   * ===================================================================================================== */
  let snipBusy = false, snipWin = null, snipResolve = null, snipShot = null;
  async function ocrImage(img) {
    if (!win32) return { ok: false, text: 'Text recognition uses the Windows built-in OCR, so it works on Windows only.' };
    let image = img; const sz = image.getSize();
    if (!sz.width || !sz.height) return { ok: false, text: 'That picture is empty.' };
    if (sz.width < 1000 && sz.height < 1000) { const k = Math.min(3, Math.max(1.5, 1200 / Math.max(sz.width, sz.height))); image = image.resize({ width: Math.round(sz.width * k), quality: 'best' }); }   // small crops read much better when enlarged
    const f = path.join(os.tmpdir(), 'di-ocr-' + crypto.randomBytes(6).toString('hex') + '.png');
    try {
      fs.writeFileSync(f, image.toPNG());
      const r = parse(await tps.run('ocr ' + asciiJson({ path: f, lang: S().ocrLang || 'auto' }), 90000), null);
      if (!r) return { ok: false, text: 'The OCR helper did not answer. Try again in a moment.' };
      if (!r.ok) return { ok: false, text: r.text || 'Text recognition failed.' };
      const text = String(r.text || '').replace(/\r/g, '').trim();
      return text ? { ok: true, text, lang: r.lang, note: r.note || '' } : { ok: false, text: 'No text found in that picture.', note: r.note || '' };
    } catch (err) { return { ok: false, text: 'Text recognition failed: ' + err.message }; }
    finally { try { fs.unlinkSync(f); } catch {} }
  }
  function finishOcr(r, reveal) {
    if (r.ok && S().ocrCopy !== false) { try { clipboard.writeText(r.text); r.copied = true; } catch {} }
    if (reveal) { ctx.openIsland('ocr'); tell('ocr', r); }
    return r;
  }
  function selectArea(d, shot) {
    return new Promise((resolve) => {
      snipShot = shot; snipResolve = resolve;
      const w = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, resizable: false, movable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#000000', webPreferences: { ...ctx.WEBPREFS, preload: path.join(__dirname, 'snip-preload.js') } });
      snipWin = w; ctx.harden(w.webContents); w.setAlwaysOnTop(true, 'screen-saver');
      w.once('ready-to-show', () => { w.show(); w.focus(); });
      w.on('closed', () => { snipWin = null; if (snipResolve) { const r = snipResolve; snipResolve = null; r(null); } });
      w.loadFile(path.join(__dirname, 'snip.html'));
    });
  }
  ipcMain.handle('snip:init', (e) => { if (!trusted(e) || !snipWin || e.sender !== snipWin.webContents || !snipShot) return null; return { url: 'data:image/jpeg;base64,' + snipShot.toJPEG(88).toString('base64') }; });
  ipcMain.on('snip:done', (e, rect) => {
    if (!trusted(e) || !snipWin || e.sender !== snipWin.webContents) return;
    const r = snipResolve; snipResolve = null; try { snipWin.close(); } catch {} if (r) r(rect && Number.isFinite(+rect.w) ? { x: +rect.x, y: +rect.y, w: +rect.w, h: +rect.h } : null);
  });
  async function ocrSnip() {
    if (snipBusy) return { ok: false, text: 'A selection is already open.' };
    snipBusy = true;
    try {
      ctx.collapseIsland(); ctx.hideIsland(); await sleep(450);
      const d = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getPrimaryDisplay(), f = d.scaleFactor || 1;
      const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * f), height: Math.round(d.size.height * f) } });
      const src = srcs.find((x) => x.display_id === String(d.id)) || srcs[0];
      if (!src) throw new Error('no screen found');
      const rect = await selectArea(d, src.thumbnail);
      if (!rect || rect.w < 6 || rect.h < 6) return { ok: false, cancelled: true, text: 'Cancelled.' };
      const full = src.thumbnail.getSize(), k = full.width / d.bounds.width;
      const x = Math.max(0, Math.round(rect.x * k)), y = Math.max(0, Math.round(rect.y * k));
      const crop = src.thumbnail.crop({ x, y, width: Math.max(1, Math.min(full.width - x, Math.round(rect.w * k))), height: Math.max(1, Math.min(full.height - y, Math.round(rect.h * k))) });
      return finishOcr(await ocrImage(crop), true);
    } catch (err) { return finishOcr({ ok: false, text: 'Could not capture the screen: ' + err.message }, true); }
    finally { snipBusy = false; snipShot = null; ctx.showIslandInactive(); }
  }
  ipcMain.handle('ocr:snip', (e) => (trusted(e) ? ocrSnip() : { ok: false }));
  ipcMain.handle('ocr:clipboard', async (e) => {
    if (!trusted(e)) return { ok: false };
    let img; try { img = clipboard.readImage(); } catch { img = null; }
    if (!img || img.isEmpty()) return { ok: false, text: 'There is no picture on the clipboard. Press Win+Shift+S, select an area, then try again.' };
    return finishOcr(await ocrImage(img), false);
  });
  ipcMain.handle('ocr:file', async (e) => {
    if (!trusted(e)) return { ok: false };
    const p = (await pick({ properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp'] }] }))[0];
    if (!p) return { ok: false, cancelled: true };
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return { ok: false, text: 'That file is not a picture Windows can read.' };
    return finishOcr(await ocrImage(img), false);
  });
  ipcMain.handle('ocr:langs', async (e) => { if (!trusted(e)) return { ok: false, langs: [] }; if (!win32) return { ok: false, langs: [], text: 'Windows only.' }; return parse(await tps.run('ocrlangs', 15000), { ok: false, langs: [] }); });

  /* =====================================================================================================
   * Currency rates (open.er-api.com, no key, updated once a day; attribution shown in the converter) + QR
   * ===================================================================================================== */
  const fxFile = () => path.join(dataDir(), 'fx.json');
  ipcMain.handle('fx:rates', async (e, force) => {
    if (!trusted(e)) return { ok: false };
    let cache = parse(fs.existsSync(fxFile()) ? fs.readFileSync(fxFile(), 'utf8') : '', null);
    if (cache && !(cache.rates && typeof cache.rates === 'object' && cache.t)) cache = null;
    const fresh = cache && Date.now() - cache.t < 12 * 3600 * 1000;
    if (fresh && !force) return { ok: true, base: cache.base, rates: cache.rates, t: cache.t, stale: false };
    if (S().fxOnline === false) return cache ? { ok: true, base: cache.base, rates: cache.rates, t: cache.t, stale: true } : { ok: false, text: 'Online exchange rates are switched off in Settings.' };
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.result !== 'success' || !j.rates || typeof j.rates.USD !== 'number') throw new Error('unexpected answer');
      const rates = {}; for (const k of Object.keys(j.rates)) if (/^[A-Z]{3}$/.test(k) && typeof j.rates[k] === 'number' && j.rates[k] > 0) rates[k] = j.rates[k];
      cache = { base: 'USD', rates, t: Date.now() };
      try { fs.writeFileSync(fxFile(), JSON.stringify(cache)); } catch {}
      return { ok: true, base: 'USD', rates, t: cache.t, stale: false };
    } catch (err) {
      return cache ? { ok: true, base: cache.base, rates: cache.rates, t: cache.t, stale: true, text: 'Offline: showing rates from ' + new Date(cache.t).toLocaleDateString() + '.' } : { ok: false, text: 'Could not load exchange rates (' + err.message + '). Check your connection.' };
    }
  });
  ipcMain.handle('qr:make', (e, text) => (trusted(e) ? QR.matrix(text) : { ok: false }));
  const pngOf = (dataUrl) => { const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '')); return m && m[1].length < 7e6 ? Buffer.from(m[1], 'base64') : null; };
  ipcMain.handle('qr:copy', (e, dataUrl) => { if (!trusted(e)) return false; const b = pngOf(dataUrl); if (!b) return false; const img = nativeImage.createFromBuffer(b); if (img.isEmpty()) return false; clipboard.writeImage(img); return true; });
  ipcMain.handle('qr:save', (e, dataUrl) => {
    if (!trusted(e)) return { ok: false, text: 'Blocked.' };
    const b = pngOf(dataUrl); if (!b) return { ok: false, text: 'Could not read the picture.' };
    try {
      const base = String(S().captureFolder || '').trim(), dir = base && okPath(base) ? path.join(base, 'QR codes') : path.join(app.getPath('pictures'), 'Dynamic Island', 'QR codes');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'QR_' + new Date().toLocaleString('sv').replace(/[: ]/g, (c) => (c === ' ' ? '_' : '-')) + '.png');
      fs.writeFileSync(file, b); ctx.saved.add(file); return { ok: true, path: file };
    } catch (err) { return { ok: false, text: 'Could not save: ' + err.message }; }
  });

  /* ---------- start / stop ---------- */
  function seed() {
    const s = S(); let changed = false;
    if (!s.foldersSeeded) {
      if (!(db().folders || []).length) db().folders = T.sanitizeFolders(['downloads', 'documents', 'desktop', 'pictures'].map((k) => { try { return { path: app.getPath(k) }; } catch { return null; } }));
      s.foldersSeeded = true; changed = true;
    }
    if (!s.snippetsSeeded) {
      if (!(db().snippets || []).length) db().snippets = T.sanitizeSnippets([{ trigger: ';date', text: '{date}', label: 'Today’s date' }, { trigger: ';now', text: '{datetime}', label: 'Date and time' }, { trigger: ';ty', text: 'Thank you for your email. I will get back to you shortly.{cursor}', label: 'Quick thanks' }]);
      s.snippetsSeeded = true; changed = true;
    }
    if (changed) ctx.save();
  }
  function init() {
    seed(); loadClips();
    lastText = readClip();   // what is on the clipboard at start is not "new"
    every(() => { pollClip().catch(() => {}); }, 700);
    every(purgeClips, 6 * 3600 * 1000);
    if (win32) { const t = setTimeout(() => { tps.run('ping', 90000); }, 4000); if (t.unref) t.unref(); }   // warm the helper (it compiles a little C# on first start) so the first copy / OCR is not slow
    syncExpander();
  }
  function shutdown() { try { writeClips(); } catch {} try { xfer.stop(); } catch {} stopExpander(); timers.forEach(clearInterval); try { tps.kill(); } catch {} }
  return { init, shutdown, syncExpander, ocrSnip, _test: { get clips() { return clips; }, pollClip, insertText, listClips, renamePairs, buildPlan, expLine: (l) => expLine(l), xfer, setExpPending: (f) => { expPending = f; } } };
};
