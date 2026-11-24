/* Main-process glue for the smart assistant: connects the pure logic (assistant.js, intents.js) to the user's data,
 * the selected AI model, the clipboard, the screen, Windows Search and the installed apps.
 *
 * Privacy rules this file enforces:
 *   - Nothing is sent to an AI unless the user asked for language work (summarise, rewrite, meeting notes, screen help, chat).
 *     What is sent is only the text/image they pointed at. Tasks, calendar and memory are added to a chat prompt only when the
 *     local model is selected, or the user switched on "Share my tasks, calendar and memory with Claude / ChatGPT".
 *   - Memory is written only after the user says yes (a "remember ..." command, or the Remember button on a proposal).
 *   - Every answer says which engine produced it (Claude, ChatGPT, local model, or offline).
 *   - Actions that change data come back as one-time tokens held here; the window can only ask to run a token, never to run
 *     an arbitrary operation, and every operation is re-validated against the real data.
 *   - Selection capture never sends Ctrl+C to a terminal (it would interrupt the running program).
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const P = require('./planner'), A = require('./assistant'), I = require('./intents'), W = require('./wellness');

const DAY = 864e5, MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const TERMINALS = /^(windowsterminal|wt|cmd|powershell|powershell_ise|pwsh|conhost|bash|wsl|wslhost|mintty|alacritty|wezterm|kitty|putty)$/i;
const DOC_EXT = /\.(txt|md|markdown|csv|tsv|json|log|html?|xml|docx)$/i;

/* ---- reading documents (no extra dependencies) ---- */
function docxText(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--; if (e < 0) return '';
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nl);
    if (name === 'word/document.xml') {
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28), raw = buf.subarray(start, start + csize);
      const xml = (method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: 16 * 1024 * 1024 }) : raw).toString('utf8');
      return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }
    p += 46 + nl + el + cl;
  }
  return '';
}
function readDoc(file) {   // -> text or '' (unsupported / unreadable)
  try {
    const st = fs.statSync(file); if (!st.isFile() || st.size > 25 * 1024 * 1024) return '';
    const buf = fs.readFileSync(file);
    if (/\.docx$/i.test(file)) return docxText(buf);
    if (!DOC_EXT.test(file)) return '';
    let t = buf.subarray(0, 600000).toString('utf8');
    if (/\.html?$/i.test(file)) t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    return t;
  } catch { return ''; }
}

