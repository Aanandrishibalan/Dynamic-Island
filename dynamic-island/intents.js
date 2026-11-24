/* Intent router: one sentence (typed or spoken) -> what the assistant should do. Pure, no Electron, no network.
 *
 * route(text, ctx) returns a plan:
 *   { reply, ops[], items[], slots[], plan, confirm, proposal, brief, search, ai, choices[] }
 * ops are small objects. "Data" ops change the user's lists and are applied by the main process (after it re-checks them);
 * "UI" ops (open a slide, timer, volume ...) are carried out by the island. Nothing here touches the disk or the network.
 * An ai plan means "this needs language work": the main process calls the selected model, and falls back to the offline
 * summary / proofreading in assistant.js when no model is reachable.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./planner.js'), require('./assistant.js'), require('./wellness.js'));
  else root.Intents = factory(root.Planner, root.Assistant, root.DIWell);
})(this, function (P, A, W) {
  const DAY = 864e5;
  const DATA_OPS = ['addCapture', 'doneTask', 'deleteTask', 'clearDone', 'retime', 'moveTasks', 'addEvent', 'habitDone', 'bumpGoal', 'journal', 'remember', 'forget', 'placeTask', 'applyPlan', 'openApp', 'shopAdd', 'shopDone', 'shopRemove', 'shopClear', 'alarmAdd', 'alarmOff', 'addBirthday', 'addCountdown', 'addZone', 'setWell', 'pomo'];
  const SLIDE_ALIASES = {
    planner: ['planner', 'plan', 'daily plan', 'today plan', 'todays plan'], habits: ['habits', 'habit'], goals: ['goals', 'daily goals', 'goal'], journal: ['journal', 'diary'], expenses: ['expenses', 'expense', 'spending'],
    music: ['music', 'now playing'], tasks: ['tasks', 'task list', 'reminders', 'tasks and reminders'], calendar: ['calendar', 'schedule', 'agenda'], clock: ['timer', 'stopwatch', 'clock', 'timer and stopwatch'],
    connect: ['wifi', 'wi-fi', 'bluetooth', 'network', 'wifi and bluetooth', 'networks'], browser: ['browser', 'web'], pad: ['sticky pad', 'sticky notes', 'sticky', 'pad', 'notes', 'scratchpad'], find: ['find', 'apps', 'all apps', 'search'],
    photos: ['photos', 'pictures', 'gallery'], weather: ['weather', 'forecast'], news: ['news', 'headlines'], health: ['health', 'usage', 'screen time', 'battery'], system: ['system', 'cpu', 'memory', 'storage'], style: ['style', 'theme', 'appearance'],
    messages: ['messages', 'mail', 'email', 'emails', 'inbox'], assistant: ['assistant', 'ai assistant', 'ai', 'briefing', 'daily briefing', 'smart assistant'],
    shopping: ['shopping list', 'shopping', 'groceries', 'grocery list', 'grocery'], alarms: ['alarm', 'alarms', 'alarm clock', 'world clock', 'world clocks', 'pomodoro', 'countdown', 'countdowns', 'focus timer']
  };
  const aliasMap = {}; Object.keys(SLIDE_ALIASES).forEach((id) => SLIDE_ALIASES[id].forEach((a) => (aliasMap[a] = id)));
  const BUILTIN = { notepad: 'notepad', calculator: 'calc', calc: 'calc', 'task manager': 'taskmgr', 'file explorer': 'explorer', explorer: 'explorer', files: 'explorer', 'snipping tool': 'snip', 'snip and sketch': 'snip' };
  const DAYWORDS = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|next week)\b/i;

  const strip = (s) => String(s == null ? '' : s).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  function lead(raw) {   // drop wake words and politeness: "Hey island, could you please ..."
    let t = strip(raw);
    t = t.replace(/^(?:hey|hi|hello|ok|okay|yo)[ ,]+(?=island|assistant|dynamic)/i, '').replace(/^(?:dynamic island|island|assistant)\b[ ,:]*/i, '');
    for (let i = 0; i < 3; i++) t = t.replace(/^(?:please|kindly|can you|could you|would you|will you|i want you to|i need you to|i want to|i would like to|i'd like to|i'd like you to|let's|let me|go ahead and)[ ,]+/i, '');
    return t.replace(/[ ,]*\bplease\b[ .!?]*$/i, '').replace(/[.!?]+$/, '').trim();
  }
  const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const ms = (n, unit) => n * ({ h: 3600e3, m: 60e3, s: 1e3 }[unit[0].toLowerCase()] || 6e4);
  function duration(q) {   // "1 hour 30 minutes", "25 min", "half an hour", "an hour" -> ms or null
    let tot = 0, hit = false; const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi; let m;
    while ((m = re.exec(q))) { tot += ms(parseFloat(m[1]), m[2]); hit = true; }
    if (!hit) { if (/\bhalf an? hour\b/i.test(q)) { tot = 30 * 6e4; hit = true; } else if (/\ban? hour\b/i.test(q)) { tot = 36e5; hit = true; } else if (/\ban? minute\b/i.test(q)) { tot = 6e4; hit = true; } else if (/\bpomodoro\b/i.test(q)) { tot = 25 * 6e4; hit = true; } }
    return hit && tot >= 1000 && tot <= 99 * 3600e3 ? Math.round(tot) : null;
  }
  const fmtDur = (t) => { const h = Math.floor(t / 36e5), m = Math.floor(t % 36e5 / 6e4), s = Math.round(t % 6e4 / 1e3); return [h ? h + ' hour' + (h > 1 ? 's' : '') : '', m ? m + ' minute' + (m > 1 ? 's' : '') : '', !h && !m && s ? s + ' seconds' : ''].filter(Boolean).join(' '); };

  /* fuzzy match of a spoken phrase against names: returns [{item, score}] best first */
  function matchBy(phrase, items, textOf) {
    const q = A.tokens(String(phrase).toLowerCase()).filter((w) => w.length > 1); if (!q.length) return [];
    const out = [];
    for (const it of items) {
      const txt = String(textOf(it) || '').toLowerCase(), hay = A.tokens(txt); let hit = 0;
      for (const w of q) if (hay.includes(w)) hit += 1; else if (hay.some((h) => (h.length >= 3 && w.length >= 3) && (h.startsWith(w) || w.startsWith(h)))) hit += 0.7;
      const score = hit / q.length * (hit / Math.max(hay.length, 1) * 0.3 + 0.7) + (txt === String(phrase).toLowerCase() ? 0.5 : 0);
      if (hit > 0 && hit / q.length >= 0.5) out.push({ item: it, score });
    }
    return out.sort((a, b) => b.score - a.score);
  }
  const whenText = (p, o) => {   // "today at 4 PM", "tomorrow", "Monday"
    const now = o.now; const k = p.date; if (!k && !p.due) return '';
    const day = k ? A.dayName(k, now) : 'today'; return (day === 'today' || day === 'tomorrow' ? day : 'on ' + day) + (p.due ? ' at ' + A.clock(p.due, o.clock24) : '');
  };
  const taskLine = (t, o) => A.lcFirst(t.text) + (t.due ? ' at ' + A.clock(t.due, o.clock24) : '');


  /* ------------------------------------------------------------------------------------------------------------ */
  const CITY_ZONES = { london: 'Europe/London', uk: 'Europe/London', 'new york': 'America/New_York', nyc: 'America/New_York', 'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', chicago: 'America/Chicago', toronto: 'America/Toronto', dubai: 'Asia/Dubai', singapore: 'Asia/Singapore', tokyo: 'Asia/Tokyo', japan: 'Asia/Tokyo', sydney: 'Australia/Sydney', paris: 'Europe/Paris', berlin: 'Europe/Berlin', india: 'Asia/Kolkata', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', chennai: 'Asia/Kolkata', kolkata: 'Asia/Kolkata', hyderabad: 'Asia/Kolkata', 'hong kong': 'Asia/Hong_Kong', beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai', moscow: 'Europe/Moscow', cairo: 'Africa/Cairo', johannesburg: 'Africa/Johannesburg', 'sao paulo': 'America/Sao_Paulo', karachi: 'Asia/Karachi', dhaka: 'Asia/Dhaka', kathmandu: 'Asia/Kathmandu', colombo: 'Asia/Colombo', seoul: 'Asia/Seoul', bangkok: 'Asia/Bangkok', istanbul: 'Europe/Istanbul', rome: 'Europe/Rome', madrid: 'Europe/Madrid', auckland: 'Pacific/Auckland', doha: 'Asia/Qatar', riyadh: 'Asia/Riyadh' };
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  function daysFrom(q) {   // "every day", "weekdays", "weekends", "every monday", "on mon and wed" -> [0..6] (empty = once)
    if (/\b(every ?day|daily|everyday|each day)\b/.test(q)) return ALL_DAYS.slice();
    if (/\bweekdays?\b/.test(q)) return [1, 2, 3, 4, 5];
    if (/\bweekends?\b/.test(q)) return [0, 6];
    const out = new Set(), re = new RegExp('\\b(' + '' + ')\\b', 'g'); let m;
    if (/\b(every|on|each)\b/.test(q)) { const names = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 }; const r2 = /\b(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)s?\b/g; while ((m = r2.exec(q))) out.add(names[m[1]]); }
    return [...out].sort();
  }
  function alarmTime(q) {   // "7 am", "6:30", "7.30 pm", "at 18:00" -> 'HH:MM' or null
    const m = q.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i) || q.match(/\b(?:at|for)\s+(\d{1,2})(?:[:.](\d{2}))?\b(?!\s*(?:min|hour|hr|day|sec))/i) || q.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!m) { if (/\bnoon\b/.test(q)) return '12:00'; return null; }
    let h = +m[1]; const mi = m[2] ? +m[2] : 0, ap = m[3] ? m[3].toLowerCase().replace(/\./g, '') : '';
    if (mi > 59) return null;
    if (ap) { if (h < 1 || h > 12) return null; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
    else { if (h > 23) return null; if (h < 12 && /\b(tonight|evening|afternoon|night)\b/.test(q)) h += 12; }
    return p2(h) + ':' + p2(mi);
  }
  const p2 = (n) => String(n).padStart(2, '0');
  function zoneFrom(q) { const names = Object.keys(CITY_ZONES).sort((a, b) => b.length - a.length); for (const n of names) if (new RegExp('\\b' + n + '\\b').test(q)) return { tz: CITY_ZONES[n], name: n }; return null; }
  const MONN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const niceDate = (ymd, now) => (Math.abs(P.parseYmd(ymd).getTime() - now) > 300 * DAY ? Number(ymd.slice(8)) + ' ' + MONN[+ymd.slice(5, 7) - 1] : A.dayName(ymd, now));

  function wellnessRoute(text, q, c) {
    const { now, d, st, o, say } = c; let m;
    const clock = (hhmm) => A.clock(W.atTime(W.ymd(new Date(now)), hhmm), o.clock24);

    /* shopping list */
    const shopTxt = W.parseShoppingPhrase(text);
    if (shopTxt && W.splitShopping(shopTxt).length) { const items = W.splitShopping(shopTxt); return say('Added ' + A.joinList(items) + ' to your shopping list.', { ops: [{ op: 'shopAdd', text: shopTxt }] }); }
    if (/\b(?:what(?:'?s| is)? (?:on|in)|show|read|open|check|see|list)\b.*\b(?:shopping|grocery|groceries|buy)\s*list\b|^(?:my )?(?:shopping|grocery) list$|\bwhat (?:do i|should i) (?:need to )?buy\b|\bwhat(?:'?s| is) on my list\b/i.test(q)) {
      const open = (d.shopping || []).filter((x) => !x.done);
      return say(open.length ? 'You need to buy ' + A.joinList(open.slice(0, 12).map((x) => x.text)) + (open.length > 12 ? ' and ' + (open.length - 12) + ' more' : '') + '.' : 'Your shopping list is empty.', { ops: [{ op: 'go', slide: 'shopping' }] });
    }
    if (/^(?:clear|empty|delete|reset|remove everything from)\s+(?:the |my )?(?:shopping|grocery|groceries)(?: list)?$/i.test(q) || /^clear (?:the |my )?(?:bought|ticked|done|completed) (?:items|things)$/i.test(q)) {
      const onlyDone = /bought|ticked|done|completed/i.test(q), n = (d.shopping || []).filter((x) => !onlyDone || x.done).length;
      return n ? say((onlyDone ? 'Remove ' + n + ' bought item' : 'Empty the shopping list (' + n + ' item') + (n === 1 ? '' : 's') + (onlyDone ? '' : ')') + '?', { confirm: { yes: 'Yes, clear', ops: [{ op: 'shopClear', doneOnly: onlyDone }] } }) : say('The shopping list is already empty.');
    }
    if ((m = text.match(/^(?:remove|delete|take off|cross off|drop)\s+(.+?)\s+(?:from|off)\s+(?:the |my )?(?:shopping|grocery|groceries)(?: list)?$/i))) {
      const hit = matchBy(m[1], d.shopping || [], (x) => x.text); return hit.length ? say('Removed ' + hit[0].item.text + ' from the shopping list.', { ops: [{ op: 'shopRemove', id: hit[0].item.id }] }) : say('I could not find "' + m[1] + '" on your shopping list.');
    }
    if ((d.shopping || []).length && (m = text.match(/^(?:i\s+)?(?:bought|got|picked up|purchased|have bought)\s+(.+)$/i))) {
      const names = W.splitShopping(m[1]), ids = []; for (const n of names) { const h = matchBy(n, (d.shopping || []).filter((x) => !x.done), (x) => x.text); if (h.length && h[0].score >= 0.6) ids.push(h[0].item); }
      if (ids.length) return say('Ticked off ' + A.joinList(ids.map((x) => x.text)) + '.', { ops: [{ op: 'shopDone', ids: ids.map((x) => x.id) }] });
    }

    /* alarm clock */
    if (/\b(?:set|create|add|make|start|schedule)\b.*\balarm\b|\bwake me(?: up)?\b|\balarm (?:for|at)\b|^alarm\b/i.test(q) && !/\b(?:off|cancel|delete|remove|stop|turn off|disable)\b/.test(q)) {
      const tm = alarmTime(q); if (!tm) return say('What time should the alarm ring? For example "set an alarm for 6:30 am on weekdays".');
      const days = daysFrom(q), label = ((text.match(/\b(?:called|named|labell?ed|for the|to)\s+([a-z][\w' ]{2,30})$/i) || [])[1] || '').replace(/^(?:wake up|ring)$/i, '');
      return say('Alarm set for ' + clock(tm) + ' (' + W.describeDays(days).toLowerCase() + ').', { ops: [{ op: 'alarmAdd', time: tm, days, label: /^\d|am$|pm$/i.test(label) ? '' : label }, { op: 'go', slide: 'alarms' }] });
    }
    if (/\b(?:turn off|switch off|cancel|delete|remove|stop|disable|clear)\b.*\balarms?\b/.test(q)) {
      const all = /\b(all|every|my)\b.*\balarms\b|\balarms\b/.test(q) && !alarmTime(q), tm = alarmTime(q), list = (d.alarms || []).filter((a) => a.on);
      if (!(d.alarms || []).length) return say('You have no alarms.');
      if (tm) { const hit = (d.alarms || []).filter((a) => a.time === tm); return hit.length ? say('Alarm at ' + clock(tm) + ' turned off.', { ops: hit.map((a) => ({ op: 'alarmOff', id: a.id })) }) : say('I could not find an alarm at ' + clock(tm) + '.'); }
      return list.length ? say(all ? 'All alarms turned off.' : 'Turned off the next alarm.', { ops: [{ op: 'alarmOff', id: all ? '' : list.slice().sort((a, b) => a.next - b.next)[0].id, all }] }) : say('All your alarms are already off.');
    }
    if (/\b(?:what|which|any|when|show)\b.*\balarms?\b/.test(q) && !/\bset\b/.test(q)) {
      const on = (d.alarms || []).filter((a) => a.on).sort((a, b) => a.next - b.next);
      return say(on.length ? 'Next alarm: ' + clock(on[0].time) + ' (rings in ' + W.until(on[0].next, now) + ').' + (on.length > 1 ? ' ' + (on.length - 1) + ' more are on.' : '') : 'You have no alarms on.', { ops: [{ op: 'go', slide: 'alarms' }] });
    }

    /* Pomodoro */
    if (/\bpomodoro\b|\bfocus (?:session|sprint|cycle)\b/.test(q) || /^(?:start|begin) (?:a )?(?:focus|work) (?:timer|time)$/.test(q)) {
      const action = /\b(stop|end|cancel|reset|quit)\b/.test(q) ? 'stop' : /\b(pause|hold)\b/.test(q) ? 'pause' : /\b(resume|continue|unpause)\b/.test(q) ? 'resume' : /\b(skip|next)\b/.test(q) ? 'skip' : /\b(status|left|remaining|how much)\b/.test(q) ? 'status' : 'start';
      const say2 = { stop: 'Pomodoro stopped.', pause: 'Pomodoro paused.', resume: 'Pomodoro resumed.', skip: 'Skipping to the next phase.', status: 'Here is your Pomodoro.', start: 'Pomodoro started: ' + (st.pomoWork || 25) + ' minutes of focus.' }[action];
      return say(say2, { ops: [{ op: 'pomo', action }, ...(action === 'start' || action === 'status' ? [{ op: 'go', slide: 'alarms', tab: 'pomo' }] : [])] });
    }

    /* water / stand-up / screen-break reminders */
    const kindRe = [['screen', /\b(?:screen breaks?|eye breaks?|rest (?:my )?eyes|20-20-20|look away)\b/], ['water', /\b(?:water|hydrat\w*)\b/], ['break', /\b(?:stand(?:ing)? up|stretch\w*|move around|walk around|break reminders?|take a walk|take breaks?)\b/]];
    const hit = kindRe.find((k) => k[1].test(q));
    if (hit && (/\breminders?\b|\bevery\b|\bremind me\b/.test(q)) && !/\b(?:at|by)\s+\d|\b(?:tomorrow|today|tonight)\b/.test(q)) {
      const kind = hit[0], key = { water: 'water', break: 'break', screen: 'screenBreak' }[kind], label = { water: 'Water reminders', break: 'Stand-up reminders', screen: 'Screen-break reminders' }[kind];
      if (/\b(?:off|stop|disable|cancel|no more|don'?t)\b/.test(q)) return say(label + ' are off.', { ops: [{ op: 'setWell', patch: { [key + 'On']: false } }] });
      const dd = duration(q), mins = dd ? Math.round(dd / 6e4) : /\bevery (?:hour|hr)\b/.test(q) ? 60 : null, patch = { [key + 'On']: true }; if (mins) patch[key + 'Every'] = mins;
      const every = mins || (key === 'water' ? st.waterEvery || 60 : key === 'break' ? st.breakEvery || 60 : st.screenBreakEvery || 30);
      return say(label + ' on, every ' + (every % 60 === 0 ? (every / 60 === 1 ? 'hour' : every / 60 + ' hours') : every + ' minutes') + (kind === 'screen' ? ' of continuous screen use.' : ' during the day.'), { ops: [{ op: 'setWell', patch }] });
    }
    if (/\b(?:turn|switch)\s+(on|off)\b.*\b(?:battery|charge|charged)\b.*\b(?:alert|reminder|notification)s?\b/.test(q) || /\b(?:battery|charge)\b.*\balerts?\b.*\b(on|off)\b/.test(q)) {
      const on = /\bon\b/.test(q) && !/\boff\b/.test(q), full = /\b(full|charged|unplug)\b/.test(q);
      return say((full ? 'Charged alert' : 'Low battery alert') + (on ? ' on.' : ' off.'), { ops: [{ op: 'setWell', patch: full ? { batteryFullOn: on } : { batteryOn: on } }] });
    }

    /* birthdays */
    if ((m = text.match(/^(?:add|save|remember|set|create)?\s*(?:a )?(?:birthday|b-?day)\s+(?:reminder\s+)?(?:for\s+)(.+?)\s+(?:on|is on|is|:)\s+(.+)$/i) || text.match(/^(?:add|save|remember|set)?\s*(.+?)['’]s\s+(?:birthday|b-?day)\s*(?:is\s+)?(?:on|is|:)?\s*(.+)$/i))) {
      const who = m[1].replace(/^(?:my|the)\s+/i, '').trim(), p = P.parseCapture('x ' + m[2], new Date(now)), yr = (m[2].match(/\b(19\d{2}|20\d{2})\b/) || [])[1];
      if (p.date && who && who.length < 50) return say('Added ' + cap1(who) + '\'s birthday on ' + Number(p.date.slice(8)) + ' ' + MONN[+p.date.slice(5, 7) - 1] + '. I will remind you at 09:00 every year.', { ops: [{ op: 'addBirthday', title: cap1(who) + '\'s birthday', date: p.date, born: yr ? +yr : 0 }] });
      if (who && who.length < 50) return say('Which date is ' + cap1(who) + '\'s birthday? For example "add ' + who + '\'s birthday on 5 March 1990".');
    }
    if (/\b(?:whose|any|upcoming|next)\b.*\bbirthdays?\b|\bbirthdays? (?:this|next|coming)\b/.test(q)) {
      const from = W.ymd(new Date(now)), to = W.ymd(new Date(now + 30 * DAY)), list = W.expand((d.events || []).filter((e) => e.kind === 'birthday'), from, to);
      return say(list.length ? 'Birthdays in the next 30 days: ' + A.joinList(list.slice(0, 6).map((e) => e.title.replace(/'s birthday$/i, '') + ' ' + niceDate(e.date, now) + (e.age ? ' (turns ' + e.age + ')' : ''))) + '.' : 'No birthdays in the next 30 days.', { ops: [{ op: 'go', slide: 'calendar' }] });
    }

    /* countdowns and "how many days until ..." */
    if ((m = text.match(/^(?:add |start |create |set |make )?(?:a )?(?:countdown|count down)\s+(?:to|until|till|for)\s+(.+?)\s+(?:on|at|is on|:)\s+(.+)$/i)) || (m = text.match(/^(?:add |start |create |set |make )?(?:a )?(?:countdown|count down)\s+(?:to|until|till|for)\s+(.+)$/i))) {
      const label = cap1(m[1].replace(/^(?:my|the)\s+/i, '')), p = P.parseCapture('x ' + (m[2] || m[1]), new Date(now));
      if (m[2] && p.date) return say('Counting down to ' + label + ': ' + W.countdownInfo({ date: p.date, time: p.hasTime && p.due ? A.clock(p.due, true) : '' }, now).text + '.', { ops: [{ op: 'addCountdown', label, date: p.date, time: p.hasTime && p.due ? A.clock(p.due, true) : '' }, { op: 'go', slide: 'alarms', tab: 'count' }] });
      return say('Which date is "' + label + '"? For example "countdown to ' + label.toLowerCase() + ' on 25 December".');
    }
    if ((m = text.match(/^(?:how many days|how long|how much time|days)\s+(?:are there |is there |do i have |left )?(?:until|till|to|before|for|left (?:for|until|till))\s+(?:the |my )?(.+)$/i))) {
      const name = m[1].trim(), cdh = matchBy(name, d.countdowns || [], (x) => x.label)[0];
      if (cdh) { const i = W.countdownInfo(cdh.item, now); return say(cdh.item.label + ': ' + i.text + (i.past ? '.' : ' (' + niceDate(cdh.item.date, now) + ').')); }
      const reg = W.resolveRegion(st.holidayRegion, c.locale || ''), hs = reg === 'none' ? [] : W.holidaysBetween(reg, W.ymd(new Date(now)), W.ymd(new Date(now + 400 * DAY))), hh = matchBy(name, hs, (x) => x.name)[0];
      if (hh) { const i = W.countdownInfo({ date: hh.item.date }, now); return say(hh.item.name + ' is ' + (i.days === 0 ? 'today' : i.days === 1 ? 'tomorrow' : 'in ' + i.days + ' days') + ' (' + niceDate(hh.item.date, now) + ').'); }
      const ev = matchBy(name, (d.events || []).filter((e) => !e.done || e.repeat !== 'none'), (x) => x.title)[0];
      if (ev) { const nx = ev.item.repeat && ev.item.repeat !== 'none' ? W.occurrences(ev.item, W.ymd(new Date(now)), W.ymd(new Date(now + 800 * DAY)))[0] : ev.item.date; if (nx) { const i = W.countdownInfo({ date: nx }, now); return say(cap1(ev.item.title) + ': ' + (i.days <= 1 ? i.text.toLowerCase() : 'in ' + i.text) + ' (' + niceDate(nx, now) + ').'); } }
      const p = P.parseCapture('x ' + name, new Date(now)); if (p.date) { const i = W.countdownInfo({ date: p.date }, now); return say(i.days === 0 ? 'That is today.' : i.days > 0 ? i.days + ' day' + (i.days === 1 ? '' : 's') + ' to go.' : 'That was ' + Math.abs(i.days) + ' day' + (i.days === -1 ? '' : 's') + ' ago.'); }
    }
    if (/\b(?:next|upcoming|coming)\b.*\b(?:public |bank )?holidays?\b|\bwhen is the next holiday\b|\bis (?:today|tomorrow) a holiday\b/.test(q)) {
      const reg = W.resolveRegion(st.holidayRegion, c.locale || ''); if (reg === 'none') return say('Pick a holiday region in Settings > Wellness first.');
      const hs = W.holidaysBetween(reg, W.ymd(new Date(now)), W.ymd(new Date(now + 400 * DAY)));
      if (/\btoday\b/.test(q)) { const h = W.holidayOn(reg, W.ymd(new Date(now))); return say(h.length ? 'Yes, today is ' + A.joinList(h) + '.' : 'No, today is not a public holiday.'); }
      if (/\btomorrow\b/.test(q)) { const h = W.holidayOn(reg, W.ymd(new Date(now + DAY))); return say(h.length ? 'Yes, tomorrow is ' + A.joinList(h) + '.' : 'No, tomorrow is not a public holiday.'); }
      return hs.length ? say('Next holidays: ' + A.joinList(hs.slice(0, 3).map((h) => h.name + ' ' + niceDate(h.date, now))) + '.') : say('No upcoming holidays found.');
    }

    /* world clock */
    if ((m = q.match(/\bwhat(?:'s| is)? (?:the )?(?:time|date)\b.*\b(?:in|at)\b\s+(.+)$/) || q.match(/\btime (?:in|at)\s+(.+)$/) || q.match(/\b(?:add|show|put)\s+(.+?)\s+(?:to|in|on)\s+(?:the |my )?(?:world )?clock/))) {
      const z = zoneFrom(m[1]); if (z) {
        const add = /\b(add|put)\b/.test(q), info = W.zoneInfo(z.tz, now, undefined, o.clock24);
        if (add) return say('Added ' + W.zoneLabel(z.tz) + ' to your world clock.', { ops: [{ op: 'addZone', tz: z.tz }, { op: 'go', slide: 'alarms', tab: 'world' }] });
        return say('It is ' + info.time + ' in ' + cap1(z.name) + ' (' + info.dayText.toLowerCase() + ', ' + (info.diff === 0 ? 'same time as here' : info.diffText.replace('-', '−') + ' from you') + ').');
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  function route(raw, ctx) {
    ctx = ctx || {}; const now = ctx.now || Date.now(), d = ctx.data || {}, st = ctx.settings || {}, o = { now, clock24: !!st.clock24, currency: st.currency || '₹' };
    const text = lead(raw), q = text.toLowerCase(); let m;
    const say = (reply, extra) => ({ handled: true, reply, ops: [], ...extra });
    if (!text) return say('Say or type what you need. Try "what\'s pending today?"');
    const sn = A.snapshot(d, now), memoryOn = st.assistMemory !== false;

    /* ---- personal memory ---- */
    if ((m = text.match(/^(?:remember|keep in mind|note that|don'?t forget that)\b[ ,:]*(.*)$/i)) && m[1]) {
      if (!memoryOn) return say('Memory is turned off. Turn it on in Settings > Assistant if you want me to remember things.');
      const it = A.parseMemory(m[1]); if (!it) return say('Tell me what to remember, for example "remember that I prefer meetings after 11".');
      return say('Okay, I will remember: ' + it.text + '.', { ops: [{ op: 'remember', item: it }], undo: true });
    }
    if (/^forget (?:everything|all|it all)\b/i.test(text)) return d.memory && d.memory.length ? say('Forget all ' + A.plural(d.memory.length, 'thing') + ' I remember about you?', { confirm: { yes: 'Yes, forget all', ops: [{ op: 'forget', all: true }] } }) : say('I have nothing saved about you.');
    if ((m = text.match(/^forget (?:that |about |what i said about )?(.+)$/i))) {
      const hit = matchBy(m[1], d.memory || [], (x) => x.text);
      if (!hit.length) return say('I could not find that in my memory. Say "what do you remember" to see it.');
      return say('Forgot: ' + hit[0].item.text, { ops: [{ op: 'forget', id: hit[0].item.id }] });
    }
    if (/\b(what do you (remember|know)( about me)?|what have i told you|show (me )?(my )?memory|my memory|what do you know)\b/i.test(q)) {
      const mem = d.memory || []; return say(mem.length ? 'I remember ' + mem.length + ' thing' + (mem.length > 1 ? 's' : '') + ': ' + mem.slice(0, 6).map((x) => x.text).join('; ') + (mem.length > 6 ? '; and more in Settings > Assistant.' : '.') : 'I do not remember anything yet. Say "remember that ..." and I will keep it.');
    }

    /* ---- meeting assistant ---- */
    if (/\b(start|begin|take|record|open)\b.*\b(meeting|call)\b.*\b(notes?|minutes|recording)\b|\b(start|begin|take|record)\s+(?:the |a |my |some )?(?:meeting )?(?:notes|minutes)\b|\brecord (?:this |the |my )?(?:meeting|call)\b|\bmeeting (?:notes|assistant|mode)\b/i.test(q) && !/\b(stop|end|finish)\b/.test(q) && !/\b(last|previous|latest)\b/.test(q))
      return say('Meeting notes started. I will listen on this PC, nothing is saved until you stop and keep the notes.', { ops: [{ op: 'meeting', action: 'start' }] });
    if (/\b(stop|end|finish|done with|wrap up)\b.*\b(meeting|notes|minutes|recording)\b/i.test(q)) return say('Stopping and writing up the meeting.', { ops: [{ op: 'meeting', action: 'stop' }] });
    if (/\b(action items?|minutes|notes|decisions)\b.*\b(last|previous|latest|recent)\b.*\bmeeting\b|\b(last|previous|latest|recent)\b.*\bmeeting\b.*\b(notes|summary|action items?|minutes)\b/i.test(q)) {
      const mt = (d.meetings || [])[0]; if (!mt) return say('There are no saved meeting notes yet. Say "start meeting notes" at the start of a meeting.');
      const open = mt.actions.filter((a) => !a.done);
      return say(mt.title + ': ' + (mt.summary || '') + (open.length ? ' Action items: ' + open.map((a) => a.text + (a.owner ? ' (' + a.owner + ')' : '')).join('; ') + '.' : ' No open action items.'), { ops: [{ op: 'go', slide: 'assistant' }] });
    }

    /* ---- wellness: shopping list, alarms, Pomodoro, water / break reminders, birthdays, countdowns, world clock ---- */
    const wl = wellnessRoute(text, q, { now, d, st, o, say, sn, locale: ctx.locale });
    if (wl) return wl;

    /* ---- system and island controls (voice productivity) ---- */
    const dur = duration(q);
    if (/\b(stop|cancel|clear|reset|pause|end)\b.*\btimer\b/i.test(q)) return say('Timer stopped.', { ops: [{ op: 'timerStop' }] });
    if (/\b(stop|reset|start|lap|pause|resume)\b.*\bstopwatch\b/i.test(q)) { const a = /reset/.test(q) ? 'reset' : /lap/.test(q) ? 'lap' : /(stop|pause)/.test(q) ? 'stop' : 'start'; return say('Stopwatch: ' + a + '.', { ops: [{ op: 'stopwatch', action: a }] }); }
    if ((/\b(set|start|create|begin|run)\b.*\b(timer|countdown|pomodoro)\b/i.test(q) || /^(\d+[\d. ]*\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?)(?: \d+\s*(?:minutes?|mins?|seconds?|secs?))?)\s+timer\b/i.test(q) || /^pomodoro\b/i.test(q)) && dur)
      return say('Timer set for ' + fmtDur(dur) + '.', { ops: [{ op: 'timer', ms: dur }] });
    if (/^(?:set|start)\b.*\btimer$/i.test(q) && !dur) return say('How long should the timer be? For example "set a timer for 10 minutes".');
    if ((m = q.match(/\b(?:volume|sound)\b.*?\b(\d{1,3})\b/)) && /\b(set|to|at|volume \d)/.test(q)) return say('Volume ' + Math.min(100, +m[1]) + '.', { ops: [{ op: 'volume', set: Math.min(100, +m[1]) }] });
    if (/\bunmute\b/.test(q)) return say('Unmuted.', { ops: [{ op: 'volume', unmute: true }] });
    if (/\bmute\b/.test(q) && !/\bmuted\b/.test(q)) return say('Muted.', { ops: [{ op: 'volume', mute: true }] });
    if (/\b(volume|sound)\b.*\b(up|higher|louder|increase)\b|\b(turn|volume|make).*\b(up|louder)\b.*\b(volume|sound|it)\b|^(louder|volume up)$/i.test(q)) return say('Volume up.', { ops: [{ op: 'volume', delta: 15 }] });
    if (/\b(volume|sound)\b.*\b(down|lower|quieter|softer|decrease|reduce)\b|\b(turn|make).*\b(down|quieter)\b.*\b(volume|sound|it)\b|^(quieter|volume down)$/i.test(q)) return say('Volume down.', { ops: [{ op: 'volume', delta: -15 }] });
    if (/\b(max|maximum|full) volume\b|\bvolume (to )?(max|maximum|full)\b/i.test(q)) return say('Volume at maximum.', { ops: [{ op: 'volume', set: 100 }] });
    if ((m = q.match(/\bbrightness\b.*?\b(\d{1,3})\b/)) && /\b(set|to|at)\b/.test(q)) return say('Brightness ' + Math.min(100, +m[1]) + '.', { ops: [{ op: 'bright', set: Math.min(100, +m[1]) }] });
    if (/\b(brightness)\b.*\b(up|higher|increase)\b|\b(brighter|increase brightness)\b/i.test(q)) return say('Brighter.', { ops: [{ op: 'bright', delta: 15 }] });
    if (/\b(brightness)\b.*\b(down|lower|decrease|reduce)\b|\b(dimmer|darker|dim the screen|reduce brightness)\b/i.test(q)) return say('Dimmer.', { ops: [{ op: 'bright', delta: -15 }] });
    if (/^(?:pause|stop)(?: the)?(?: music| song| track| video| playback)?$/i.test(q) || /^(?:resume|play|continue)(?: the)?(?: music| song| track| video| playback)?$/i.test(q) || /^play some music$/i.test(q)) return say(/^(pause|stop)/i.test(q) ? 'Paused.' : 'Playing.', { ops: [{ op: 'media', action: 'toggle' }] });
    if (/^(?:next|skip)(?: the)?(?: song| track)?$|\bskip (?:this|the) (?:song|track)\b|\bnext (?:song|track)\b/i.test(q)) return say('Next track.', { ops: [{ op: 'media', action: 'next' }] });
    if (/^(?:previous|last|back)(?: song| track)$|\bprevious (?:song|track)\b|\bgo back a (?:song|track)\b/i.test(q)) return say('Previous track.', { ops: [{ op: 'media', action: 'prev' }] });
    if ((m = q.match(/\b(?:turn|switch|set|enable|disable)?\s*(on|off)\s+(?:the\s+)?(wi-?fi|bluetooth|airplane(?: mode)?|flight mode)\b|\b(wi-?fi|bluetooth|airplane(?: mode)?|flight mode)\s+(on|off)\b|\b(enable|disable)\s+(?:the\s+)?(wi-?fi|bluetooth|airplane(?: mode)?)\b/i))) {
      const kind = (m[2] || m[3] || m[6] || '').toLowerCase(), on = (m[1] || m[4] || (m[5] === 'enable' ? 'on' : 'off') || '').toLowerCase() === 'on', k = /air|flight/.test(kind) ? 'airplane' : /blue/.test(kind) ? 'bluetooth' : 'wifi';
      return say({ wifi: 'Wi-Fi', bluetooth: 'Bluetooth', airplane: 'Airplane mode' }[k] + (on ? ' on.' : ' off.'), { ops: [{ op: 'radio', kind: k, on }] });
    }
    if ((m = q.match(/\b(?:focus(?: mode)?|do not disturb|dnd)\b.*?\b(on|off)\b|\b(?:turn|switch)\s+(on|off)\s+(?:focus|do not disturb|dnd)\b|\b(start|enable|stop|disable|end)\s+(?:focus(?: mode)?|do not disturb)\b/i))) {
      const on = /^(on|start|enable)$/.test(String(m[1] || m[2] || m[3]).toLowerCase()); return say(on ? 'Focus on. Message pop-ups are paused.' : 'Focus off.', { ops: [{ op: 'focus', on }] });
    }
    if (/\b(take|capture|grab|make)\b.*\bscreenshot\b|^screenshot$/i.test(q)) return say('Taking a screenshot.', { ops: [{ op: 'screenshot' }] });
    if (/^lock(?: the)?(?: pc| computer| screen| laptop)?$/i.test(q)) return say('Locking.', { ops: [{ op: 'sys', name: 'lock' }] });
    if (/^(?:put (?:the )?(?:pc|computer|laptop) to )?sleep(?: the)?(?: pc| computer| laptop)?$|^put .* to sleep$/i.test(q)) return say('Put the PC to sleep?', { confirm: { yes: 'Yes, sleep', ops: [{ op: 'sys', name: 'sleep' }] } });
    if (/^(?:quit|exit|close|shut down)(?: the)?(?: dynamic island| island| app)$/i.test(q)) return say('Quit Dynamic Island?', { confirm: { yes: 'Yes, quit', ops: [{ op: 'sys', name: 'quit' }] } });
    if (/^open (?:the )?settings$|^(?:island )?settings$/i.test(q)) return say('Opening settings.', { ops: [{ op: 'settings' }] });

    /* ---- completing / postponing / deleting, habits, goals ---- */
    const openTasks = (d.tasks || []).filter((t) => !t.done);
    if ((m = text.match(/^(?:mark|set|tick|check)(?: off)?\s+(.+?)(?: as)?\s+(?:done|complete|completed|finished)$/i) || text.match(/^(?:complete|finish|tick off|check off|done with|finished|completed|i(?:'ve| have)? (?:finished|completed|done))\s+(?:the |my |a )?(.+)$/i) || text.match(/^mark done:?\s*(.+)$/i))) {
      const ph = m[1].replace(/^(?:the|my|a)\s+/i, ''), th = matchBy(ph, openTasks, (t) => t.text), hh = matchBy(ph, d.habits || [], (h) => h.name).filter((h) => !P.habitStats(h.item, now).doneToday);
      const best = th[0], bh = hh[0];
      if (bh && (!best || bh.score > best.score + 0.05)) return say('Ticked ' + bh.item.name + ' for today.', { ops: [{ op: 'habitDone', id: bh.item.id }] });
      if (!best) return say('I could not find an open task or habit like "' + ph + '".');
      const tie = th.filter((x) => x.score >= best.score - 0.001);
      if (tie.length > 1) return say('Which one did you finish?', { choices: tie.slice(0, 4).map((x) => ({ label: x.item.text, ops: [{ op: 'doneTask', id: x.item.id }], reply: 'Done: ' + x.item.text })) });
      return say('Done: ' + best.item.text + '.', { ops: [{ op: 'doneTask', id: best.item.id }] });
    }
    if ((m = text.match(/^(?:postpone|delay|push|move|reschedule|shift|snooze)\s+(?:the |my )?(.+?)\s+(?:to|until|till|for|by)\s+(.+)$/i)) && !/\b(pending|unfinished|overdue|remaining|all|everything)\b/i.test(m[1])) {
      const th = matchBy(m[1], openTasks, (t) => t.text); if (!th.length) return say('I could not find a task like "' + m[1] + '".');
      const t = th[0].item, nowD = new Date(now), by = duration(m[2]);
      if (/\bby\b/i.test(text) && by && !/\b(tomorrow|today)\b/i.test(m[2])) return say('Moved "' + t.text + '" ' + fmtDur(by) + ' later.', { ops: [{ op: 'retime', id: t.id, date: P.ymd(new Date((t.due || now) + by)), due: (t.due || now) + by }] });
      const p = P.parseCapture('x ' + m[2], nowD); if (!p.date && !p.due) return say('When should I move it to? For example "postpone ' + m[1] + ' to tomorrow at 10".');
      return say('Moved "' + t.text + '" to ' + whenText(p, o) + '.', { ops: [{ op: 'retime', id: t.id, date: p.date || P.ymd(nowD), due: p.due || null }] });
    }
    if (/^(?:move|push|reschedule|postpone|shift)\b.*\b(pending|unfinished|overdue|remaining|all|everything)\b.*\b(tasks?|items)?\b.*\b(?:to|until|for)\s+(?:tomorrow|next \w+|\w+day)\b/i.test(q)) {
      const p = P.parseCapture('x ' + q.replace(/^.*\b(?:to|until|for)\s+/, ''), new Date(now)), list = sn.pending.filter((t) => !t.due || t.due < now);
      if (!list.length) return say('Nothing to move: no pending tasks.');
      if (!p.date) return say('Which day should I move them to? Say "move my pending tasks to tomorrow".');
      return say('Move ' + A.plural(list.length, 'task') + ' to ' + A.dayName(p.date, now) + '?', { confirm: { yes: 'Yes, move them', ops: [{ op: 'moveTasks', ids: list.map((t) => t.id), date: p.date }] } });
    }
    if ((m = text.match(/^(?:delete|remove|discard|cancel)\s+(?:the |my )?(?:task |reminder )?(.+)$/i)) && !/\b(timer|meeting notes|reminders? (?:in|at))\b/i.test(m[1])) {
      if (/^(?:all )?(?:the )?(?:done|completed|finished) (?:tasks|items)$/i.test(m[1])) { const n = (d.tasks || []).filter((t) => t.done).length; return n ? say('Delete ' + A.plural(n, 'completed task') + '?', { confirm: { yes: 'Yes, delete', ops: [{ op: 'clearDone' }] } }) : say('There are no completed tasks to delete.'); }
      const th = matchBy(m[1], d.tasks || [], (t) => t.text); if (th.length) return say('Delete "' + th[0].item.text + '"?', { confirm: { yes: 'Yes, delete', ops: [{ op: 'deleteTask', id: th[0].item.id }] } });
    }
    if ((m = text.match(/^(?:log|add|record|plus|\+)\s*(\d+(?:\.\d+)?)?\s*(?:more\s+)?(?:to\s+|of\s+|for\s+)?(.+)$/i) || text.match(/^i\s+(?:drank|had|walked|read|did|ran|completed|logged)\s+(\d+(?:\.\d+)?)?\s*(.+)$/i))) {
      const gm = matchBy(String(m[2]).replace(/\b(glass(?:es)?|cups?|steps|pages?|minutes?|reps|km|miles?|times?)\b/gi, ' '), d.goals || [], (g) => g.text + ' ' + (g.unit || ''));
      if (gm.length && gm[0].score >= 0.5) { const n = m[1] ? +m[1] : 1; return say('Logged ' + n + (gm[0].item.unit ? ' ' + gm[0].item.unit : '') + ' for ' + gm[0].item.text + '.', { ops: [{ op: 'bumpGoal', id: gm[0].item.id, delta: n }] }); }
    }

    /* ---- the daily briefing and "what's pending" ---- */
    if (/\b(daily )?brief(?:ing)?\b|^(?:good )?(?:morning|afternoon|evening)\b|\bhow(?:'s| is) my day\b|\bwhat(?:'s| is) my day\b|\bmy day (?:look|like)|\bagenda for today\b|\bcatch me up\b|\bsummari[sz]e my (?:day|tasks|schedule|calendar)\b|\bplan for today\b/i.test(q)) {
      const b = A.buildBriefing(d, { now, clock24: o.clock24, currency: o.currency, weather: ctx.weather }); return say(b.text, { brief: b });
    }
    const dayAsk = q.match(/\b(tomorrow|today)\b/), isPendingQ = /\bwhat(?:'s| is| are)?\s+(?:still\s+)?(?:pending|left|outstanding|remaining|due|on (?:my )?(?:plate|list|agenda|schedule|calendar|today|tomorrow)|happening|up)\b|\b(?:pending|overdue|outstanding|unfinished|remaining)\s+(?:tasks?|items?|things|work|today)\b|\bwhat do i have\b|\bwhat (?:tasks|reminders|events|meetings) do i have\b|\bdo i have (?:any )?(?:tasks|reminders|meetings|events|anything)\b|\bshow (?:me )?(?:my )?(?:tasks|reminders|agenda|schedule|to-?dos?)\b|^(?:my )?(?:tasks|reminders|to-?dos?|agenda)(?: for)?(?: today| tomorrow)?$|\bwhat do i need to do\b|\bwhat should i (?:finish|complete)\b|\bwhat(?:'s| is) next on my\b/i.test(q);
    if (isPendingQ && !/\bwhat should i do (?:now|next)\b/i.test(q) && !/\b(find|get|give|suggest|schedule|time[- ]?block|reschedule|slots?|free time|when can i|plan my)\b/i.test(q)) {
      if (dayAsk && dayAsk[1] === 'tomorrow') {
        const k = P.ymd(new Date(now + DAY)), ts = (d.tasks || []).filter((t) => !t.done && P.dayOf(t) === k), es = (d.events || []).filter((e) => e.date === k && !e.done);
        if (!ts.length && !es.length) return say('Nothing is planned for tomorrow yet.', { ops: [{ op: 'go', slide: 'planner' }] });
        return say('Tomorrow you have ' + [ts.length ? A.plural(ts.length, 'task') : '', es.length ? A.plural(es.length, 'event') : ''].filter(Boolean).join(' and ') + '. ' + [...es.map((e) => cap1(e.title) + (e.time ? ' at ' + A.clock(A.hhmmToMs(k, e.time), o.clock24) : '')), ...ts.slice(0, 4).map((t) => cap1(t.text))].slice(0, 5).join('; ') + '.', { ops: [{ op: 'go', slide: 'planner' }] });
      }
      const sentences = A.pendingSentences(sn, o); const ev = sn.todayEvents.filter((e) => !e.at || e.at >= now - 5 * 6e4);
      if (ev.length) sentences.push('Next event: ' + ev[0].title + (ev[0].at ? ' at ' + A.clock(ev[0].at, o.clock24) : '') + '.');
      return say(sentences.join(' '), { tasks: sn.pending.slice(0, 6).map((t) => ({ id: t.id, text: t.text, meta: (t.due ? A.clock(t.due, o.clock24) : '') + (sn.urgent.includes(t) ? (t.due ? ' · ' : '') + 'urgent' : '') })), ops: [] });
    }
    if (/\bhow many\b.*\b(tasks?|things)\b.*\b(done|finish(?:ed)?|complete(?:d)?)\b/i.test(q)) return say(sn.doneToday.length ? 'You finished ' + A.plural(sn.doneToday.length, 'task') + ' today.' : 'You have not finished any tasks today yet.');

    /* ---- calendar events and smart scheduling ---- */
    if ((m = text.match(/^(?:schedule|book|set up|arrange|add|create|put|plan|fix)\s+(?:me\s+)?(?:a |an |the |my )?((?:meeting|call|appointment|event|lunch|dinner|interview|session|catch ?up|standup|demo|review|sync|class|coffee)\b.*)$/i)) || (m = text.match(/^(?:schedule|book|add|put)\s+(.+?)\s+(?:on|to|in)\s+(?:my\s+)?calendar\b(.*)$/i))) {
      const body = m[2] ? m[1] + ' ' + m[2] : m[1], p = P.parseCapture(body, new Date(now));
      if (p.date || p.due) {
        const day = p.date || P.ymd(new Date(now)), tm = p.due ? A.clock(p.due, true) : '', title = cap1(p.text.replace(/^(?:a|an|the)\s+/i, '') || 'Event');
        return say('Added "' + title + '" to your calendar ' + whenText({ ...p, date: day }, o) + '.', { ops: [{ op: 'addEvent', title, date: day, time: tm.length === 5 ? tm : '' }] });
      }
      const mins = duration(body) || 60, os = A.settingsFor(d.memory, st), opts = A.slotOptions(d, { ...os, now, clock24: o.clock24 }, Math.round(mins / 6e4) || 60);
      const title = cap1(p.text);
      return opts.length ? say('When should "' + title + '" be? Here are the next open slots:', { slots: opts.map((s) => ({ ...s, day: A.dayName(P.ymd(new Date(s.start)), now), text: A.clock(s.start, o.clock24) + '–' + A.clock(s.end, o.clock24), ops: [{ op: 'addEvent', title, date: P.ymd(new Date(s.start)), time: A.clock(s.start, true) }] })) }) : say('I could not find a free slot in the next week. Tell me a day and time instead.');
    }
    const wantsSlots = /\b(find|get|give|suggest|show|check|look for)\b.*\b(time|slot|slots|window|gap)\b|\bwhen (?:can|should|could|do) i\b|\bfree (?:time|slots?|windows?)\b|\bwhen am i (?:free|available)\b|\bam i (?:free|available)\b|\bwhat time (?:should|can) i\b|\b(?:schedule|time[- ]?block|organi[sz]e|arrange|reschedule|fit)\b.*\b(?:my )?(?:day|tasks?|todos?|to-?dos?|unfinished|pending|remaining|overdue|afternoon|morning|week|work)\b|\bplan my (?:day|tasks|afternoon|morning|week)\b/i.test(q);
    if (wantsSlots) {
      const os = { ...A.settingsFor(d.memory, st), now, clock24: o.clock24 };
      const bulk = /\b(unfinished|pending|remaining|overdue|my tasks|all (?:my )?tasks|my day|my to-?dos?|my work|the rest|my afternoon|my morning|my week|tasks)\b/i.test(q) && !/\bfor (?:the |a |my )?[a-z]+ (?:report|call|email|meeting)\b/i.test(q);
      if (/\bwhen am i (?:free|available)\b|\b(?:am i|are we) (?:free|available)\b|\bfree (?:time|slots?|windows?)\b/i.test(q) && !/\bfor\b.*\b(?:minutes?|mins?|hours?)\b/i.test(q)) {
        const p = P.parseCapture('x ' + q, new Date(now)), k = p.date || P.ymd(new Date(now)), free = A.describeFree(d, os, k);
        return say(free.length ? 'You are free ' + A.dayName(k, now) + ' ' + A.joinList(free.slice(0, 5)) + '.' : 'No free working time ' + A.dayName(k, now) + '.');
      }
      if (bulk) {
        const includeUpcoming = /\bweek\b/i.test(q), pl = A.planSlots(d, { ...os, includeUpcoming });
        return say(A.planText(pl, os), { plan: { placements: pl.placements.map((p) => ({ ...p, day: A.dayName(P.ymd(new Date(p.start)), now), text2: A.clock(p.start, o.clock24) + '–' + A.clock(p.end, o.clock24) })), unplaced: pl.unplaced }, confirm: pl.placements.length ? { yes: 'Apply this schedule', ops: [{ op: 'applyPlan', placements: pl.placements.map((p) => ({ id: p.id, start: p.start })) }], note: 'Each task gets a reminder at its start time.' } : undefined });
      }
      const phrase = (q.match(/\bfor\s+(.+)$/) || q.match(/\b(?:to|do|finish|complete|work on)\s+(.+)$/) || [])[1] || '', pr = P.parseCapture('x ' + phrase, new Date(now)), mins = Math.round((duration(phrase) || 0) / 6e4);
      const clean = phrase.replace(/\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi, ' ').replace(DAYWORDS, ' ').replace(/\b(?:my|the|a|an|some|about|around|for|on|at|in|of)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      const th = clean ? matchBy(clean, openTasks, (t) => t.text) : [], task = th[0] && th[0].score >= 0.6 ? th[0].item : null;
      const need = mins || (task ? A.estimateMin(task, os) : 45), opts = A.slotOptions(d, os, need, pr.date && DAYWORDS.test(phrase) ? pr.date : null);
      const name = task ? task.text : cap1(clean || 'Focus time');
      if (!opts.length) return say('I could not find ' + need + ' free minutes ' + (pr.date ? A.dayName(pr.date, now) : 'in the next week') + '.');
      return say((task ? 'Found time for "' + task.text + '" (' + need + ' min):' : 'Open slots for ' + need + ' minutes:'), { slots: opts.map((s) => ({ ...s, day: A.dayName(P.ymd(new Date(s.start)), now), text: A.clock(s.start, o.clock24) + '–' + A.clock(s.end, o.clock24), ops: [{ op: 'placeTask', id: task ? task.id : '', text: name, start: s.start }] })) });
    }

    /* ---- language work: summarise / write / screen (needs the AI; offline fallbacks exist) ---- */
    const inline = (() => { const mm = text.match(/[:：]\s*([\s\S]{25,})$/) || text.match(/"([\s\S]{25,})"$/); return mm ? mm[1].trim() : ''; })();
    if (/\b(summari[sz]e|summary of|sum up|tl;?dr|gist of|boil (?:it |this )?down|key points)\b/i.test(q)) {
      const src = inline ? 'text' : /\b(unread )?(?:mail|e-?mails?|inbox|messages?)\b/i.test(q) ? 'mail' : /\bclipboard|copied\b/i.test(q) ? 'clipboard' : /\b(file|document|doc|pdf|report|article)\b/i.test(q) && !/\bselect/i.test(q) ? 'file' : /\bmeeting\b/i.test(q) ? 'meeting' : /\b(journal|my notes|this week)\b/i.test(q) ? 'journal' : 'selection';
      return { handled: true, ops: [], ai: { kind: 'summarize', source: src, text: inline } };
    }
    if (/\btranslate\b/i.test(q)) return { handled: true, ops: [], ai: { kind: 'write', mode: 'translate', lang: A.langOf(q) || 'English', text: inline, source: inline ? 'text' : /clipboard|copied/i.test(q) ? 'clipboard' : 'selection' } };
    if (/\b(correct|fix|proofread|check)\b.*\b(grammar|spelling|typos?|mistakes|text|this|it|selection|selected|message|email|sentence|paragraph)\b|\bproofread\b|\bgrammar check\b/i.test(q))
      return { handled: true, ops: [], ai: { kind: 'write', mode: 'correct', text: inline, source: inline ? 'text' : /clipboard|copied/i.test(q) ? 'clipboard' : 'selection' } };
    if (/\b(rewrite|rephrase|reword|paraphrase|improve|polish|simplify|shorten|make (?:this|it)|expand|lengthen|tone down)\b/i.test(q)) {
      const tone = (q.match(/\b(formal|professional|polite|friendly|casual|short(?:er)?|concise|long(?:er)?|detailed|simple|simpler|persuasive|confident|warm|firm|direct|clear(?:er)?)\b/) || [])[1] || '';
      const T = { formal: 'formal and professional', professional: 'professional', polite: 'polite', friendly: 'friendly and warm', casual: 'casual', short: 'shorter', shorter: 'shorter', concise: 'concise', long: 'longer and more detailed', longer: 'longer and more detailed', detailed: 'more detailed', simple: 'simpler and easier to read', simpler: 'simpler and easier to read', persuasive: 'persuasive', confident: 'confident', warm: 'warm', firm: 'firm but polite', direct: 'direct', clear: 'clearer', clearer: 'clearer' };
      return { handled: true, ops: [], ai: { kind: 'write', mode: 'rewrite', tone: T[tone] || '', lang: A.langOf(q), text: inline, source: inline ? 'text' : /clipboard|copied/i.test(q) ? 'clipboard' : 'selection' } };
    }
    if (/^(?:write|draft|compose|create|prepare|type)\b.*\b(message|e-?mail|mail|reply|text|note|letter|whatsapp|apology|invitation|invite|follow[- ]?up|thank(?: you)?|request|reminder|post|bio|announcement)\b|^reply (?:to|saying|that|with|yes|no)\b|^(?:email|mail|message|text|whatsapp|tell|ask|write to)\s+[\p{L}][\p{L}'.-]*(?:\s+[\p{L}][\p{L}'.-]*)?\s+(?:that|about|to|if|whether|saying|and)\b/iu.test(text))
      return { handled: true, ops: [], ai: { kind: 'write', mode: 'compose', instruction: text, tone: (q.match(/\b(formal|polite|friendly|casual|short|brief|firm|apologetic|enthusiastic|professional)\b/) || [])[1] || '', lang: A.langOf(q), source: /\breply\b/i.test(q) ? 'selection' : 'none' } };
    if (/\bwhat(?:'s| is) on (?:my |the )?screen\b|\b(?:explain|read|look at|analy[sz]e|help me with|check|scan)\s+(?:this|the|my)\s+screen\b|\bwhat am i looking at\b|\bscreen assistant\b|\bwhat should i do (?:here|on this|on the screen)\b|\bhelp me with this\b/i.test(q))
      return { handled: true, ops: [], ai: { kind: 'screen', question: /\b(what should i do|help me)\b/i.test(q) || /screen/.test(q) ? 'What should I do next on this screen?' : text } };

    /* ---- natural-language search ---- */
    if (/^(?:find|search|look|locate|where|show me|do i have|did i|what did i|how much (?:did|have) i|how much money|which|open (?:my |the )?(?:\S+ )?(?:file|document|spreadsheet|pdf|photo|presentation))\b/i.test(q) || /\bhow much\b.*\b(spen[dt]|expenses?)\b/i.test(q)) {
      const kindApp = /\b(app|application|program)\b/i.test(q), kindFile = /\b(files?|documents?|spreadsheets?|pdfs?|photos?|pictures?|presentations?|slides?|excel|word|recordings?|images?|videos?|screenshots?)\b/i.test(q);
      return { handled: true, ops: [], search: { query: text, files: kindFile || /^open\b/i.test(q), apps: kindApp, fq: A.fileQuery(text, now) } };
    }

    /* ---- open an app or a slide ---- */
    if ((m = text.match(/^(?:open|launch|start|run|switch to|go to|show(?: me)?|take me to|bring up)\s+(?:the |my )?(.+?)(?:\s+(?:slide|tab|page|screen|view|app))?$/i))) {
      const name = m[1].toLowerCase().trim();
      if (BUILTIN[name]) return say('Opening ' + name + '.', { ops: [{ op: 'sys', name: BUILTIN[name] }] });
      if (aliasMap[name] && !/\bapp$/i.test(text)) return say('Opening ' + name + '.', { ops: [{ op: 'go', slide: aliasMap[name] }] });
      if (/^(?:open|launch|start|run|switch to)$/i.test(text.split(' ')[0]) && !/^(?:a|an|some|something|that|it|this)$/i.test(name)) return say('Opening ' + m[1] + '.', { ops: [{ op: 'openApp', query: m[1] }] });
    }

    /* ---- suggestions: "what should I do now?" ---- */
    if (/^(?:what should i (?:do|work on)(?: now| next| first)?|what(?:'s| is) next|what now|any suggestions|suggest(?: something)?|what do you suggest|next task|help me (?:focus|prioriti[sz]e)|prioriti[sz]e(?: my tasks)?|what(?:'s| is) most important)$/i.test(q)) {
      const nx = sn.urgent[0] || sn.reminders[0] || sn.pending[0] || sn.anytime[0];
      return say(nx ? 'Start with "' + nx.text + '"' + (nx.due ? ' (at ' + A.clock(nx.due, o.clock24) + ')' : sn.urgent.includes(nx) ? ', it is urgent' : '') + '. ' + (sn.pending.length > 1 ? A.plural(sn.pending.length - 1, 'other task') + ' after that.' : '') : 'Nothing is pending. A good moment to plan tomorrow or take a break.', { suggestions: true });
    }

    /* ---- adding things ---- */
    const cm = P.parseCapture(text, new Date(now));
    if (cm.kind === 'expense' || cm.kind === 'idea') return say(cm.kind === 'expense' ? 'Saving the expense.' : 'Saving your idea.', { ops: [{ op: 'addCapture', text }] });
    if ((m = text.match(/^(?:journal|diary|note to self|write in my journal|dear diary)[:,\-]?\s+(.+)$/i))) return say('Saved to your journal.', { ops: [{ op: 'journal', text: m[1] }] });
    if ((m = text.match(/^(?:remind me|reminder)\s*(?:to |about |that |of )?(.+)$/i) || text.match(/^(?:add|create|new|make|put|save|set(?: up)?)\s+(?:a |an |the |new )?(?:task|todo|to-?do|reminder|note)\s*(?:to |for |called |named |that |about |:|-)?\s*(.+)$/i) || text.match(/^(?:task|todo|to-?do)[:\-]?\s+(.+)$/i) || text.match(/^add\s+(.+?)\s+to\s+(?:my\s+)?(?:(shopping|work|personal|urgent)\s+)?(?:task\s+|to-?do\s+)?(?:list|planner|tasks)$/i) || text.match(/^(?:add|remember to|don't forget to)\s+(.+)$/i))) {
      const cat = (m[2] || '').toLowerCase(), body = (cat ? cat + ': ' : '') + m[1].replace(/^to\s+/i, ''), p = P.parseCapture(body, new Date(now));
      if (p.text && p.kind === 'task') return say('Added "' + p.text + '"' + (whenText(p, o) ? ' ' + whenText(p, o) : '') + '.', { ops: [{ op: 'addCapture', text: body }] });
    }

    /* ---- something about the user worth remembering? offer it, never store it silently ---- */
    if (memoryOn) { const cand = A.memoryCandidate(text); if (cand) return say('Noted. Want me to remember that?', { proposal: cand }); }

    /* ---- anything else: a normal conversation, with context if the user allows it ---- */
    return { handled: false, ops: [], ai: { kind: 'chat', text } };
  }

  return { route, lead, duration, matchBy, DATA_OPS, SLIDE_ALIASES, BUILTIN };
});
