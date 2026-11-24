/* Headless UI check for the wellness screens: shopping, alarms (4 tabs), calendar extras, income, alert pop-up.
 * Run: node tests/ui.wellness.js [screenshot-dir]  (needs Playwright + Chromium) */
const path = require('path'), { chromium } = require('playwright');
const out = process.argv[2] || null;
(async () => {
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 900, height: 600 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' | '))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.addInitScript(() => {
    const noop = () => {}, pr = (v = null) => async () => v, cb = {}, calls = [];
    const db = { settings: { theme: 'dark', clock24: true, currency: '₹', hiddenSlides: [], slideOrder: [], assistBrief: 'off', pomoWork: 25, pomoShort: 5, pomoLong: 15, pomoEvery: 4, holidayRegion: 'IN' },
      conversations: [], tasks: [], events: [], notes: ['', '', ''], habits: [], goals: [], journal: [], expenses: [], memory: [], meetings: [], shopping: [], alarms: [], countdowns: [], zones: [], pomo: { phase: 'idle', end: 0, left: 0, paused: false, cycle: 0, total: 0 } };
    const base = { wellBattery: (c) => calls.push(['bat', c]), alarmSnooze: async (id, m) => { calls.push(['snooze', id, m]); return db.alarms; }, pomo: async (a) => { calls.push(['pomo', a]); db.pomo = a === 'start' ? { phase: 'work', end: Date.now() + 1500000, left: 0, paused: false, cycle: 0, total: 1500000 } : { phase: 'idle', end: 0, left: 0, paused: false, cycle: 0, total: 0 }; return db.pomo; }, drank: async () => { calls.push(['drank']); return true; },
      setIgnore: noop, action: noop, openSettings: (t) => calls.push(['settings', t]), openUrl: noop, openPath: noop, showFile: noop, openConv: noop,
      getData: async () => JSON.parse(JSON.stringify(db)), setSettings: async (p) => { Object.assign(db.settings, p); return JSON.parse(JSON.stringify(db)); },
      setData: async (p) => { Object.assign(db, p); cb.onStore && cb.onStore(JSON.parse(JSON.stringify(db))); return db; },
      chat: pr({ ok: true, text: 'hi' }), stt: pr({}), usage: pr({ screen: 0, idle: 0, apps: {}, idleNow: 0 }), weather: pr(null), news: pr([]), photos: pr([]), photoFull: pr(''), media: pr('None|||'), appsList: pr([]), appIcons: pr({}), appLaunch: pr(null), filesRecent: pr([]), filesSearch: pr([]),
      capture: pr(null), saveMedia: pr(null), screenshot: pr(null), locationDetect: pr(null), vision: pr({}),
      vault: { status: pr({}) }, onVault: noop, ai: { status: pr({}), models: pr([]) }, app: { info: pr({}), ack: pr(null) },
      net: { radios: pr({ wifi: true, bluetooth: false }), radio: pr('ok'), airplane: pr('ok'), online: pr(true), wifiScan: pr({}), btList: pr([]) },
      mail: { state: pr({ status: {}, messages: [] }), refresh: pr(null) }, sys: { get: pr({ vol: 40, muted: false, bright: 70 }), vol: noop, bright: noop, apps: pr([]), stats: pr({}) },
      speed: { live: pr({ error: true }) }, assist: { ask: pr({ ok: true, reply: 'x' }), suggest: pr([]), brief: pr({}), act: pr({}), copy: noop },
      tools: new Proxy({}, { get: () => new Proxy({}, { get: () => pr(null) }) }) };
    for (const k of ['onStore', 'onCollapse', 'onToggle', 'onOpenConv', 'onReminder', 'onAlert', 'onMail', 'onMailNew', 'onGoto', 'onCapture', 'onVoice', 'onClip', 'onExpander', 'onOcr', 'onXfer', 'onSpeed']) base[k] = (f) => { cb[k] = f; };
    window.island = base; window.__cb = cb; window.__calls = calls; window.__db = db;
  });
  await pg.addInitScript(() => {   // sound + battery stubs: record every chime note, and let the test move the battery
    window.__audio = { ctx: 0, notes: [] };
    window.AudioContext = class { constructor() { window.__audio.ctx++; this.currentTime = 0; this.destination = {}; this.state = 'running'; }
      resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
      createGain() { const p = () => {}; return { gain: { setValueAtTime: p, linearRampToValueAtTime: p, exponentialRampToValueAtTime: p, value: 1 }, connect: p }; }
      createOscillator() { const a = window.__audio, o = { type: '', frequency: { value: 0 }, connect() {}, start() { a.notes.push(o.frequency.value); }, stop() {} }; return o; } };
    const bat = { level: 0.15, charging: false, _l: {}, addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); } };
    window.__bat = bat; window.__fireBat = (t) => (bat._l[t] || []).forEach((f) => f());
    navigator.getBattery = () => Promise.resolve(bat);
  });
  await pg.goto('file://' + path.resolve(__dirname, '../dynamic-island/index.html')); await pg.waitForTimeout(500);
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  await pg.evaluate(() => window.__cb.onToggle()); await pg.waitForTimeout(900);
  const go = async (id) => { await pg.evaluate((i) => { const b = [...document.querySelectorAll('#dots button')].find((x) => x.dataset.go === i); b && b.click(); }, id); await pg.waitForTimeout(700); };
  const shot = async (n) => { if (out) await pg.screenshot({ path: path.join(out, n + '.png') }); };
  const txt = (sel) => pg.locator(sel).innerText();

  /* shopping */
  await go('shopping'); ok(await pg.locator('#sl-shopping').isVisible(), 'shopping slide opens');
  await pg.fill('#shIn', 'milk, 2 kg rice and eggs'); await pg.click('#shAdd'); await pg.waitForTimeout(200);
  ok((await pg.locator('#shList .tk:not(.sec)').count()) === 3, 'three items added from one line');
  await pg.locator('#shList [data-shtk]').first().click(); await pg.waitForTimeout(200);
  ok(/bought/i.test(await txt('#shList')) && /2 to buy/.test(await txt('#shSub')), 'ticking moves an item to Bought');
  await pg.fill('#shIn', 'milk'); await pg.click('#shAdd'); await pg.waitForTimeout(200);
  ok((await pg.locator('#shList .tk:not(.sec)').count()) === 3, 'a duplicate is not added twice');
  await shot('shopping');
  await pg.click('#shClearDone'); await pg.waitForTimeout(200); ok(!/bought/i.test(await txt('#shList')), 'clear bought');
  await pg.click('#shClearAll'); ok(/Tap again/.test(await txt('#shClearAll')), 'clear all asks twice'); await pg.click('#shClearAll'); await pg.waitForTimeout(200);
  ok((await pg.evaluate(() => window.__db.shopping.length)) === 0, 'clear all empties the list');

  /* alarms */
  await go('alarms'); ok(await pg.locator('#alP-alarm').isVisible(), 'alarms slide opens on the Alarm tab');
  await pg.fill('#alTime', '06:30'); await pg.fill('#alLabel', 'Gym'); await pg.click('#alDays [data-dpre=wd]'); await pg.click('#alAdd'); await pg.waitForTimeout(200);
  ok(/6:?30|06:30/.test(await txt('#alList')) && /Weekdays/.test(await txt('#alList')) && /Gym/.test(await txt('#alList')), 'alarm added with label and weekdays');
  await pg.click('#alList [data-alsw]'); await pg.waitForTimeout(200); ok((await pg.evaluate(() => window.__db.alarms[0].on)) === false, 'alarm switch turns it off');
  await shot('alarms');
  await pg.click('[data-altab=world]'); await pg.selectOption('#wcSel', 'Asia/Tokyo'); await pg.click('#wcAdd'); await pg.waitForTimeout(200);
  ok(/Tokyo/.test(await txt('#wcList')) && /This PC/.test(await txt('#wcList')), 'world clock shows Tokyo and this PC'); await shot('world');
  await pg.click('[data-altab=pomo]'); ok(/25:00/.test(await txt('#pmTime')), 'pomodoro shows 25:00'); await pg.click('#pmMain'); await pg.waitForTimeout(300);
  ok(/Focus/.test(await txt('#pmPhase')) && /Pause/.test(await txt('#pmMain')), 'pomodoro starts a focus phase'); await shot('pomo');
  await pg.click('#pmStop'); await pg.waitForTimeout(300); ok(/Ready/.test(await txt('#pmPhase')), 'pomodoro stops');
  await pg.click('#pmSet'); ok((await pg.evaluate(() => window.__calls.some((c) => c[0] === 'settings' && c[1] === 'wellness'))), 'durations button opens the wellness settings tab');
  await pg.click('[data-altab=count]'); await pg.fill('#cdLabel', 'Goa trip'); await pg.fill('#cdDate', new Date(Date.now() + 10 * 864e5).toLocaleDateString('en-CA')); await pg.click('#cdAdd'); await pg.waitForTimeout(200);
  ok(/Goa trip/.test(await txt('#cdList')) && /10 days/.test(await txt('#cdList')), 'countdown shows 10 days'); await shot('countdown');

  /* calendar */
  await go('calendar'); await pg.click('[data-evk=birthday]'); await pg.fill('#evText', 'Ravi'); await pg.fill('#evBorn', '1990'); await pg.click('#evAdd'); await pg.waitForTimeout(200);
  ok(/Ravi's birthday/.test(await txt('#evList')) && /\(\d+\)/.test(await txt('#evList')), 'birthday saved with age');
  ok((await pg.evaluate(() => { const e = window.__db.events[0]; return e.kind === 'birthday' && e.repeat === 'yearly' && e.born === 1990; })), 'birthday stored as yearly');
  await pg.click('[data-evk=birthday]'); await pg.fill('#evText', 'Team sync'); await pg.selectOption('#evRep', 'weekly'); await pg.click('#evAdd'); await pg.waitForTimeout(200);
  ok(/Weekly/.test(await txt('#evList')), 'weekly event shows its repeat');
  await pg.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 7); document.querySelector('[data-cd="' + d.toLocaleDateString('en-CA') + '"]').click(); }); await pg.waitForTimeout(200);
  ok(/Team sync/.test(await txt('#evList')), 'weekly event also appears a week later'); await shot('calendar');
  const holOn = async (iso) => { const [y, m] = iso.split('-').map(Number), now = new Date(); let diff = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
    await pg.click('[data-calnav="0"]'); for (; diff > 0; diff--) await pg.click('[data-calnav="1"]'); for (; diff < 0; diff++) await pg.click('[data-calnav="-1"]');
    await pg.click('[data-cd="' + iso + '"]'); await pg.waitForTimeout(150); };
  const y0 = new Date().getFullYear();
  await holOn(y0 + '-12-25'); ok(/Christmas Day/.test(await txt('#evList')) && /Holiday/.test(await txt('#evList')), 'calendar lists the India holiday (Christmas Day) on 25 Dec');
  ok(/Christmas Day/.test(await pg.getAttribute('[data-cd="' + y0 + '-12-25"]', 'aria-label')), 'the holiday is also in that date cell\'s accessible label');
  ok((await pg.locator('[data-cd="' + y0 + '-12-25"] i.h').count()) === 1, 'a holiday with nothing else planned gets the holiday dot');
  await holOn((y0 + 1) + '-01-26'); ok(/Republic Day/.test(await txt('#evList')), 'Republic Day shows on 26 Jan next year');
  await holOn(y0 + '-12-24'); ok(!/Holiday/.test(await txt('#evList')), 'an ordinary date shows no holiday');
  await pg.evaluate(() => { window.__db.settings.holidayRegion = 'none'; window.__cb.onStore(JSON.parse(JSON.stringify(window.__db))); }); await holOn(y0 + '-12-25'); await pg.waitForTimeout(100);
  const noneHol = /Christmas Day/.test(await txt('#evList')); await pg.evaluate(() => { window.__db.settings.holidayRegion = 'IN'; window.__cb.onStore(JSON.parse(JSON.stringify(window.__db))); });
  ok(!noneHol, 'with the holiday region switched off the holiday is hidden');
  await shot('calendar-holiday');

  /* expenses */
  await go('expenses'); await pg.click('[data-ext=income]'); ok(/Salary/.test(await txt('#exCats')), 'income categories shown');
  await pg.fill('#exAmt', '5000'); await pg.fill('#exNote', 'salary'); await pg.click('#exAdd'); await pg.waitForTimeout(200);
  ok(/\+₹5,000/.test(await txt('#exList')) && /Income/.test(await txt('#exTop')), 'income entry listed with + and totals');
  await pg.click('[data-ext=expense]'); await pg.fill('#exAmt', '250'); await pg.fill('#exNote', 'lunch'); await pg.click('#exAdd'); await pg.waitForTimeout(200);
  ok(/Balance ₹4,750/.test(await txt('#exTop')), 'balance = income minus spending'); await shot('expenses');

  /* alerts */
  const alert = async (a) => { await pg.evaluate((x) => window.__cb.onAlert(x), a); await pg.waitForTimeout(400); };
  await alert({ kind: 'alarm', id: 'a1', title: 'Gym', text: 'x', time: '06:30', label: 'Gym', sound: true, repeatSound: true });
  ok((await pg.evaluate(() => window.__audio.notes.join())) === '880,1175,1568', 'alarm chime plays its three notes (A5, D6, G6)');
  await pg.waitForTimeout(4300); ok((await pg.evaluate(() => window.__audio.notes.length)) === 6, 'an alarm keeps chiming every 4 seconds until stopped');
  ok(await pg.locator('#rAl').isVisible() && /Gym/.test(await txt('#rText')) && /Snooze 10/.test(await txt('#rAl')), 'alarm pop-up shows snooze buttons'); await shot('alert-alarm');
  await pg.click('[data-rem="al:snooze10"]'); await pg.waitForTimeout(300);
  { const n = await pg.evaluate(() => window.__audio.notes.length); await pg.waitForTimeout(4500); ok((await pg.evaluate(() => window.__audio.notes.length)) === n, 'the chime stops once the alarm is snoozed'); }
  ok(await pg.evaluate(() => window.__calls.some((c) => c[0] === 'snooze' && c[1] === 'a1' && c[2] === 10)), 'snooze 10 min reaches the backend');
  await alert({ kind: 'water', title: 'Water', text: 'Time for a glass of water.', action: 'drank' }); await pg.click('[data-rem="al:drank"]'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => window.__calls.some((c) => c[0] === 'drank')), 'water pop-up logs a glass');
  await alert({ kind: 'storage', title: 'Low disk space', text: 'C: has 5 GB left' }); await alert({ kind: 'storage', title: 'Low disk space', text: 'C: has 5 GB left' });
  await pg.click('[data-rem="al:dismiss"]'); await pg.waitForTimeout(300); ok(!(await pg.evaluate(() => document.getElementById('island').classList.contains('remind'))), 'duplicate alert shown once, then the island collapses');
  await pg.evaluate(() => window.__cb.onToggle()); await pg.waitForTimeout(500);
  await pg.evaluate(() => { window.__db.events = [{ id: 'b1', date: '2000-03-05', time: '', title: "Ravi's birthday", kind: 'birthday', repeat: 'yearly', done: false, notified: false, due: null }]; });
  await pg.evaluate(() => window.__cb.onReminder({ id: 'b1', text: "Ravi's birthday today", kind: 'birthday' })); await pg.waitForTimeout(400);
  ok(/Birthday/.test(await txt('#rKind')), 'birthday reminder labelled Birthday');
  await pg.click('[data-rem=done]'); await pg.waitForTimeout(300); ok((await pg.evaluate(() => window.__db.events[0].done)) === false, 'Done on a birthday keeps it repeating');

  { const n = await pg.evaluate(() => window.__audio.notes.length);
    await alert({ kind: 'battery', level: 'low', title: 'Battery low', text: 'Battery low: 15%.', sound: false });
    ok(/Battery low/.test(await txt('#rText')) && (await pg.evaluate(() => window.__audio.notes.length)) === n, 'an alert sent with sound:false shows but stays silent');
    await pg.click('[data-rem="al:dismiss"]'); await pg.waitForTimeout(300);
    await alert({ kind: 'storage', title: 'Low disk space', text: 'C: low' });
    ok((await pg.evaluate(() => window.__audio.notes.length)) === n + 3, 'an ordinary alert plays the chime once (3 notes)');
    await pg.click('[data-rem="al:dismiss"]'); await pg.waitForTimeout(300); }

  /* battery: the page reads navigator.getBattery and reports to the main process, which owns the alerts */
  { const bat = () => pg.evaluate(() => window.__calls.filter((c) => c[0] === 'bat').map((c) => c[1]));
    let r = await bat(); ok(r.length >= 1 && r[0].pct === 15 && r[0].charging === false, 'battery reading (15%, not charging) is sent on start-up');
    ok(/15%/.test(await txt('#batTxt')) && (await pg.evaluate(() => document.getElementById('batFill').style.width)) === '15%', 'the battery pill shows 15%');
    await pg.evaluate(() => { window.__bat.level = 0.9; window.__bat.charging = true; window.__fireBat('levelchange'); }); await pg.waitForTimeout(200);
    r = await bat(); ok(r[r.length - 1].pct === 90 && r[r.length - 1].charging === true, 'a level change sends the new reading (90%, charging)');
    ok(/90%/.test(await txt('#batTxt')), 'the battery pill follows to 90%');
    const n = r.length; await pg.evaluate(() => { window.__bat.charging = false; window.__fireBat('chargingchange'); }); await pg.waitForTimeout(200);
    r = await bat(); ok(r.length === n + 1 && r[r.length - 1].charging === false, 'unplugging sends a fresh reading'); }

  /* thinking */
  ok((await pg.locator('#asThink').count()) === 1, 'thinking row exists');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' / ') : ''));
  await br.close();
})();
