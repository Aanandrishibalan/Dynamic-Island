/* Wellness wiring: planner (income, amounts, shopping capture), assistant (events/birthdays/briefing), intents (routing), assist (ops), wellmain (ticks). */
const W = require('../dynamic-island/wellness.js'), P = require('../dynamic-island/planner.js'), A = require('../dynamic-island/assistant.js'), I = require('../dynamic-island/intents.js');
const createAssist = require('../dynamic-island/assist.js'), createWell = require('../dynamic-island/wellmain.js');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)));
const L = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = L(2026, 11, 23, 10, 0);

// ---- planner
eq([P.parseAmount('1,200.50'), P.parseAmount('1,200'), P.parseAmount('12,5'), P.parseAmount('1.200,50'), P.parseAmount('250')], [1200.5, 1200, 12.5, 1200.5, 250], 'amounts: thousands separators and decimal commas');
let c = P.parseCapture('spent 1,200.50 on lunch'); ok(c.kind === 'expense' && c.amount === 1200.5 && c.cat === 'Food', '"spent 1,200.50 on lunch" is one expense of 1200.50');
c = P.parseCapture('received 25,000 salary'); ok(c.kind === 'income' && c.amount === 25000 && c.cat === 'Salary', 'income capture');
c = P.parseCapture('add milk and eggs to the shopping list'); ok(c.kind === 'shopping' && c.text === 'milk and eggs', 'shopping capture');
ok(P.parseCapture('shopping: call the bank').kind === 'task', 'the "shopping:" category prefix is still a task');
eq([P.sanitizeExpense({ amount: 10 }).type, P.sanitizeExpense({ amount: 10, type: 'income', cat: 'Salary' }).cat, P.sanitizeExpense({ amount: 10, type: 'income', cat: 'Food' }).cat], ['expense', 'Salary', 'Other'], 'expense entries gain a type; income categories are separate');
const base = new Date(2026, 10, 23, 12).getTime(), sum = P.expenseSummary([{ t: base, amount: 100, type: 'expense', cat: 'Food' }, { t: base, amount: 1000, type: 'income', cat: 'Salary' }, { t: base, amount: 50, cat: 'Food' }], base);
ok(sum.month === 150 && sum.incomeMonth === 1000 && sum.balanceMonth === 850, 'summary keeps income out of spending and gives a balance');

// ---- assistant: repeating events and birthdays
const bd = W.armEvent(W.sanitizeEvent({ id: 'b', date: '1990-11-23', title: "Ravi's birthday", kind: 'birthday', born: 1990 }), NOW - 3600e3);
const snap = A.snapshot({ events: [bd], tasks: [] }, NOW); ok(snap.todayEvents.length === 1 && snap.birthdays.length === 1 && snap.todayEvents[0].age === 36, 'a birthday shows on its day with the age');
ok(A.buildBriefing({ events: [bd], tasks: [] }, { now: NOW, region: 'IN' }).text.includes('Birthday today: Ravi\'s birthday (36)'), 'briefing mentions the birthday');
ok(A.buildBriefing({ events: [], tasks: [] }, { now: L(2026, 1, 26, 9), region: 'IN' }).text.includes('Republic Day'), 'briefing mentions a public holiday');
const wk = W.sanitizeEvent({ id: 'w', date: '2026-11-02', time: '14:00', title: 'Standup', repeat: 'weekly' });
ok(A.snapshot({ events: [wk], tasks: [] }, NOW).todayEvents[0].at === L(2026, 11, 23, 14, 0), 'a weekly event today starts at its own time (not its next alert)');

