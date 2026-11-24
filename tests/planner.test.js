const P = require('../dynamic-island/planner.js');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, m + (s ? '' : '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b))); };
const L = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const FRI9 = new Date(2026, 10, 20, 9, 0), FRI1645 = new Date(2026, 10, 20, 16, 45);   // Friday 20 Nov 2026
const c = (t, n = FRI9) => P.parseCapture(t, n);
const pick = (r) => ({ text: r.text, date: r.date, time: r.hasTime, cat: r.cat, pri: r.pri, repeat: r.repeat });

/* the four examples from the brief */
let r = c('Buy groceries tomorrow.'); eq(pick(r), { text: 'Buy groceries', date: '2026-11-21', time: false, cat: 'shopping', pri: 'normal', repeat: 'none' }, 'Buy groceries tomorrow'); ok(r.due === null, 'date only: no alert time');
r = c('Call supplier at 4 PM.'); eq([r.text, r.due, r.cat, r.date], ['Call supplier', L(2026, 11, 20, 16), 'work', '2026-11-20'], 'Call supplier at 4 PM (today)');
r = c('Call supplier at 4 PM.', FRI1645); eq([r.due, r.date], [L(2026, 11, 21, 16), '2026-11-21'], '4 PM already passed -> tomorrow');
r = c('Pay electricity bill on Monday.'); eq(pick(r), { text: 'Pay electricity bill', date: '2026-11-23', time: false, cat: 'personal', pri: 'normal', repeat: 'none' }, 'Pay electricity bill on Monday');
r = c('Complete Excel report before 6 PM.'); eq([r.text, r.by, r.due, r.cat], ['Complete Excel report', L(2026, 11, 20, 18), L(2026, 11, 20, 17, 30), 'work'], 'before 6 PM: deadline 6, reminder 5:30');

/* priority / category / repeat / condition */
r = c('urgent: call mom in 30 minutes'); eq([r.text, r.cat, r.pri, r.due], ['Call mom', 'urgent', 'high', FRI9.getTime() + 30 * 60000], 'urgent + in 30 minutes');
r = c('Team standup every Monday at 10am'); eq([r.repeat, r.date, r.due, r.text], ['weekly', '2026-11-23', L(2026, 11, 23, 10), 'Team standup'], 'every Monday at 10am');
r = c('Water plants every day'); eq([r.repeat, r.date, r.text], ['daily', '2026-11-20', 'Water plants'], 'every day starts today');
r = c('Send gift 25 Dec'); eq([r.date, r.text], ['2026-12-25', 'Send gift'], '25 Dec'); r = c('Party dec 25th'); eq(r.date, '2026-12-25', 'dec 25th');
r = c('Rent 5/12'); eq(r.date, '2026-12-05', '5/12 is day/month');
r = c('Pay rent on the 5th'); eq(r.date, '2026-12-05', 'on the 5th -> next 5th');
r = c('Gym next Friday'); eq(r.date, '2026-11-27', 'next Friday on a Friday = a week away'); r = c('Gym this Friday'); eq(r.date, '2026-11-20', 'this Friday on a Friday = today');
r = c('Read book tonight'); eq([r.due, r.text], [L(2026, 11, 20, 20), 'Read book'], 'tonight = 8 PM');
r = c('Deploy tomorrow at 14:30'); eq([r.due, r.text], [L(2026, 11, 21, 14, 30), 'Deploy'], '24-hour time + tomorrow');
r = c('Meet Ravi at 7'); eq(new Date(r.due).getHours(), 19, '"at 7" means 7 PM'); r = c('Walk at 8'); eq([new Date(r.due).getHours(), r.date],[8,'2026-11-21'], '"at 8" stays morning (passed -> tomorrow)');
r = c('Pay EMI monthly'); eq(r.repeat, 'monthly', 'monthly'); r = c('Check mail every weekday at 9am'); eq(r.repeat, 'weekdays', 'every weekday');
r = c('Submit tax return!!'); eq(r.pri, 'high', 'exclamation marks = high'); r = c('Clean garage someday'); eq(r.pri, 'low', 'someday = low');
r = c('Remind me to call Ravi when I am online'); eq([r.cond, r.text], ['online', 'Call Ravi'], 'condition: online'); r = c('Back up laptop when I plug in'); eq(r.cond, 'charging', 'condition: charging'); r = c('Update notes when I unlock'); eq(r.cond, 'unlock', 'condition: unlock');
r = c('shopping: milk and eggs'); eq([r.cat, r.text], ['shopping', 'Milk and eggs'], 'explicit category prefix');
r = c('Dentist at 25 dec'); ok(!r.hasTime && r.date === '2026-12-25', '"at 25 dec" is a date, not a time');
r = c('x'.repeat(900)); ok(r.text.length <= 120, 'very long input is capped'); r = c('   '); eq([r.text, r.due, r.date], ['', null, null], 'empty input');
r = c('Think about holiday'); eq([r.date, r.due], [null, null], 'no date words -> undated');

/* ideas and expenses */
r = c('idea: app for kuli booking'); eq([r.kind, r.text], ['idea', 'App for kuli booking'], 'idea capture');
r = c('spent 250 on lunch'); eq([r.kind, r.amount, r.text, r.cat], ['expense', 250, 'lunch', 'Food'], 'expense capture'); r = c('Spent ₹1,200.50 for petrol'); eq([r.kind, r.cat], ['expense', 'Transport'], 'expense with currency symbol');
r = c('Pay electricity bill'); eq(r.kind, 'task', '"Pay ..." stays a task');

/* AI merge: rules win on explicit values, AI fills gaps */
const rules = c('Call supplier at 4 PM'); const ai = P.parseAiJson('```json\n{"text":"Call the supplier","date":"2026-12-01","time":"09:00","category":"work","priority":"high","repeat":"none"}\n```');
let mg = P.mergeAi(rules, ai, FRI9); eq([mg.text, mg.due, mg.pri], ['Call the supplier', rules.due, 'high'], 'AI cannot override an explicit time; improves name and priority');
mg = P.mergeAi(c('Think about holiday'), { date: '2026-12-01', time: '09:00', category: 'personal' }, FRI9); eq([mg.date, mg.due], ['2026-12-01', L(2026, 12, 1, 9)], 'AI fills a missing date and time');
ok(P.mergeAi(c('x'), { category: 'hack', priority: 'x', date: 'tomorrow', time: '99:99' }, FRI9) === null, 'bad AI fields are ignored'); ok(P.parseAiJson('sorry') === null, 'unusable AI answer'); ok(P.aiMessages('hi', FRI9)[1].content.includes('2026-11-20'), 'AI prompt carries today');

/* sanitising */
const st = P.sanitizeTask({ id: 'a', text: 'Bad', cat: 'hax', pri: 'x', repeat: 'yearly', cond: 'rm', date: 'tomorrow', due: 'x', imp: 'yes' }); eq([st.cat, st.pri, st.repeat, st.cond, st.date, st.due, 'imp' in st], ['personal', 'normal', 'none', 'none', null, null, false], 'task sanitised'); ok(P.sanitizeTask({ text: '  ' }) === null, 'empty task dropped');
ok(P.sanitizeExpense({ amount: -4 }) === null && P.sanitizeExpense({ amount: '12.345', cat: 'zzz' }).cat === 'Other', 'expense sanitised');
ok(P.sanitizeHabit({ name: 'Read', days: ['2026-11-01', 'nope', '2026-11-01'] }).days.length === 1, 'habit days validated'); ok(P.sanitizeGoal({ text: 'Water', target: 0 }).target === 1, 'goal target floor');

/* repeating tasks */
const T = (o) => ({ id: 'r', text: 'Standup', done: false, repeat: 'weekly', cat: 'work', pri: 'normal', cond: 'none', notified: false, spawned: false, ...o });
const NOW = FRI9.getTime(); let before = [T({ due: L(2026, 11, 20, 10), date: '2026-11-20' })], after = [{ ...before[0], done: true }];
let sp = P.spawnNext(before, after, NOW); ok(sp.tasks.length === 2 && sp.tasks[1].spawned && sp.tasks[1].doneAt === NOW, 'ticking a weekly task makes one copy and marks the old one'); eq(sp.tasks[0].due, L(2026, 11, 27, 10), 'next weekly copy is a week later, same time');
sp = P.spawnNext(sp.tasks, sp.tasks, NOW); ok(sp.tasks.length === 2, 'saving again does not repeat twice');
sp = P.spawnNext([T({ repeat: 'daily', date: '2026-10-01' })], [T({ repeat: 'daily', date: '2026-10-01', done: true })], NOW); eq(sp.tasks[0].date, '2026-11-21', 'long-overdue daily comes back tomorrow, not in the past');
sp = P.spawnNext([T({ repeat: 'monthly', date: '2026-01-31' })], [T({ repeat: 'monthly', date: '2026-01-31', done: true })], L(2026, 1, 31)); eq(sp.tasks[0].date, '2026-02-28', 'monthly on the 31st lands on 28 Feb');
sp = P.spawnNext([T({ repeat: 'none' })], [T({ repeat: 'none', done: true })], NOW); ok(sp.tasks.length === 1, 'normal task does not repeat'); sp = P.spawnNext([], [T({ done: true, date: '2026-11-20' })], NOW); ok(sp.tasks.length === 1, 'done task arriving from outside does not repeat');
sp = P.spawnNext([T({ repeat: 'weekdays', date: '2026-11-20' })], [T({ repeat: 'weekdays', date: '2026-11-20', done: true })], NOW); eq(sp.tasks[0].date, '2026-11-23', 'weekdays skip the weekend');

/* today's plan + matrix */
const tasks = [{ id: '1', text: 'Old', date: '2026-11-18', done: false, cat: 'work', pri: 'normal' }, { id: '2', text: 'Now', due: L(2026, 11, 20, 15), done: false, cat: 'work', pri: 'normal' }, { id: '3', text: 'Urgent', date: '2026-11-20', cat: 'urgent', pri: 'high', done: false }, { id: '4', text: 'Later', date: '2026-12-10', done: false, cat: 'personal', pri: 'normal' }, { id: '5', text: 'Anytime', done: false, cat: 'personal', pri: 'normal' }, { id: '6', text: 'Done', date: '2026-11-20', done: true, doneAt: NOW - 3600e3, cat: 'work', pri: 'normal' }];
const g = P.groupTasks(tasks, NOW); eq([g.overdue.length, g.today.map((t) => t.text), g.upcoming.length, g.anytime.length, g.doneToday.length, g.progress], [1, ['Urgent', 'Now'], 1, 1, 1, { done: 1, total: 4 }], 'groups: urgent first, progress counts');
eq(tasks.filter((t) => !t.done).map((t) => P.quadrant(t, NOW)), ['quick', 'quick', 'do', 'later', 'later'], 'Eisenhower quadrants'); eq(P.quadrant({ date: '2026-12-10', imp: true }, NOW), 'plan', 'important but not urgent = schedule'); eq(P.quadrant({ date: '2026-11-18', imp: true }, NOW), 'do', 'important and overdue = do first');

/* habits / goals / expenses */
const days = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-01', '2026-11-02'];
let hs = P.habitStats({ days }, NOW); eq([hs.doneToday, hs.streak, hs.best, hs.last7], [true, 4, 4, [false, false, false, true, true, true, true]], 'habit streak and last 7 days');
hs = P.habitStats({ days: ['2026-11-19', '2026-11-18'] }, NOW); eq([hs.doneToday, hs.streak], [false, 2], 'streak survives until today ends'); hs = P.habitStats({ days: ['2026-11-10'] }, NOW); eq(hs.streak, 0, 'broken streak');
eq(P.toggleHabit({ days: ['2026-11-20'] }, '2026-11-20').days, [], 'toggle off'); eq(P.toggleHabit({ days: [] }, '2026-11-20').days, ['2026-11-20'], 'toggle on');
let gl = { target: 8, log: { '2026-11-19': 8, '2026-11-20': 3 } }; eq(P.goalStats(gl, NOW), { n: 3, pct: 38, hit: false, streak: 1 }, 'goal progress, streak counts yesterday'); gl = P.bumpGoal(gl, '2026-11-20', 5); ok(P.goalStats(gl, NOW).hit && P.goalStats(gl, NOW).streak === 2, 'goal reached'); eq(P.bumpGoal({ log: {} }, 'd', -1).log.d, 0, 'goal never below zero');
const ex = [{ t: L(2026, 11, 20, 8), amount: 100, cat: 'Food' }, { t: L(2026, 11, 18, 8), amount: 50.5, cat: 'Food' }, { t: L(2026, 11, 3, 8), amount: 200, cat: 'Bills' }, { t: L(2026, 10, 30, 8), amount: 999, cat: 'Other' }];
const es = P.expenseSummary(ex, NOW); eq([es.today, es.week, es.month, es.cats], [100, 150.5, 350.5, [['Bills', 200], ['Food', 150.5]]], 'expense summary');
console.log(f ? f + ' FAILED' : 'PLANNER TESTS PASSED'); process.exit(f ? 1 : 0);
