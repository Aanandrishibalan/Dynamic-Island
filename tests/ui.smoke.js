/* Headless UI check: loads the real index.html with a stubbed island API backed by the real assistant code.
 * Run:  node tests/ui.smoke.js [screenshot-dir]   (needs Playwright + Chromium) */
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const createAssist = require('../dynamic-island/assist.js'), P = require('../dynamic-island/planner.js');
const out = process.argv[2] || null;
const L = (d, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.getTime(); };
const T = (o) => ({ id: 't' + Math.random().toString(36).slice(2, 6), text: 'x', done: false, doneAt: null, cat: 'personal', pri: 'normal', cond: 'none', repeat: 'none', due: null, date: null, by: null, notified: false, spawned: false, ...o });
const today = P.ymd(new Date());
const db = { settings: { theme: 'dark', accent: '#0a84ff', clock24: true, currency: '₹', aiProvider: 'ollama', hiddenSlides: [], slideOrder: [], assistMemory: true, assistBrief: 'first', assistBriefDate: '', assistSuggest: true, assistWorkStart: 540, assistWorkEnd: 1080, assistLunch: true, assistDefMin: 30, assistSpeak: false, assistVoiceRoute: true, homeButtons: null, homeHide: [] },
  conversations: [], notes: ['', '', ''], habits: [{ id: 'h1', name: 'Meditate', days: [] }], goals: [], journal: [], expenses: [{ id: 'e1', t: Date.now(), amount: 250, cat: 'Food', note: 'lunch' }], memory: [], meetings: [], events: [{ id: 'ev1', date: today, time: '17:00', title: 'Team sync', due: L(0, 17), done: false, notified: false }],
  tasks: [T({ text: 'Call supplier', due: L(0, 16), date: today, cat: 'work' }), T({ text: 'Submit tax return', date: today, cat: 'urgent', pri: 'high' }), T({ text: 'Fix invoice', date: P.ymd(new Date(Date.now() - 864e5)), pri: 'high', cat: 'work' }), T({ text: 'Buy milk', date: today, cat: 'shopping' }), T({ text: 'Write report 45 min', date: today, cat: 'work' })] };
const A = createAssist({ getDb: () => db, save() {}, provider: () => 'ollama', chat: async (m) => ({ ok: true, text: 'Stub model answer: ' + String(m[m.length - 1].content).slice(0, 60) }), vision: async () => ({ ok: true, text: '{"summary":"You are reading an invoice.","actions":[{"label":"Add task","kind":"task","text":"Pay invoice 104 by Friday"}]}' }),
  grabScreen: async () => 'AAAA', clipboard: { _t: 'Meeting moved to Thursday because the supplier is late. Please confirm by Friday. Ravi will send the revised invoice. We decided to keep the old price.', readText() { return this._t; }, writeText(t) { this._t = t; }, clear() { this._t = ''; } },
  ps: async () => '[]', getFg: () => ({ name: 'chrome', hwnd: 0 }), setCopyBusy() {}, appIndex: async () => [{ id: 'a1', name: 'Google Chrome' }], launchApp: async () => true, openPath() {}, mail: () => [], usage: () => ({ idleNow: 0, screen: 100 }), weather: () => null,
  setTasks: (l) => { db.tasks = P.sanitizeList(l, P.sanitizeTask, 2000); }, captureAdd: async (raw) => { const p = P.parseCapture(raw, new Date()); db.tasks = [P.makeTask(p, Date.now()), ...db.tasks]; return { ok: true, text: 'Added to your planner' }; } });