// ---- intents
const d = { shopping: [{ id: 's1', text: 'milk', done: false }], alarms: [{ id: 'a1', time: '07:00', days: [], on: true, next: L(2026, 11, 24, 7) }], countdowns: [], events: [], tasks: [] };
const R = (t) => I.route(t, { now: NOW, data: d, settings: { clock24: true, holidayRegion: 'IN' } });
const ops = (t) => R(t).ops.map((o) => o.op).join();
eq(ops('add rice and dal to the shopping list'), 'shopAdd', 'intent: shopping add');
eq(ops('I bought milk'), 'shopDone', 'intent: tick off an item');
eq(ops('set an alarm for 6:30 am on weekdays'), 'alarmAdd,go', 'intent: alarm');
eq(R('set an alarm for 6:30 am on weekdays').ops[0].days, [1, 2, 3, 4, 5], 'intent: alarm weekdays');
eq(ops('turn off my alarm'), 'alarmOff', 'intent: alarm off');
eq(ops('start pomodoro'), 'pomo,go', 'intent: pomodoro');
eq(R('remind me to drink water every 45 minutes').ops[0].patch, { waterOn: true, waterEvery: 45 }, 'intent: water reminders');
eq(R('screen break reminder every 20 minutes').ops[0].patch, { screenBreakOn: true, screenBreakEvery: 20 }, 'intent: screen break');
eq(R("add Ravi's birthday on 5 March 1990").ops[0], { op: 'addBirthday', title: "Ravi's birthday", date: '1990-03-05', born: 1990 }, 'intent: birthday');
ok(/32 days/.test(R('countdown to Goa trip on 25 december').reply) && ops('countdown to Goa trip on 25 december') === 'addCountdown,go', 'intent: countdown');
ok(/Christmas Day is in 32 days/.test(R('how many days until christmas').reply), 'intent: days until a holiday');
const tokyoNow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(NOW);   // not hard-coded, so the test passes in any time zone
ok(new RegExp(tokyoNow + ' in Tokyo').test(R('what time is it in Tokyo').reply), 'intent: world clock question');
ok(R('remind me to call mom at 5pm').ops[0].op === 'addCapture' && R('set a timer for 10 minutes').ops[0].op === 'timer', 'normal reminders and timers are not hijacked');

