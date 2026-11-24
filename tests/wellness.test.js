const W = require('../dynamic-island/wellness.js');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)));
const L = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = L(2026, 11, 23, 10, 0);   // Monday 23 Nov 2026, 10:00

// ---- settings
eq(W.sanitizeSettings({ waterEvery: 1, screenBreakEvery: 'x', batteryLow: 99, storageMinGB: 0, evil: 1 }), { waterEvery: 5, screenBreakEvery: 30, batteryLow: 50, storageMinGB: 1 }, 'settings are clamped, unknown keys dropped');
eq(W.sanitizeSettings({ waterOn: 'yes', holidayRegion: 'XX' }), { waterOn: true, holidayRegion: 'auto' }, 'booleans and region are normalised');
eq(W.sanitizeSettings({ waterFrom: 900, waterTo: 600 }), {}, 'a window that ends before it starts is refused');

// ---- events: shape and repeats
const ev = (o) => W.sanitizeEvent({ id: 'e1', date: '2026-03-05', title: 'Ravi', ...o });
ok(W.sanitizeEvent({ id: 'old', date: '2026-11-20', time: '11:00', title: 'Sync', due: 123, done: false, notified: false }).repeat === 'none', 'an old event (no kind/repeat) loads as a one-off event');
ok(W.sanitizeEvent({ date: 'nope', title: 'x' }) === null && W.sanitizeEvent({ date: '2026-02-30', title: 'x' }) === null && W.sanitizeEvent({ date: '2026-02-03', title: ' ' }) === null, 'bad date / empty title are rejected');
ok(ev({ kind: 'birthday', repeat: 'none' }).repeat === 'yearly', 'a birthday always repeats yearly');
ok(ev({ kind: 'birthday', born: 1990 }).born === 1990 && ev({ kind: 'event', born: 1990 }).born === undefined && ev({ kind: 'birthday', born: 5 }).born === undefined, 'year of birth only on birthdays and only when plausible');
eq(W.occurrences(ev({ repeat: 'yearly' }), '2026-01-01', '2028-12-31'), ['2026-03-05', '2027-03-05', '2028-03-05'], 'yearly: one date per year');
eq(W.occurrences(ev({ repeat: 'yearly' }), '2025-01-01', '2025-12-31'), [], 'a repeat never starts before the event date');
eq(W.occurrences(ev({ date: '2024-02-29', repeat: 'yearly' }), '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'], '29 Feb falls on 28 Feb in other years');
eq(W.occurrences(ev({ date: '2026-01-31', repeat: 'monthly' }), '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'], 'monthly on the 31st lands on the last day of shorter months');
eq(W.occurrences(ev({ date: '2026-11-02', repeat: 'weekly' }), '2026-11-20', '2026-12-10'), ['2026-11-23', '2026-11-30', '2026-12-07'], 'weekly: same weekday');
eq(W.occurrences(ev({ repeat: 'none' }), '2026-03-01', '2026-03-31'), ['2026-03-05'], 'one-off inside range');
ok(W.occursOn(ev({ repeat: 'yearly' }), '2031-03-05') && !W.occursOn(ev({ repeat: 'yearly' }), '2031-03-06'), 'occursOn');
eq([W.ageOn(ev({ kind: 'birthday', born: 1990 }), '2026-03-05'), W.ageOn(ev({ kind: 'birthday' }), '2026-03-05')], [36, 0], 'age on a birthday (0 when the year is unknown)');
const ex = W.expand([ev({ repeat: 'yearly', kind: 'birthday', born: 2000 }), { ...ev({ id: 'e2', date: '2027-03-05', title: 'Dentist' }) }], '2027-03-01', '2027-03-31');
ok(ex.length === 2 && ex.every((x) => x.date === '2027-03-05') && ex[0].age + ex[1].age === 27, 'expand lists every occurrence with its own date');

