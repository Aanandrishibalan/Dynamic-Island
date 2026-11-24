const A = require('../dynamic-island/assistant.js'), I = require('../dynamic-island/intents.js'), P = require('../dynamic-island/planner.js'), createAssist = require('../dynamic-island/assist.js');
const zlib = require('zlib');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, m + (s ? '' : '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b))); };
const L = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = L(2026, 11, 20, 10, 0);   // Friday
const T = (o) => ({ id: 't' + Math.random().toString(36).slice(2, 6), text: 'x', done: false, doneAt: null, cat: 'personal', pri: 'normal', cond: 'none', repeat: 'none', due: null, date: null, by: null, notified: false, spawned: false, ...o });
const mkData = () => ({ tasks: [T({ text: 'Call supplier', due: L(2026, 11, 20, 16), date: '2026-11-20', cat: 'work' }), T({ text: 'Submit tax return', date: '2026-11-20', cat: 'urgent', pri: 'high' }), T({ text: 'Fix invoice', date: '2026-11-19', pri: 'high', cat: 'work' }), T({ text: 'Buy milk', date: '2026-11-20', cat: 'shopping' }), T({ text: 'Clean desk', date: '2026-11-20' })], events: [], habits: [{ id: 'h1', name: 'Meditate', days: [] }], goals: [{ id: 'g1', text: 'Drink water', target: 8, unit: 'glasses', log: {} }], expenses: [{ id: 'e1', t: L(2026, 11, 3, 9), amount: 100, cat: 'Food', note: 'lunch' }, { id: 'e2', t: L(2026, 11, 5, 9), amount: 50.5, cat: 'Food', note: 'dinner' }, { id: 'e3', t: L(2026, 11, 6, 9), amount: 900, cat: 'Bills', note: 'electricity' }], journal: [], notes: ['', '', ''], memory: [], meetings: [], conversations: [] });

/* briefing: the example from the brief */
let d = mkData(), b = A.buildBriefing(d, { now: NOW });
ok(b.text.startsWith('You have 5 pending tasks. Two are urgent.') && /You also have a reminder to call supplier at 4 PM\./.test(b.text), 'briefing matches the spoken example: ' + b.text);
eq([b.stats.pending, b.stats.urgent, b.stats.reminders], [5, 2, 1], 'briefing counts');
b = A.buildBriefing({ tasks: [], events: [] }, { now: NOW }); eq(b.text, 'You have nothing pending today.', 'empty day');
b = A.buildBriefing({ tasks: [T({ text: 'Only one', date: '2026-11-20', pri: 'high' })], events: [{ id: 'e', title: 'Standup', date: '2026-11-20', time: '11:00' }] }, { now: NOW }); ok(/1 pending task\. It is urgent\./.test(b.text) && /Standup at 11 AM/.test(b.text), 'singular + event');
ok(/16:00/.test(A.buildBriefing(mkData(), { now: NOW, clock24: true }).text), '24-hour clock option');
ok(!A.snapshot({ tasks: [T({ text: 'W', date: '2026-11-20', cond: 'online' })] }, NOW).pending.length, 'condition tasks are not "pending" until met');

/* scheduling */
d = mkData(); d.events = [{ id: 'e', title: 'Sync', date: '2026-11-20', time: '11:00', done: false }];
const pl = A.planSlots(d, { now: NOW }); const hit = (a, bb) => a.start < bb.end && bb.start < a.end; const busy = { start: L(2026, 11, 20, 11), end: L(2026, 11, 20, 12) }, call = { start: L(2026, 11, 20, 16), end: L(2026, 11, 20, 16, 30) }, lunch = { start: L(2026, 11, 20, 13), end: L(2026, 11, 20, 14) };
ok(pl.placements.length === 4 && !pl.unplaced.length, 'plans every untimed task (the 4 PM call is already timed)');
ok(pl.placements.every((p) => p.start >= NOW + 5 * 6e4 && !hit(p, busy) && !hit(p, call) && !hit(p, lunch)), 'no slot is in the past, on the meeting, on the 4 PM call or on lunch');
ok(A.rankTasks(A.schedulable(d, NOW, A.SCHED), NOW)[0].text === 'Fix invoice', 'overdue + important first');
ok(pl.placements.every((p, i, a) => a.every((q, j) => i === j || !hit(p, q))), 'slots never overlap each other');
const tight = A.planSlots({ tasks: [T({ text: 'Big job 8 hours', date: '2026-11-20' })], events: [] }, { now: NOW, tasks: undefined }); ok(tight.placements.length === 0 && tight.unplaced.length === 1, 'a task that cannot fit before its deadline is reported, not forced');
const sat = A.planSlots({ tasks: [T({ text: 'Later' })], events: [] }, { now: L(2026, 11, 20, 19, 0) }); eq(new Date(sat.placements[0].start).getDay(), 1, 'after hours on Friday -> next working day (Monday)');
eq(A.estimateMin({ text: 'Write report 2 hours' }), 120, 'length parsed from text'); eq(A.slotOptions({ tasks: [], events: [] }, { now: NOW }, 30).length, 3, 'three slot options');
const os = A.settingsFor([A.parseMemory('I work 10 am to 7 pm')], {}); eq([os.workStart, os.workEnd], [600, 1140], 'remembered work hours drive scheduling');
ok(A.describeFree({ tasks: [], events: [] }, { now: NOW }, '2026-11-21').join().includes('9 AM'), 'free time description');

/* memory */
eq(A.parseMemory('remember that I work 10 to 6 pm').key, 'work', 'work hours parsed'); eq(A.parseMemory('lunch is at 1:30 pm').start, 810, 'lunch time parsed');
eq(A.parseMemory('I usually go to the gym at 6 PM').kind, 'routine', 'routine'); eq(A.parseMemory('I prefer short meetings').kind, 'preference', 'preference');
ok(A.memoryCandidate('I usually go to the gym at 6 PM') && !A.memoryCandidate('What is the weather like?') && !A.memoryCandidate('call mom tomorrow'), 'only self-statements are proposed');
let ml = A.addMemory([], A.parseMemory('I work 9 to 5')).list; ml = A.addMemory(ml, A.parseMemory('I work 10 to 6')).list; ok(ml.length === 1 && ml[0].start === 600, 'new work hours replace the old'); ok(A.addMemory(ml, { text: 'ab' }).item === null, 'too-short memory refused');
ok(A.routineDue({ text: 'I go to the gym at 6 PM' }, L(2026, 11, 20, 17, 50), 20) && !A.routineDue({ text: 'I go to the gym at 6 PM on weekends' }, L(2026, 11, 20, 17, 50), 20), 'routine reminder window + weekend rule');

/* search */
d = mkData(); d.journal = [{ id: 'j', t: NOW, text: 'Idea: kuli booking app for the station', kind: 'idea' }]; d.notes = ['supplier phone 98400', '', ''];
ok(A.searchLocal('find supplier', d, { now: NOW }).items.length >= 2, 'finds the task and the sticky note');
eq(A.searchLocal('what did I note about kuli', d, { now: NOW }).items[0].kind, 'journal', 'finds the journal idea');
ok(/₹150\.5 on Food this month/.test(A.searchLocal('how much did I spend on food this month', d, { now: NOW }).answer), 'expense total by category');
eq(A.fileQuery('find my budget spreadsheet from last week', NOW).term + '|' + A.fileQuery('find my budget spreadsheet from last week', NOW).exts[0], 'budget|xlsx', 'file query: term + type');

/* text tools */
const long = 'The supplier delivery is late again. We must confirm the new date by Friday. The supplier blamed the port strike. Ravi will send the revised invoice. Lunch was good. The price stays the same as agreed last month.';
ok(A.extractiveSummary(long, 3).gist.length > 10 && A.extractiveSummary(long, 3).bullets.length === 2, 'offline summary'); eq(A.basicCorrect('i recieve teh mail  tommorow ,ok'), "I receive the mail tomorrow, ok.", 'offline proofreading');
eq(A.langOf('translate to tamil'), 'Tamil', 'language detection'); ok(A.writeMessages({ mode: 'translate', lang: 'Hindi', text: 'hi' })[0].content.includes('Hindi'), 'translate prompt');
ok(A.parseMeeting('```json\n{"title":"Sync","summary":"s","actions":[{"text":"Send invoice","owner":"Ravi","due":"2026-11-25"}],"decisions":["Keep price"]}```').actions[0].owner === 'Ravi', 'AI meeting JSON parsed'); ok(A.parseMeeting('sorry') === null, 'bad AI answer ignored');
const em = A.extractiveMeeting('We decided to keep the old price. Ravi will send the revised invoice by Monday. Please confirm the delivery date. The weather was nice.', NOW); ok(em.decisions.length === 1 && em.actions.length >= 2 && em.actions[0].owner === 'Ravi', 'offline meeting notes: decisions + action items + owner');
ok(A.parseScreen('{"summary":"x","actions":[{"label":"Add","kind":"task","text":"Pay"},{"label":"","kind":"x","text":""}]}').actions.length === 1, 'screen actions validated');

/* suggestions */
const sg = (c) => A.suggest({ ...mkData(), now: NOW, ...c }).map((s) => s.id);
ok(sg({ app: 'Teams' }).includes('app-meeting') && sg({ app: 'OUTLOOK' }).includes('app-mail') && sg({ app: 'winword' }).includes('app-writing'), 'suggestions follow the app in front');
ok(sg({}).includes('brief') && !sg({ briefedToday: true }).includes('brief'), 'briefing offered once'); ok(sg({ battery: { pct: 12, charging: false } }).includes('battery') && !sg({ battery: { pct: 12, charging: true } }).includes('battery'), 'low battery only when unplugged');
ok(sg({ meetingOn: true })[0] === 'meeting-stop', 'recording meeting comes first'); ok(sg({ screenSec: 3 * 3600, idleSec: 5 }).includes('break'), 'long screen time -> break');

/* intents */
const ctx = (data) => ({ now: NOW, data: data || mkData(), settings: {} }), R = (t, data) => I.route(t, ctx(data));
ok(R("What's pending today?").reply.startsWith('You have 5 pending tasks. Two are urgent.'), 'voice: "What\'s pending today?"');
eq(R('hey island, could you please set a timer for 1 hour 30 minutes').ops, [{ op: 'timer', ms: 5400000 }], 'timer with wake word + politeness');
eq(R('set volume to 40').ops, [{ op: 'volume', set: 40 }], 'volume'); eq(R('turn off bluetooth').ops, [{ op: 'radio', kind: 'bluetooth', on: false }], 'bluetooth off');
ok(R('sleep').confirm && !R('sleep').ops.length, 'sleep needs confirmation'); ok(R('delete buy milk').confirm, 'delete needs confirmation');
d = mkData(); eq(R('mark buy milk as done', d).ops[0], { op: 'doneTask', id: d.tasks[3].id }, 'complete a task by name'); eq(R('mark meditate done', d).ops[0].op, 'habitDone', 'tick a habit'); eq(R('I drank 3 glasses of water', d).ops[0].delta, 3, 'goal log');
eq(R('find time for my unfinished tasks').confirm.ops[0].op, 'applyPlan', 'smart scheduling returns a plan to apply'); ok(R('find time for buy milk 20 minutes').slots.length === 3, 'single-task slot options');
ok(R('schedule meeting with Ravi tomorrow at 3 pm').ops[0].op === 'addEvent' && R('schedule meeting with Ravi tomorrow at 3 pm').ops[0].time === '15:00', 'event with time'); ok(R('schedule a meeting with Ravi').slots, 'event without time -> slots');
ok(R('summarise my unread mail').ai.source === 'mail' && R('translate this to Tamil').ai.lang === 'Tamil' && R('make this more formal').ai.tone === 'formal and professional' && R('write an email to supplier asking to confirm delivery').ai.mode === 'compose' && R("what's on my screen").ai.kind === 'screen', 'AI intents: summarise, translate, rewrite, compose, screen');
ok(R('remember that I prefer meetings after 11').ops[0].op === 'remember' && R('I usually go to the gym at 6 PM').proposal && !R('I usually go to the gym at 6 PM').ops.length, 'memory: explicit saves, statement proposes');
ok(R('remember that I like tea', Object.assign(mkData(), {})).ops.length === 1 && I.route('remember that I like tea', { now: NOW, data: mkData(), settings: { assistMemory: false } }).ops.length === 0, 'memory off blocks saving');
ok(R('what is the capital of France').ai.kind === 'chat', 'anything else is a chat'); ok(R('remind me to call Ravi at 5 pm').ops[0].op === 'addCapture', 'add task by voice');
ok(R('how much did I spend on food this month').search, 'expense question goes to search');

/* glue: tokens, validation, docx, privacy */
(async () => {
  const db = { settings: { aiProvider: 'ollama', clock24: true, assistMemory: true, currency: '₹' }, ...mkData() }; let saved = 0, chatSeen = null, prov = 'ollama';
  const cb = { t: 'Dear team, the delivery slipped. Please confirm Friday. Ravi sends the invoice.', readText() { return this.t; }, writeText(x) { this.t = x; }, clear() { this.t = ''; } };
  const G = createAssist({ getDb: () => db, save: () => saved++, now: () => NOW, provider: () => prov, chat: async (m) => { chatSeen = m; return { ok: true, text: 'MODEL' }; }, vision: async () => ({ ok: false, text: 'no vision' }), clipboard: cb, ps: async () => '[]', getFg: () => ({ name: 'cmd', hwnd: 9 }), setCopyBusy() {}, appIndex: async () => [], launchApp: async () => false, openPath() {}, mail: () => [], usage: () => ({}), weather: () => null,
    setTasks: (l) => { db.tasks = P.sanitizeList(l, P.sanitizeTask, 2000); }, captureAdd: async (raw) => { db.tasks.unshift(P.makeTask(P.parseCapture(raw, new Date(NOW)), NOW)); return { ok: true, text: 'Added' }; } });
  let r = await G.ask('what is the capital of France'); ok(r.reply === 'MODEL' && r.engine === 'local model', 'chat answer names its engine');
  prov = 'claude'; chatSeen = null; await G.ask('what is the capital of France'); ok(!/pending tasks/.test(JSON.stringify(chatSeen)), 'cloud chat does NOT get tasks/calendar unless the user allows it');
  db.settings.assistCloudContext = true; await G.ask('what is the capital of France'); ok(/pending tasks/.test(JSON.stringify(chatSeen)), '...and does once the user switches sharing on'); prov = 'ollama'; db.settings.assistCloudContext = false;
  r = await G.ask('summarise the selected text'); ok(r.reply === 'MODEL' && /clipboard/.test(r.source), 'selection into a terminal is skipped; clipboard used and labelled');
  const bad = await G.applyOps([{ op: 'retime', id: db.tasks[0].id, date: 'tomorrow', due: 1 }, { op: 'placeTask', start: 1, text: 'x' }, { op: 'addEvent', date: '2026-02-31', title: 'x' }, { op: 'bumpGoal', id: 'g1', delta: 1e9 }, { op: 'forget', id: 'none' }]); ok(db.tasks.every((t) => t.due !== 1) && !(db.events || []).length && !db.goals[0].log['2026-11-20'], 'data ops validate dates, times and sizes');
  r = await G.ask('delete buy milk'); ok(r.confirm && db.tasks.some((t) => t.text === 'Buy milk'), 'confirm: nothing deleted yet'); const a = await G.act(r.confirm.id); ok(!db.tasks.some((t) => t.text === 'Buy milk') && a.ok, 'confirm: deleted after yes'); ok(!(await G.act(r.confirm.id)).ok, 'a token works only once'); ok(!(await G.act('forged')).ok, 'forged token refused');
  r = await G.ask('I usually go to the gym at 6 PM'); ok(r.proposal && !db.memory.length, 'proposal not stored'); await G.act(r.proposal.id); ok(db.memory.length === 1, 'stored after Remember');
  const doc = (xml) => { const raw = Buffer.from(xml), c = zlib.deflateRawSync(raw), name = Buffer.from('word/document.xml'), lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(c.length, 18); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(c.length, 20); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
    const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 10); const off = 30 + name.length + c.length; eo.writeUInt32LE(off + 46 + name.length - 46 + 0, 12); eo.writeUInt32LE(off, 16); return Buffer.concat([lh, name, c, cd, name, eo]); };
  ok(G.docxText(doc('<w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:t>Second line</w:t></w:p>')).trim() === 'Hello & welcome\nSecond line', 'reads text out of a .docx');
  const m = await G.meetingFinish({ transcript: 'We decided to keep the old price. Ravi will send the revised invoice by Monday. Please confirm the date.', dur: 60, t: NOW }); ok(m.ok && m.engine === 'offline' && m.draft.actions.length >= 1, 'meeting notes fall back to offline rules when the model gives no JSON');
  const sv = G.meetingSave(m.draft); ok(db.meetings.length === 1 && sv.id, 'meeting saved only on request'); const mt = await G.meetingTasks(sv.id); ok(mt.ok && /added to your planner/.test(mt.text), 'action items become tasks');
  console.log(f ? f + ' FAILED' : 'ALL ASSISTANT TESTS PASSED'); process.exit(f ? 1 : 0);
})();
