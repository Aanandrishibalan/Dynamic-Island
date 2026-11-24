/* Smart assistant core: no Electron, no DOM, no network. The main process, the tests and (for formatting) the island share it.
 *
 * What is here (everything works on this PC with no AI; the AI only improves wording and does language work):
 *   briefing      today's tasks, calendar and reminders as a short spoken-style summary
 *   scheduling    free time slots for unfinished tasks (working hours, events, lunch, deadlines)
 *   memory        user-approved preferences and routines (never stored without a yes)
 *   search        natural-language search over tasks, events, notes, journal, meetings, expenses, memory
 *   suggestions   context rules: what is on screen, time of day, battery, load, next meeting
 *   text tools    extractive summary and basic proofreading (offline fallbacks) + prompts for the AI
 *   meetings      notes / decisions / action items from a transcript (offline heuristics + AI prompt)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./planner.js'), require('./wellness.js'));
  else root.Assistant = factory(root.Planner, root.DIWell);
})(this, function (P, W) {
  const DAY = 864e5, MIN = 6e4;
  const p2 = (n) => String(n).padStart(2, '0');
  const cap = (s, n) => String(s == null ? '' : s).slice(0, n);
  const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const Word = (n) => { const w = n >= 0 && n <= 10 ? WORDS[n] : String(n); return w[0].toUpperCase() + w.slice(1); };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);   // "Call supplier" -> "call supplier", "SMS Ravi" stays
  const joinList = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  /* ---------- time formatting (no locale, so tests are stable) ---------- */
  const clock = (ms, h24) => { const d = new Date(ms), h = d.getHours(), m = d.getMinutes(); if (h24) return p2(h) + ':' + p2(m); return ((h % 12) || 12) + (m ? ':' + p2(m) : '') + ' ' + (h < 12 ? 'AM' : 'PM'); };
  const minToClock = (min, h24) => { const d = new Date(2000, 0, 1, Math.floor(min / 60), min % 60); return clock(d.getTime(), h24); };
  const hhmmToMs = (day, hhmm) => { const a = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); if (!a) return null; const d = P.parseYmd(day); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +a[1], +a[2]).getTime(); };
  const dayName = (key, now) => { const t = P.ymd(new Date(now)), tm = P.ymd(new Date(now + DAY)); return key === t ? 'today' : key === tm ? 'tomorrow' : P.parseYmd(key).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' }); };

  /* ================================================================================================================
   * Personal memory: only what the user approved. A proposal is a plain object held in memory by the island until the
   * user taps "Remember"; nothing here writes to disk.
   * ============================================================================================================== */
  const MEM_KINDS = ['preference', 'routine', 'fact', 'work', 'lunch'];
  function parseClockText(s) {   // "10", "10 am", "6:30pm", "18:00" -> minutes after midnight, or null
    const m = String(s || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/); if (!m) return null;
    let h = +m[1]; const mi = +(m[2] || 0), ap = m[3] ? m[3][0] : ''; if (h > 24 || mi > 59) return null;
    if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
    return h * 60 + mi;
  }
  const TIME_RE = '(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?)';
  function parseMemory(text) {   // sentence -> {kind, text, key?, start?, end?} or null
    let t = clip(text, 220).replace(/^(please\s+)?(?:(?:remember|note|keep in mind|don'?t forget)(?:\s+that)?[,:]?\s*)?(?:that\s+)?/i, '').replace(/[.!]+$/, '').trim();
    if (t.length < 4) return null;
    let m = t.match(new RegExp('\\b(?:i|we)\\s+(?:usually\\s+|normally\\s+)?(?:work|am (?:at work|online|available)|start|am in the office)\\s+(?:from\\s+)?' + TIME_RE + '\\s*(?:to|until|till|-|–)\\s*' + TIME_RE, 'i'));
    if (m) { const a = parseClockText(m[1]); let b = parseClockText(m[2]); if (a !== null && b !== null && b <= a && b < 12 * 60 && !/am|pm|a\.m|p\.m/i.test(m[2])) b += 12 * 60; if (a !== null && b !== null && b > a) return { kind: 'work', key: 'work', text: 'I work ' + minToClock(a) + ' to ' + minToClock(b), start: a, end: b }; }
    m = t.match(new RegExp('\\blunch(?:\\s+break)?(?:\\s+is)?\\s*(?:at|around|from)?\\s*' + TIME_RE, 'i'));
    if (m) { let a = parseClockText(m[1]); if (a !== null) { if (a < 7 * 60) a += 12 * 60; return { kind: 'lunch', key: 'lunch', text: 'Lunch around ' + minToClock(a), start: a, end: a + 60 }; } }
    const first = t[0].toUpperCase() + t.slice(1);
    const kind = /\b(every|each|daily|weekly|weekdays?|weekends?|mornings?|evenings?|nights?|usually|normally|always)\b|\bat\s+\d/i.test(t) && /\b(i|we)\b/i.test(t) ? 'routine'
      : /\b(prefer|like|love|hate|dislike|never|favou?rite|don'?t like|avoid|rather)\b/i.test(t) ? 'preference' : 'fact';
    return { kind, text: first.slice(0, 200) };
  }
  /* A statement the user made about themselves that is worth offering to remember. Questions and commands are not. */
  function memoryCandidate(raw) {
    const t = clip(raw, 220); if (!t || /\?\s*$/.test(t) || t.split(' ').length < 4) return null;
    if (!/^(i\s+(always|usually|normally|prefer|like|love|hate|never|work|wake|start|go|have|am|take|eat|sleep)\b|my\s+[\w ]{2,20}\s+(is|are)\b|call me\b|every (day|morning|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|i'?m (a|an|the)\b)/i.test(t)) return null;
    return parseMemory(t);
  }
  function sanitizeMemory(m) {
    if (!m || typeof m !== 'object') return null; const text = clip(m.text, 200); if (text.length < 3) return null;
    const o = { id: cap(m.id, 40) || P.uid(), kind: MEM_KINDS.includes(m.kind) ? m.kind : 'fact', text, t: num(m.t) || Date.now() };
    if (o.kind === 'work' || o.kind === 'lunch') {
      const a = num(m.start), b = num(m.end);
      if (a === null || b === null || a < 0 || b > 1440 || b <= a) { o.kind = 'fact'; } else { o.key = o.kind; o.start = Math.round(a); o.end = Math.round(b); }
    }
    return o;
  }
  function addMemory(list, item, now) {   // a work-hours / lunch item replaces the previous one of the same kind; duplicates are ignored
    const m = sanitizeMemory({ ...item, t: now || Date.now() }); if (!m) return { list, item: null };
    const low = m.text.toLowerCase(); let out = list.filter((x) => !(m.key && x.key === m.key) && x.text.toLowerCase() !== low);
    out = [m, ...out].slice(0, 200); return { list: out, item: m };
  }
  const prefsFrom = (memory) => { const p = {}; (memory || []).forEach((m) => { if (m.key === 'work' && !p.work) p.work = m; if (m.key === 'lunch' && !p.lunch) p.lunch = m; }); return p; };

  /* ================================================================================================================
   * Daily briefing
   * ============================================================================================================== */
  /* The start of an event on its own date. A repeating event's `due` is its NEXT alert, so the time is always rebuilt from date + time. */
  const evMs = (e) => (e.date && e.time ? hhmmToMs(e.date, e.time) : e.repeat && e.repeat !== 'none' ? null : e.due || null);
  /* Events happening on one day, repeats and birthdays included. Each item keeps its fields and gets date = that day. */
  const eventsOn = (events, day) => W.expand((events || []).filter((e) => e && e.date && P.validYmd(e.date)), day, day).filter((e) => (e.repeat && e.repeat !== 'none') || !e.done);
  const bdayLine = (e) => e.title + (e.age > 0 ? ' (' + e.age + ')' : '');
  function snapshot(d, now) {   // the numbers the briefing, the pending answer and the suggestions are built from
    now = now || Date.now(); const today = P.ymd(new Date(now)), tasks = d.tasks || [], events = d.events || [];
    const open = tasks.filter((t) => !t.done), g = P.groupTasks(tasks, now);
    const pending = [...g.overdue, ...g.today].filter((t) => !(t.cond && t.cond !== 'none' && !t.due));   // waiting-for-a-condition tasks are not "pending today" until their condition is met
    const waiting = [...g.overdue, ...g.today].filter((t) => t.cond && t.cond !== 'none' && !t.due);
    const urgent = pending.filter((t) => P.quadrant(t, now) === 'do');
    const reminders = pending.filter((t) => t.due && t.due >= now && P.ymd(new Date(t.due)) === today).sort((a, b) => a.due - b.due);
    const todayEvents = eventsOn(events, today).map((e) => ({ ...e, at: evMs(e) })).sort((a, b) => (a.at || 0) - (b.at || 0));
    const nextEvent = todayEvents.find((e) => e.at && e.at >= now - 5 * MIN) || null;
    const birthdays = todayEvents.filter((e) => e.kind === 'birthday');
    return { now, today, birthdays, open, overdue: g.overdue, todayTasks: g.today, pending, waiting, urgent, reminders, todayEvents, nextEvent, anytime: g.anytime, progress: g.progress, doneToday: g.doneToday };
  }
  /* Spoken-style sentences. Example: "You have 5 pending tasks. Two are urgent. You also have a reminder to call supplier at 4 PM." */
  function pendingSentences(s, o) {
    const h24 = !!(o && o.clock24), out = [], n = s.pending.length;
    if (!n) out.push(s.doneToday.length ? 'Nothing pending. You have finished ' + plural(s.doneToday.length, 'task') + ' today.' : 'You have nothing pending today.');
    else {
      out.push('You have ' + plural(n, 'pending task') + '.');
      const u = s.urgent.length;
      if (u) out.push(n === 1 ? 'It is urgent.' : u === n ? 'All of them are urgent.' : u === 1 ? 'One is urgent.' : Word(u) + ' are urgent.');
      if (s.overdue.length && s.overdue.length !== n) out.push(Word(s.overdue.length) + (s.overdue.length === 1 ? ' is' : ' are') + ' overdue.');
    }
    const rs = s.reminders;
    if (rs.length) { const f = rs.slice(0, 2).map((t) => lcFirst(t.text) + ' at ' + clock(t.due, h24)); const more = rs.length - 2;
      out.push('You also have ' + (rs.length === 1 ? 'a reminder to ' : 'reminders to ') + joinList(f) + (more > 0 ? ', plus ' + more + ' more' : '') + '.'); }
    return out;
  }
  function buildBriefing(d, o) {
    o = o || {}; const now = o.now || Date.now(), s = snapshot(d, now), h24 = !!o.clock24, hr = new Date(now).getHours();
    const hello = hr < 5 ? 'Hello' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const lines = pendingSentences(s, o), sections = [];
    if (s.todayEvents.length) {
      const left = s.todayEvents.filter((e) => e.kind !== 'birthday' && (!e.at || e.at >= now - 5 * MIN));
      if (left.length) { const n = left[0]; lines.push('You have ' + plural(left.length, 'event') + ' left today' + (n.at ? '; next is ' + n.title + ' at ' + clock(n.at, h24) : '') + '.'); }
    }
    if (s.pending.length) sections.push({ icon: '✅', title: 'Pending today', items: s.pending.slice(0, 8).map((t) => ({ text: t.text, meta: (t.due ? clock(t.due, h24) : '') + (s.urgent.includes(t) ? (t.due ? ' · ' : '') + 'urgent' : ''), id: t.id })) });
    if (s.birthdays.length) { lines.push('Birthday today: ' + joinList(s.birthdays.map(bdayLine)) + '.'); sections.push({ icon: '🎂', title: 'Birthdays', items: s.birthdays.map((e) => ({ text: bdayLine(e), meta: 'Today' })) }); }
    const hol = o.region ? W.holidayOn(o.region, s.today) : []; if (hol.length) lines.push('Today is ' + joinList(hol) + '.');
    if (s.todayEvents.some((e) => e.kind !== 'birthday')) sections.push({ icon: '📅', title: 'Calendar', items: s.todayEvents.filter((e) => e.kind !== 'birthday').map((e) => ({ text: e.title, meta: e.at ? clock(e.at, h24) : 'All day' })) });
    if (s.waiting.length) sections.push({ icon: '⏳', title: 'Waiting for a condition', items: s.waiting.slice(0, 4).map((t) => ({ text: t.text, meta: { charging: 'when plugged in', online: 'when online', unlock: 'when you unlock' }[t.cond] || '' })) });
    const upcoming = (d.tasks || []).filter((t) => !t.done && t.date && t.date > s.today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
    if (upcoming.length) sections.push({ icon: '🗓', title: 'Coming up', items: upcoming.map((t) => ({ text: t.text, meta: dayName(t.date, now) })) });
    const extras = [];
    const tick = (d.habits || []).filter((h) => !P.habitStats(h, now).doneToday);
    if (tick.length) extras.push(plural(tick.length, 'habit') + ' still to tick (' + joinList(tick.slice(0, 3).map((h) => h.name)) + ')');
    const gl = (d.goals || []).map((g) => ({ g, st: P.goalStats(g, now) })).filter((x) => !x.st.hit);
    if (gl.length) extras.push(joinList(gl.slice(0, 2).map((x) => x.g.text + ' ' + x.st.n + '/' + x.g.target)) + ' for today');
    const spent = P.expenseSummary(d.expenses || [], now).today;
    if (spent > 0) extras.push('spent ' + (o.currency || '₹') + spent.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' so far');
    const shop = (d.shopping || []).filter((x) => !x.done).length; if (shop) extras.push(plural(shop, 'item') + ' on your shopping list');
    const unread = (d.mail || []).filter((m) => m.unread).length;
    if (unread) extras.push(plural(unread, 'unread message'));
    if (extras.length) sections.push({ icon: '•', title: 'Also', items: extras.map((x) => ({ text: x[0].toUpperCase() + x.slice(1), meta: '' })) });
    if (o.weather) lines.push(o.weather);
    const tip = (d.memory || []).filter((m) => m.kind === 'routine' && routineDue(m, now, 90)).slice(0, 1).map((m) => 'Routine: ' + m.text + '.');
    lines.push(...tip);
    return { title: hello, text: lines.join(' '), lines, sections, stats: { pending: s.pending.length, urgent: s.urgent.length, reminders: s.reminders.length, events: s.todayEvents.length, overdue: s.overdue.length }, spoken: lines.join(' ') };
  }

  /* ================================================================================================================
   * Smart scheduling
   * ============================================================================================================== */
  const SCHED = { workStart: 9 * 60, workEnd: 18 * 60, lunchStart: 13 * 60, lunchLen: 60, buffer: 10, horizon: 7, defMin: 30, eventMin: 60, callMin: 30 };
  function estimateMin(t, o) {   // "report 45 min", "2 hours", else a default by category
    const m = String(t.text || '').match(/\b(\d{1,3}(?:\.\d)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i);
    if (m) { const v = parseFloat(m[1]) * (/^h/i.test(m[2]) ? 60 : 1); if (v >= 5 && v <= 480) return Math.round(v); }
    const d = (o && o.defMin) || SCHED.defMin; return t.cat === 'work' ? Math.round(d * 1.5) : t.cat === 'shopping' ? d : d;
  }
  function settingsFor(memory, st) {
    const pr = prefsFrom(memory), o = { ...SCHED };
    if (st && num(st.assistWorkStart) !== null) o.workStart = st.assistWorkStart; if (st && num(st.assistWorkEnd) !== null) o.workEnd = st.assistWorkEnd;
    if (st && num(st.assistDefMin) !== null) o.defMin = st.assistDefMin;
    if (pr.work) { o.workStart = pr.work.start; o.workEnd = pr.work.end; }
    if (pr.lunch) { o.lunchStart = pr.lunch.start; o.lunchLen = pr.lunch.end - pr.lunch.start; }
    if (st && st.assistLunch === false && !pr.lunch) o.lunchLen = 0;
    return o;
  }
  function busyFor(dayKey, d, placed, o) {   // [start, end] in ms for one day
    const out = [], day0 = P.parseYmd(dayKey).getTime(), at = (min) => day0 + min * MIN;
    for (const e of eventsOn(d.events, dayKey)) { if (e.kind === 'birthday') continue; const s = evMs(e); if (s) out.push([s - o.buffer * MIN, s + (e.dur || o.eventMin) * MIN + o.buffer * MIN]); }
    for (const t of d.tasks || []) if (!t.done && t.due && P.ymd(new Date(t.due)) === dayKey && !(t.cond && t.cond !== 'none')) out.push([t.due - 5 * MIN, t.due + o.callMin * MIN]);   // a timed task is a commitment (a call at 4 PM)
    for (const p of placed) if (P.ymd(new Date(p.start)) === dayKey) out.push([p.start - 5 * MIN, p.end + 5 * MIN]);
    if (o.lunchLen > 0) out.push([at(o.lunchStart), at(o.lunchStart + o.lunchLen)]);
    return out;
  }
  function freeIntervals(dayKey, d, placed, o, now) {
    const day0 = P.parseYmd(dayKey).getTime();
    let lo = day0 + o.workStart * MIN; const hi = day0 + o.workEnd * MIN;
    if (dayKey === P.ymd(new Date(now))) lo = Math.max(lo, Math.ceil((now + 5 * MIN) / (5 * MIN)) * 5 * MIN);
    if (lo >= hi) return [];
    const busy = busyFor(dayKey, d, placed, o).map((b) => [Math.max(b[0], lo), Math.min(b[1], hi)]).filter((b) => b[1] > b[0]).sort((a, b) => a[0] - b[0]);
    const out = []; let cur = lo;
    for (const b of busy) { if (b[0] > cur) out.push([cur, b[0]]); cur = Math.max(cur, b[1]); }
    if (cur < hi) out.push([cur, hi]);
    return out.filter((x) => x[1] - x[0] >= 10 * MIN);
  }
  const workDay = (d, o) => { const wd = d.getDay(); return o.workDays ? o.workDays.includes(wd) : wd >= 1 && wd <= 5; };
  /* Which tasks need a slot: open, no time yet, not waiting on a condition, not a repeating habit-style task already dated later. */
  function schedulable(d, now, o) {
    const today = P.ymd(new Date(now)), lim = P.ymd(new Date(now + (o.horizon || SCHED.horizon) * DAY));
    return (d.tasks || []).filter((t) => !t.done && !t.due && !(t.cond && t.cond !== 'none') && (!t.date || t.date <= (o.includeUpcoming ? lim : today)));
  }
  const rankTasks = (list, now) => list.map((t) => ({ t, q: { do: 0, plan: 1, quick: 2, later: 3 }[P.quadrant(t, now)], dl: t.by || (t.date ? P.parseYmd(t.date).getTime() + DAY - 1 : 9e15) }))
    .sort((a, b) => a.q - b.q || a.dl - b.dl || (a.t.created || 0) - (b.t.created || 0)).map((x) => x.t);
  function planSlots(d, o) {   // greedy first-fit for every schedulable task
    o = { ...SCHED, ...(o || {}) }; const now = o.now || Date.now(), placements = [], unplaced = [];
    const list = o.tasks ? o.tasks : rankTasks(schedulable(d, now, o), now);
    for (const t of list) {
      const dur = (t.min || estimateMin(t, o)) * MIN, dl = t.by || (t.date && t.date >= P.ymd(new Date(now)) ? P.parseYmd(t.date).getTime() + DAY - 1 : null); let got = null;
      for (let i = 0; i <= o.horizon && !got; i++) {
        const day = new Date(startOfDay(new Date(now)).getTime() + i * DAY + 12 * 3600e3), key = P.ymd(day);
        if (i > 0 && !workDay(day, o)) continue;
        for (const iv of freeIntervals(key, d, placements, o, now)) { const s = iv[0]; if (iv[1] - s >= dur) { if (dl && s + dur > dl) break; got = { id: t.id, text: t.text, start: s, end: s + dur, min: Math.round(dur / MIN) }; break; } }
        if (dl && P.parseYmd(key).getTime() > dl) break;
      }
      if (got) placements.push(got); else unplaced.push({ id: t.id, text: t.text, reason: dl ? 'No free time before its deadline' : 'No free time in the next ' + o.horizon + ' days' });
    }
    return { placements, unplaced, opts: o };
  }
  function slotOptions(d, o, minutes, dayKey) {   // up to 3 different open slots (a "find time for ..." answer)
    o = { ...SCHED, ...(o || {}) }; const now = o.now || Date.now(), out = [], dur = minutes * MIN;
    for (let i = 0; i <= o.horizon && out.length < 3; i++) {
      const day = new Date(startOfDay(new Date(now)).getTime() + i * DAY + 12 * 3600e3), key = P.ymd(day);
      if (dayKey && key !== dayKey) continue; if (!dayKey && i > 0 && !workDay(day, o)) continue;
      for (const iv of freeIntervals(key, d, out, o, now)) { if (iv[1] - iv[0] >= dur) { out.push({ start: iv[0], end: iv[0] + dur, min: minutes }); if (out.length >= 3) break; } }
    }
    return out;
  }
  function describeFree(d, o, dayKey) {
    o = { ...SCHED, ...(o || {}) }; const now = o.now || Date.now(), iv = freeIntervals(dayKey, d, [], o, now), h24 = !!o.clock24;
    return iv.map((x) => clock(x[0], h24) + '–' + clock(x[1], h24));
  }
  const planText = (pl, o) => {
    const h24 = !!(o && o.clock24), now = (o && o.now) || Date.now(); if (!pl.placements.length && !pl.unplaced.length) return 'Every unfinished task already has a time, or there is nothing left to schedule.';
    const by = {}; pl.placements.forEach((p) => { (by[P.ymd(new Date(p.start))] = by[P.ymd(new Date(p.start))] || []).push(p); });
    const lines = Object.keys(by).sort().map((k) => cap(dayName(k, now), 20).replace(/^./, (c) => c.toUpperCase()) + ': ' + by[k].map((p) => clock(p.start, h24) + ' ' + lcFirst(p.text) + ' (' + p.min + ' min)').join(', '));
    if (pl.unplaced.length) lines.push('No room for: ' + pl.unplaced.map((u) => u.text).join(', '));
    return 'I found time for ' + plural(pl.placements.length, 'task') + '. ' + lines.join('. ') + '.';
  };

  /* ================================================================================================================
   * Natural language search
   * ============================================================================================================== */
  const STOP = new Set('a an and are as at be by can could did do does find for from get give had has have how i in is it its look me my of on or please search show tell that the their them there these this to up was were what when where which who why will with would you your about any all some something anything lookup locate called named containing mentioned noted wrote note notes say said write save saved'.split(' '));
  const stem = (w) => w.replace(/(ing|ed|es|s)$/i, (m, x, i, s) => (s.length - m.length >= 3 ? '' : m));
  const tokens = (q) => String(q || '').toLowerCase().replace(/[^\p{L}\p{N}₹$€£\s'-]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem);
  function timeWindow(q, now) {   // "yesterday", "last week", "this month"... -> [from, to) in ms, plus the query with those words removed
    const t0 = startOfDay(new Date(now)).getTime(); let from = null, to = null, rest = q;
    const cut = (re) => { const m = rest.match(re); if (m) rest = rest.replace(re, ' '); return !!m; };
    if (cut(/\byesterday\b/i)) { from = t0 - DAY; to = t0; }
    else if (cut(/\btoday\b/i)) { from = t0; to = t0 + DAY; }
    else if (cut(/\blast week\b/i)) { const d = new Date(t0); const mon = t0 - ((d.getDay() + 6) % 7) * DAY; from = mon - 7 * DAY; to = mon; }
    else if (cut(/\bthis week\b/i)) { const d = new Date(t0); from = t0 - ((d.getDay() + 6) % 7) * DAY; to = from + 7 * DAY; }
    else if (cut(/\blast month\b/i)) { const d = new Date(now); from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(); to = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
    else if (cut(/\bthis month\b/i)) { const d = new Date(now); from = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); }
    else if (cut(/\b(?:last|past) (\d{1,3}) days\b/i)) { const n = +(q.match(/(\d{1,3}) days/i) || [])[1] || 7; from = t0 - (n - 1) * DAY; to = t0 + DAY; }
    return { from, to, rest };
  }
  const KINDS = [['task', /\b(tasks?|todos?|to-dos?|reminders?)\b/i], ['event', /\b(events?|meetings? on|calendar|appointments?)\b/i], ['note', /\b(sticky|pad|my notes)\b/i], ['journal', /\b(journal|diary|ideas?)\b/i], ['meeting', /\b(meetings?|minutes)\b/i], ['expense', /\b(expenses?|spent|spend|paid)\b/i], ['chat', /\b(chats?|conversations?)\b/i], ['memory', /\b(memory|remember(ed)?)\b/i]];
  function expenseAnswer(q, d, now, cur) {
    if (!/\b(how much|total|sum)\b[\s\S]*\b(spen[dt]|expenses?|paid|cost)\b|\b(spen[dt]|expenses?)\b[\s\S]*\b(how much|total)\b/i.test(q)) return null;
    const { from, to, rest } = timeWindow(q, now); const d0 = new Date(now), f = from === null ? new Date(d0.getFullYear(), d0.getMonth(), 1).getTime() : from, t = to === null ? now + DAY : to;
    const cats = P.EXP_CATS.filter((c) => new RegExp('\\b' + c + '\\b', 'i').test(rest)), words = tokens(rest.replace(/how much|did i|have i|total|spen[dt]|expenses?|paid|on|for|so far/gi, ' ')).filter((w) => !/^(month|week|year|day)$/.test(w) && !cats.some((c) => c.toLowerCase().startsWith(w)));
    const list = (d.expenses || []).filter((e) => e.t >= f && e.t < t && (!cats.length || cats.includes(e.cat)) && (!words.length || words.some((w) => (e.note + ' ' + e.cat).toLowerCase().includes(w))));
    const sum = Math.round(list.reduce((a, e) => a + e.amount, 0) * 100) / 100, label = /yesterday/i.test(q) ? 'yesterday' : /\btoday\b/i.test(q) ? 'today' : /last month/i.test(q) ? 'last month' : /last week/i.test(q) ? 'last week' : /this week/i.test(q) ? 'this week' : from !== null && !/this month/i.test(q) ? 'in that period' : 'this month';
    const what = cats.length ? ' on ' + cats.join(' and ') : words.length ? ' on ' + words.join(' ') : '';
    return list.length ? 'You spent ' + cur + sum.toLocaleString('en-US', { maximumFractionDigits: 2 }) + what + ' ' + label + ' (' + plural(list.length, 'entry', 'entries') + ').' : 'I found no expenses' + what + ' ' + label + '.';
  }
  function searchLocal(query, d, o) {
    o = o || {}; const now = o.now || Date.now(), q = String(query || '').trim(); if (!q) return { items: [], answer: '' };
    const ans = expenseAnswer(q, d, now, o.currency || '₹'); if (ans) return { items: [], answer: ans };
    const kinds = KINDS.filter((k) => k[1].test(q)).map((k) => k[0]), tw = timeWindow(q, now);
    const kw = tokens(tw.rest.replace(KINDS.map((k) => k[1].source).join('|'), ' ').replace(new RegExp(KINDS.map((k) => k[1].source).join('|'), 'gi'), ' ')); const words = kw.length ? kw : [];
    const docs = [];
    (d.tasks || []).forEach((t) => docs.push({ kind: 'task', id: t.id, title: t.text, sub: (t.done ? 'Done' : t.due ? 'Due ' + clock(t.due, o.clock24) + ' ' + dayName(P.ymd(new Date(t.due)), now) : t.date ? 'Due ' + dayName(t.date, now) : 'Task') + ' · ' + t.cat, text: t.text + ' ' + t.cat, when: t.due || (t.date ? P.parseYmd(t.date).getTime() : t.created || 0), go: 'planner' }));
    (d.events || []).forEach((e) => { const nx = e.repeat && e.repeat !== 'none' ? W.occurrences(e, P.ymd(new Date(now)), P.ymd(new Date(now + 800 * DAY)))[0] || e.date : e.date; docs.push({ kind: 'event', id: e.id, title: e.title, sub: (e.kind === 'birthday' ? 'Birthday · ' : '') + (e.time ? e.time + ' ' : '') + dayName(nx, now), text: e.title + (e.kind === 'birthday' ? ' birthday' : ''), when: P.parseYmd(nx).getTime(), go: 'calendar' }); });
    (d.shopping || []).forEach((x) => docs.push({ kind: 'task', id: x.id, title: x.text, sub: x.done ? 'Shopping list · bought' : 'Shopping list', text: x.text + ' shopping list groceries', when: x.t || 0, go: 'shopping' }));
    (d.notes || []).forEach((n, i) => { if (n && n.trim()) docs.push({ kind: 'note', id: 'n' + i, title: clip(n, 80), sub: 'Sticky note ' + (i + 1), text: n, when: 0, go: 'pad' }); });
    (d.journal || []).forEach((j) => docs.push({ kind: 'journal', id: j.id, title: clip(j.text, 90), sub: (j.kind === 'idea' ? 'Idea · ' : 'Journal · ') + dayName(P.ymd(new Date(j.t)), now), text: j.text, when: j.t, go: 'journal' }));
    (d.meetings || []).forEach((m) => docs.push({ kind: 'meeting', id: m.id, title: m.title, sub: 'Meeting · ' + dayName(P.ymd(new Date(m.t)), now), text: m.title + ' ' + m.summary + ' ' + (m.actions || []).map((a) => a.text).join(' ') + ' ' + (m.decisions || []).join(' '), when: m.t, go: 'assistant' }));
    (d.expenses || []).forEach((x) => docs.push({ kind: 'expense', id: x.id, title: (o.currency || '₹') + x.amount + ' · ' + (x.note || x.cat), sub: 'Expense · ' + x.cat + ' · ' + dayName(P.ymd(new Date(x.t)), now), text: x.note + ' ' + x.cat, when: x.t, go: 'expenses' }));
    (d.conversations || []).forEach((c) => docs.push({ kind: 'chat', id: c.id, title: c.title || 'Chat', sub: 'Chat · ' + dayName(P.ymd(new Date(c.updated || now)), now), text: (c.messages || []).map((m) => m.content).join(' '), when: c.updated || 0, go: 'chat' }));
    (d.memory || []).forEach((m) => docs.push({ kind: 'memory', id: m.id, title: m.text, sub: 'Memory · ' + m.kind, text: m.text, when: m.t, go: 'assistant' }));
    const out = [];
    for (const x of docs) {
      if (kinds.length && !kinds.includes(x.kind) && !(kinds.includes('meeting') && x.kind === 'event')) continue;
      if (tw.from !== null && !(x.when >= tw.from && x.when < tw.to)) continue;
      const hay = tokens(x.text), low = String(x.text).toLowerCase();
      let score = 0; for (const w of words) { if (hay.includes(w)) score += 2; else if (hay.some((h) => h.startsWith(w) || w.startsWith(h) && h.length >= 4)) score += 1; else if (w.length >= 4 && low.includes(w)) score += 1; }
      if (words.length && score === 0) continue; if (words.length > 1 && score < words.length) continue;
      if (!words.length && !(kinds.length || tw.from !== null)) continue;
      out.push({ ...x, score: score + (x.kind === 'task' ? 0.2 : 0) + (x.when ? Math.min(0.5, Math.max(0, 0.5 - Math.abs(now - x.when) / (400 * DAY))) : 0) });
    }
    out.sort((a, b) => b.score - a.score || (b.when || 0) - (a.when || 0));
    const items = out.slice(0, 8).map(({ kind, id, title, sub, go }) => ({ kind, id, title: clip(title, 120), sub, go }));
    return { items, answer: items.length ? 'I found ' + plural(out.length, 'match', 'matches') + (out.length > 8 ? ' (showing 8)' : '') + '.' : '', words, kinds };
  }
  /* "find my budget spreadsheet from last week" -> {term:'budget', exts:['xlsx','xls','csv'], recent:true}; the main process asks Windows Search with it */
  const FILE_TYPES = [[/\b(spreadsheets?|excel|sheet|workbook)\b/i, ['xlsx', 'xls', 'csv', 'xlsm']], [/\b(documents?|word|docs?|letter|report)\b/i, ['docx', 'doc', 'pdf', 'txt', 'rtf']], [/\bpdfs?\b/i, ['pdf']], [/\b(presentations?|slides?|deck|powerpoint|ppt)\b/i, ['pptx', 'ppt']], [/\b(photos?|pictures?|images?|screenshots?)\b/i, ['jpg', 'jpeg', 'png', 'gif', 'webp']], [/\b(videos?|movies?|clips?)\b/i, ['mp4', 'mkv', 'mov', 'webm']], [/\b(music|songs?|audio|recordings?)\b/i, ['mp3', 'wav', 'm4a', 'webm']]];
  function fileQuery(q, now) {
    const tw = timeWindow(String(q || ''), now || Date.now()); const exts = []; FILE_TYPES.forEach((f) => { if (f[1] && f[0].test(tw.rest)) f[1].forEach((e) => { if (!exts.includes(e)) exts.push(e); }); });
    const strip = tw.rest.replace(/\b(files?|folders?|documents?|spreadsheets?|presentations?|photos?|pictures?|images?|pdfs?|videos?|recordings?|named|called|open|my|the|that|latest|recent|new|old)\b/gi, ' ');
    const term = tokens(strip).sort((a, b) => b.length - a.length)[0] || '';
    return { term: term.replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 40), exts, from: tw.from, to: tw.to };
  }

  /* ================================================================================================================
   * Text tools: offline summary + proofreading, and the prompts that ask an AI to do better
   * ============================================================================================================== */
  const sentences = (t) => String(t || '').replace(/\r/g, '').split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n+/).map((s) => s.trim()).filter((s) => s.length > 2);
  function extractiveSummary(text, n) {
    n = n || 4; const ss = sentences(text); if (ss.length <= n) return { gist: ss[0] || '', bullets: ss.slice(1) };
    const freq = {}; ss.forEach((s) => tokens(s).forEach((w) => { if (w.length > 2) freq[w] = (freq[w] || 0) + 1; }));
    const scored = ss.map((s, i) => { const tk = tokens(s).filter((w) => w.length > 2), sc = tk.reduce((a, w) => a + freq[w], 0) / Math.pow(Math.max(tk.length, 1), 0.6); return { s, i, sc: sc * (i === 0 ? 1.4 : 1) * (/\d|deadline|urgent|important|must|please|by /i.test(s) ? 1.15 : 1) * (s.length > 260 ? 0.6 : 1) }; });
    const pick = scored.sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
    return { gist: pick[0], bullets: pick.slice(1) };
  }
  const summaryText = (r) => r.gist ? r.gist + (r.bullets.length ? '\n' + r.bullets.map((b) => '• ' + b).join('\n') : '') : '';
  function basicCorrect(text) {   // offline: spacing, capitals, the most common slips. The AI does the real proofreading.
    let t = String(text || '').replace(/[ \t]+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').replace(/([,.!?;:])(?=[A-Za-z])/g, '$1 ').trim();
    const fix = { teh: 'the', recieve: 'receive', recieved: 'received', adress: 'address', definately: 'definitely', seperate: 'separate', occured: 'occurred', untill: 'until', wich: 'which', thier: 'their', becuase: 'because', alot: 'a lot', tommorow: 'tomorrow', tomorow: 'tomorrow', wating: 'waiting', realy: 'really', beleive: 'believe', freind: 'friend', dont: "don't", cant: "can't", wont: "won't", doesnt: "doesn't", didnt: "didn't", im: "I'm", ive: "I've", thats: "that's", u: 'you', ur: 'your', pls: 'please', plz: 'please', thx: 'thanks' };
    t = t.replace(/\b[A-Za-z']+\b/g, (w) => { const k = w.toLowerCase(); if (!(k in fix)) return w; const r = fix[k]; return w[0] === w[0].toUpperCase() && w.length > 1 ? r[0].toUpperCase() + r.slice(1) : r; });
    t = t.replace(/\bi\b/g, 'I').replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    if (t && !/[.!?…)"”]$/.test(t) && t.length > 20 && !/\n/.test(t)) t += '.';
    return t;
  }
  const LANGS = { english: 'English', tamil: 'Tamil', hindi: 'Hindi', telugu: 'Telugu', kannada: 'Kannada', malayalam: 'Malayalam', marathi: 'Marathi', bengali: 'Bengali', gujarati: 'Gujarati', punjabi: 'Punjabi', urdu: 'Urdu', spanish: 'Spanish', french: 'French', german: 'German', italian: 'Italian', portuguese: 'Portuguese', japanese: 'Japanese', korean: 'Korean', chinese: 'Chinese', arabic: 'Arabic', russian: 'Russian', dutch: 'Dutch', turkish: 'Turkish', indonesian: 'Indonesian' };
  const LANG_RE = new RegExp('\\b(' + Object.keys(LANGS).join('|') + ')\\b', 'i');
  const langOf = (s) => { const m = String(s || '').match(LANG_RE); return m ? LANGS[m[1].toLowerCase()] : ''; };
  const memLine = (memory) => (memory && memory.length ? 'About the user (approved by them): ' + memory.slice(0, 25).map((m) => m.text).join('; ') + '.' : '');
  const today0 = (now) => { const d = new Date(now || Date.now()); return P.ymd(d) + ' (' + d.toLocaleDateString('en-US', { weekday: 'long' }) + ')'; };
  function summarizeMessages(text, o) {
    o = o || {}; const style = o.style || 'short';
    return [{ role: 'system', content: 'You summarise text for a busy person. Be faithful: never add facts. Format: one line starting "Gist:", then at most 4 short bullets starting "• ", then (only if present in the text) a line "To do:" with action items or dates. Plain text, no markdown headings.' + (style === 'tiny' ? ' Use one sentence only.' : '') },
      { role: 'user', content: (o.label ? 'Source: ' + o.label + '\n\n' : '') + cap(text, 14000) }];
  }
  function writeMessages(o) {
    const mode = o.mode || 'rewrite', memory = memLine(o.memory), text = cap(o.text, 8000);
    const base = 'You are a careful writing assistant. Return ONLY the resulting text, with no preface, quotes or explanation. Keep names, numbers, dates and links exactly. ' + memory;
    if (mode === 'correct') return [{ role: 'system', content: base + 'Fix spelling, grammar and punctuation. Keep the meaning, wording and tone; change as little as possible. Keep the original language.' }, { role: 'user', content: text }];
    if (mode === 'translate') return [{ role: 'system', content: base + 'Translate into ' + (o.lang || 'English') + '. Keep the tone and formatting. If the text is already in ' + (o.lang || 'English') + ', improve it lightly.' }, { role: 'user', content: text }];
    if (mode === 'compose') return [{ role: 'system', content: base + 'Write the message the user describes, ready to send. Use a ' + (o.tone || 'clear, polite and concise') + ' tone. Include a subject line only for emails. Do not invent facts, names or dates that are not given; use [brackets] for anything missing.' + (o.lang ? ' Write it in ' + o.lang + '.' : '') }, { role: 'user', content: (o.instruction || '') + (text ? '\n\nContext or draft:\n' + text : '') }];
    return [{ role: 'system', content: base + 'Rewrite the text to be ' + (o.tone || 'clearer and more professional') + '. Keep the meaning.' + (o.lang ? ' Output in ' + o.lang + '.' : '') }, { role: 'user', content: text }];
  }
  function meetingMessages(transcript, o) {
    return [{ role: 'system', content: 'You turn a meeting transcript (may contain speech-recognition errors and several languages) into notes. Reply with ONLY a JSON object: {"title": short title, "summary": 2-4 sentences, "decisions": [strings], "actions": [{"text": task starting with a verb, "owner": name or "", "due": "YYYY-MM-DD" or ""}], "followups": [strings]}. Use only what was said. Today is ' + today0(o && o.now) + '.' }, { role: 'user', content: cap(transcript, 24000) }];
  }
  const screenMessages = (q, o) => 'You are a screen assistant. The image is the user\'s screen. ' + (o && o.app ? 'The active app is "' + cap(o.app, 40) + '". ' : '') + memLine(o && o.memory) +
    '\nReply with ONLY JSON: {"summary": one sentence on what the user is doing (never mention clock, date, battery, taskbar), "actions": [up to 4 objects {"label": short button text, "kind": "task" | "copy" | "note" | "steps", "text": the task to add / the text to copy / the note / the instruction}]}. ' +
    'Prefer actions that save the user time: add a task for a deadline or request you can see, copy a code or number, draft a reply, or give a concrete next step naming the exact button.' + '\nUser question: ' + cap(q || 'What should I do next?', 600);
  function parseJson(txt) { const m = String(txt || '').match(/\{[\s\S]*\}/); if (!m) return null; try { const j = JSON.parse(m[0]); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; } }
  function parseScreen(txt) {
    const j = parseJson(txt); if (!j) return { summary: cap(String(txt || '').trim(), 900), actions: [] };
    const actions = (Array.isArray(j.actions) ? j.actions : []).slice(0, 4).map((a) => ({ label: clip(a && a.label, 40), kind: ['task', 'copy', 'note', 'steps'].includes(a && a.kind) ? a.kind : 'steps', text: cap(a && a.text, 800).trim() })).filter((a) => a.label && a.text);
    return { summary: clip(j.summary, 400), actions };
  }

  /* ---------- meetings ---------- */
  const ACT_RE = /\b(will|shall|need(?:s)? to|has to|have to|must|should|let'?s|going to|action item|todo|to-do|follow up|follow-up|please|assigned|take care of|responsible for|can you|could you)\b/i;
  const DEC_RE = /\b(decided|agreed|approved|we(?:'ll| will) go with|finali[sz]ed|confirmed|settled on|the plan is)\b/i;
  function extractiveMeeting(transcript, now) {
    const ss = sentences(transcript), actions = [], decisions = [];
    for (const s of ss) {
      if (DEC_RE.test(s) && decisions.length < 8) decisions.push(clip(s, 200));
      else if (ACT_RE.test(s) && s.split(' ').length >= 4 && actions.length < 12) {
        const own = s.match(/^([A-Z][a-z]{1,15})\s+(?:will|should|needs? to|has to|is going to|can|could)\b/), t = clip(s.replace(/^([A-Z][a-z]{1,15})\s+(?:will|should|needs? to|has to|is going to)\s+/, '').replace(/^(?:ok|okay|so|and|also|then)[, ]+/i, ''), 160);
        const pc = P.parseCapture(t, new Date(now || Date.now()));
        actions.push({ text: pc.text || t, owner: own && !/^(We|They|You|It|This|That|Let|Please)$/.test(own[1]) ? own[1] : '', due: pc.date || '', done: false });
      }
    }
    const sum = extractiveSummary(transcript, 3);
    return { title: clip(ss[0] || 'Meeting', 60), summary: [sum.gist].concat(sum.bullets).filter(Boolean).join(' ').slice(0, 600), decisions, actions, followups: [] };
  }
  function parseMeeting(txt, now) {
    const j = parseJson(txt); if (!j) return null;
    const arr = (x, n) => (Array.isArray(x) ? x : []).map((s) => clip(typeof s === 'string' ? s : s && s.text, 220)).filter(Boolean).slice(0, n);
    const actions = (Array.isArray(j.actions) ? j.actions : []).slice(0, 20).map((a) => ({ text: clip(typeof a === 'string' ? a : a && a.text, 200), owner: clip(a && a.owner, 40), due: P.validYmd(a && a.due) ? a.due : '', done: false })).filter((a) => a.text);
    const r = { title: clip(j.title, 70) || 'Meeting', summary: clip(j.summary, 900), decisions: arr(j.decisions, 12), actions, followups: arr(j.followups, 10) };
    return r.summary || r.actions.length || r.decisions.length ? r : null;
  }
  function sanitizeMeeting(m) {
    if (!m || typeof m !== 'object') return null; const title = clip(m.title, 70) || 'Meeting';
    return { id: cap(m.id, 40) || P.uid(), t: num(m.t) || Date.now(), dur: Math.max(0, Math.min(86400, Math.round(num(m.dur) || 0))), title, summary: clip(m.summary, 1200),
      decisions: (Array.isArray(m.decisions) ? m.decisions : []).slice(0, 12).map((x) => clip(x, 220)).filter(Boolean), followups: (Array.isArray(m.followups) ? m.followups : []).slice(0, 10).map((x) => clip(x, 220)).filter(Boolean),
      actions: (Array.isArray(m.actions) ? m.actions : []).slice(0, 20).map((a) => ({ text: clip(a && a.text, 200), owner: clip(a && a.owner, 40), due: P.validYmd(a && a.due) ? a.due : '', done: !!(a && a.done) })).filter((a) => a.text),
      transcript: cap(m.transcript, 60000) };
  }
  function meetingMarkdown(m) {
    const L = ['# ' + m.title, new Date(m.t).toLocaleString('en-US') + (m.dur ? ' · ' + Math.max(1, Math.round(m.dur / 60)) + ' min' : ''), '', '## Summary', m.summary || '(none)'];
    if (m.decisions.length) L.push('', '## Decisions', ...m.decisions.map((x) => '- ' + x));
    if (m.actions.length) L.push('', '## Action items', ...m.actions.map((a) => '- [' + (a.done ? 'x' : ' ') + '] ' + a.text + (a.owner ? ' (' + a.owner + ')' : '') + (a.due ? ' — ' + a.due : '')));
    if (m.followups.length) L.push('', '## Follow-ups', ...m.followups.map((x) => '- ' + x));
    return L.join('\n');
  }

  /* ================================================================================================================
   * Contextual suggestions: cheap rules over what the user is doing right now
   * ============================================================================================================== */
  const APPS = [
    ['meeting', /^(teams|ms-teams|zoom|webex|slack|skype|discord|googlemeet|whereby)/i], ['mail', /^(outlook|olk|thunderbird|mailspring|hxoutlook)/i],
    ['writing', /^(winword|notepad|notepad\+\+|wordpad|obsidian|onenote|typora|libreoffice|soffice)/i], ['sheet', /^(excel|scalc)/i], ['code', /^(code|devenv|idea|pycharm|webstorm|sublime_text|cursor)/i],
    ['browser', /^(chrome|msedge|firefox|brave|opera|vivaldi|arc)/i], ['media', /^(spotify|vlc|wmplayer|music|netflix)/i], ['pdf', /^(acrord|acrobat|sumatra|foxit)/i]
  ];
  const appKind = (n) => { const a = APPS.find((x) => x[1].test(String(n || ''))); return a ? a[0] : ''; };
  const routineMin = (m) => { const t = String(m.text).match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i) || String(m.text).match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i); return t ? parseClockText(t[1]) : null; };
  function routineDue(m, now, within) {
    const a = routineMin(m); if (a === null) return false; const d = new Date(now), cur = d.getHours() * 60 + d.getMinutes(), wd = d.getDay();
    if (/\bweekdays?\b/i.test(m.text) && (wd === 0 || wd === 6)) return false; if (/\bweekends?\b/i.test(m.text) && wd >= 1 && wd <= 5) return false;
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], named = days.filter((x) => new RegExp('\\b' + x + 's?\\b', 'i').test(m.text)); if (named.length && !named.includes(days[wd])) return false;
    const at = a < 7 * 60 && !/\bam\b/i.test(m.text) ? a + 12 * 60 : a; return at - cur >= -5 && at - cur <= within;
  }
  function suggest(c) {   // c: {now, app, idleSec, screenSec, battery:{pct,charging}, briefedToday, focus, mail, tasks, events, memory, meetingOn}
    const now = c.now || Date.now(), s = snapshot(c, now), out = [], h = new Date(now).getHours(), k = appKind(c.app), h24 = !!c.clock24;
    const add = (id, icon, title, detail, action, w) => out.push({ id, icon, title, detail, action, w });
    if (c.meetingOn) add('meeting-stop', '⏹', 'Meeting notes are recording', 'Tap when the meeting ends to get notes and action items.', { type: 'meeting', op: 'stop' }, 100);
    const soon = s.nextEvent && s.nextEvent.at && s.nextEvent.at - now <= 15 * MIN && s.nextEvent.at - now > -5 * MIN ? s.nextEvent : null;
    if (soon && !c.meetingOn) add('event-soon', '📅', soon.title + ' starts ' + (soon.at - now < 60e3 ? 'now' : 'in ' + Math.max(1, Math.round((soon.at - now) / MIN)) + ' min'), 'Take notes and action items automatically.', { type: 'meeting', op: 'start', title: soon.title }, 90);
    const imm = s.reminders.find((t) => t.due - now <= 30 * MIN); if (imm && !soon) add('rem-soon', '⏰', lcFirst(imm.text) + ' at ' + clock(imm.due, h24), 'Coming up in ' + Math.max(1, Math.round((imm.due - now) / MIN)) + ' min.', { type: 'ask', text: "what's pending today" }, 80);
    (c.memory || []).filter((m) => m.kind === 'routine' && routineDue(m, now, 20)).slice(0, 1).forEach((m) => add('routine-' + m.id, '🔁', m.text, 'One of your routines. Add it as a reminder?', { type: 'capture', text: cap(m.text.replace(/^i\s+(usually\s+|normally\s+|always\s+)?/i, ''), 100) }, 70));
    if (!c.briefedToday && h >= 5 && h < 12) add('brief', '☀️', 'Start with your daily briefing', s.pending.length ? plural(s.pending.length, 'task') + ' pending today.' : 'See what today looks like.', { type: 'ask', text: 'daily briefing' }, 60);
    if (k === 'meeting' && !c.meetingOn) add('app-meeting', '🎙', 'In a call?', 'Start meeting notes and get action items afterwards.', { type: 'meeting', op: 'start' }, 75);
    if (k === 'mail') add('app-mail', '✉️', 'Summarise your unread mail', (c.mail || []).filter((m) => m.unread).length ? plural((c.mail || []).filter((m) => m.unread).length, 'unread message') + ' waiting.' : 'Get the gist of new messages.', { type: 'ask', text: 'summarise my unread mail' }, 65);
    if (k === 'writing' || k === 'code') add('app-writing', '✍️', 'Proofread what you selected', 'Select text in ' + cap(c.app, 24) + ', then fix grammar or rewrite it.', { type: 'ask', text: 'correct the selected text' }, 55);
    if (k === 'browser' || k === 'pdf') add('app-read', '📖', 'Summarise what you are reading', 'Select the part you want, then get the gist.', { type: 'ask', text: 'summarise the selected text' }, 55);
    if (k === 'sheet' && s.todayTasks.length) add('app-sheet', '📊', 'Working on a spreadsheet?', 'Find time to finish it.', { type: 'ask', text: 'find time for my unfinished tasks' }, 40);
    if (s.overdue.length) add('overdue', '⚠️', plural(s.overdue.length, 'overdue task'), 'Let me find new time slots for them.', { type: 'ask', text: 'find time for my unfinished tasks' }, 68);
    else if (s.open.some((t) => !t.due && (!t.date || t.date <= s.today)) && h >= 8 && h < 17) add('plan', '🗓', 'Time-block your day', plural(s.open.filter((t) => !t.due && (!t.date || t.date <= s.today)).length, 'task') + ' have no time yet.', { type: 'ask', text: 'find time for my unfinished tasks' }, 35);
    if (h >= 18 && s.pending.length) add('wrap', '🌙', 'Wrap up the day', plural(s.pending.length, 'task') + ' still pending. Move them to tomorrow?', { type: 'ask', text: 'reschedule my pending tasks to tomorrow' }, 50);
    if ((c.screenSec || 0) >= 2 * 3600 && (c.idleSec || 0) < 120) add('break', '🧘', 'Time for a break', 'You have been on screen about ' + Math.floor(c.screenSec / 3600) + ' h today.', { type: 'ask', text: 'set a timer for 5 minutes' }, 45);
    const b = c.battery; if (b && b.pct <= 20 && !b.charging) add('battery', '🔋', 'Battery at ' + b.pct + '%', 'Plug in soon. Reminders that wait for charging will fire then.', { type: 'none' }, 52);
    if (c.focus && s.pending.length) add('focus', '🎯', 'Focus is on', 'Next: ' + lcFirst((s.urgent[0] || s.pending[0]).text), { type: 'none' }, 20);
    if (!out.length && s.pending.length) { const nx = s.urgent[0] || s.reminders[0] || s.pending[0]; add('next', '➡️', 'Next: ' + lcFirst(nx.text), nx.due ? 'At ' + clock(nx.due, h24) : 'Your most important open task.', { type: 'none' }, 10); }
    return out.sort((a, b) => b.w - a.w).slice(0, 4);
  }

  return { SCHED, MEM_KINDS, Word, plural, clock, minToClock, lcFirst, joinList, parseClockText, parseMemory, memoryCandidate, sanitizeMemory, addMemory, prefsFrom, snapshot, pendingSentences, buildBriefing,
    estimateMin, settingsFor, freeIntervals, schedulable, rankTasks, planSlots, slotOptions, describeFree, planText, tokens, timeWindow, searchLocal, fileQuery, expenseAnswer,
    sentences, extractiveSummary, summaryText, basicCorrect, LANGS, langOf, summarizeMessages, writeMessages, meetingMessages, screenMessages, parseJson, parseScreen,
    extractiveMeeting, parseMeeting, sanitizeMeeting, meetingMarkdown, appKind, routineDue, suggest, dayName, evMs, hhmmToMs, eventsOn };
});