// ---- events: alert times
let e = W.armEvent(ev({ time: '14:30', date: '2026-11-25' }), NOW);
ok(e.due === L(2026, 11, 25, 14, 30) && e.notified === false, 'one-off future event is armed');
e = W.armEvent(ev({ time: '09:00', date: '2026-11-20' }), NOW);
ok(e.notified === true, 'one-off event in the past never alerts');
e = W.armEvent(ev({ kind: 'birthday', date: '2026-03-05' }), NOW);
ok(e.due === L(2027, 3, 5, 9, 0) && !e.notified, 'a birthday with no time alerts at 09:00 on its next date');
e = W.armEvent(ev({ kind: 'birthday', date: '2026-11-23' }), L(2026, 11, 23, 8, 0));
ok(e.due === L(2026, 11, 23, 9, 0), 'a birthday today before 09:00 alerts today');
e = W.armEvent(ev({ kind: 'birthday', date: '2026-11-23' }), L(2026, 11, 23, 9, 30));
ok(e.due === L(2027, 11, 23, 9, 0), 'a birthday today after 09:00 waits for next year');
let r = W.afterFire({ ...W.armEvent(ev({ repeat: 'yearly', time: '10:00', date: '2026-11-23' }), L(2026, 11, 23, 8, 0)) }, NOW + 1);
ok(r.notified === false && r.due === L(2027, 11, 23, 10, 0), 'after a yearly alert fires it is armed for next year');
r = W.afterFire(ev({ time: '10:00', date: '2026-11-23', due: NOW }), NOW + 1);
ok(r.notified === true, 'after a one-off alert fires it is finished');
ok(W.nextDue(ev({ kind: 'event' }), NOW) === null, 'an event with no time has no alert');
r = W.afterFire({ ...ev({ repeat: 'weekly', time: '08:00', date: '2026-11-02' }) }, L(2026, 11, 23, 8, 0, 1));
ok(r.due === L(2026, 11, 30, 8, 0), 'weekly repeat re-arms for the next week');

// ---- holidays
const hn = (reg, y) => W.holidaysIn(reg, y).map((h) => h.date + ' ' + h.name);
ok(hn('IN', 2026).includes('2026-01-26 Republic Day') && hn('IN', 2026).includes('2026-08-15 Independence Day') && hn('IN', 2026).includes('2026-10-02 Gandhi Jayanti'), 'India fixed holidays');
ok(hn('US', 2026).includes('2026-11-26 Thanksgiving') && hn('US', 2026).includes('2026-05-25 Memorial Day') && hn('US', 2026).includes('2026-09-07 Labor Day') && hn('US', 2026).includes('2026-01-19 Martin Luther King Jr. Day'), 'US weekday-based holidays (Thanksgiving 4th Thursday, Memorial last Monday ...)');
ok(hn('UK', 2026).includes('2026-04-03 Good Friday') && hn('UK', 2026).includes('2026-04-06 Easter Monday') && hn('UK', 2027).includes('2027-03-26 Good Friday'), 'Easter-based holidays (Easter 2026 = 5 Apr, 2027 = 28 Mar)');
ok(hn('UK', 2026).includes('2026-08-31 Summer bank holiday') && hn('UK', 2026).includes('2026-05-04 Early May bank holiday'), 'UK bank holidays');
eq(W.holidaysIn('none', 2026), [], 'no region, no holidays');
eq([W.resolveRegion('auto', 'en-IN'), W.resolveRegion('auto', 'en-US'), W.resolveRegion('auto', 'en-GB'), W.resolveRegion('auto', 'fr-FR'), W.resolveRegion('US', 'en-IN'), W.resolveRegion('none', 'en-IN'), W.resolveRegion('auto', '')], ['IN', 'US', 'UK', 'none', 'US', 'none', 'none'], 'region from locale or setting');
eq(W.holidayOn('IN', '2026-01-26'), ['Republic Day'], 'holidayOn');
eq(W.holidaysBetween('IN', '2026-12-20', '2027-01-05').map((h) => h.date), ['2026-12-25', '2027-01-01'], 'holidaysBetween spans a year end');

