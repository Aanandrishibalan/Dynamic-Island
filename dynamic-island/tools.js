/* Pure logic for the productivity tools: clipboard history, text expander, calculator, unit converter,
 * batch rename, QR payloads and window-layout geometry. No Electron, no file system, no network:
 * the same file runs in the main process (require) and in the island page (<script src="tools.js">, window.DITools),
 * and is covered by tests/tools.test.js. */
(function (g, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else g.DITools = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const T = {};
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const pad2 = (n) => String(n).padStart(2, '0');

  /* =====================================================================================================
   * 1. Clipboard manager + history
   * ===================================================================================================== */
  T.CLIP_MAX_LEN = 20000;
  T.CLIP_TYPES = ['url', 'email', 'phone', 'invoice', 'address', 'number', 'paragraph', 'text'];
  const STREET = /\b(street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|nagar|colony|sector|floor|flat|plot|apartment|apt\.?|block|cross|main|near|opp\.?|layout|village|district|dist\.?|taluk|salai|marg|chowk|po box|p\.?o\.? box|suite|ste\.?|boulevard|blvd\.?|drive|dr\.?)\b/i;
  const INVOICE_WORD = /^(?:inv(?:oice)?|bill|po|so|order|ord|ref|receipt|rcpt|txn|trx|utr|ticket|tkt|case|id)[\s#:.\-_\/]*[a-z0-9][a-z0-9\-_\/]{2,28}$/i;

  /** Guess what a copied piece of text is, so it can be filtered and recognised at a glance. */
  T.classifyClip = function (text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return 'text';
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(t)) return 'url';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return 'email';
    const isDate = /^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}$/.test(t) || /^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}$/.test(t);
    const digits = t.replace(/\D/g, '');
    if (!isDate && /^\+?[\d\s().\-]{7,22}$/.test(t) && digits.length >= 7 && digits.length <= 15) return 'phone';
    if ((INVOICE_WORD.test(t) && /\d/.test(t)) || /^#\s?\d{3,}$/.test(t) || /^[A-Z]{2,5}[-\/]\d{4}[-\/]\d{2,8}$/.test(t)) return 'invoice';
    if (/^[-+]?[₹$€£]?\s?\d[\d,]*(?:\.\d+)?%?$/.test(t) && !isDate) return 'number';
    const parts = t.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
    const pin = /\b\d{6}\b/.test(t) || /\b\d{5}(?:-\d{4})?\b/.test(t);
    if (t.length >= 12 && t.length <= 300 && /\d/.test(t) && parts.length >= 2 && (STREET.test(t) || pin)) return 'address';
    if (t.length > 160 || /\r?\n/.test(t)) return 'paragraph';
    return 'text';
  };

  T.sanitizeClip = function (c) {
    if (!c || typeof c !== 'object') return null;
    const text = str(c.text, T.CLIP_MAX_LEN);
    if (!text.trim()) return null;
    return { id: str(c.id, 40) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), t: Number(c.t) || 0, text,
      type: T.CLIP_TYPES.includes(c.type) ? c.type : T.classifyClip(text), pinned: !!c.pinned, label: str(c.label, 60).trim() };
  };
  T.sanitizeClips = (arr, max) => (Array.isArray(arr) ? arr : []).map(T.sanitizeClip).filter(Boolean).slice(0, max || 1000);

  /** Add copied text to the list (newest first). Same text again moves to the top and keeps its pin / label.
   *  Pinned ("saved") items are never dropped by the size limit. Returns { list, added }. */
  T.addClip = function (list, text, now, opts) {
    opts = opts || {};
    text = String(text == null ? '' : text);
    if (!text.trim() || text.length > T.CLIP_MAX_LEN) return { list, added: null };
    const max = Math.max(10, Math.min(500, Number(opts.max) || 100));
    const i = list.findIndex((c) => c.text === text);
    let item;
    const rest = list.slice();
    if (i >= 0) { item = { ...rest.splice(i, 1)[0], t: now }; }
    else item = { id: now.toString(36) + Math.random().toString(36).slice(2, 8), t: now, text, type: T.classifyClip(text), pinned: false, label: '' };
    let out = [item, ...rest];
    let unpinned = 0;
    out = out.filter((c) => c.pinned || ++unpinned <= max);
    return { list: out.slice(0, 700), added: item };
  };

  /** Drop unpinned items older than `days` (0 = keep forever). */
  T.purgeClips = (list, days, now) => (!days || days <= 0 ? list : list.filter((c) => c.pinned || now - c.t <= days * 86400000));

  /** Search + filter. filter: 'all' | 'saved' | a type. q: words, all must appear in the text, label or type name. */
  T.searchClips = function (list, q, filter) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter((c) => {
      if (filter === 'saved' && !c.pinned) return false;
      if (filter && filter !== 'all' && filter !== 'saved' && c.type !== filter) return false;
      if (!words.length) return true;
      const hay = (c.text + ' ' + c.label + ' ' + c.type).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  };
  T.clipPreview = function (c, n) {
    n = n || 300;
    return { id: c.id, t: c.t, type: c.type, pinned: !!c.pinned, label: c.label || '', len: c.text.length, text: c.text.length > n ? c.text.slice(0, n) + '…' : c.text };
  };

  /* =====================================================================================================
   * 2. Text expander (snippets)
   * ===================================================================================================== */
  // A trigger starts with a symbol so ordinary words never expand by accident: ;sig  /addr  \\mail  :ty  #id  @me  !hi  ~x
  T.TRIGGER_RE = /^[;\/\\:#@!~][A-Za-z0-9_.\-]{1,19}$/;
  T.sanitizeSnippet = function (s) {
    if (!s || typeof s !== 'object') return null;
    const trigger = str(s.trigger, 20).trim(), text = str(s.text, 5000);
    if (!T.TRIGGER_RE.test(trigger) || !text) return null;
    return { id: str(s.id, 40) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), trigger, text, label: str(s.label, 60).trim() };
  };
  T.sanitizeSnippets = function (arr) {
    const seen = new Set(), out = [];
    for (const s of Array.isArray(arr) ? arr : []) {
      const c = T.sanitizeSnippet(s); if (!c) continue;
      const k = c.trigger.toLowerCase(); if (seen.has(k)) continue;
      seen.add(k); out.push(c);
      if (out.length >= 200) break;
    }
    return out;
  };
  T.triggerProblem = function (trigger, snippets, selfId) {
    trigger = String(trigger || '').trim();
    if (!trigger) return 'Type a trigger, for example ;sig';
    if (!T.TRIGGER_RE.test(trigger)) return 'Start with one of ; / \\ : # @ ! ~ then 1-19 letters, digits, - _ .';
    const lc = trigger.toLowerCase();
    for (const s of snippets || []) {
      if (s.id === selfId) continue;
      const o = s.trigger.toLowerCase();
      if (o === lc) return 'That trigger is already used';
      if (o.startsWith(lc) || lc.startsWith(o)) return 'Clashes with ' + s.trigger + ': the shorter one would always fire first';   // expansion is instant, so a trigger that starts another can never be completed
    }
    return '';
  };
  const fmtDate = (d, f) => {
    const dd = pad2(d.getDate()), mm = pad2(d.getMonth() + 1), y = d.getFullYear();
    if (f === 'dmy') return dd + '/' + mm + '/' + y;
    if (f === 'mdy') return mm + '/' + dd + '/' + y;
    if (f === 'ymd') return y + '-' + mm + '-' + dd;
    if (f === 'long') return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return d.toLocaleDateString();
  };
  /** Fill placeholders: {date} {time} {datetime} {day} {clipboard}; {cursor} marks where the caret ends up.
   *  Returns { text, back } where back = characters between the caret mark and the end of the text. */
  T.expandTemplate = function (text, now, opts) {
    opts = opts || {};
    const d = now instanceof Date ? now : new Date(now || Date.now());
    const time = opts.clock24 === false ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const map = { date: fmtDate(d, opts.dateFormat), time, datetime: fmtDate(d, opts.dateFormat) + ' ' + time, day: d.toLocaleDateString('en-GB', { weekday: 'long' }), clipboard: String(opts.clipboard == null ? '' : opts.clipboard) };
    let out = String(text).replace(/\{(date|time|datetime|day|clipboard)\}/g, (_m, k) => map[k]);
    const i = out.indexOf('{cursor}');
    let back = 0;
    if (i >= 0) { out = out.slice(0, i) + out.slice(i + 8).replace(/\{cursor\}/g, ''); back = Array.from(out.slice(i).replace(/\r?\n/g, '\n')).length; }
    return { text: out, back };
  };
  T.typeable = (text) => text.length <= 300 && !/[\r\n]/.test(text);   // short single lines are typed; the rest is pasted

  /* =====================================================================================================
   * 3. Calculator (recursive descent, no eval)
   * ===================================================================================================== */
  const FUNCS = {
    sqrt: [1, Math.sqrt], cbrt: [1, Math.cbrt], abs: [1, Math.abs], ln: [1, Math.log], log: [1, Math.log10], log10: [1, Math.log10], log2: [1, Math.log2], exp: [1, Math.exp],
    round: [1, Math.round], floor: [1, Math.floor], ceil: [1, Math.ceil], sign: [1, Math.sign],
    min: [-1, Math.min], max: [-1, Math.max], pow: [2, Math.pow], mod: [2, (a, b) => a % b]
  };
  const TRIG = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan };
  const CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
  const CalcError = (m) => Object.assign(new Error(m), { calc: true });

  function tokenize(src) {
    const toks = []; let i = 0; const fn = [];   // fn: for each open bracket, was it a function call? (decides whether "1,000" is a number or two arguments)
    src = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−|–/g, '-').replace(/\*\*/g, '^').replace(/π/g, 'pi').replace(/√\s*(\d+(?:\.\d+)?|\.\d+)/g, 'sqrt($1)').replace(/√/g, 'sqrt');
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      let m;
      if ((m = /^\d{1,3}(?:,\d{2,3})+(?:\.\d+)?(?![\d,])/.exec(src.slice(i))) && !fn.includes(true)) { toks.push({ t: 'num', v: parseFloat(m[0].replace(/,/g, '')) }); i += m[0].length; continue; }
      if ((m = /^(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(src.slice(i)))) {
        let txt = m[0];
        if (/e/i.test(txt) && /^[a-z]/i.test(src.slice(i + txt.length))) txt = txt.replace(/e.*$/i, '');   // "2e" followed by a name is not an exponent
        if (!txt) throw CalcError('Unexpected "' + c + '"');
        toks.push({ t: 'num', v: parseFloat(txt) }); i += txt.length; continue;
      }
      if ((m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i)))) { toks.push({ t: 'id', v: m[0].toLowerCase() }); i += m[0].length; continue; }
      if ('+-*/^%!(),'.includes(c)) {
        if (c === '(') fn.push(toks.length > 0 && toks[toks.length - 1].t === 'id' && !['of', 'mod', 'ans'].includes(toks[toks.length - 1].v));
        if (c === ')') fn.pop();
        toks.push({ t: c }); i++; continue;
      }
      throw CalcError('Unexpected "' + c + '"');
    }
    return toks;
  }

  /** calc('20% of 150') -> { ok:true, value:30, text:'30' }.  opts: { ans, angle:'deg'|'rad' } */
  T.calc = function (expr, opts) {
    opts = opts || {};
    const src = String(expr == null ? '' : expr).trim();
    if (!src) return { ok: false, error: '' };
    if (src.length > 300) return { ok: false, error: 'Too long' };
    try {
      const toks = tokenize(src); let p = 0, depth = 0;
      const peek = () => toks[p], next = () => toks[p++];
      const isOp = (t, c) => t && t.t === c;
      const isWord = (t, w) => t && t.t === 'id' && t.v === w;
      const deg = opts.angle !== 'rad';
      function expect(c) { if (!isOp(peek(), c)) throw CalcError('Expected "' + c + '"'); p++; }
      function parseExpr() {
        if (++depth > 60) throw CalcError('Too deeply nested');
        let r = parseTerm();
        while (isOp(peek(), '+') || isOp(peek(), '-')) {
          const op = next().t, rt = parseTerm();
          const rhs = rt.pct ? r.v * rt.v : rt.v;   // 200 + 10% = 220
          r = { v: op === '+' ? r.v + rhs : r.v - rhs };
        }
        depth--; return r;
      }
      function parseTerm() {
        let r = parseUnary();
        for (;;) {
          const t = peek();
          if (isOp(t, '*') || isOp(t, '/') || isWord(t, 'of') || isWord(t, 'x') || isWord(t, 'mod')) {
            next();
            const b = parseUnary();
            if (isOp(t, '/')) { if (b.v === 0) throw CalcError('Cannot divide by zero'); r = { v: r.v / b.v }; }
            else if (isWord(t, 'mod')) { if (b.v === 0) throw CalcError('Cannot divide by zero'); r = { v: r.v % b.v }; }
            else r = { v: r.v * b.v };
          } else if (t && (t.t === '(' || (t.t === 'id' && !['of', 'x', 'mod'].includes(t.v)))) {   // 2(3+4), 2pi; never "1 000" (that would silently be 0)
            const b = parseUnary(); r = { v: r.v * b.v };
          } else break;
        }
        return r;
      }
      function parseUnary() {
        if (isOp(peek(), '-')) { next(); return { v: -parseUnary().v }; }
        if (isOp(peek(), '+')) { next(); return parseUnary(); }
        return parsePower();
      }
      function parsePower() {
        const base = parsePostfix();
        if (isOp(peek(), '^')) { next(); const e = parseUnary(); return { v: Math.pow(base.v, e.v) }; }   // right-associative, -2^2 = -4
        return base;
      }
      function parsePostfix() {
        let r = parsePrimary();
        for (;;) {
          if (isOp(peek(), '!')) { next(); r = { v: factorial(r.v) }; }
          else if (isOp(peek(), '%')) { next(); r = { v: r.v / 100, pct: !r.pct }; }
          else break;
        }
        return r;
      }
      function factorial(n) {
        if (n < 0 || n !== Math.floor(n)) throw CalcError('Factorial needs a whole number ≥ 0');
        if (n > 170) throw CalcError('Result too large');
        let f = 1; for (let i = 2; i <= n; i++) f *= i; return f;
      }
      function parsePrimary() {
        const t = next();
        if (!t) throw CalcError('Incomplete expression');
        if (t.t === 'num') return { v: t.v };
        if (t.t === '(') { const r = parseExpr(); expect(')'); return { v: r.v }; }
        if (t.t === 'id') {
          if (t.v in CONSTS) return { v: CONSTS[t.v] };
          if (t.v === 'ans') { if (opts.ans == null || !isFinite(opts.ans)) throw CalcError('No previous answer'); return { v: opts.ans }; }
          if (isOp(peek(), '(') || t.v in FUNCS || t.v in TRIG) {
            if (!(t.v in FUNCS) && !(t.v in TRIG)) throw CalcError('Unknown function "' + t.v + '"');
            expect('(');
            const args = [];
            if (!isOp(peek(), ')')) { args.push(parseExpr().v); while (isOp(peek(), ',')) { next(); args.push(parseExpr().v); } }
            expect(')');
            if (t.v in TRIG) {
              if (args.length !== 1) throw CalcError(t.v + ' takes one value');
              const inv = t.v[0] === 'a';
              return { v: inv ? (deg ? TRIG[t.v](args[0]) * 180 / Math.PI : TRIG[t.v](args[0])) : TRIG[t.v](deg ? args[0] * Math.PI / 180 : args[0]) };
            }
            const [n, f] = FUNCS[t.v];
            if (n >= 0 && args.length !== n) throw CalcError(t.v + ' takes ' + n + ' value' + (n > 1 ? 's' : ''));
            if (n < 0 && !args.length) throw CalcError(t.v + ' needs at least one value');
            return { v: f(...args) };
          }
          throw CalcError('Unknown name "' + t.v + '"');
        }
        throw CalcError('Unexpected "' + t.t + '"');
      }
      const res = parseExpr();
      if (p < toks.length) throw CalcError('Unexpected "' + (toks[p].t === 'num' ? toks[p].v : toks[p].v || toks[p].t) + '"');
      if (Number.isNaN(res.v)) throw CalcError('Not a number');
      if (!Number.isFinite(res.v)) throw CalcError('Result too large');
      return { ok: true, value: res.v, text: T.formatNumber(res.v) };
    } catch (e) {
      if (e && e.calc) return { ok: false, error: e.message };
      return { ok: false, error: 'Cannot calculate that' };
    }
  };

  /** 12 significant digits (hides 0.1+0.2 = 0.30000000000000004), exponent form for very large / small values. */
  T.formatNumber = function (v) {
    if (!Number.isFinite(v)) return String(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e15 || a < 1e-7) return v.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
    return String(parseFloat(v.toPrecision(12)));
  };
  /** Digit grouping for display (123456.7 -> 123,456.7). */
  T.groupNumber = function (text, locale) {
    if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
    const [i, f] = text.split('.');
    let out;
    try { out = Number(i).toLocaleString(locale || undefined, { maximumFractionDigits: 0, useGrouping: true }); if (/^-?\d/.test(i) && i.replace('-', '').length > 15) out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ','); } catch { out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    if (i === '-0') out = '-0';
    return f ? out + '.' + f : out;
  };

  /* =====================================================================================================
   * 4. Unit converter (length, weight, temperature) + currency
   * ===================================================================================================== */
  T.UNITS = {
    length: { name: 'Length', base: 'm', units: { mm: ['Millimetre', 0.001], cm: ['Centimetre', 0.01], m: ['Metre', 1], km: ['Kilometre', 1000], in: ['Inch', 0.0254], ft: ['Foot', 0.3048], yd: ['Yard', 0.9144], mi: ['Mile', 1609.344], nmi: ['Nautical mile', 1852] } },
    weight: { name: 'Weight', base: 'kg', units: { mg: ['Milligram', 1e-6], g: ['Gram', 0.001], kg: ['Kilogram', 1], t: ['Tonne', 1000], quintal: ['Quintal', 100], tola: ['Tola', 0.0116638038], oz: ['Ounce', 0.028349523125], lb: ['Pound', 0.45359237], st: ['Stone', 6.35029318] } },
    temperature: { name: 'Temperature', units: { c: ['Celsius', 0], f: ['Fahrenheit', 0], k: ['Kelvin', 0] } }
  };
  const ALIASES = {
    mm: ['millimeter', 'millimeters', 'millimetre', 'millimetres'], cm: ['centimeter', 'centimeters', 'centimetre', 'centimetres'], m: ['meter', 'meters', 'metre', 'metres', 'mtr'],
    km: ['kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms', 'kilo'], in: ['inch', 'inches', '"'], ft: ['foot', 'feet', 'feets', "'"], yd: ['yard', 'yards', 'yds'], mi: ['mile', 'miles'], nmi: ['nauticalmile', 'nauticalmiles'],
    mg: ['milligram', 'milligrams'], g: ['gram', 'grams', 'gm', 'gms'], kg: ['kilogram', 'kilograms', 'kgs', 'kilos'], t: ['tonne', 'tonnes', 'ton', 'tons', 'mt'], quintal: ['quintals'], tola: ['tolas'],
    oz: ['ounce', 'ounces'], lb: ['lbs', 'pound', 'pounds'], st: ['stone', 'stones'],
    c: ['°c', 'celsius', 'degc', 'centigrade', '℃'], f: ['°f', 'fahrenheit', 'degf', '℉'], k: ['kelvin', 'kelvins']
  };
  const CUR_ALIASES = { usd: ['$', 'dollar', 'dollars', 'us$'], inr: ['₹', 'rupee', 'rupees', 'rs', 'rs.'], eur: ['€', 'euro', 'euros'], gbp: ['£', 'pound', 'pounds', 'sterling', 'quid'], jpy: ['¥', 'yen'], aud: ['a$'], cad: ['c$'], cny: ['yuan', 'rmb'], aed: ['dirham', 'dirhams'], sgd: ['s$'] };
  T.CURRENCY_COMMON = ['USD', 'INR', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED', 'CNY', 'CHF', 'SAR', 'LKR'];
  const NAME_IDX = {};
  Object.keys(T.UNITS).forEach((cat) => Object.keys(T.UNITS[cat].units).forEach((id) => {
    (NAME_IDX[id] = NAME_IDX[id] || []).push({ cat, id });
    (ALIASES[id] || []).forEach((a) => (NAME_IDX[a] = NAME_IDX[a] || []).push({ cat, id }));
    const nm = T.UNITS[cat].units[id][0].toLowerCase().replace(/\s/g, ''); (NAME_IDX[nm] = NAME_IDX[nm] || []).push({ cat, id });
    (NAME_IDX[nm + 's'] = NAME_IDX[nm + 's'] || []).push({ cat, id });
  }));
  const curCode = (tok) => { const t = tok.toLowerCase(); if (/^[a-z]{3}$/.test(t)) return t.toUpperCase(); for (const k of Object.keys(CUR_ALIASES)) if (CUR_ALIASES[k].includes(t)) return k.toUpperCase(); return null; };

  /** Candidate meanings of a unit word: [{cat,id}] (currencies use cat 'currency', id = ISO code). */
  T.findUnit = function (tok, rates) {
    const t = String(tok || '').toLowerCase().trim(); if (!t) return [];
    const out = (NAME_IDX[t] || []).slice();
    const c = curCode(t);
    if (c && (!rates || !rates.rates || c in rates.rates || c === (rates.base || 'USD'))) out.push({ cat: 'currency', id: c });
    return out;
  };

  T.convert = function (cat, from, to, value, rates) {
    value = Number(value);
    if (!Number.isFinite(value)) return NaN;
    if (cat === 'temperature') {
      const k = from === 'c' ? value + 273.15 : from === 'f' ? (value - 32) * 5 / 9 + 273.15 : value;
      return to === 'c' ? k - 273.15 : to === 'f' ? (k - 273.15) * 9 / 5 + 32 : k;
    }
    if (cat === 'currency') {
      if (!rates || !rates.rates) return NaN;
      const r = Object.assign({ [rates.base || 'USD']: 1 }, rates.rates);
      if (!(from in r) || !(to in r) || !r[from]) return NaN;
      return value / r[from] * r[to];
    }
    const u = T.UNITS[cat]; if (!u || !u.units[from] || !u.units[to]) return NaN;
    return value * u.units[from][1] / u.units[to][1];
  };
  T.formatConv = function (v) {
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e12 || a < 1e-6) return v.toExponential(4).replace(/\.?0+e/, 'e').replace('e+', 'e');
    const s = String(parseFloat(v.toPrecision(7)));
    return a >= 1000 ? T.groupNumber(s) : s;
  };
  /** "5 km to mi", "100 usd in inr", "72 f to c" -> { ok, cat, from, to, value, result } */
  T.parseConversion = function (text, rates) {
    const m = /^\s*([-+]?(?:\d[\d,]*\.?\d*|\.\d+))\s*([^\s\d][^\s]*?)\s+(?:to|in|into|as|=|->|→)\s+([^\s\d][^\s]*?)\s*$/i.exec(String(text || ''));
    if (!m) return { ok: false };
    const value = parseFloat(m[1].replace(/,/g, '')), A = T.findUnit(m[2], rates), B = T.findUnit(m[3], rates);
    for (const a of A) for (const b of B) {
      if (a.cat === b.cat) {
        const result = T.convert(a.cat, a.id, b.id, value, rates);
        if (Number.isFinite(result)) return { ok: true, cat: a.cat, from: a.id, to: b.id, value, result };
      }
    }
    return { ok: false };
  };

  /* =====================================================================================================
   * 5. Batch file renamer
   * ===================================================================================================== */
  const BAD_CHARS = /[<>:"\/\\|?*\u0000-\u001f]/;
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const splitPath = (p) => { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return { dir: p.slice(0, i), name: p.slice(i + 1) }; };
  const splitExt = (n) => { const d = n.lastIndexOf('.'); return d <= 0 ? { base: n, ext: '' } : { base: n.slice(0, d), ext: n.slice(d) }; };
  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s_\-.(\[])([a-zа-я\u00c0-\u024f])/g, (_m, a, b) => a + b.toUpperCase());
  const fmtStamp = (ms, f) => {
    const d = new Date(ms || 0);
    return String(f || 'YYYY-MM-DD').replace(/YYYY|MM|DD|HH|mm|ss/g, (k) => ({ YYYY: d.getFullYear(), MM: pad2(d.getMonth() + 1), DD: pad2(d.getDate()), HH: pad2(d.getHours()), mm: pad2(d.getMinutes()), ss: pad2(d.getSeconds()) }[k]));
  };
  T.RENAME_DEFAULTS = { base: 'keep', custom: '', find: '', replace: '', regex: false, matchCase: false, spaces: 'keep', caseMode: 'none', prefix: '', suffix: '',
    date: 'none', dateFormat: 'YYYY-MM-DD', num: false, numStart: 1, numStep: 1, numPad: 3, numPos: 'suffix', numSep: ' ' };

  /** Work out new names. The extension is never changed (a document can never become a program). `files`: [{path, name?, mtime?}].
   *  `existing`: optional Set of lower-cased full paths already on disk (to catch clashes with files outside the batch). */
  T.planRename = function (files, rules, existing) {
    const r = { ...T.RENAME_DEFAULTS, ...(rules || {}) };
    let re = null, ruleError = '';
    if (r.find) {
      try { re = r.regex ? new RegExp(r.find, r.matchCase ? 'g' : 'gi') : new RegExp(r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), r.matchCase ? 'g' : 'gi'); }
      catch { ruleError = 'The find pattern is not a valid regular expression'; }
    }
    const items = (Array.isArray(files) ? files : []).slice(0, 500).map((f, i) => {
      const sp = splitPath(String(f.path || '')), oldName = f.name || sp.name, { base, ext } = splitExt(oldName);
      const item = { path: String(f.path || ''), dir: sp.dir, oldName, newName: oldName, status: 'same', reason: '' };
      if (ruleError) { item.status = 'invalid'; item.reason = ruleError; return item; }
      let b = r.base === 'custom' ? String(r.custom) : base;
      if (re) { try { b = b.replace(re, String(r.replace).replace(/\$(?![0-9&$`'])/g, '$$$$')); } catch { item.status = 'invalid'; item.reason = 'Replace failed'; return item; } }
      if (r.spaces === 'underscore') b = b.replace(/\s+/g, '_'); else if (r.spaces === 'dash') b = b.replace(/\s+/g, '-'); else if (r.spaces === 'remove') b = b.replace(/\s+/g, '');
      if (r.caseMode === 'lower') b = b.toLowerCase(); else if (r.caseMode === 'upper') b = b.toUpperCase(); else if (r.caseMode === 'title') b = titleCase(b);
      else if (r.caseMode === 'sentence') b = b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
      b = b.replace(/ {2,}/g, ' ').trim();
      if (r.date === 'prefix') b = fmtStamp(f.mtime, r.dateFormat) + (b ? ' ' + b : ''); else if (r.date === 'suffix') b = (b ? b + ' ' : '') + fmtStamp(f.mtime, r.dateFormat);
      b = String(r.prefix) + b + String(r.suffix);
      if (r.num) {
        const n = String(Math.max(0, Math.round(Number(r.numStart) || 0) + i * Math.round(Number(r.numStep) || 1))).padStart(Math.max(0, Math.min(8, Math.round(Number(r.numPad)) || 0)), '0');
        const sep = String(r.numSep == null ? ' ' : r.numSep).slice(0, 3);
        b = r.numPos === 'prefix' ? n + (b ? sep + b : '') : (b ? b + sep : '') + n;
      }
      b = b.replace(/[. ]+$/, '');
      item.newName = b + ext;
      if (!b) { item.status = 'invalid'; item.reason = 'The name would be empty'; }
      else if (BAD_CHARS.test(b)) { item.status = 'invalid'; item.reason = 'Names cannot contain < > : " / \\ | ? *'; }
      else if (RESERVED.test(b.split('.')[0])) { item.status = 'invalid'; item.reason = '“' + b + '” is a reserved Windows name'; }
      else if (item.newName.length > 200) { item.status = 'invalid'; item.reason = 'Name is too long'; }
      else item.status = item.newName === oldName ? 'same' : 'ok';
      return item;
    });
    const sep = (it) => (it.dir.includes('\\') || !it.dir.includes('/') ? '\\' : '/');
    const key = (dir, name) => (dir + '\\' + name).toLowerCase().replace(/\//g, '\\');
    const sources = new Set(items.map((it) => key(it.dir, it.oldName)));
    const seen = new Map();
    for (const it of items) {
      if (it.status !== 'ok') { if (it.status === 'same') seen.set(key(it.dir, it.newName), it); continue; }
      const k = key(it.dir, it.newName);
      if (seen.has(k)) { it.status = 'dup'; it.reason = 'Another file gets the same name'; continue; }
      seen.set(k, it);
      if (existing && existing.has(k) && !sources.has(k)) { it.status = 'exists'; it.reason = 'A file with that name already exists'; }
    }
    // a rename that targets the name of a file in the batch that is staying as it is
    for (const it of items) if (it.status === 'ok') { const o = items.find((x) => x !== it && x.status === 'same' && key(x.dir, x.newName) === key(it.dir, it.newName)); if (o) { it.status = 'dup'; it.reason = 'Another file already has that name'; } }
    const ok = items.filter((x) => x.status === 'ok').length, bad = items.filter((x) => x.status === 'invalid' || x.status === 'dup' || x.status === 'exists').length;
    return { items, ok, bad, same: items.length - ok - bad, canApply: ok > 0 && bad === 0, sep: items[0] ? sep(items[0]) : '\\' };
  };

  /* =====================================================================================================
   * 6. QR payloads
   * ===================================================================================================== */
  const wEsc = (s) => String(s == null ? '' : s).replace(/([\\;,:"])/g, '\\$1');
  T.wifiPayload = (o) => 'WIFI:T:' + (o.auth === 'nopass' ? 'nopass' : o.auth === 'WEP' ? 'WEP' : 'WPA') + ';S:' + wEsc(o.ssid) + ';' + (o.auth === 'nopass' ? '' : 'P:' + wEsc(o.pass) + ';') + (o.hidden ? 'H:true;' : '') + ';';
  const vEsc = (s) => String(s == null ? '' : s).replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
  T.vcardPayload = (o) => ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + vEsc(o.name), o.phone ? 'TEL:' + vEsc(o.phone) : '', o.email ? 'EMAIL:' + vEsc(o.email) : '', o.org ? 'ORG:' + vEsc(o.org) : '', 'END:VCARD'].filter(Boolean).join('\n');
  T.qrPayload = function (mode, o) {
    o = o || {};
    if (mode === 'wifi') return o.ssid ? T.wifiPayload(o) : '';
    if (mode === 'contact') return o.name ? T.vcardPayload(o) : '';
    if (mode === 'phone') return o.text ? 'tel:' + String(o.text).replace(/[^\d+]/g, '') : '';
    if (mode === 'email') return o.text ? 'mailto:' + String(o.text).trim() : '';
    return String(o.text == null ? '' : o.text);
  };

  /* =====================================================================================================
   * 7. Window layouts (geometry; Windows applies the rectangles)
   * ===================================================================================================== */
  T.ZONES = ['left', 'right', 'top', 'bottom', 'tl', 'tr', 'bl', 'br', 'third1', 'third2', 'third3', 'twoL', 'twoR', 'center', 'max'];
  /** work = the monitor's work area {x,y,w,h}. Returns the target rectangle, or { max:true }. */
  T.zoneRect = function (zone, work) {
    const { x, y, w, h } = work, hw = Math.floor(w / 2), hh = Math.floor(h / 2), tw = Math.floor(w / 3);
    switch (zone) {
      case 'left': return { x, y, w: hw, h };
      case 'right': return { x: x + hw, y, w: w - hw, h };
      case 'top': return { x, y, w, h: hh };
      case 'bottom': return { x, y: y + hh, w, h: h - hh };
      case 'tl': return { x, y, w: hw, h: hh };
      case 'tr': return { x: x + hw, y, w: w - hw, h: hh };
      case 'bl': return { x, y: y + hh, w: hw, h: h - hh };
      case 'br': return { x: x + hw, y: y + hh, w: w - hw, h: h - hh };
      case 'third1': return { x, y, w: tw, h };
      case 'third2': return { x: x + tw, y, w: tw, h };
      case 'third3': return { x: x + 2 * tw, y, w: w - 2 * tw, h };
      case 'twoL': return { x, y, w: 2 * tw, h };
      case 'twoR': return { x: x + tw, y, w: w - tw, h };
      case 'center': { const cw = Math.round(w * 0.7), ch = Math.round(h * 0.8); return { x: x + Math.round((w - cw) / 2), y: y + Math.round((h - ch) / 2), w: cw, h: ch }; }
      case 'max': return { max: true };
      default: return null;
    }
  };
  T.LAYOUTS = [
    { id: 'side', name: 'Side by side', zones: ['left', 'right'] },
    { id: 'stack', name: 'Stacked', zones: ['top', 'bottom'] },
    { id: 'main', name: 'Main + side', zones: ['twoL', 'third3'] },
    { id: 'thirds', name: 'Three columns', zones: ['third1', 'third2', 'third3'] },
    { id: 'grid', name: '2 × 2 grid', zones: ['tl', 'tr', 'bl', 'br'] },
    { id: 'focus', name: 'Focus (maximise top window)', zones: ['max'] }
  ];
  /** Rectangle as fractions of the work area, so a saved layout still fits after a resolution change. */
  T.relRect = (r, work) => ({ x: +((r.x - work.x) / work.w).toFixed(4), y: +((r.y - work.y) / work.h).toFixed(4), w: +(r.w / work.w).toFixed(4), h: +(r.h / work.h).toFixed(4) });
  T.absRect = (rel, work) => ({ x: Math.round(work.x + rel.x * work.w), y: Math.round(work.y + rel.y * work.h), w: Math.round(rel.w * work.w), h: Math.round(rel.h * work.h) });

  /* =====================================================================================================
   * 8. Small sanitisers for stored lists
   * ===================================================================================================== */
  const DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
  T.sanitizeFolder = function (f) {
    if (!f || typeof f !== 'object') return null;
    const p = str(f.path, 500).trim();
    if (!DRIVE_PATH.test(p) || p.includes('\0') || p.startsWith('\\\\') || p.indexOf(':', 2) !== -1) return null;
    const name = str(f.name, 40).trim() || p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
    return { id: str(f.id, 40) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), name, path: p };
  };
  T.sanitizeFolders = (arr) => { const seen = new Set(); return (Array.isArray(arr) ? arr : []).map(T.sanitizeFolder).filter((f) => f && !seen.has(f.path.toLowerCase()) && seen.add(f.path.toLowerCase())).slice(0, 60); };
  T.sanitizeFavs = (arr) => { const seen = new Set(); return (Array.isArray(arr) ? arr : []).map((a) => str(a && a.name != null ? a.name : a, 120).trim()).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, 48).map((name) => ({ name })); };
  T.sanitizeLayout = function (l) {
    if (!l || typeof l !== 'object' || !Array.isArray(l.items)) return null;
    const num = (v) => (Number.isFinite(+v) ? Math.max(-1, Math.min(3, +v)) : 0);
    const items = l.items.slice(0, 24).map((i) => i && typeof i === 'object' && str(i.proc, 80).trim() ? { proc: str(i.proc, 80).trim(), mon: Math.max(0, Math.min(15, Math.round(+i.mon) || 0)), max: !!i.max, x: num(i.x), y: num(i.y), w: num(i.w), h: num(i.h) } : null).filter(Boolean);
    const name = str(l.name, 40).trim();
    return items.length && name ? { id: str(l.id, 40) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), name, items } : null;
  };
  T.sanitizeLayouts = (arr) => (Array.isArray(arr) ? arr : []).map(T.sanitizeLayout).filter(Boolean).slice(0, 20);
  T.sanitizeCalcHistory = (arr) => (Array.isArray(arr) ? arr : []).map((h) => h && typeof h === 'object' ? { e: str(h.e, 300), r: str(h.r, 40) } : null).filter((h) => h && h.e && h.r).slice(0, 30);

  /* =====================================================================================================
   * 9. Task manager: group processes into apps, keep Windows itself out of reach
   * ===================================================================================================== */
  // Ending any of these would log you out, blank the screen or take Windows down, so the island never offers them.
  T.PROC_PROTECTED = new Set(['system', 'idle', 'registry', 'memory compression', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso', 'lsm', 'svchost',
    'dwm', 'fontdrvhost', 'explorer', 'sihost', 'taskhostw', 'ctfmon', 'runtimebroker', 'searchhost', 'searchindexer', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost',
    'applicationframehost', 'systemsettingsbroker', 'securityhealthservice', 'securityhealthsystray', 'msmpeng', 'nissrv', 'wudfhost', 'spoolsv', 'audiodg', 'conhost', 'dllhost', 'wmiprvse',
    'lockapp', 'userinit', 'logonui', 'dashost', 'taskmgr', 'unsecapp', 'wlanext', 'smartscreen', 'consent', 'backgroundtaskhost']);
  T.procIsProtected = (name) => T.PROC_PROTECTED.has(String(name || '').toLowerCase().replace(/\.exe$/, ''));
  T.fmtMem = (b) => { b = Number(b) || 0; return b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? Math.round(b / 1048576) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; };
  /** rows: [{pid, name, title, mem, path?, desc?}] from the helper (path / desc only on the first row of each program).
   *  A program that has a window anywhere in its group is an "app" (all its processes end together, like Task Manager's "End task");
   *  the rest are background processes. `self` = pids that belong to the island and its helpers: never listed, never ended. */
  T.groupProcs = function (rows, self) {
    const mine = self instanceof Set ? self : new Set(self || []), by = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || typeof r !== 'object') continue;
      const pid = Math.round(Number(r.pid)), name = str(r.name, 80).trim();
      if (!Number.isFinite(pid) || pid <= 4 || !name || mine.has(pid)) continue;
      const key = name.toLowerCase();
      let g = by.get(key);
      if (!g) { g = { id: key, key: name, name: '', title: '', pids: [], n: 0, mem: 0, path: '', desc: '', win: false }; by.set(key, g); }
      g.pids.push(pid); g.n++; g.mem += Math.max(0, Number(r.mem) || 0);
      if (!g.path && r.path) g.path = str(r.path, 500);
      if (!g.desc && r.desc) g.desc = str(r.desc, 80).trim();
      const t = str(r.title, 120).trim(); if (t && !g.win) { g.win = true; g.title = t; }
    }
    const out = { apps: [], bg: [] };
    for (const g of by.values()) {
      const nice = g.desc && g.desc.length < 50 && !/^\s*$/.test(g.desc) ? g.desc : g.key.charAt(0).toUpperCase() + g.key.slice(1);
      const item = { id: g.id, name: nice, title: g.title, pids: g.pids.sort((a, b) => a - b), n: g.n, mem: g.mem, path: g.path, protected: T.procIsProtected(g.key), proc: g.key };
      (g.win ? out.apps : out.bg).push(item);
    }
    const byMem = (a, b) => b.mem - a.mem || a.name.localeCompare(b.name);
    out.apps.sort(byMem); out.bg.sort(byMem);
    return out;
  };
  /** The ids the page asked to end -> [{pid, name}] to hand to the helper, using only what the last listing showed. Protected programs are dropped. */
  T.procTargets = function (ids, known) {
    const seen = new Set(), items = [], skipped = [];
    for (const id of Array.isArray(ids) ? ids.slice(0, 200) : []) {
      const g = known instanceof Map ? known.get(String(id)) : null;
      if (!g || seen.has(g.id)) continue; seen.add(g.id);
      if (g.protected) { skipped.push(g.name); continue; }
      for (const pid of g.pids) items.push({ pid, name: g.proc });
    }
    return { items, skipped };
  };

  T.fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');
  return T;
});