(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.exposeFunction('nodeAssist', async (fn, ...a) => A[fn](...a));
  await pg.exposeFunction('nodeDb', async () => JSON.parse(JSON.stringify(db)));
  await pg.addInitScript(() => {
    const noop = () => {}, pr = (v = null) => async () => v; const cb = {};
    const base = { wellBattery: noop, alarmSnooze: pr([]), pomo: pr(null), drank: pr(false), setIgnore: noop, action: noop, openSettings: noop, openUrl: noop, openPath: noop, showFile: noop, openConv: noop,
      getData: () => window.nodeDb(), setSettings: async (p) => { const d = await window.nodeDb(); return Object.assign(d.settings, p) && d; }, setData: () => window.nodeDb(),
      chat: pr({ ok: true, text: 'hi' }), stt: pr({ ok: true, text: 'what is pending today' }), usage: pr({ screen: 0, idle: 0, apps: {}, idleNow: 0 }), weather: pr({ ok: false, text: 'x' }), news: pr({ ok: false }), photos: pr([]), media: pr('none'), appsList: pr([]), appIcons: pr({}), filesRecent: pr([]), filesSearch: pr([]), locationDetect: pr({ ok: false }), capture: pr({ ok: true, text: 'ok' }),
      vault: { status: pr({}), unlock: pr({}), lock: pr({}), setPassphrase: pr({}), removePassphrase: pr({}), wipe: pr({}) }, onVault: noop, ai: { status: pr({}), connect: pr({}), disconnect: pr({}), models: pr([]) },
      net: { radios: pr({ wifi: true, bluetooth: false }), radio: pr('ok'), airplane: pr('ok'), online: pr(true), wifiScan: pr({}), wifiConnect: pr({}), wifiDisconnect: pr({}), wifiForget: pr({}), btList: pr({}) },
      mail: { state: pr({ status: {}, messages: [] }), refresh: pr(null), open: noop, openSource: noop, setGmail: pr({}), clearGmail: pr(true), linkWhatsApp: noop },
      sys: { get: pr({ vol: 40, muted: false, bright: 70 }), vol: noop, bright: noop, apps: pr([]), focus: noop, stats: pr({}) }, speed: { live: pr({ error: true }), start: pr({}), cancel: noop, clear: pr({}) }, app: { info: pr({ version: '1.4.0' }), ack: noop },
      assist: { ask: (t, x) => window.nodeAssist('ask', t, x), act: (id) => window.nodeAssist('act', id), brief: () => window.nodeAssist('brief'), suggest: (x) => window.nodeAssist('suggestions', x), meetingFinish: (p) => window.nodeAssist('meetingFinish', p), meetingSave: (d) => window.nodeAssist('meetingSave', d), meetingTasks: (i, x) => window.nodeAssist('meetingTasks', i, x), meetingExport: pr({}), remember: (t) => window.nodeAssist('addMemory', t), copy: (t) => { window.__copied = t; } } };
    for (const k of ['onStore', 'onCollapse', 'onToggle', 'onOpenConv', 'onReminder', 'onAlert', 'onMail', 'onMailNew', 'onGoto', 'onCapture', 'onVoice', 'onSpeed']) base[k] = (f) => { cb[k] = f; };
    window.island = base; window.__cb = cb;
  });
  await pg.goto('file://' + path.resolve(__dirname, '../dynamic-island/index.html'));
  await pg.waitForTimeout(500);
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  await pg.evaluate(() => window.__cb.onToggle()); await pg.waitForTimeout(1200);   // first open of the day -> briefing
  const card = async () => (await pg.locator('#asOut .ascard').first().innerText());
  let t = await card(); ok(/pending tasks/.test(t) && /Two are urgent|urgent/.test(t) && /reminder to call supplier at 16:00/.test(t), 'auto briefing on first open: ' + t.split('\n').slice(0, 3).join(' | ').slice(0, 130));
  if (out) await pg.screenshot({ path: path.join(out, 'assistant-briefing.png') });
  const ask = async (q) => { await pg.fill('#asIn', q); await pg.press('#asIn', 'Enter'); await pg.waitForTimeout(500); return card(); };
  t = await ask("What's pending today?"); ok(/You have \d+ pending tasks?\./.test(t), "pending answer: " + t.split('\n').slice(0, 2).join(' | ').slice(0, 120));
  t = await ask('Find time for my unfinished tasks'); ok(/I found time for/.test(t) && (await pg.locator('#asOut .ascard').first().locator('button', { hasText: 'Apply this schedule' }).count()) === 1, 'smart scheduling offers Apply');
  if (out) await pg.screenshot({ path: path.join(out, 'assistant-schedule.png') });
  await pg.locator('#asOut .ascard').first().locator('button', { hasText: 'Apply this schedule' }).click(); await pg.waitForTimeout(400);
  ok(db.tasks.filter((x) => x.text.startsWith('Buy milk'))[0].due > 0, 'applying the schedule gave tasks a start time');
  t = await ask('remember that I prefer meetings after 11'); ok(/I will remember/.test(t) && db.memory.length === 1, 'memory saved on explicit request');
  t = await ask('I usually go to the gym at 6 PM'); ok(/Want me to remember/.test(t) && db.memory.length === 1, 'statement only proposed, not stored');
  await pg.locator('#asOut .ascard').first().locator('button', { hasText: 'Remember this' }).click(); await pg.waitForTimeout(300); ok(db.memory.length === 2, 'Remember this stores it');
  t = await ask('summarise the selected text'); ok(/Stub model answer|Gist|Meeting moved/.test(t), 'summarise uses selection/clipboard + model');
  t = await ask("what's on my screen"); ok(/invoice/.test(t) && (await pg.locator('#asOut .ascard').first().locator('button', { hasText: 'Add task' }).count()) === 1, 'screen assistant shows an action chip');
  t = await ask('how much did I spend on food this month'); ok(/₹250/.test(t), 'expense search answer');
  t = await ask('set a timer for 10 minutes'); ok(/Timer set for 10 minutes/.test(t), 'voice command: timer');
  t = await ask('delete buy milk'); ok(/Delete/.test(t) && (await pg.locator('#asOut .ascard').first().locator('button', { hasText: 'Yes, delete' }).count()) === 1, 'destructive action asks first');
  if (out) await pg.screenshot({ path: path.join(out, 'assistant-more.png') });
  await pg.evaluate(() => { const b = [...document.querySelectorAll('#dots button')].find((x) => x.dataset.go === 'home'); b && b.click(); }); await pg.waitForTimeout(900);
  ok((await pg.locator('#hSug').isVisible()), 'Home shows a contextual suggestion'); if (out) await pg.screenshot({ path: path.join(out, 'home-suggestion.png') });
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' / ') : ''));
  await br.close();
})();