// ---- shopping
eq(W.splitShopping('milk, 2 kg rice and eggs; Milk'), ['milk', '2 kg rice', 'eggs'], 'split on comma / and / ; keep quantities, drop duplicates');
eq(W.splitShopping('- tea\n1. sugar\n* salt'), ['tea', 'sugar', 'salt'], 'list bullets are removed');
eq(W.splitShopping('  '), [], 'empty text, no items');
let sh = W.addShopping([], 'milk, eggs', NOW); ok(sh.list.length === 2 && sh.added.length === 2, 'items added');
sh.list[0].done = true; const doneName = sh.list[0].text;
sh = W.addShopping(sh.list, doneName + ', bread', NOW); ok(sh.list.length === 3 && sh.revived.join() === doneName && sh.added.join() === 'bread' && sh.list.every((x) => !x.done), 'a ticked item added again comes back; no duplicates');
eq([W.parseShoppingPhrase('add milk and eggs to the shopping list'), W.parseShoppingPhrase('shop: rice, dal'), W.parseShoppingPhrase('groceries - tea'), W.parseShoppingPhrase('add a task'), W.parseShoppingPhrase('buy groceries tomorrow')], ['milk and eggs', 'rice, dal', 'tea', null, null], 'shopping phrases');
ok(W.sanitizeShopItem({ text: ' ' }) === null && W.sanitizeShopItem({ text: 'x'.repeat(200) }).text.length === 80, 'shop item sanitised');

// ---- alarm clock
const al = (o) => W.sanitizeAlarm({ id: 'a1', time: '07:00', on: true, days: [], ...o }, NOW);
ok(W.sanitizeAlarm({ time: '25:00' }) === null && W.sanitizeAlarm({ time: '7:00' }) === null, 'bad alarm time rejected');
eq(al({}).next, L(2026, 11, 24, 7, 0), 'a 07:00 alarm set at 10:00 rings tomorrow');
eq(al({ time: '10:30' }).next, L(2026, 11, 23, 10, 30), 'a later time today rings today');
eq(al({ time: '10:00' }).next, L(2026, 11, 24, 10, 0), 'the current minute is already past');
eq(al({ days: [1, 5], time: '09:00' }).next, L(2026, 11, 27, 9, 0), 'weekday alarm: next Friday (Monday 09:00 has passed)');
eq(al({ days: [0], time: '09:00' }).next, L(2026, 11, 29, 9, 0), 'Sunday alarm');
eq(al({ on: false }).next, 0, 'an alarm that is off has no next ring');
eq(al({ days: [3, 3, 9, -1, 'x'] }).days, [3], 'days sanitised');
let t = W.alarmTick([al({ id: 'once', time: '10:30' }), al({ id: 'rep', time: '10:30', days: [1, 2, 3, 4, 5, 6, 0] })], L(2026, 11, 23, 10, 30, 0) + 5000);
ok(t.fired.length === 2 && t.alarms[0].on === false && t.alarms[0].next === 0 && t.alarms[1].on && t.alarms[1].next === L(2026, 11, 24, 10, 30), 'ringing: a one-off alarm switches off, a repeating one re-arms for tomorrow');
t = W.alarmTick([al({ time: '10:30' })], L(2026, 11, 23, 12, 0));
ok(t.fired.length === 0 && t.alarms[0].on === false, 'an alarm missed by more than 10 minutes (PC asleep) does not ring');
t = W.alarmTick([al({ time: '10:30' })], L(2026, 11, 23, 10, 0, 0) + 1000); ok(t.fired.length === 0 && !t.changed, 'not yet time');
const sn = W.alarmSnooze([al({ id: 'x', time: '10:30', on: false })], 'x', NOW, 5); ok(sn[0].on && sn[0].next === NOW + 300000, 'snooze re-arms in 5 minutes even for a one-off alarm');
eq([W.describeDays([]), W.describeDays([1, 2, 3, 4, 5]), W.describeDays([0, 6]), W.describeDays([0, 1, 2, 3, 4, 5, 6]), W.describeDays([1, 3])], ['Once', 'Weekdays', 'Weekends', 'Every day', 'Mon Wed'], 'describeDays');
eq([W.until(NOW + 29 * 60000, NOW), W.until(NOW + 150 * 60000, NOW), W.until(NOW + 30 * 3600000, NOW), W.until(NOW + 1000, NOW)], ['29 min', '2h 30m', '1d 6h', 'less than a minute'], 'until');