module.exports = function createAssist(D) {
  const db = () => D.getDb(), S = () => db().settings, nowMs = () => (D.now ? D.now() : Date.now());
  const provider = () => D.provider();
  const engineName = () => ({ claude: 'Claude', openai: 'ChatGPT' }[provider()] || 'local model');
  const cloud = () => provider() !== 'ollama';
  const ctxAllowed = () => !cloud() || S().assistCloudContext === true;   // may tasks / calendar / memory go into a chat prompt?
  const clock24 = () => S().clock24 !== false;
  const data = () => { const d = db(); return { tasks: d.tasks, events: d.events, habits: d.habits, goals: d.goals, journal: d.journal, expenses: d.expenses, notes: d.notes, shopping: d.shopping || [], alarms: d.alarms || [], countdowns: d.countdowns || [], zones: d.zones || [], memory: d.memory || [], meetings: d.meetings || [], conversations: d.conversations || [], mail: D.mail ? D.mail() : [] }; };
  const memoryOn = () => S().assistMemory !== false;
  const locale = () => { try { return D.locale ? D.locale() : ''; } catch { return ''; } };
  const region = () => W.resolveRegion(S().holidayRegion, locale());
  const wxLine = () => { try { const w = D.weather && D.weather(); return w && w.ok ? 'It is ' + Math.round(w.current.temperature_2m) + w.unit + ' in ' + w.name + '.' : ''; } catch { return ''; } };

  /* ---- one-time tokens for anything that changes data ---- */
  const pend = new Map(); let seq = 0;
  function tok(ops, extra) {
    const t = nowMs(); for (const [k, v] of pend) if (v.exp < t) pend.delete(k);
    if (pend.size > 300) pend.delete(pend.keys().next().value);
    const id = 'k' + (++seq) + Math.random().toString(36).slice(2, 7); pend.set(id, { ops, exp: t + 15 * 60e3, ...extra }); return id;
  }

  /* ---- applying data operations (every field is re-validated here) ---- */
  const setTasks = (list) => D.setTasks(list);
  const findTask = (id) => db().tasks.find((t) => t.id === String(id));
  const okTime = (ms) => typeof ms === 'number' && isFinite(ms) && ms > nowMs() - 10 * 6e4 && ms < nowMs() + 400 * DAY;
  async function applyOps(ops) {
    const ui = [], notes = []; let changed = false, memoryItem = null;
    for (const o of Array.isArray(ops) ? ops.slice(0, 60) : []) {
      if (!o || typeof o !== 'object') continue;
      const n = nowMs();
      try {
        switch (o.op) {
          case 'addCapture': { const r = await D.captureAdd(String(o.text || '')); if (r && r.ok) notes.push(r.text); else if (r) notes.push(r.text); break; }
          case 'doneTask': { const t = findTask(o.id); if (t && !t.done) { setTasks(db().tasks.map((x) => (x.id === t.id ? { ...x, done: true, doneAt: n } : x))); changed = true; } break; }
          case 'deleteTask': if (findTask(o.id)) { setTasks(db().tasks.filter((x) => x.id !== String(o.id))); changed = true; } break;
          case 'clearDone': setTasks(db().tasks.filter((x) => !x.done)); changed = true; break;
          case 'retime': { const t = findTask(o.id); if (!t || !P.validYmd(o.date)) break; const due = o.due == null ? null : o.due; if (due !== null && !okTime(due)) break; setTasks(db().tasks.map((x) => (x.id === t.id ? { ...x, date: o.date, due, notified: false } : x))); changed = true; break; }
          case 'moveTasks': { if (!P.validYmd(o.date) || !Array.isArray(o.ids)) break; const ids = new Set(o.ids.map(String)), nd = P.parseYmd(o.date);
            setTasks(db().tasks.map((x) => { if (!ids.has(x.id) || x.done) return x; const od = x.due ? new Date(x.due) : null; return { ...x, date: o.date, due: od ? new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), od.getHours(), od.getMinutes()).getTime() : null, notified: false }; })); changed = true; break; }
          case 'addEvent': { const e = W.sanitizeEvent({ id: 'e' + n + Math.random().toString(36).slice(2, 5), date: o.date, time: o.time, title: clip(o.title, 80), kind: 'event', repeat: o.repeat }); if (!e) break;
            db().events = [...(db().events || []), W.armEvent(e, n)]; changed = true; break; }
          case 'addBirthday': { const e = W.sanitizeEvent({ id: 'e' + n + Math.random().toString(36).slice(2, 5), date: o.date, title: clip(o.title, 80), kind: 'birthday', born: +o.born || undefined }); if (!e) break;
            db().events = [...(db().events || []), W.armEvent(e, n)]; changed = true; break; }
          case 'shopAdd': { const r = W.addShopping(db().shopping || [], String(o.text || ''), n); db().shopping = r.list; changed = changed || r.added.length > 0 || r.revived.length > 0; break; }
          case 'shopDone': { const ids = new Set((Array.isArray(o.ids) ? o.ids : []).map(String)); db().shopping = (db().shopping || []).map((x) => (ids.has(x.id) ? { ...x, done: true } : x)); changed = true; break; }
          case 'shopRemove': db().shopping = (db().shopping || []).filter((x) => x.id !== String(o.id)); changed = true; break;
          case 'shopClear': db().shopping = o.doneOnly ? (db().shopping || []).filter((x) => !x.done) : []; changed = true; break;
          case 'alarmAdd': { const a = W.sanitizeAlarm({ id: 'a' + n + Math.random().toString(36).slice(2, 5), time: o.time, label: clip(o.label, 40), days: o.days, on: true }, n); if (!a || (db().alarms || []).length >= 30) break; db().alarms = [...(db().alarms || []), a]; changed = true; break; }
          case 'alarmOff': { const all = !!o.all || !o.id; db().alarms = (db().alarms || []).map((a) => (all || a.id === String(o.id) ? { ...a, on: false, next: 0 } : a)); changed = true; break; }
          case 'addCountdown': { const c = W.sanitizeCountdown({ id: 'c' + n + Math.random().toString(36).slice(2, 5), label: clip(o.label, 60), date: o.date, time: o.time }); if (c && (db().countdowns || []).length < 50) { db().countdowns = [...(db().countdowns || []), c]; changed = true; } break; }
          case 'addZone': { const z = W.sanitizeZone({ id: 'z' + n + Math.random().toString(36).slice(2, 5), tz: o.tz }); if (z && !(db().zones || []).some((x) => x.tz === z.tz) && (db().zones || []).length < 12) { db().zones = [...(db().zones || []), z]; changed = true; } break; }
          case 'setWell': { const p = W.sanitizeSettings(o.patch && typeof o.patch === 'object' ? o.patch : {}); if (Object.keys(p).length) { Object.assign(db().settings, p); changed = true; } break; }
          case 'pomo': if (D.pomo && ['start', 'pause', 'resume', 'stop', 'skip'].includes(o.action)) D.pomo(o.action); else if (o.action === 'status') ui.push({ op: 'go', slide: 'alarms', tab: 'pomo' }); break;
          case 'habitDone': { const day = P.ymd(new Date(n)); if (db().habits.some((h) => h.id === String(o.id))) { db().habits = db().habits.map((h) => (h.id === String(o.id) && !h.days.includes(day) ? P.toggleHabit(h, day) : h)); changed = true; } break; }
          case 'bumpGoal': { const d = +o.delta; if (!isFinite(d) || Math.abs(d) > 1e5) break; const day = P.ymd(new Date(n)); if (db().goals.some((g) => g.id === String(o.id))) { db().goals = db().goals.map((g) => (g.id === String(o.id) ? P.bumpGoal(g, day, d) : g)); changed = true; } break; }
          case 'journal': { const e = P.sanitizeEntry({ t: n, text: o.text, kind: 'entry' }); if (e) { db().journal = [e, ...db().journal].slice(0, 2000); changed = true; } break; }
          case 'remember': { if (!memoryOn()) { notes.push('Memory is off.'); break; } const r = A.addMemory(db().memory || [], o.item || {}, n); if (r.item) { db().memory = r.list; memoryItem = r.item; changed = true; } break; }
          case 'forget': { if (o.all) db().memory = []; else db().memory = (db().memory || []).filter((m) => m.id !== String(o.id)); changed = true; break; }
          case 'placeTask': { if (!okTime(o.start)) break; const day = P.ymd(new Date(o.start)), t = o.id ? findTask(o.id) : null;
            if (t) setTasks(db().tasks.map((x) => (x.id === t.id ? { ...x, date: day, due: o.start, notified: false } : x)));
            else if (clip(o.text, 200)) setTasks([{ ...P.makeTask({ text: clip(o.text, 200), date: day, due: o.start, cat: 'personal', pri: 'normal', repeat: 'none', cond: 'none' }, n) }, ...db().tasks]);
            changed = true; break; }
          case 'applyPlan': { const map = new Map(); (Array.isArray(o.placements) ? o.placements : []).slice(0, 100).forEach((p) => { if (p && okTime(p.start)) map.set(String(p.id), p.start); });
            if (map.size) { setTasks(db().tasks.map((x) => (map.has(x.id) && !x.done ? { ...x, date: P.ymd(new Date(map.get(x.id))), due: map.get(x.id), notified: false } : x))); changed = true; } break; }
          case 'openApp': { const q = clip(o.query, 60).toLowerCase(); if (!q) break; const idx = await D.appIndex(false), hit = idx.filter((a) => a.name.toLowerCase() === q)[0] || idx.filter((a) => a.name.toLowerCase().startsWith(q))[0] || idx.filter((a) => a.name.toLowerCase().includes(q))[0];
            if (hit && (await D.launchApp(hit.id))) notes.push('Opened ' + hit.name + '.'); else notes.push('I could not find an app called "' + clip(o.query, 40) + '".'); break; }
          case 'openFile': if (typeof o.path === 'string') { D.openPath(o.path); } break;
          default: ui.push(o);   // everything else is carried out by the island window itself
        }
      } catch (e) { notes.push('Something went wrong: ' + clip(e.message, 100)); }
    }
    if (changed) D.save();
    return { ui, notes, memoryItem };
  }

  /* ---- text sources: selection, clipboard, mail, files, meetings ---- */
  async function selectionText() {
    const fg = D.getFg ? D.getFg() : null, old = D.clipboard.readText();
    if (fg && fg.hwnd && !TERMINALS.test(fg.name || '')) {
      try {
        D.setCopyBusy(true); D.clipboard.writeText('');
        await D.ps('copysel ' + String(fg.hwnd).replace(/\D/g, ''));
        await new Promise((r) => setTimeout(r, 120));
        const got = D.clipboard.readText();
        if (old) D.clipboard.writeText(old); else D.clipboard.clear && D.clipboard.clear();   // the user's clipboard is put back
        if (got && got.trim()) return { text: got, label: 'selected text' };
      } catch {} finally { D.setCopyBusy(false); if (D.focusIsland) D.focusIsland(); }
    }
    const cb = old || D.clipboard.readText();
    return cb && cb.trim() ? { text: cb, label: 'clipboard (no selection found)' } : { error: 'Select some text first, then try again. You can also copy it (Ctrl+C) and I will use your clipboard.' };
  }
  async function getSource(src, inline) {
    if (src === 'text') return { text: inline, label: 'your text' };
    if (src === 'selection') return selectionText();
    if (src === 'clipboard') { const t = D.clipboard.readText(); return t && t.trim() ? { text: t, label: 'clipboard' } : { error: 'Your clipboard is empty. Copy some text first.' }; }
    if (src === 'mail') {
      const un = (D.mail ? D.mail() : []).filter((m) => m.unread).slice(0, 25); if (!un.length) return { error: 'You have no unread messages in the island right now. Connect Outlook, Gmail or WhatsApp in Settings > Messages.' };
      return { text: un.map((m) => `From ${m.from || 'unknown'} (${m.src}): ${m.subject || m.preview || ''}${m.subject && m.preview ? ' - ' + m.preview : ''}`).join('\n'), label: A.plural(un.length, 'unread message') };
    }
    if (src === 'meeting') { const m = (db().meetings || [])[0]; return m ? { text: m.transcript || m.summary, label: 'last meeting' } : { error: 'There are no saved meetings yet.' }; }
    if (src === 'journal') { const from = nowMs() - 7 * DAY, js = (db().journal || []).filter((j) => j.t >= from); return js.length ? { text: js.map((j) => new Date(j.t).toDateString() + ': ' + j.text).join('\n'), label: 'this week\'s journal' } : { error: 'Nothing in your journal for the past week.' }; }
    if (src === 'file') {
      if (!D.pickFile) return { error: 'Choosing files is not available here.' };
      const f = await D.pickFile(); if (!f) return { error: 'No file chosen.' };
      const t = readDoc(f); return t.trim() ? { text: t, label: path.basename(f) } : { error: /\.pdf$/i.test(f) ? 'PDF text is not built in. Copy the text from the PDF and say "summarise clipboard".' : 'I cannot read that file type. Try .txt, .md, .csv, .json, .html or .docx.' };
    }
    return { error: 'Unknown source.' };
  }

  /* ---- AI calls with an offline fallback ---- */
  const ask1 = (messages, opts) => D.chat(messages, opts);
  async function runAi(ai, rawText, extra) {
    const eng = engineName();
    if (ai.kind === 'summarize') {
      const s = await getSource(ai.source, ai.text); if (s.error) return { reply: s.error, error: true };
      const text = String(s.text).slice(0, 60000), r = await ask1(A.summarizeMessages(text, { label: s.label }), { maxTokens: 700, numCtx: 8192 });
      if (r.ok) return { reply: r.text, copy: r.text, engine: eng, source: s.label };
      return { reply: A.summaryText(A.extractiveSummary(text, 4)) || 'That text is too short to summarise.', copy: A.summaryText(A.extractiveSummary(text, 4)), engine: 'offline', source: s.label, note: 'No AI model answered, so this is a quick summary made on this PC. ' + r.text };
    }
    if (ai.kind === 'write') {
      let ctxText = '', label = '';
      if (ai.mode !== 'compose' || ai.source === 'selection') { const s = await getSource(ai.source === 'none' ? 'selection' : ai.source, ai.text); if (s.error && ai.mode !== 'compose') return { reply: s.error, error: true }; if (!s.error) { ctxText = s.text; label = s.label; } }
      const msgs = A.writeMessages({ mode: ai.mode, tone: ai.tone, lang: ai.lang, instruction: ai.instruction, text: ctxText, memory: memoryOn() && ctxAllowed() ? db().memory : [] });
      const r = await ask1(msgs, { maxTokens: 1200, numCtx: 8192 });
      if (r.ok) return { reply: r.text, copy: r.text, engine: eng, source: label || undefined, kindOut: 'write' };
      if (ai.mode === 'correct' && ctxText) { const fixed = A.basicCorrect(ctxText); return { reply: fixed, copy: fixed, engine: 'offline', source: label, kindOut: 'write', note: 'No AI model answered, so only spacing, capitals and common slips were fixed. ' + r.text }; }
      return { reply: r.text, error: true };
    }
    if (ai.kind === 'screen') return screenAssist(ai.question, extra);
    /* plain conversation */
    const hist = (Array.isArray(extra && extra.history) ? extra.history : []).slice(-8).map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: clip(m && m.content, 1500) })).filter((m) => m.content);
    let sys = 'You are the assistant inside a desktop Dynamic Island. Keep answers short and practical.';
    if (ctxAllowed()) {
      const d = data(), b = A.buildBriefing(d, { now: nowMs(), clock24: clock24(), currency: S().currency, region: region() });
      sys += ' Today is ' + new Date(nowMs()).toDateString() + '. The user\'s day: ' + b.text + (memoryOn() && d.memory.length ? ' ' + 'Things the user asked you to remember: ' + d.memory.slice(0, 25).map((m) => m.text).join('; ') + '.' : '') + ' Use this only when it is relevant.';
    }
    const msgs = [{ role: 'system', content: sys }, ...hist.filter((m, i, a) => !(i === a.length - 1 && m.role === 'user' && m.content === clip(rawText, 1500))), { role: 'user', content: clip(rawText, 4000) }];
    const r = await ask1(msgs, { maxTokens: 900 });
    return r.ok ? { reply: r.text, engine: eng, chat: true } : { reply: r.text, error: true };
  }
  async function screenAssist(question, extra) {
    if (!D.grabScreen) return { reply: 'Screen help is not available here.', error: true };
    let jpeg; try { jpeg = await D.grabScreen(); } catch (e) { return { reply: 'Could not read the screen: ' + clip(e.message, 100), error: true }; }
    const fg = D.getFg ? D.getFg() : null, r = await D.vision(A.screenMessages(question, { app: fg && fg.name, memory: memoryOn() && ctxAllowed() ? db().memory : [] }), jpeg);
    if (!r.ok) return { reply: r.text, error: true };
    const sc = A.parseScreen(r.text), acts = sc.actions.map((a) => {
      if (a.kind === 'task') return { label: a.label, kind: 'task', text: a.text, id: tok([{ op: 'addCapture', text: a.text }]) };
      if (a.kind === 'copy') return { label: a.label, kind: 'copy', text: a.text, id: tok([{ op: 'copy', text: a.text }]) };
      if (a.kind === 'note') return { label: a.label, kind: 'note', text: a.text, id: tok([{ op: 'journal', text: a.text }]) };
      return { label: a.label, kind: 'steps', text: a.text };
    });
    const steps = acts.filter((a) => a.kind === 'steps');
    return { reply: sc.summary + (steps.length ? '\n' + steps.map((a, i) => (i + 1) + '. ' + a.text).join('\n') : ''), screenActions: acts.filter((a) => a.kind !== 'steps'), engine: engineName(), source: 'your screen' };
  }

  /* ---- search: local data + Windows Search + installed apps ---- */
  async function runSearch(s) {
    const o = { now: nowMs(), clock24: clock24(), currency: S().currency }, loc = A.searchLocal(s.query, data(), o); let items = loc.items.slice();
    if (loc.answer && !loc.items.length && /spen|how much/i.test(s.query)) return { reply: loc.answer, items: [] };
    const fq = s.fq || A.fileQuery(s.query, nowMs());
    if ((s.files || items.length < 3) && (fq.term || fq.exts.length) && D.ps) {
      try {
        const terms = fq.term ? [fq.term] : fq.exts.slice(0, 3).map((e) => '.' + e); let files = [];
        for (const t of terms) { const r = JSON.parse((await D.ps('files ' + t)) || '[]'); if (Array.isArray(r)) files.push(...r.filter((x) => typeof x === 'string')); }
        files = [...new Set(files)];
        if (fq.exts.length) files = files.filter((f) => fq.exts.some((e) => f.toLowerCase().endsWith('.' + e)));
        if (fq.from !== null) files = files.filter((f) => { try { const t = fs.statSync(f).mtimeMs; return t >= fq.from && t < fq.to; } catch { return false; } });
        files.slice(0, 6).forEach((f) => items.push({ kind: 'file', title: path.basename(f), sub: path.dirname(f), id: tok([{ op: 'openFile', path: f }]), act: true }));
      } catch {}
    }
    if (s.apps || (items.length < 2 && fq.term)) {
      try { const idx = await D.appIndex(false), t = (fq.term || '').toLowerCase(); if (t) idx.filter((a) => a.name.toLowerCase().includes(t)).slice(0, 3).forEach((a) => items.push({ kind: 'app', title: a.name, sub: 'App', id: tok([{ op: 'openApp', query: a.name }]), act: true })); } catch {}
    }
    items = items.slice(0, 12);
    return { reply: loc.answer || (items.length ? 'Here is what I found.' : 'I could not find anything for "' + clip(s.query, 60) + '".'), items };
  }

  /* ---- decorating a plan for the window: operations become tokens ---- */
  function decorate(plan, out) {
    if (plan.confirm) out.confirm = { id: tok(plan.confirm.ops), yes: plan.confirm.yes, note: plan.confirm.note || '' };
    if (plan.slots) out.slots = plan.slots.map((s) => ({ day: s.day, text: s.text, min: s.min, id: tok(s.ops) }));
    if (plan.choices) out.choices = plan.choices.map((c) => ({ label: c.label, id: tok(c.ops, { reply: c.reply }) }));
    if (plan.proposal) out.proposal = { text: plan.proposal.text, kind: plan.proposal.kind, id: tok([{ op: 'remember', item: plan.proposal }], { reply: 'Remembered.' }) };
    if (plan.plan) out.plan = { placements: plan.plan.placements.map((p) => ({ text: p.text, day: p.day, when: p.text2, min: p.min })), unplaced: plan.plan.unplaced.map((u) => ({ text: u.text, reason: u.reason })) };
    if (plan.tasks) out.tasks = plan.tasks;
    if (plan.brief) out.brief = plan.brief;
  }

  /* ================================ public API ================================ */
  async function ask(raw, extra) {
    const text = clip(raw, 2000); if (!text) return { ok: false, reply: 'Type or say something first.' };
    const plan = I.route(text, { now: nowMs(), data: data(), settings: { ...S(), clock24: clock24() }, weather: wxLine(), locale: locale() });
    const out = { ok: true, reply: plan.reply || '', ui: [], engine: 'this PC' };
    const r = await applyOps(plan.ops); out.ui = r.ui;
    if (r.memoryItem) out.memoryId = r.memoryItem.id;
    if (r.notes.length && (plan.ops || []).some((o) => o.op === 'openApp')) out.reply = r.notes.join(' ');
    decorate(plan, out);
    if (plan.brief) { S().assistBriefDate = P.ymd(new Date(nowMs())); D.save(); }
    if (plan.suggestions) out.suggestions = await suggestions(extra || {});
    if (plan.search) Object.assign(out, await runSearch(plan.search));
    if (plan.ai) { const a = await runAi(plan.ai, text, extra); Object.assign(out, a); if (a.error) out.ok = false; }
    return out;
  }
  async function act(id) {
    const p = pend.get(String(id)); if (!p) return { ok: false, reply: 'That action has expired. Ask again.' };
    pend.delete(String(id)); const r = await applyOps(p.ops);
    return { ok: true, reply: p.reply || r.notes[0] || 'Done.', ui: r.ui, memoryId: r.memoryItem && r.memoryItem.id };
  }
  function brief() { const b = A.buildBriefing(data(), { now: nowMs(), clock24: clock24(), currency: S().currency, weather: wxLine(), region: region() }); S().assistBriefDate = P.ymd(new Date(nowMs())); D.save(); return b; }
  async function suggestions(extra) {
    extra = extra || {}; const fg = D.getFg ? D.getFg() : {}, u = D.usage ? D.usage() : {}, d = data(), bat = extra.battery && typeof extra.battery.pct === 'number' ? { pct: Math.max(0, Math.min(100, Math.round(extra.battery.pct))), charging: !!extra.battery.charging } : null;
    return A.suggest({ ...d, now: nowMs(), app: fg && fg.name, idleSec: u.idleNow || 0, screenSec: u.screen || 0, battery: bat, briefedToday: S().assistBriefDate === P.ymd(new Date(nowMs())), focus: !!S().focusOn, meetingOn: !!extra.meetingOn, clock24: clock24() })
      .map((s) => ({ id: s.id, icon: s.icon, title: s.title, detail: s.detail, action: s.action }));
  }
  async function meetingFinish(p) {
    const tr = clip(p && p.transcript, 60000); if (tr.length < 25) return { ok: false, text: 'I did not hear enough to write notes.' };
    const r = await ask1(A.meetingMessages(tr, { now: nowMs() }), { maxTokens: 1500, numCtx: 16384 }), parsed = r.ok ? A.parseMeeting(r.text, nowMs()) : null;
    const notes = parsed || A.extractiveMeeting(tr, nowMs());
    return { ok: true, engine: parsed ? engineName() : 'offline', note: parsed ? '' : 'No AI model answered, so these notes were made on this PC with simple rules. Check them.', draft: A.sanitizeMeeting({ ...notes, t: +p.t || nowMs(), dur: +p.dur || 0, transcript: tr }) };
  }
  function meetingSave(draft) { const m = A.sanitizeMeeting(draft); if (!m) return null; db().meetings = [m, ...(db().meetings || []).filter((x) => x.id !== m.id)].slice(0, 50); D.save(); return m; }
  async function meetingTasks(id, idxs) {
    const m = (db().meetings || []).find((x) => x.id === String(id)); if (!m) return { ok: false, text: 'Meeting not found.' };
    const pick = Array.isArray(idxs) ? idxs.map(Number).filter((i) => m.actions[i]) : m.actions.map((_, i) => i); let n = 0;
    for (const i of pick) { const a = m.actions[i], dd = a.due ? P.parseYmd(a.due) : null, when = dd ? ' ' + dd.getDate() + ' ' + MON[dd.getMonth()] : '', r = await D.captureAdd((a.text + (a.owner ? ' (' + a.owner + ')' : '') + when).slice(0, 280)); if (r && r.ok) n++; }
    return { ok: true, text: n + ' action item' + (n === 1 ? '' : 's') + ' added to your planner.' };
  }
  function addMemory(text) { if (!memoryOn()) return { ok: false, text: 'Memory is off.' }; const it = A.parseMemory(text); if (!it) return { ok: false, text: 'Write a full sentence to remember.' }; const r = A.addMemory(db().memory || [], it, nowMs()); db().memory = r.list; D.save(); return { ok: true, item: r.item }; }

  return { ask, act, brief, suggestions, meetingFinish, meetingSave, meetingTasks, addMemory, applyOps, readDoc, docxText, pendingCount: () => pend.size };
};
module.exports.readDoc = readDoc; module.exports.docxText = docxText;
