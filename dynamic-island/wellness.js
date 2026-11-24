/* Pure logic for: repeating calendar events (birthdays, yearly repeats), public holidays, shopping list, alarm clock,
 * Pomodoro, countdowns, world clock, and the rules behind the water / screen-break / break / battery / storage alerts.
 * No Electron, no file system, no network, no timers: the same file runs in the main process (require) and in the
 * island page (<script src="wellness.js">, window.DIWell). Covered by tests/wellness.test.js. */
(function (g, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else g.DIWell = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const W = {};
  const MIN = 60000, DAY = 86400000;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const clamp = (v, lo, hi, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const validYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s;
  function parseYmd(s) { const a = String(s).split('-').map(Number); return new Date(a[0], a[1] - 1, a[2], 12, 0, 0, 0); }   // noon: immune to DST shifts
  const validTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();   // m = 0..11
  const atTime = (day, time) => { const a = String(day).split('-').map(Number), b = String(time || '00:00').split(':').map(Number); return new Date(a[0], a[1] - 1, a[2], b[0] || 0, b[1] || 0, 0, 0).getTime(); };
  W.ymd = ymd; W.parseYmd = parseYmd; W.validYmd = validYmd; W.validTime = validTime; W.uid = uid; W.atTime = atTime;

  /* ---------------------------------------- settings for every new feature ---------------------------------------- */
  W.SETTING_DEFAULTS = {
    waterOn: false, waterEvery: 60, waterFrom: 480, waterTo: 1320,                 // reminder every N minutes between 08:00 and 22:00
    screenBreakOn: false, screenBreakEvery: 30,                                    // after N minutes of continuous screen use
    breakOn: false, breakEvery: 60,                                                // stand-up / stretch reminder every N minutes in work hours
    batteryOn: true, batteryLow: 20, batteryFullOn: false, batteryFull: 80,
    storageOn: true, storageMinGB: 10,
    pomoWork: 25, pomoShort: 5, pomoLong: 15, pomoEvery: 4, pomoAuto: true,
    holidayRegion: 'auto'
  };
  const BOOL = ['waterOn', 'screenBreakOn', 'breakOn', 'batteryOn', 'batteryFullOn', 'storageOn', 'pomoAuto'];
  const RANGE = { waterEvery: [5, 480], waterFrom: [0, 1439], waterTo: [1, 1440], screenBreakEvery: [5, 180], breakEvery: [15, 480], batteryLow: [5, 50], batteryFull: [50, 100], storageMinGB: [1, 500], pomoWork: [1, 180], pomoShort: [1, 60], pomoLong: [1, 120], pomoEvery: [2, 10] };
  W.HOLIDAY_REGIONS = ['auto', 'IN', 'US', 'UK', 'none'];
  /* Keeps only valid values for the keys it knows; everything else is left out. Returns the cleaned partial object. */
  W.sanitizeSettings = (p) => {
    const out = {}; if (!p || typeof p !== 'object') return out;
    for (const k of BOOL) if (k in p) out[k] = !!p[k];
    for (const k of Object.keys(RANGE)) if (k in p) out[k] = clamp(p[k], RANGE[k][0], RANGE[k][1], W.SETTING_DEFAULTS[k]);
    if ('holidayRegion' in p) out.holidayRegion = W.HOLIDAY_REGIONS.includes(p.holidayRegion) ? p.holidayRegion : 'auto';
    if ('waterFrom' in out && 'waterTo' in out && out.waterTo <= out.waterFrom) { delete out.waterFrom; delete out.waterTo; }
    return out;
  };

  /* ---------------------------------------- repeating calendar events ---------------------------------------- */
  W.EV_KINDS = ['event', 'birthday']; W.REPEATS = ['none', 'weekly', 'monthly', 'yearly'];
  /* Events keep every field the older versions wrote (id, date, time, title, due, done, notified) and gain kind + repeat. */
  W.sanitizeEvent = (e) => {
    if (!e || typeof e !== 'object' || !validYmd(e.date)) return null;
    const title = str(e.title, 120).trim(); if (!title) return null;
    const kind = W.EV_KINDS.includes(e.kind) ? e.kind : 'event';
    let repeat = W.REPEATS.includes(e.repeat) ? e.repeat : 'none'; if (kind === 'birthday') repeat = 'yearly';
    const out = { id: str(e.id, 40) || 'e' + uid(), date: e.date, time: validTime(e.time) ? e.time : '', title, due: e.due == null || e.due === '' ? null : (num(e.due) || null), done: !!e.done, notified: !!e.notified, kind, repeat };
    if (e.dur != null && num(e.dur) > 0) out.dur = Math.min(1440, num(e.dur));
    const born = Math.round(num(e.born)); if (kind === 'birthday' && born >= 1900 && born <= 2200) out.born = born;
    return out;
  };
  /* Dates (YYYY-MM-DD) on which event e happens between from and to (inclusive). A repeat never starts before the event's own date.
   * Yearly on 29 Feb falls on 28 Feb in other years; monthly on the 31st falls on the last day of shorter months. */
  W.occurrences = (e, from, to) => {
    const out = [], a = e.date, rep = e.repeat || 'none';
    if (!validYmd(a) || from > to) return out;
    if (rep === 'none') return a >= from && a <= to ? [a] : out;
    const f = parseYmd(from > a ? from : a), t = parseYmd(to), ad = parseYmd(a);
    if (rep === 'weekly') {
      const off = ((Math.round((f - ad) / DAY) % 7) + 7) % 7;
      for (let d = new Date(f.getTime() + ((7 - off) % 7) * DAY); d <= t; d = new Date(d.getTime() + 7 * DAY)) out.push(ymd(d));
      return out;
    }
    if (rep === 'monthly') {
      for (let y = f.getFullYear(), m = f.getMonth(); y < t.getFullYear() || (y === t.getFullYear() && m <= t.getMonth()); m++) {
        if (m > 11) { m = 0; y++; }
        const k = y + '-' + pad2(m + 1) + '-' + pad2(Math.min(ad.getDate(), daysInMonth(y, m)));
        if (k >= a && k >= from && k <= to) out.push(k);
      }
      return out;
    }
    for (let y = f.getFullYear(); y <= t.getFullYear(); y++) {   // yearly
      const k = y + '-' + pad2(ad.getMonth() + 1) + '-' + pad2(Math.min(ad.getDate(), daysInMonth(y, ad.getMonth())));
      if (k >= a && k >= from && k <= to) out.push(k);
    }
    return out;
  };
  W.occursOn = (e, day) => W.occurrences(e, day, day).length === 1;
  /* The age a birthday shows on a given day, or 0 when the year of birth is unknown. */
  W.ageOn = (e, day) => (e.kind === 'birthday' && e.born ? Math.max(0, Number(String(day).slice(0, 4)) - e.born) : 0);
  /* Events as a flat list of occurrences in a date range: every item keeps its id and gets date = the occurrence date. */
  W.expand = (events, from, to) => {
    const out = [];
    for (const e of Array.isArray(events) ? events : []) for (const d of W.occurrences(e, from, to)) out.push({ ...e, date: d, anchor: e.date, age: W.ageOn(e, d) });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.time || '').localeCompare(String(b.time || ''))));
  };
  /* Next alert moment (ms) of an event that has a time, strictly after `now`. Birthdays without a time alert at 09:00. null = never again. */
  W.nextDue = (e, now) => {
    const time = validTime(e.time) ? e.time : e.kind === 'birthday' ? '09:00' : '';
    if (!time) return null;
    const rep = e.repeat || 'none'; if (rep === 'none') { const t = atTime(e.date, time); return t > now ? t : null; }
    const from = ymd(new Date(now - DAY)), to = ymd(new Date(now + 400 * DAY));
    for (const d of W.occurrences(e, from, to)) { const t = atTime(d, time); if (t > now) return t; }
    return null;
  };
  /* Called when an event's alert has just fired. A one-off event is finished; a repeating one is armed for its next time. */
  W.afterFire = (e, now) => {
    if ((e.repeat || 'none') === 'none') return { ...e, notified: true };
    const nd = W.nextDue(e, now);
    return nd ? { ...e, due: nd, notified: false } : { ...e, notified: true };
  };
  /* Arms an event for the alert: used when it is created or changed. */
  W.armEvent = (e, now) => {
    const time = validTime(e.time) ? e.time : e.kind === 'birthday' ? '09:00' : '';
    if (!time) return { ...e, due: null, notified: false };
    const nd = W.nextDue(e, now - 1);
    if ((e.repeat || 'none') === 'none') { const t = atTime(e.date, time); return { ...e, due: t, notified: t <= now }; }
    return { ...e, due: nd, notified: nd === null };
  };

  /* ---------------------------------------- public holidays ---------------------------------------- */
  function easter(y) {   // anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g2 = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g2 + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, da, 12);
  }
  function nthWeekday(y, m, wd, n) {   // m 1..12, wd 0=Sun..6=Sat, n 1..4 or -1 for the last one
    if (n > 0) { const first = new Date(y, m - 1, 1, 12), off = (wd - first.getDay() + 7) % 7; return new Date(y, m - 1, 1 + off + 7 * (n - 1), 12); }
    const last = new Date(y, m, 0, 12); return new Date(y, m - 1, last.getDate() - ((last.getDay() - wd + 7) % 7), 12);
  }
  /* Fixed-date and "Nth weekday" holidays only. Festivals that follow a lunar calendar (Diwali, Eid, Pongal and so on) change every year,
   * so they are not built in: add them as yearly or one-off events. */
  const RULES = {
    IN: [['f', 1, 1, "New Year's Day"], ['f', 1, 26, 'Republic Day'], ['f', 4, 14, 'Ambedkar Jayanti'], ['f', 5, 1, 'May Day'], ['f', 8, 15, 'Independence Day'], ['f', 10, 2, 'Gandhi Jayanti'], ['f', 12, 25, 'Christmas Day']],
    US: [['f', 1, 1, "New Year's Day"], ['n', 1, 1, 3, 'Martin Luther King Jr. Day'], ['n', 2, 1, 3, "Presidents' Day"], ['n', 5, 1, -1, 'Memorial Day'], ['f', 6, 19, 'Juneteenth'], ['f', 7, 4, 'Independence Day'],
      ['n', 9, 1, 1, 'Labor Day'], ['n', 10, 1, 2, 'Columbus Day'], ['f', 11, 11, 'Veterans Day'], ['n', 11, 4, 4, 'Thanksgiving'], ['f', 12, 25, 'Christmas Day']],
    UK: [['f', 1, 1, "New Year's Day"], ['e', -2, 'Good Friday'], ['e', 1, 'Easter Monday'], ['n', 5, 1, 1, 'Early May bank holiday'], ['n', 5, 1, -1, 'Spring bank holiday'], ['n', 8, 1, -1, 'Summer bank holiday'], ['f', 12, 25, 'Christmas Day'], ['f', 12, 26, 'Boxing Day']]
  };
  W.holidaysIn = (region, year) => {
    const rules = RULES[region]; if (!rules) return [];
    return rules.map((r) => {
      let d; if (r[0] === 'f') d = new Date(year, r[1] - 1, r[2], 12); else if (r[0] === 'n') d = nthWeekday(year, r[1], r[2], r[3]); else { d = easter(year); d = new Date(d.getTime() + r[1] * DAY); }
      return { date: ymd(d), name: r[r.length - 1] };
    }).sort((a, b) => (a.date < b.date ? -1 : 1));
  };
  /* 'auto' picks the region from a locale such as en-IN, en-US, en-GB; anything else shows no holidays. */
  W.resolveRegion = (setting, locale) => {
    if (setting && setting !== 'auto') return RULES[setting] ? setting : 'none';
    const m = /[-_]([A-Za-z]{2})\b/.exec(String(locale || '')); const c = m ? m[1].toUpperCase() : '';
    return c === 'IN' ? 'IN' : c === 'US' ? 'US' : c === 'GB' ? 'UK' : 'none';
  };
  W.holidayOn = (region, day) => { const y = Number(String(day).slice(0, 4)); return W.holidaysIn(region, y).filter((h) => h.date === day).map((h) => h.name); };
  W.holidaysBetween = (region, from, to) => { const out = []; for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) for (const h of W.holidaysIn(region, y)) if (h.date >= from && h.date <= to) out.push(h); return out; };

  /* ---------------------------------------- shopping list ---------------------------------------- */
  W.sanitizeShopItem = (x) => {
    if (!x || typeof x !== 'object') return null; const text = str(x.text, 80).replace(/\s+/g, ' ').trim(); if (!text) return null;
    return { id: str(x.id, 40) || 's' + uid(), text, done: !!x.done, t: num(x.t) || Date.now() };
  };
  /* "milk, 2 kg rice and eggs" -> ['milk', '2 kg rice', 'eggs'] */
  W.splitShopping = (s) => {
    const seen = new Set(), out = [];
    for (let x of String(s == null ? '' : s).split(/\s*(?:,|;|\n|\band\b|&)\s*/i)) {
      x = x.replace(/\s+/g, ' ').replace(/^(?:[-*•]+|\d+[.)])\s+/, '').trim().slice(0, 80);   // list bullets ("- ", "1. ") go, quantities ("2 kg rice") stay
      if (x && !seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); out.push(x); }
    }
    return out.slice(0, 30);
  };
  /* Adds items to the list. An item that is already there is not repeated; if it was ticked off it comes back as to-buy. */
  W.addShopping = (list, text, now) => {
    const cur = (Array.isArray(list) ? list : []).slice(), added = [], revived = [];
    for (const name of W.splitShopping(text)) {
      const i = cur.findIndex((x) => x.text.toLowerCase() === name.toLowerCase());
      if (i >= 0) { if (cur[i].done) { cur[i] = { ...cur[i], done: false }; revived.push(name); } continue; }
      cur.unshift({ id: 's' + uid(), text: name, done: false, t: now || Date.now() }); added.push(name);
    }
    return { list: cur.slice(0, 500), added, revived };
  };
  /* Quick Capture and voice: "add milk to the shopping list", "shop: milk, eggs", "groceries: rice". Returns the item text or null. */
  W.parseShoppingPhrase = (raw) => {
    const s = String(raw == null ? '' : raw).trim(); let m;
    if ((m = s.match(/^(?:add|put|get|include)\s+(.+?)\s+(?:to|on|in|into)\s+(?:the\s+|my\s+)?(?:shopping|grocery|groceries|buy)\s*(?:list)?[.!]?$/i))) return m[1];
    if ((m = s.match(/^(?:shop|shopping list|grocery|groceries|grocery list|buy list|to buy)\s*[:\-–]\s*(.+)$/i))) return m[1];   // not plain "shopping:": that one is the Shopping category prefix of a task
    return null;
  };

  /* ---------------------------------------- alarm clock ---------------------------------------- */
  /* alarm: {id, time 'HH:MM', label, days [0..6] (0 = Sunday; empty = once), on, next (ms of the next ring)} */
  W.sanitizeAlarm = (a, now) => {
    if (!a || typeof a !== 'object' || !validTime(a.time)) return null;
    const days = [...new Set((Array.isArray(a.days) ? a.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const out = { id: str(a.id, 40) || 'a' + uid(), time: a.time, label: str(a.label, 40).trim(), days, on: !!a.on, next: num(a.next) > 0 ? num(a.next) : 0 };
    if (out.on && !out.next) out.next = W.alarmNext(out, now || Date.now()) || 0;
    if (!out.on) out.next = 0;
    return out;
  };
  /* The first ring strictly after `from`; null when the alarm is off. */
  W.alarmNext = (a, from) => {
    if (!a || !a.on || !validTime(a.time)) return null;
    const hm = a.time.split(':').map(Number), base = new Date(from);
    for (let i = 0; i <= 8; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hm[0], hm[1], 0, 0), t = d.getTime();
      if (t > from && (!a.days.length || a.days.includes(d.getDay()))) return t;
    }
    return null;
  };
  /* One tick of the alarm clock. Returns the updated list and the alarms that ring now. An alarm that is more than 10 minutes late
   * (the PC was asleep or the island was closed) does not ring; a repeating one is re-armed, a one-off one is switched off. */
  W.alarmTick = (alarms, now) => {
    const fired = []; let changed = false;
    const list = (Array.isArray(alarms) ? alarms : []).map((a) => {
      if (!a.on || !a.next || a.next > now) return a;
      changed = true; const late = now - a.next > 10 * MIN; if (!late) fired.push(a);
      if (a.days.length) return { ...a, next: W.alarmNext(a, now) || 0 };
      return { ...a, on: false, next: 0 };
    });
    return { alarms: list, fired, changed };
  };
  W.alarmSnooze = (alarms, id, now, min) => alarms.map((a) => (a.id === id ? { ...a, on: true, next: now + (min || 5) * MIN, snoozed: true } : a));
  W.describeDays = (days) => {
    const n = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (!days || !days.length) return 'Once'; if (days.length === 7) return 'Every day';
    if (days.join() === '1,2,3,4,5') return 'Weekdays'; if (days.join() === '0,6') return 'Weekends';
    return days.map((d) => n[d]).join(' ');
  };
  W.until = (ms, now) => { const m = Math.max(0, Math.round((ms - now) / MIN)), h = Math.floor(m / 60); return m < 1 ? 'less than a minute' : h >= 24 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h ? h + 'h ' + (m % 60) + 'm' : m + ' min'; };

  /* ---------------------------------------- Pomodoro ---------------------------------------- */
  /* state: {phase 'idle'|'work'|'short'|'long', end ms (running), left ms (paused), paused, cycle (work sessions finished), total ms of this phase} */
  W.POMO_IDLE = { phase: 'idle', end: 0, left: 0, paused: false, cycle: 0, total: 0 };
  W.sanitizePomo = (p) => {
    if (!p || typeof p !== 'object' || !['work', 'short', 'long'].includes(p.phase)) return { ...W.POMO_IDLE };
    return { phase: p.phase, end: Math.max(0, num(p.end)), left: Math.max(0, num(p.left)), paused: !!p.paused, cycle: clamp(p.cycle, 0, 1e6, 0), total: Math.max(0, num(p.total)) };
  };
  const phaseMs = (cfg, phase) => (phase === 'work' ? cfg.pomoWork : phase === 'short' ? cfg.pomoShort : cfg.pomoLong) * MIN;
  const begin = (cfg, phase, now, cycle) => { const t = phaseMs(cfg, phase); return { phase, end: now + t, left: 0, paused: false, cycle, total: t }; };
  W.pomoStart = (cfg, now) => begin(cfg, 'work', now, 0);
  W.pomoLeft = (s, now) => (s.phase === 'idle' ? 0 : s.paused ? s.left : Math.max(0, s.end - now));
  W.pomoPause = (s, now) => (s.phase === 'idle' || s.paused ? s : { ...s, paused: true, left: Math.max(0, s.end - now), end: 0 });
  W.pomoResume = (s, now) => (s.phase !== 'idle' && s.paused ? { ...s, paused: false, end: now + s.left, left: 0 } : s);
  W.pomoStop = () => ({ ...W.POMO_IDLE });
  W.pomoLabel = (phase) => (phase === 'work' ? 'Focus' : phase === 'short' ? 'Short break' : phase === 'long' ? 'Long break' : 'Ready');
  /* Moves to the phase after the current one. Work -> short break (a long one after every `pomoEvery` sessions) -> work. */
  W.pomoNext = (s, cfg, now) => {
    if (s.phase === 'work') { const c = s.cycle + 1; return { state: begin(cfg, c % cfg.pomoEvery === 0 ? 'long' : 'short', now, c), finished: 'work', cycle: c }; }
    if (s.phase === 'short' || s.phase === 'long') { if (cfg.pomoAuto === false) return { state: { ...W.POMO_IDLE, cycle: s.cycle }, finished: s.phase, cycle: s.cycle }; return { state: begin(cfg, 'work', now, s.cycle), finished: s.phase, cycle: s.cycle }; }
    return { state: s, finished: null, cycle: s.cycle };
  };
  /* One tick: when the running phase is over, returns the next state and what to tell the person. */
  W.pomoTick = (s, cfg, now) => {
    if (s.phase === 'idle' || s.paused || !s.end || s.end > now) return { state: s, event: null };
    const n = W.pomoNext(s, cfg, now), ph = n.state.phase;
    const text = n.finished === 'work' ? 'Focus session ' + n.cycle + ' done. ' + (ph === 'long' ? 'Take a long break (' + cfg.pomoLong + ' min).' : 'Take a short break (' + cfg.pomoShort + ' min).')
      : ph === 'work' ? 'Break over. Focus for ' + cfg.pomoWork + ' minutes.' : 'Break over. Pomodoro paused here; start the next focus session when you are ready.';
    return { state: n.state, event: { finished: n.finished, next: ph, text } };
  };

  /* ---------------------------------------- interval alerts: water and stand-up breaks ---------------------------------------- */
  const minuteOfDay = (now) => { const d = new Date(now); return d.getHours() * 60 + d.getMinutes(); };
  W.inWindow = (now, from, to) => { const m = minuteOfDay(now); return m >= from && m < to; };
  /* When the next reminder is due: `every` minutes from now, moved to `from` o'clock the next morning if that falls outside the window. */
  W.nextInterval = (now, every, from, to) => {
    let t = now + every * MIN;
    if (W.inWindow(t, from, to)) return t;
    const d = new Date(t), m = d.getHours() * 60 + d.getMinutes();
    const day = m < from ? 0 : 1;   // before the window opens: today; after it closes: tomorrow
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + day, Math.floor(from / 60), from % 60, 0, 0).getTime();
  };
  /* st = {next}. Returns {st, fire}. The first call only arms the timer. Outside the window nothing fires. */
  W.intervalStep = (st, now, every, from, to) => {
    st = st || { next: 0 };
    if (!st.next) return { st: { next: W.nextInterval(now, every, from, to) }, fire: false };
    if (now < st.next) return { st, fire: false };
    const fire = W.inWindow(now, from, to);
    return { st: { next: W.nextInterval(now, every, from, to) }, fire };
  };

  /* ---------------------------------------- screen break ---------------------------------------- */
  /* st = {active seconds of continuous use}. Called every `stepSec` seconds with how long the person has been idle.
   * 2 minutes without keyboard or mouse counts as a break and starts the count again. */
  W.screenBreakStep = (st, idleSec, everyMin, stepSec) => {
    let a = (st && st.active) || 0; stepSec = stepSec || 5;
    if (idleSec >= 120) return { st: { active: 0 }, fire: false };
    if (idleSec < 60) a += stepSec;
    if (a >= everyMin * 60) return { st: { active: 0 }, fire: true, minutes: Math.round(a / 60) };
    return { st: { active: a }, fire: false };
  };

  /* ---------------------------------------- battery ---------------------------------------- */
  /* prev: null on the first reading, then the state this function returned. cur: {pct 0..100, charging}. cfg: {batteryOn, batteryLow, batteryFullOn, batteryFull}.
   * Low and critical fire once per discharge; "charged" fires once per charge. The first reading never fires "charged". */
  W.batteryStep = (prev, cur, cfg) => {
    const alerts = [], pct = Math.round(cur.pct), low = cfg.batteryLow, crit = Math.min(10, Math.max(3, low - 5));
    let s = prev ? { ...prev } : { low: false, crit: false, full: !!cur.charging && pct >= cfg.batteryFull };
    if (cur.charging) { s.low = false; s.crit = false; }
    else {
      if (pct > low + 5) { s.low = false; s.crit = false; }
      if (cfg.batteryOn !== false) {
        if (pct <= crit && !s.crit) { s.crit = true; s.low = true; alerts.push({ level: 'critical', pct, text: 'Battery critically low: ' + pct + '%. Plug in the charger now.' }); }
        else if (pct <= low && !s.low) { s.low = true; alerts.push({ level: 'low', pct, text: 'Battery low: ' + pct + '%. Plug in the charger soon.' }); }
      }
      s.full = false;
    }
    if (cur.charging) {
      if (pct < cfg.batteryFull - 3) s.full = false;
      if (cfg.batteryFullOn && pct >= cfg.batteryFull && !s.full) { s.full = true; alerts.push({ level: 'full', pct, text: pct >= 100 ? 'Battery fully charged. You can unplug the charger.' : 'Battery reached ' + pct + '%. You can unplug the charger.' }); }
    }
    return { state: s, alerts };
  };

  /* ---------------------------------------- storage ---------------------------------------- */
  const GB = 1073741824;
  /* drives: [{l:'C', total, free}] in bytes. state: {C: 'YYYY-MM-DD' of the last alert}. A drive alerts once a day while it stays under the limit;
   * small drives (a USB stick) are ignored: a drive must be at least four times the limit in size. */
  W.storageStep = (drives, cfg, state, day) => {
    const st = { ...(state || {}) }, alerts = [], min = cfg.storageMinGB * GB;
    for (const d of Array.isArray(drives) ? drives : []) {
      if (!(d.total >= 4 * min)) continue;
      if (d.free >= min * 1.2) { delete st[d.l]; continue; }
      if (d.free < min && st[d.l] !== day) { st[d.l] = day; alerts.push({ drive: d.l, freeGB: Math.round((d.free / GB) * 10) / 10, text: 'Drive ' + d.l + ': only ' + (Math.round((d.free / GB) * 10) / 10) + ' GB free. Delete or move files to free up space.' }); }
    }
    return { state: st, alerts };
  };

  /* ---------------------------------------- countdowns (days until a date) ---------------------------------------- */
  W.sanitizeCountdown = (c) => {
    if (!c || typeof c !== 'object' || !validYmd(c.date)) return null; const label = str(c.label, 60).trim(); if (!label) return null;
    return { id: str(c.id, 40) || 'c' + uid(), label, date: c.date, time: validTime(c.time) ? c.time : '', notified: !!c.notified };
  };
  W.countdownInfo = (c, now) => {
    const target = atTime(c.date, c.time || '00:00'), t0 = new Date(now), today = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate(), 12).getTime();
    const days = Math.round((parseYmd(c.date).getTime() - today) / DAY);
    if (c.time && target > now && target - now < DAY) return { days, past: false, text: 'in ' + W.until(target, now), soon: true };
    if (days === 0) return { days, past: false, text: 'Today', soon: true };
    if (days === 1) return { days, past: false, text: 'Tomorrow', soon: true };
    if (days > 1) return { days, past: false, text: days + ' days', soon: days <= 7 };
    return { days, past: true, text: Math.abs(days) + (days === -1 ? ' day ago' : ' days ago'), soon: false };
  };
  /* The countdown whose day has come and was not announced yet (from 08:00, or from its own time). */
  W.countdownsDue = (list, now) => (Array.isArray(list) ? list : []).filter((c) => { if (c.notified) return false; const t = atTime(c.date, c.time || '08:00'); return t <= now && now - t < 2 * DAY; });

  /* ---------------------------------------- world clock ---------------------------------------- */
  const ZONE_NAMES = { 'Europe/London': 'London', 'America/New_York': 'New York', 'America/Los_Angeles': 'Los Angeles', 'America/Chicago': 'Chicago', 'Asia/Dubai': 'Dubai', 'Asia/Singapore': 'Singapore', 'Asia/Tokyo': 'Tokyo', 'Australia/Sydney': 'Sydney', 'Asia/Kolkata': 'India', 'Europe/Paris': 'Paris', 'Europe/Berlin': 'Berlin' };
  W.QUICK_ZONES = ['Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
  W.zoneLabel = (tz) => ZONE_NAMES[tz] || String(tz).split('/').pop().replace(/_/g, ' ');
  W.validZone = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return typeof tz === 'string' && tz.length < 60; } catch { return false; } };
  W.sanitizeZone = (z) => {
    if (!z || typeof z !== 'object' || !W.validZone(z.tz)) return null;
    return { id: str(z.id, 40) || 'z' + uid(), tz: z.tz, label: str(z.label, 40).trim() || W.zoneLabel(z.tz) };
  };
  function wall(tz, now) {   // the zone's wall-clock time as if it were UTC, plus its date
    const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(now)).forEach((x) => { p[x.type] = x.value; });
    return { ms: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second), day: p.year + '-' + p.month + '-' + p.day, h: +p.hour % 24, m: +p.minute };
  }
  /* time ('14:05' or '2:05 PM'), offset from this PC's zone in minutes, a short "+5h 30m" text, and Yesterday / Today / Tomorrow. */
  W.zoneInfo = (tz, now, localTz, clock24) => {
    const z = wall(tz, now), l = wall(localTz || Intl.DateTimeFormat().resolvedOptions().timeZone, now), diff = Math.round((z.ms - l.ms) / MIN), ad = Math.abs(diff);
    const time = clock24 === false ? ((z.h % 12) || 12) + ':' + pad2(z.m) + ' ' + (z.h < 12 ? 'AM' : 'PM') : pad2(z.h) + ':' + pad2(z.m);
    const dd = Math.round((Date.UTC(...z.day.split('-').map((v, i) => (i === 1 ? +v - 1 : +v))) - Date.UTC(...l.day.split('-').map((v, i) => (i === 1 ? +v - 1 : +v)))) / DAY);
    return { time, diff, diffText: diff === 0 ? 'Same time' : (diff > 0 ? '+' : '-') + Math.floor(ad / 60) + 'h' + (ad % 60 ? ' ' + (ad % 60) + 'm' : ''), dayText: dd === 0 ? 'Today' : dd > 0 ? 'Tomorrow' : 'Yesterday', day: z.day, hour: z.h };
  };

  return W;
});
