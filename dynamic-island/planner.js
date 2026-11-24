/* Planner logic with no Electron or DOM in it, so the island, the main process and the tests all share it.
 * Quick Capture understands a sentence on this PC (no network); an AI pass is optional and only fills gaps. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('./wellness.js')); else root.Planner = factory(root.DIWell); })(this, function (W) {
  const CATS = ['personal', 'work', 'shopping', 'urgent'];
  const PRIS = ['low', 'normal', 'high'];
  const REPEATS = ['none', 'daily', 'weekly', 'weekdays', 'monthly'];
  const CONDS = ['none', 'charging', 'online', 'unlock'];
  const EXP_CATS = ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Other'];
  const INC_CATS = ['Salary', 'Business', 'Gift', 'Refund', 'Interest', 'Other'];
  /* "1,200.50", "1.200,50", "1,200", "12,5", "1200" -> number (a comma before exactly 3 digits is a thousands separator) */
  function parseAmount(s) {
    s = String(s == null ? '' : s).trim(); if (!/^\d[\d.,]*$/.test(s)) return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) return parseFloat(lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
    if (lc >= 0) return /^\d{1,3}(,\d{3})+$/.test(s) ? parseFloat(s.replace(/,/g, '')) : parseFloat(s.replace(',', '.'));
    if ((s.match(/\./g) || []).length > 1) return parseFloat(s.replace(/\./g, ''));
    return parseFloat(s);
  }
  const DAY = 864e5;
  const p2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const parseYmd = (s) => { const a = String(s).split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
  const validYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const cap = (s, n) => String(s == null ? '' : s).slice(0, n);
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

  const WD = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
  const WDRE = '(?:sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)';
  const MO = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MORE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const mon = (s) => MO[s.slice(0, 3).toLowerCase()];

  /* ---------- category / expense category guesses ---------- */
  const SHOP = /\b(buy|groceries|grocery|shopping|purchase|supermarket|vegetables|milk|restock)\b/i;
  const WORK = /\b(supplier|client|customer|vendor|meeting|report|excel|invoice|project|office|presentation|deadline|email|e-mail|boss|manager|team|quote|quotation|proposal|payroll|gst|tax|sales|submit|review|standup)\b/i;
  const guessCat = (t) => (SHOP.test(t) ? 'shopping' : WORK.test(t) ? 'work' : 'personal');
  const INC_RULES = [['Salary', /\b(salary|pay ?check|paycheque|wages?|stipend)\b/i], ['Business', /\b(sales?|client|customer|invoice|freelance|business|commission)\b/i], ['Gift', /\b(gift|birthday|bonus)\b/i], ['Refund', /\b(refund|cashback|cash back|reimbursement)\b/i], ['Interest', /\b(interest|dividend)\b/i]];
  const guessIncCat = (t) => { for (const r of INC_RULES) if (r[1].test(t)) return r[0]; return 'Other'; };
  const EXP_RULES = [['Food', /\b(lunch|dinner|breakfast|food|tea|coffee|snack|grocer\w*|restaurant|biryani|meal|juice|vegetables)\b/i], ['Transport', /\b(petrol|diesel|fuel|bus|auto|taxi|cab|uber|ola|train|metro|ticket|parking|toll)\b/i], ['Bills', /\b(bill|rent|electricity|recharge|internet|wifi|emi|insurance|water|gas|phone)\b/i], ['Health', /\b(medicine|doctor|hospital|pharmacy|clinic|tablet|dental)\b/i], ['Shopping', /\b(clothes|shirt|shoes|amazon|flipkart|shopping|bought|gift)\b/i]];
  const guessExpCat = (t) => { for (const r of EXP_RULES) if (r[1].test(t)) return r[0]; return 'Other'; };

  /* ---------- Quick Capture parser ---------- */
  function resolveHour(h, mi, ap) {
    mi = mi ? +mi : 0; h = +h; ap = ap && ap.toLowerCase().replace(/\./g, '');
    if (mi > 59 || h > 23) return null;
    if (ap) { if (h < 1 || h > 12) return null; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
    else if (h >= 1 && h <= 7) h += 12;   // "at 7" means 7 PM; 8-11 stay morning, 12 is noon
    return [h, mi];
  }
  function parseCapture(raw, now) {
    now = now || new Date();
    const out = { text: '', kind: 'task', date: null, hasTime: false, due: null, by: null, cat: 'personal', pri: 'normal', repeat: 'none', cond: 'none', found: { date: false, time: false } };
    const orig = cap(String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim(), 300);
    if (!orig) return out;
    let m;
    if ((m = orig.match(/^(idea|note|thought)\s*[:\-]\s*(.+)$/i))) { out.kind = 'idea'; out.text = cap(m[2].charAt(0).toUpperCase() + m[2].slice(1), 500); return out; }
    const shopText = W && W.parseShoppingPhrase ? W.parseShoppingPhrase(orig) : null;
    if (shopText && W.splitShopping(shopText).length) { out.kind = 'shopping'; out.text = cap(shopText, 300); return out; }
    if ((m = orig.match(/^(?:spent|expense)\s*[:\-]?\s*(?:rs\.?|inr|₹|\$)?\s*(\d[\d.,]*)\s*(?:rs|rupees|inr)?\s*(?:on|for|at)?\s*(.*)$/i))) {
      const amt = parseAmount(m[1]); if (amt > 0) { out.kind = 'expense'; out.amount = Math.round(amt * 100) / 100; out.text = cap(m[2].replace(/[.!\s]+$/, '') || 'Expense', 120); out.cat = guessExpCat(out.text); return out; }
    }
    if ((m = orig.match(/^(?:income|earned|received|got paid|credited|salary)\s*[:\-]?\s*(?:rs\.?|inr|₹|\$)?\s*(\d[\d.,]*)\s*(?:rs|rupees|inr)?\s*(?:from|for|as|of|on)?\s*(.*)$/i))) {
      const amt = parseAmount(m[1]); if (amt > 0) { out.kind = 'income'; out.amount = Math.round(amt * 100) / 100; out.text = cap(m[2].replace(/[.!\s]+$/, '') || (/^salary/i.test(orig) ? 'Salary' : 'Income'), 120); out.cat = guessIncCat(/^salary/i.test(orig) ? 'salary ' + out.text : out.text); return out; }
    }
    let s = ' ' + orig + ' ';
    const take = (re, fn) => { const x = s.match(re); if (!x) return false; s = s.replace(re, ' '); if (fn) fn(x); return true; };
    let flaggedUrgent = false, wd = null, relTime = false;

    take(/^\s*(personal|work|shopping|urgent)\s*:\s*/i, (x) => { out.cat = x[1].toLowerCase(); if (out.cat === 'urgent') { flaggedUrgent = true; out.pri = 'high'; } });
    if (take(/\b(urgent(?:ly)?|asap|critical)\b/i)) { flaggedUrgent = true; out.cat = 'urgent'; out.pri = 'high'; }
    if (take(/\b(important|high priority|top priority)\b/i)) out.pri = 'high';
    if (take(/\b(low priority|someday|whenever|no rush)\b/i)) out.pri = 'low';
    if (take(/!{2,}/)) out.pri = 'high';

    /* repeat */
    if (take(/\bevery\s+weekday\b|\bweekdays\b/i)) out.repeat = 'weekdays';
    else if (take(new RegExp('\\bevery\\s+(' + WDRE + ')\\b', 'i'), (x) => { out.repeat = 'weekly'; wd = WD[x[1].toLowerCase()]; })) { /* weekly on a day */ }
    else if (take(/\bevery\s*day\b|\bdaily\b|\beveryday\b/i)) out.repeat = 'daily';
    else if (take(/\bevery\s+week\b|\bweekly\b/i)) out.repeat = 'weekly';
    else if (take(/\bevery\s+month\b|\bmonthly\b/i)) out.repeat = 'monthly';

    /* conditions */
    if (take(/\bwhen(?:ever)?\s+(?:i\s*(?:'m|am)?\s*)?(?:plug(?:ged)?\s*in|charging|on charge)\b/i)) out.cond = 'charging';
    else if (take(/\bwhen(?:ever)?\s+(?:i\s*(?:'m|am)\s*|i\s*|we\s*(?:'re)?\s*)?(?:back\s+)?(?:online|connected)\b|\bwhen\s+(?:the\s+)?internet\s+(?:is\s+)?(?:back|connected|on)\b/i)) out.cond = 'online';
    else if (take(/\bwhen(?:ever)?\s+i\s+(?:unlock|log\s*in|get\s+back|come\s+back|start\s+(?:my\s+)?pc)\b/i)) out.cond = 'unlock';

    /* time of day */
    let hm = null, byHm = null;
    if (take(/\bin\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?|h)\b/i, (x) => { const n = +x[1], ms = /^h/i.test(x[2]) ? n * 3600e3 : n * 60e3; out.due = now.getTime() + ms; relTime = true; })) { out.hasTime = true; out.found.time = true; }
    if (!relTime) {
      const tm = (x, a, b, c) => resolveHour(x[a], x[b], x[c]);
      let re = /\b(?:before|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?!\w)|\b(?:before|by)\s+(\d{1,2}):(\d{2})\b/i;
      if ((m = s.match(re))) { byHm = m[1] ? tm(m, 1, 2, 3) : tm(m, 4, 5, 6); if (byHm) s = s.replace(re, ' '); }
      if (!byHm) {
        re = new RegExp('(?:\\bat|@)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?(?![\\w:])(?!\\s*' + MORE + '\\b)|\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?!\\w)|\\b([01]?\\d|2[0-3]):([0-5]\\d)\\b', 'i');
        m = s.match(re);
        if (m) { hm = m[1] ? tm(m, 1, 2, 3) : m[4] ? tm(m, 4, 5, 6) : tm(m, 7, 8, 9); if (hm) s = s.replace(re, ' '); }
      }
      if (!hm && !byHm) {
        if (take(/\btonight\b/i)) { hm = [20, 0]; s += ' today '; }
        else if (take(/\b(tomorrow|today|this)\s+(morning|afternoon|evening)\b/i, (x) => { hm = { morning: [9, 0], afternoon: [15, 0], evening: [18, 0] }[x[2].toLowerCase()]; if (/^(tomorrow|today)$/i.test(x[1])) s += ' ' + x[1] + ' '; })) { /* time word */ }
        else if (take(/\bevery\s+(morning|evening)\b/i, (x) => { hm = /morning/i.test(x[1]) ? [9, 0] : [18, 0]; if (out.repeat === 'none') out.repeat = 'daily'; })) { /* daily at a time of day */ }
        else if (take(/\b(?:at\s+)?noon\b/i)) hm = [12, 0];
        else if (take(/\b(?:eod|end of (?:the )?day)\b/i)) hm = [17, 0];
      }
    }

    /* date */
    const today0 = startOfDay(now); let date = null, explicit = false;
    const setD = (d) => { date = d; explicit = true; };
    const mkMD = (d, mo, y) => { let dt = new Date(y || today0.getFullYear(), mo, d); if (dt.getMonth() !== mo) return null; if (!y && dt < today0) dt = new Date(today0.getFullYear() + 1, mo, d); return dt; };
    if (take(/\bday after tomorrow\b/i)) setD(addDays(today0, 2));
    else if (take(/\b(?:tomorrow|tmrw|tmr)\b/i)) setD(addDays(today0, 1));
    else if (take(/\btoday\b/i)) setD(today0);
    else if (take(new RegExp('\\b(next|this|on)?\\s*(' + WDRE + ')\\b', 'i'), (x) => {
      const target = WD[x[2].toLowerCase()]; let diff = (target - today0.getDay() + 7) % 7;
      if (x[1] && x[1].toLowerCase() === 'next' && diff === 0) diff = 7; else if (x[1] && x[1].toLowerCase() === 'next') diff = diff || 7;
      setD(addDays(today0, diff));
    })) { /* weekday */ }
    else if ((m = s.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MORE + ')\\b(?:\\s+(\\d{4}))?', 'i'))) && mkMD(+m[1], mon(m[2]), m[3] && +m[3])) { setD(mkMD(+m[1], mon(m[2]), m[3] && +m[3])); s = s.replace(m[0], ' '); }
    else if ((m = s.match(new RegExp('\\b(' + MORE + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?', 'i'))) && mkMD(+m[2], mon(m[1]), m[3] && +m[3])) { setD(mkMD(+m[2], mon(m[1]), m[3] && +m[3])); s = s.replace(m[0], ' '); }
    else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)) && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
      const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : 0, d = mkMD(+m[1], +m[2] - 1, y); if (d) { setD(d); s = s.replace(m[0], ' '); }
    } else if ((m = s.match(/\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/i)) && +m[1] >= 1 && +m[1] <= 31) {
      let d = new Date(today0.getFullYear(), today0.getMonth(), +m[1]); if (d < today0) d = new Date(today0.getFullYear(), today0.getMonth() + 1, +m[1]); setD(d); s = s.replace(m[0], ' ');
    } else if (take(/\bin\s+(\d{1,3})\s+(day|week)s?\b/i, (x) => setD(addDays(today0, +x[1] * (/week/i.test(x[2]) ? 7 : 1))))) { /* relative days */ }
    else if (take(/\bnext\s+week\b/i)) setD(addDays(today0, 7));
    else if (take(/\bnext\s+month\b/i)) setD(new Date(today0.getFullYear(), today0.getMonth() + 1, today0.getDate()));
    if (!date && wd !== null) { setD(addDays(today0, (wd - today0.getDay() + 7) % 7)); }   // "every Monday" starts on the next Monday

    /* resolve */
    const at = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h[0], h[1]).getTime();
    if (relTime) { date = startOfDay(new Date(out.due)); out.found.time = true; }
    else if (byHm || hm) {
      out.hasTime = true; out.found.time = true;
      if (!date) date = today0;
      const t = at(date, byHm || hm);
      let dd = date;
      if (!explicit && t <= now.getTime()) dd = addDays(date, 1);
      if (!explicit && dd !== date) date = dd;
      if (byHm) { out.by = at(date, byHm); out.due = out.by - 30 * 60e3; if (out.due <= now.getTime()) out.due = out.by; }
      else out.due = at(date, hm);
    } else if (date && out.repeat === 'none' && out.cond === 'none') { /* date only: no alert time */ }
    if (explicit) out.found.date = true;
    if (!out.hasTime && !date && out.repeat !== 'none') date = today0;
    out.date = date ? ymd(date) : null;

    /* text */
    let t = s.replace(/\s+/g, ' ').trim();
    t = t.replace(/^(?:remind me to|remind me|please|to do:?|todo:?)\s+/i, '').replace(/^to\s+/i, '');
    for (let i = 0; i < 4; i++) t = t.replace(/^[\s:;,\-–.]+|[\s:;,\-–.!]+$/g, '').replace(/\s+(?:on|at|by|before|in|for|every|this|next|the|and|when)$/i, '').replace(/^(?:on|at|and)\s+/i, '');
    if (!t) t = orig.replace(/[.!\s]+$/, '');
    t = cap(t.charAt(0).toUpperCase() + t.slice(1), 120);
    out.text = t;
    if (!flaggedUrgent && out.cat === 'personal') out.cat = guessCat(t);
    return out;
  }

  const makeTask = (p, now, id) => ({ id: id || uid(), text: p.text, done: false, doneAt: null, due: p.due || null, date: p.date || null, by: p.by || null, cat: CATS.includes(p.cat) ? p.cat : 'personal', pri: PRIS.includes(p.pri) ? p.pri : 'normal', repeat: REPEATS.includes(p.repeat) ? p.repeat : 'none', cond: CONDS.includes(p.cond) ? p.cond : 'none', notified: false, spawned: false, created: now || Date.now() });

  /* ---------- optional AI pass ---------- */
  function aiMessages(text, now) {
    now = now || new Date();
    return [{ role: 'system', content: 'You turn one short sentence into a task. Reply with ONLY a JSON object, no other words.' }, { role: 'user', content: 'Today is ' + ymd(now) + ' (' + now.toLocaleDateString('en-US', { weekday: 'long' }) + '). Sentence: "' + cap(text, 300).replace(/"/g, "'") + '"\nJSON keys: "text" (short task name without the date or time words), "date" (YYYY-MM-DD or null), "time" (HH:MM 24-hour or null), "category" (personal, work, shopping or urgent), "priority" (low, normal or high), "repeat" (none, daily, weekly, weekdays or monthly).' }];
  }
  function parseAiJson(txt) {
    const m = String(txt || '').match(/\{[\s\S]*\}/); if (!m) return null;
    try { const j = JSON.parse(m[0]); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; }
  }
  /* Rules win where they found something explicit; the AI fills the gaps and can improve name, category and priority. */
  function mergeAi(rules, ai, now) {
    if (!ai || rules.kind !== 'task') return null;
    const r = { ...rules, found: { ...rules.found } }; let changed = false;
    if (typeof ai.text === 'string' && ai.text.trim() && ai.text.length <= 120) { r.text = cap(ai.text.trim(), 120); changed = true; }
    const cat = String(ai.category || '').toLowerCase(), pri = String(ai.priority || '').toLowerCase(), rep = String(ai.repeat || '').toLowerCase();
    if (CATS.includes(cat) && !(rules.cat === 'urgent')) { r.cat = cat; changed = true; }
    if (PRIS.includes(pri) && rules.pri === 'normal') { r.pri = pri; changed = true; }
    if (REPEATS.includes(rep) && rules.repeat === 'none' && rep !== 'none') { r.repeat = rep; changed = true; }
    if (!rules.found.date && validYmd(ai.date)) { r.date = ai.date; r.found.date = true; changed = true; }
    if (!rules.found.time && typeof ai.time === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(ai.time) && (r.date || rules.date)) {
      const a = ai.time.split(':').map(Number), d = parseYmd(r.date || rules.date); r.date = ymd(d); r.due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), a[0], a[1]).getTime(); r.hasTime = true; r.found.time = true; changed = true;
    }
    return changed ? r : null;
  }

  /* ---------- sanitising (everything the renderer sends is rebuilt field by field) ---------- */
  function sanitizeTask(t) {
    if (!t || typeof t !== 'object') return null;
    const text = cap(t.text, 200).trim(); if (!text) return null;
    const o = { id: cap(t.id, 40) || uid(), text, done: !!t.done, doneAt: num(t.doneAt), due: num(t.due), date: validYmd(t.date) ? t.date : null, by: num(t.by), cat: CATS.includes(t.cat) ? t.cat : 'personal', pri: PRIS.includes(t.pri) ? t.pri : 'normal', repeat: REPEATS.includes(t.repeat) ? t.repeat : 'none', cond: CONDS.includes(t.cond) ? t.cond : 'none', notified: !!t.notified, spawned: !!t.spawned };
    if (typeof t.imp === 'boolean') o.imp = t.imp;
    if (num(t.created)) o.created = t.created;
    return o;
  }
  function sanitizeHabit(h) {
    if (!h || typeof h !== 'object') return null; const name = cap(h.name, 60).trim(); if (!name) return null;
    const days = [...new Set((Array.isArray(h.days) ? h.days : []).filter(validYmd))].sort().slice(-400);
    return { id: cap(h.id, 40) || uid(), name, days };
  }
  function sanitizeGoal(g) {
    if (!g || typeof g !== 'object') return null; const text = cap(g.text, 60).trim(), target = Math.min(1e6, Math.max(1, +g.target || 1)); if (!text) return null;
    const log = {}; if (g.log && typeof g.log === 'object') Object.keys(g.log).filter(validYmd).sort().slice(-60).forEach((k) => { const v = +g.log[k]; if (isFinite(v) && v >= 0) log[k] = Math.min(1e7, v); });
    return { id: cap(g.id, 40) || uid(), text, target, unit: cap(g.unit, 16).trim(), log };
  }
  function sanitizeEntry(e) {
    if (!e || typeof e !== 'object') return null; const text = cap(e.text, 4000).trim(); if (!text) return null;
    return { id: cap(e.id, 40) || uid(), t: num(e.t) || Date.now(), text, mood: [0, 1, 2, 3, 4, 5].includes(e.mood) ? e.mood : 0, kind: e.kind === 'idea' ? 'idea' : 'entry' };
  }
  function sanitizeExpense(e) {
    if (!e || typeof e !== 'object') return null; const amount = Math.round((+e.amount || 0) * 100) / 100; if (!(amount > 0) || amount > 1e9) return null;
    const type = e.type === 'income' ? 'income' : 'expense';
    return { id: cap(e.id, 40) || uid(), t: num(e.t) || Date.now(), amount, type, cat: (type === 'income' ? INC_CATS : EXP_CATS).includes(e.cat) ? e.cat : 'Other', note: cap(e.note, 80).trim() };
  }
  const sanitizeList = (arr, fn, max) => (Array.isArray(arr) ? arr : []).slice(0, max).map(fn).filter(Boolean);

  /* ---------- repeating tasks ---------- */
  function nextOccurrence(t, now) {
    const today0 = startOfDay(new Date(now)), base = t.due ? new Date(t.due) : t.date ? parseYmd(t.date) : today0;
    const dom = base.getDate(); let d = new Date(base), k = 0;
    do {
      k++;
      if (t.repeat === 'daily') d = addDays(d, 1);
      else if (t.repeat === 'weekly') d = addDays(d, 7);
      else if (t.repeat === 'weekdays') { d = addDays(d, 1); while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1); }
      else { const y = base.getFullYear(), mo = base.getMonth() + k, dim = new Date(y, mo + 1, 0).getDate(); d = new Date(y, mo, Math.min(dom, dim), base.getHours(), base.getMinutes()); }
    } while (startOfDay(d) <= today0 && k < 2000);
    return { d, base };
  }
  /* A task that just went from open to done and repeats gets one fresh copy for its next day. */
  function spawnNext(prev, next, now) {
    now = now || Date.now(); const before = new Map((prev || []).map((t) => [t.id, t])); const add = []; let changed = false;
    const out = next.map((t) => {
      if (t.done && t.repeat !== 'none' && !t.spawned && before.has(t.id) && !before.get(t.id).done) {
        const { d, base } = nextOccurrence(t, now); changed = true;
        add.push({ ...t, id: uid(), done: false, doneAt: null, notified: false, spawned: false, due: t.due ? d.getTime() : null, by: t.by ? t.by + (d.getTime() - base.getTime()) : null, date: ymd(d), created: now });
        return { ...t, spawned: true, doneAt: t.doneAt || now };
      }
      if (t.done && !t.doneAt) { changed = true; return { ...t, doneAt: now }; }
      return t;
    });
    return { tasks: [...add, ...out], changed };
  }

  /* ---------- today's plan, matrix ---------- */
  const dayOf = (t) => (t.due ? ymd(new Date(t.due)) : t.date || null);
  const sortKey = (t) => (t.cat === 'urgent' || t.pri === 'high' ? 0 : 1);
  function groupTasks(tasks, now) {
    now = now || Date.now(); const today = ymd(new Date(now)); const g = { overdue: [], today: [], upcoming: [], anytime: [], doneToday: [] };
    const by = (a, b) => sortKey(a) - sortKey(b) || (a.due || 9e15) - (b.due || 9e15) || String(a.text).localeCompare(b.text);
    for (const t of tasks) {
      const d = dayOf(t);
      if (t.done) { if (t.doneAt && ymd(new Date(t.doneAt)) === today) g.doneToday.push(t); continue; }
      if (!d) g.anytime.push(t); else if (d < today) g.overdue.push(t); else if (d === today) g.today.push(t); else g.upcoming.push(t);
    }
    g.overdue.sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || by(a, b)); g.today.sort(by); g.anytime.sort(by); g.upcoming.sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || by(a, b));
    g.progress = { done: g.doneToday.length, total: g.doneToday.length + g.today.length + g.overdue.length };
    return g;
  }
  const isImportant = (t) => (typeof t.imp === 'boolean' ? t.imp : t.pri === 'high' || t.cat === 'urgent');
  function quadrant(t, now) {
    now = now || Date.now(); const end = t.due || (t.date ? parseYmd(t.date).getTime() + DAY - 1 : null);
    const urgent = end !== null && end - now <= DAY, imp = isImportant(t);
    return imp && urgent ? 'do' : imp ? 'plan' : urgent ? 'quick' : 'later';
  }

  /* ---------- habits, goals ---------- */
  function habitStats(h, now) {
    const set = new Set(h.days), today0 = startOfDay(new Date(now || Date.now())), k = (d) => ymd(d);
    let streak = 0, d = new Date(today0); if (!set.has(k(d))) d = addDays(d, -1);
    while (set.has(k(d))) { streak++; d = addDays(d, -1); }
    let best = 0, run = 0, prev = null;
    for (const s of [...set].sort()) { run = prev && ymd(addDays(parseYmd(prev), 1)) === s ? run + 1 : 1; best = Math.max(best, run); prev = s; }
    return { doneToday: set.has(k(today0)), streak, best, last7: [6, 5, 4, 3, 2, 1, 0].map((i) => set.has(k(addDays(today0, -i)))), total: set.size };
  }
  const toggleHabit = (h, day) => ({ ...h, days: h.days.includes(day) ? h.days.filter((x) => x !== day) : [...h.days, day].sort() });
  function goalStats(g, now) {
    const today0 = startOfDay(new Date(now || Date.now())), n = g.log[ymd(today0)] || 0; let streak = 0, d = new Date(today0);
    if (!(n >= g.target)) d = addDays(d, -1);
    while ((g.log[ymd(d)] || 0) >= g.target) { streak++; d = addDays(d, -1); }
    return { n, pct: Math.min(100, Math.round((n / g.target) * 100)), hit: n >= g.target, streak };
  }
  const bumpGoal = (g, day, delta) => ({ ...g, log: { ...g.log, [day]: Math.max(0, Math.round(((g.log[day] || 0) + delta) * 100) / 100) } });

  /* ---------- expenses ---------- */
  function expenseSummary(list, now) {
    const n = new Date(now || Date.now()), today = ymd(n), wk = ymd(addDays(startOfDay(n), -6)), mo = n.getFullYear() + '-' + p2(n.getMonth() + 1);
    const r = { today: 0, week: 0, month: 0, byCat: {}, incomeToday: 0, incomeWeek: 0, incomeMonth: 0, incByCat: {} };
    for (const e of list) {
      const d = ymd(new Date(e.t)), inc = e.type === 'income';
      if (inc) { if (d === today) r.incomeToday += e.amount; if (d >= wk && d <= today) r.incomeWeek += e.amount; if (d.slice(0, 7) === mo) { r.incomeMonth += e.amount; r.incByCat[e.cat] = (r.incByCat[e.cat] || 0) + e.amount; } continue; }
      if (d === today) r.today += e.amount; if (d >= wk && d <= today) r.week += e.amount; if (d.slice(0, 7) === mo) { r.month += e.amount; r.byCat[e.cat] = (r.byCat[e.cat] || 0) + e.amount; }
    }
    const rd = (x) => Math.round(x * 100) / 100; for (const k of ['today', 'week', 'month', 'incomeToday', 'incomeWeek', 'incomeMonth']) r[k] = rd(r[k]);
    r.balanceMonth = rd(r.incomeMonth - r.month);
    r.cats = Object.keys(r.byCat).map((c) => [c, rd(r.byCat[c])]).sort((a, b) => b[1] - a[1]);
    r.incCats = Object.keys(r.incByCat).map((c) => [c, rd(r.incByCat[c])]).sort((a, b) => b[1] - a[1]);
    return r;
  }

  return { CATS, PRIS, REPEATS, CONDS, EXP_CATS, INC_CATS, parseAmount, guessIncCat, ymd, parseYmd, validYmd, uid, parseCapture, makeTask, aiMessages, parseAiJson, mergeAi, sanitizeTask, sanitizeHabit, sanitizeGoal, sanitizeEntry, sanitizeExpense, sanitizeList, spawnNext, nextOccurrence, dayOf, groupTasks, isImportant, quadrant, habitStats, toggleHabit, goalStats, bumpGoal, expenseSummary, guessExpCat };
});