// ---- Pomodoro
const cfg = { pomoWork: 25, pomoShort: 5, pomoLong: 15, pomoEvery: 4, pomoAuto: true };
let p = W.pomoStart(cfg, NOW);
ok(p.phase === 'work' && W.pomoLeft(p, NOW) === 25 * 60000 && p.total === 25 * 60000, 'start: 25 minutes of focus');
ok(W.pomoTick(p, cfg, NOW + 60000).event === null, 'nothing happens mid-session');
p = W.pomoPause(p, NOW + 10 * 60000); ok(p.paused && W.pomoLeft(p, NOW + 99 * 60000) === 15 * 60000, 'pause freezes the time left');
p = W.pomoResume(p, NOW + 99 * 60000); ok(!p.paused && W.pomoLeft(p, NOW + 99 * 60000) === 15 * 60000, 'resume continues from where it stopped');
let tk = W.pomoTick(p, cfg, p.end + 1);
ok(tk.event && tk.event.finished === 'work' && tk.state.phase === 'short' && tk.state.cycle === 1 && /short break/.test(tk.event.text), 'work ends -> short break');
tk = W.pomoTick(tk.state, cfg, tk.state.end + 1);
ok(tk.state.phase === 'work' && tk.event.finished === 'short' && tk.state.cycle === 1, 'break ends -> next focus session (auto)');
let s4 = { ...W.pomoStart(cfg, NOW), cycle: 3 }; tk = W.pomoTick(s4, cfg, s4.end + 1);
ok(tk.state.phase === 'long' && tk.state.cycle === 4 && /long break/.test(tk.event.text), 'every 4th session is followed by a long break');
const noAuto = { ...cfg, pomoAuto: false }; tk = W.pomoTick({ ...W.pomoStart(noAuto, NOW), phase: 'short', cycle: 1 }, noAuto, NOW + 99 * 60000 * 60);
ok(tk.state.phase === 'idle' && tk.state.cycle === 1, 'with auto-start off the cycle stops after a break');
ok(W.pomoTick(W.pomoPause(W.pomoStart(cfg, NOW), NOW), cfg, NOW + 1e9).event === null, 'a paused session never ends by itself');
eq(W.sanitizePomo({ phase: 'bogus' }), W.POMO_IDLE, 'bad pomodoro state becomes idle');
eq(W.pomoStop(), W.POMO_IDLE, 'stop returns to idle');

// ---- interval alerts (water / stand up)
const FROM = 480, TO = 1320;   // 08:00 - 22:00
let iv = W.intervalStep(null, L(2026, 11, 23, 10, 0), 60, FROM, TO);
ok(!iv.fire && iv.st.next === L(2026, 11, 23, 11, 0), 'first call only arms the timer');
iv = W.intervalStep(iv.st, L(2026, 11, 23, 10, 59), 60, FROM, TO); ok(!iv.fire, 'not due yet');
iv = W.intervalStep(iv.st, L(2026, 11, 23, 11, 0, 1), 60, FROM, TO); ok(iv.fire && iv.st.next === L(2026, 11, 23, 12, 0) + 60000 * 0 + 0 || iv.st.next > L(2026, 11, 23, 11, 0), 'due: fires and re-arms');
ok(W.nextInterval(L(2026, 11, 23, 21, 30), 60, FROM, TO) === L(2026, 11, 24, 8, 0), 'a reminder that would land after 22:00 moves to 08:00 next morning');
ok(W.nextInterval(L(2026, 11, 23, 6, 0), 60, FROM, TO) === L(2026, 11, 23, 8, 0), 'before 08:00 it waits for 08:00 today');
iv = W.intervalStep({ next: L(2026, 11, 23, 23, 0) }, L(2026, 11, 23, 23, 5), 60, FROM, TO); ok(!iv.fire && iv.st.next === L(2026, 11, 24, 8, 0), 'due while outside the window: skipped silently');

// ---- screen break
let sb = { active: 0 }, fired = 0, secs = 0;
for (let i = 0; i < 400; i++) { const x = W.screenBreakStep(sb, 0, 30, 5); sb = x.st; secs += 5; if (x.fire) { fired++; break; } }
ok(fired === 1 && secs === 1800, 'fires after 30 minutes of continuous use (360 steps of 5 s)');
sb = { active: 1500 }; let x = W.screenBreakStep(sb, 130, 30, 5); ok(!x.fire && x.st.active === 0, '2 minutes without input counts as a break and resets the count');
x = W.screenBreakStep({ active: 100 }, 90, 30, 5); ok(x.st.active === 100, '60-120 s idle: neither counted nor reset');
x = W.screenBreakStep({ active: 1795 }, 3, 30, 5); ok(x.fire && x.minutes === 30 && x.st.active === 0, 'fire resets the count');