// ---- assist: ops are applied to the data
const db = { settings: { clock24: true, holidayRegion: 'IN' }, tasks: [], events: [], habits: [], goals: [], journal: [], expenses: [], notes: [], memory: [], meetings: [], conversations: [], shopping: [], alarms: [], countdowns: [], zones: [], pomo: W.POMO_IDLE };
let pomoCalls = [];
const as = createAssist({ getDb: () => db, save() {}, now: () => NOW, provider: () => 'ollama', chat: async () => ({ ok: false, text: 'x' }), setTasks(l) { db.tasks = l; }, captureAdd: async () => ({ ok: true, text: 'x' }), pomo: (a) => pomoCalls.push(a), locale: () => 'en-IN' });
(async () => {
  await as.ask('add milk, eggs and 2 kg rice to the shopping list'); eq(db.shopping.map((x) => x.text).sort(), ['2 kg rice', 'eggs', 'milk'], 'op: shopping items saved');
  await as.ask('set an alarm for 6:30 am on weekdays'); ok(db.alarms.length === 1 && db.alarms[0].on && db.alarms[0].next === L(2026, 11, 24, 6, 30), 'op: alarm saved and armed');
  await as.ask('turn off all alarms'); ok(db.alarms.every((a) => !a.on && a.next === 0), 'op: alarms switched off');
  await as.ask("add Ravi's birthday on 5 March 1990"); ok(db.events.length === 1 && db.events[0].kind === 'birthday' && db.events[0].repeat === 'yearly' && db.events[0].due === L(2027, 3, 5, 9), 'op: birthday saved and armed for 09:00 next 5 March');
  await as.ask('remind me to drink water every 30 minutes'); ok(db.settings.waterOn === true && db.settings.waterEvery === 30, 'op: water reminder setting');
  await as.ask('start pomodoro'); eq(pomoCalls, ['start'], 'op: pomodoro start reaches the main process');
  await as.ask('add Tokyo to world clock'); eq(db.zones.map((z) => z.tz), ['Asia/Tokyo'], 'op: world clock zone');
  await as.ask('countdown to Goa trip on 25 december'); eq(db.countdowns.map((x) => x.label + x.date), ['Goa trip2026-12-25'], 'op: countdown');

  // ---- wellmain: the tick
  const sent = [], notes = []; let t = NOW;
  const db2 = { settings: { ...W.SETTING_DEFAULTS, waterOn: true, waterEvery: 60, breakOn: false, screenBreakOn: true, screenBreakEvery: 5, storageOn: true, storageMinGB: 10 }, events: [], alarms: [], countdowns: [], goals: [{ id: 'g', text: 'Drink water', target: 8, unit: 'glasses', log: {} }], pomo: W.POMO_IDLE };
  const GB = 1073741824, w = createWell({ getDb: () => db2, save() {}, now: () => t, trusted: () => true, notify: (a, b) => notes.push(a + ': ' + b), send: (ch, p) => sent.push([ch, p]), idleSec: () => 0, drives: () => [{ l: 'C', total: 500 * GB, free: 2 * GB }] });
  db2.events.push(W.armEvent(W.sanitizeEvent({ id: 'e', date: '2026-11-23', time: '10:00', title: 'Yearly thing', repeat: 'yearly' }), NOW - 60000));
  db2.alarms.push(W.sanitizeAlarm({ id: 'a', time: '10:00', on: true, days: [1, 2, 3, 4, 5] }, NOW - 60000));
  db2.countdowns.push(W.sanitizeCountdown({ id: 'c', label: 'Trip', date: '2026-11-23' }));
  w.tick(t); t += 5000; w.tick(t);
  ok(sent.some((x) => x[0] === 'reminder' && x[1].text === 'Yearly thing') && db2.events[0].due === L(2027, 11, 23, 10, 0) && db2.events[0].notified === false, 'tick: repeating event fires once and re-arms for next year');
  ok(sent.some((x) => x[0] === 'alert' && x[1].kind === 'alarm') && db2.alarms[0].next === L(2026, 11, 24, 10, 0), 'tick: alarm rings and re-arms');
  ok(sent.filter((x) => x[0] === 'alert' && x[1].kind === 'countdown').length === 1 && sent.filter((x) => x[0] === 'alert' && x[1].kind === 'storage').length === 1, 'tick: countdown and storage alerts fire once');
  w.pomoAction('start'); ok(db2.pomo.phase === 'work', 'pomodoro start'); t += 25 * 60000 + 1000; w.tick(t);
  ok(db2.pomo.phase === 'short' && sent.some((x) => x[1] && x[1].kind === 'pomo'), 'tick: pomodoro moves to the break and says so');
  const n0 = sent.length; for (let i = 0; i < 62; i++) { t += 5000; w.tick(t); }
  ok(sent.slice(n0).filter((x) => x[1] && x[1].kind === 'screen').length === 1, 'tick: screen break alert after 5 minutes of continuous use (once)');
  t += 10 * 60000; w.tick(t); ok(w.state.sb.active === 0, 'tick: a long gap (PC asleep) counts as a break');
  ok(w.battery({ pct: 15, charging: false }).length === 1 && w.battery({ pct: 14, charging: false }).length === 0, 'battery: low alert once');
  ok(w.drank() && db2.goals[0].log[P.ymd(new Date(t))] === 1, 'drank: bumps the water goal');
  const s = w.cleanSettings({ waterEvery: 1, evil: 1, waterOn: 'yes' }, db2.settings); ok(s.evil === 1 && s.waterEvery === 5 && s.waterOn === true && Object.keys(s).length === 3, 'settings: wellness keys validated, others left for the caller');

  // ---- wellmain: the 5-second timer (setInterval is captured, so no real waiting)
  {
    const realSI = global.setInterval, realCI = global.clearInterval, made = [], cleared = [];
    global.setInterval = (fn, ms) => { const h = { fn, ms, unref() {} }; made.push(h); return h; };
    global.clearInterval = (h) => { cleared.push(h); };
    try {
      const sent3 = []; let t3 = NOW;
      const db3 = { settings: { ...W.SETTING_DEFAULTS, waterOn: false, breakOn: false, screenBreakOn: false, storageOn: false }, events: [], alarms: [W.sanitizeAlarm({ id: 'a', time: '10:00', on: true, days: [] }, NOW - 60000)], countdowns: [], goals: [], pomo: W.POMO_IDLE };
      const w3 = createWell({ getDb: () => db3, save() {}, now: () => t3, trusted: () => true, notify() {}, send: (ch, p) => sent3.push([ch, p]) });
      w3.start(); w3.start();
      ok(made.length === 1 && made[0].ms === 5000, 'timer: start() makes one 5-second interval (a second start() adds none)');
      ok(sent3.length === 0, 'timer: nothing fires before the first tick');
      t3 = NOW + 1000; made[0].fn();
      ok(sent3.filter((x) => x[0] === 'alert' && x[1].kind === 'alarm').length === 1, 'timer: the interval callback runs the tick and rings the due alarm');
      made[0].fn(); ok(sent3.filter((x) => x[0] === 'alert' && x[1].kind === 'alarm').length === 1, 'timer: the next 5-second tick does not ring the same alarm again');
      w3.stop(); ok(cleared.length === 1 && cleared[0] === made[0] && w3.state.started === false, 'timer: stop() clears the interval');
      w3.start(); ok(made.length === 2, 'timer: it can be started again after stop()'); w3.stop();
      const bad = createWell({ getDb: () => { throw new Error('db gone'); }, save() {}, now: () => NOW, trusted: () => true, notify() {}, send() {} });
      let threw = false; try { bad.tick(NOW); } catch { threw = true; } ok(!threw, 'timer: a failing tick never throws out of the interval');
    } finally { global.setInterval = realSI; global.clearInterval = realCI; }
  }

  // ---- wellmain: battery readings as the page sends them
  {
    const sent4 = [], notes4 = [];
    const db4 = { settings: { ...W.SETTING_DEFAULTS, batteryOn: true, batteryLow: 20, batteryFullOn: true, batteryFull: 80 }, events: [], alarms: [], countdowns: [], goals: [], pomo: W.POMO_IDLE };
    const w4 = createWell({ getDb: () => db4, save() {}, now: () => NOW, trusted: () => true, notify: (a, b) => notes4.push(a + ': ' + b), send: (ch, p) => sent4.push([ch, p]) });
    const lv = (r) => r.map((a) => a.level).join();
    eq(lv(w4.battery({ pct: 60, charging: false })), '', 'battery: no alert at 60%');
    eq(lv(w4.battery({ pct: 20, charging: false })), 'low', 'battery: low alert at the 20% setting');
    eq(lv(w4.battery({ pct: 19, charging: false })), '', 'battery: no repeat while it stays low');
    eq(lv(w4.battery({ pct: 9, charging: false })), 'critical', 'battery: a separate critical alert at 9%');
    ok(sent4.filter((x) => x[0] === 'alert' && x[1].kind === 'battery').length === 2 && notes4.length === 2, 'battery: each alert is a notification and an island alert');
    eq(lv(w4.battery({ pct: 15, charging: true })), '', 'battery: plugging in clears the low state with no alert');
    eq(lv(w4.battery({ pct: 80, charging: true })), 'full', 'battery: "charged" alert at the 80% setting while charging');
    eq(lv(w4.battery({ pct: 81, charging: true })), '', 'battery: no repeat of the charged alert');
    eq(lv(w4.battery({ pct: 50, charging: false })), '', 'battery: unplugged at 50% is quiet');
    eq(lv(w4.battery({ pct: 20, charging: false })), 'low', 'battery: low alert fires again on the next discharge');
    db4.settings.batteryOn = false; w4.state.bat = null;
    eq(lv(w4.battery({ pct: 5, charging: false })), '', 'battery: nothing when low-battery alerts are switched off');
    const n4 = sent4.length;
    ok(w4.battery(null).length === 0 && w4.battery({ pct: 'abc' }).length === 0 && w4.battery('x').length === 0 && sent4.length === n4, 'battery: junk readings are ignored');
    eq(w4.battery({ pct: 250, charging: true }).map((a) => a.pct), [100], 'battery: an out-of-range reading is clamped to 100%');
    // IPC: only trusted senders may report a reading
    const handlers = {}, ipc = { on: (c, f) => { handlers[c] = f; }, handle: (c, f) => { handlers[c] = f; } };
    let trust = false; const w5 = createWell({ getDb: () => db4, save() {}, now: () => NOW, trusted: () => trust, notify() {}, send: (ch, p) => sent4.push([ch, p]) }); w5.register(ipc);
    db4.settings.batteryOn = true; const before5 = sent4.length; handlers['well:battery']({}, { pct: 5, charging: false }); const afterUntrusted = sent4.length;
    trust = true; handlers['well:battery']({}, { pct: 5, charging: false });
    ok(afterUntrusted === before5 && sent4.length > afterUntrusted, 'battery: the IPC reading is ignored from an untrusted page and accepted from the island');
  }

  console.log(f ? f + ' FAILED' : 'WELLNESS INTEGRATION PASSED'); process.exit(f ? 1 : 0);
})();