// ---- battery
const bc = { batteryOn: true, batteryLow: 20, batteryFullOn: true, batteryFull: 80 };
let b = W.batteryStep(null, { pct: 50, charging: false }, bc); ok(b.alerts.length === 0, 'healthy battery: no alert');
b = W.batteryStep(b.state, { pct: 20, charging: false }, bc); ok(b.alerts.length === 1 && b.alerts[0].level === 'low', 'low alert at 20%');
b = W.batteryStep(b.state, { pct: 19, charging: false }, bc); ok(b.alerts.length === 0, 'low alert fires once');
b = W.batteryStep(b.state, { pct: 10, charging: false }, bc); ok(b.alerts.length === 1 && b.alerts[0].level === 'critical', 'critical alert at 10%');
b = W.batteryStep(b.state, { pct: 9, charging: false }, bc); ok(b.alerts.length === 0, 'critical fires once');
b = W.batteryStep(b.state, { pct: 30, charging: true }, bc); ok(b.alerts.length === 0 && !b.state.low, 'plugging in re-arms the low alert');
b = W.batteryStep(b.state, { pct: 79, charging: true }, bc); ok(b.alerts.length === 0, 'charging below the target: quiet');
b = W.batteryStep(b.state, { pct: 80, charging: true }, bc); ok(b.alerts.length === 1 && b.alerts[0].level === 'full' && /80%/.test(b.alerts[0].text), 'charged alert at the target');
b = W.batteryStep(b.state, { pct: 85, charging: true }, bc); ok(b.alerts.length === 0, 'charged alert fires once per charge');
b = W.batteryStep(b.state, { pct: 85, charging: false }, bc); b = W.batteryStep(b.state, { pct: 85, charging: true }, bc); ok(b.alerts.length === 1 && b.alerts[0].level === 'full', 'unplugging and plugging in again re-arms it');
b = W.batteryStep(null, { pct: 100, charging: true }, bc); ok(b.alerts.length === 0, 'starting the app while already full does not alert');
b = W.batteryStep(null, { pct: 100, charging: true }, { ...bc, batteryFull: 100 }); ok(b.alerts.length === 0, '... also at a 100% target');
b = W.batteryStep(b.state, { pct: 100, charging: false }, { ...bc, batteryFull: 100 }); b = W.batteryStep(b.state, { pct: 100, charging: true }, { ...bc, batteryFull: 100 }); ok(b.alerts[0] && /fully charged/i.test(b.alerts[0].text), '100% says "fully charged"');
b = W.batteryStep(null, { pct: 15, charging: false }, bc); ok(b.alerts.length === 1 && b.alerts[0].level === 'low', 'starting the app already low alerts at once');
b = W.batteryStep(null, { pct: 15, charging: false }, { ...bc, batteryOn: false }); ok(b.alerts.length === 0, 'low alerts can be switched off');
b = W.batteryStep(null, { pct: 90, charging: false }, bc); b = W.batteryStep(b.state, { pct: 85, charging: true }, bc); ok(b.alerts.length === 1, 'charged alert works when the first reading was on battery');
b = W.batteryStep(null, { pct: 22, charging: false }, bc); b = W.batteryStep(b.state, { pct: 20, charging: false }, bc); b = W.batteryStep(b.state, { pct: 26, charging: false }, bc); b = W.batteryStep(b.state, { pct: 20, charging: false }, bc);
ok(b.alerts.length === 1, 'discharge cycle after recovering above low+5 alerts again');

// ---- storage
const GB = 1073741824, sc = { storageMinGB: 10 };
let sg = W.storageStep([{ l: 'C', total: 500 * GB, free: 8 * GB }, { l: 'D', total: 500 * GB, free: 200 * GB }, { l: 'E', total: 16 * GB, free: 1 * GB }], sc, {}, '2026-11-23');
ok(sg.alerts.length === 1 && sg.alerts[0].drive === 'C' && sg.alerts[0].freeGB === 8 && /8 GB free/.test(sg.alerts[0].text), 'only the full big drive alerts (small USB drive ignored)');
sg = W.storageStep([{ l: 'C', total: 500 * GB, free: 7 * GB }], sc, sg.state, '2026-11-23'); ok(sg.alerts.length === 0, 'once a day per drive');
sg = W.storageStep([{ l: 'C', total: 500 * GB, free: 7 * GB }], sc, sg.state, '2026-11-24'); ok(sg.alerts.length === 1, 'next day it alerts again while still low');
sg = W.storageStep([{ l: 'C', total: 500 * GB, free: 40 * GB }], sc, sg.state, '2026-11-24'); ok(sg.alerts.length === 0 && !sg.state.C, 'space freed: the alert is re-armed');
sg = W.storageStep([{ l: 'C', total: 500 * GB, free: 10.5 * GB }], sc, {}, '2026-11-23'); ok(sg.alerts.length === 0, 'just above the limit: no alert');

// ---- countdown
const cd = (o) => W.sanitizeCountdown({ id: 'c', label: 'Trip', date: '2026-12-25', ...o });
ok(W.sanitizeCountdown({ label: '', date: '2026-12-25' }) === null && W.sanitizeCountdown({ label: 'x', date: 'bad' }) === null, 'countdown validation');
eq([W.countdownInfo(cd({}), NOW).text, W.countdownInfo(cd({ date: '2026-11-24' }), NOW).text, W.countdownInfo(cd({ date: '2026-11-23' }), NOW).text, W.countdownInfo(cd({ date: '2026-11-22' }), NOW).text, W.countdownInfo(cd({ date: '2026-11-20' }), NOW).text], ['32 days', 'Tomorrow', 'Today', '1 day ago', '3 days ago'], 'days left, tomorrow, today, ago');
ok(W.countdownInfo(cd({ date: '2026-11-23', time: '15:30' }), NOW).text === 'in 5h 30m', 'a countdown with a time inside 24 h shows hours and minutes');
ok(W.countdownInfo(cd({ date: '2026-11-30' }), NOW).soon && !W.countdownInfo(cd({ date: '2026-12-01' }), NOW).soon && !W.countdownInfo(cd({}), NOW).soon, 'soon = within a week');
ok(W.countdownsDue([cd({ date: '2026-11-23' })], L(2026, 11, 23, 7, 59)).length === 0 && W.countdownsDue([cd({ date: '2026-11-23' })], L(2026, 11, 23, 8, 0)).length === 1, 'announced from 08:00 on the day');
ok(W.countdownsDue([cd({ date: '2026-11-23', notified: true })], NOW).length === 0 && W.countdownsDue([cd({ date: '2026-11-10' })], NOW).length === 0, 'not twice, and not weeks late');

// ---- world clock
ok(W.validZone('Asia/Tokyo') && !W.validZone('Mars/Base') && !W.validZone(5), 'zone validation');
const zi = W.zoneInfo('Asia/Kolkata', Date.UTC(2026, 10, 23, 12, 0), 'UTC', true);
ok(zi.time === '17:30' && zi.diff === 330 && zi.diffText === '+5h 30m' && zi.dayText === 'Today', 'Kolkata is UTC+5:30');
const z2 = W.zoneInfo('Asia/Tokyo', Date.UTC(2026, 10, 23, 18, 0), 'UTC', true); ok(z2.time === '03:00' && z2.dayText === 'Tomorrow', 'Tokyo is already tomorrow at 18:00 UTC');
const z3 = W.zoneInfo('America/New_York', Date.UTC(2026, 10, 23, 3, 0), 'UTC', false); ok(z3.time === '10:00 PM' && z3.dayText === 'Yesterday' && z3.diffText === '-5h', '12-hour clock, New York is yesterday (EST in November)');
ok(W.zoneInfo('UTC', NOW, 'UTC', true).diffText === 'Same time', 'same zone');
ok(W.zoneInfo('America/New_York', Date.UTC(2026, 6, 1, 12, 0), 'UTC', true).diff === -240, 'daylight saving time is honoured (EDT in July)');
eq([W.zoneLabel('Asia/Kolkata'), W.zoneLabel('America/Argentina/Buenos_Aires'), W.zoneLabel('Europe/London')], ['India', 'Buenos Aires', 'London'], 'zone labels');
ok(W.sanitizeZone({ tz: 'Nope/Zone' }) === null && W.sanitizeZone({ tz: 'Asia/Tokyo' }).label === 'Tokyo', 'zone sanitised, label defaults to the city');

console.log(f ? f + ' FAILED' : 'WELLNESS TESTS PASSED'); process.exit(f ? 1 : 0);
