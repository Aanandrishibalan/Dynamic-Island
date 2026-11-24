/* Main-process glue for the wellness features: repeating calendar events and birthdays, alarm clock, Pomodoro, countdowns,
 * water / stand-up / screen-break reminders, battery and storage alerts.
 *
 * The rules live in wellness.js (pure, tested). This file owns the timers, the stored lists and the notifications:
 *   - one 5-second tick drives everything, so alerts keep working while the island is collapsed or hidden
 *   - every alert is a Windows notification AND an 'alert' message to the island, which expands, plays a sound and shows buttons
 *   - the page can only ask for a small set of actions (snooze an alarm, pomodoro start/pause/..., "I drank water", battery reading)
 */
const W = require('./wellness');
const P = require('./planner');

const DAY = 864e5, MIN = 6e4;
const WELL_KEYS = Object.keys(W.SETTING_DEFAULTS);

module.exports = function createWell(D) {
  const db = () => D.getDb(), S = () => db().settings, nowMs = () => (D.now ? D.now() : Date.now());
  const st = { water: null, brk: null, sb: { active: 0 }, bat: null, stor: {}, lastStorage: 0, lastTick: 0, started: false };
  let timer = null;

  function alert(a) {   // a: {kind, title, text, sound?, id?, level?}
    const out = { sound: true, ...a };
    try { D.notify(out.title, out.text); } catch {}
    try { D.send('alert', out); } catch {}
    return out;
  }

  /* ---------- calendar events: one-off, repeating, birthdays ---------- */
  function tickEvents(n) {
    let changed = false; const fired = [];
    for (let i = 0; i < (db().events || []).length; i++) {
      const e = db().events[i];
      if (!e || e.done || e.notified || !e.due || e.due > n) continue;
      const repeating = (e.repeat || 'none') !== 'none', stale = repeating && n - e.due > 12 * 3600e3;   // a repeating alert that was missed long ago is re-armed silently
      if (!stale) {
        const today = P.ymd(new Date(n)), age = W.ageOn(e, today), text = e.kind === 'birthday' ? e.title.replace(/'s birthday$/i, '') + '\'s birthday today' + (age > 0 ? ' (' + age + ')' : '') : String(e.title || 'Event');
        D.send('reminder', { id: e.id, text, kind: e.kind === 'birthday' ? 'birthday' : 'event' });
        try { D.notify(e.kind === 'birthday' ? 'Birthday' : 'Event', text); } catch {}
        fired.push(e.id);
      }
      db().events[i] = W.afterFire(e, n); changed = true;
    }
    return changed;
  }

  /* ---------- alarm clock ---------- */
  function tickAlarms(n) {
    const r = W.alarmTick(db().alarms || [], n); if (!r.changed) return false;
    const rang = new Set(r.fired.map((a) => a.id)); db().alarms = r.alarms.map((a) => { if (!rang.has(a.id)) return a; const { snoozed, ...rest } = a; return rest; });   // a snooze is used up once the alarm rings
    for (const a of r.fired) alert({ kind: 'alarm', id: a.id, title: a.label || 'Alarm', text: (a.label ? a.label + ' · ' : '') + W.describeDays(a.days) + ' · ' + a.time, time: a.time, label: a.label || '', repeats: a.days.length > 0, repeatSound: true });
    return true;
  }
  const alarmSnooze = (id, min) => { const m = Math.max(1, Math.min(60, Math.round(+min) || 5)); db().alarms = W.alarmSnooze(db().alarms || [], String(id), nowMs(), m); D.save(); return db().alarms; };

  /* ---------- Pomodoro ---------- */
  function tickPomo(n) {
    const r = W.pomoTick(db().pomo || W.POMO_IDLE, S(), n); if (!r.event) return false;
    db().pomo = r.state; alert({ kind: 'pomo', title: r.event.finished === 'work' ? 'Focus session done' : 'Break over', text: r.event.text, next: r.event.next }); return true;
  }
  function pomoAction(action) {
    const n = nowMs(), cur = db().pomo || W.POMO_IDLE; let s = cur;
    if (action === 'start') s = cur.phase === 'idle' ? W.pomoStart(S(), n) : cur.paused ? W.pomoResume(cur, n) : cur;
    else if (action === 'pause') s = W.pomoPause(cur, n);
    else if (action === 'resume') s = W.pomoResume(cur, n);
    else if (action === 'stop') s = W.pomoStop();
    else if (action === 'skip') s = cur.phase === 'idle' ? cur : W.pomoNext(cur.paused ? W.pomoResume(cur, n) : cur, S(), n).state;
    else return db().pomo;
    db().pomo = s; D.save(); return s;
  }

  /* ---------- countdowns ---------- */
  function tickCountdowns(n) {
    const due = W.countdownsDue(db().countdowns || [], n); if (!due.length) return false;
    const ids = new Set(due.map((c) => c.id));
    db().countdowns = db().countdowns.map((c) => (ids.has(c.id) ? { ...c, notified: true } : c));
    for (const c of due) alert({ kind: 'countdown', id: c.id, title: 'Countdown', text: c.label + (c.time ? ' is now.' : ' is today.') });
    return true;
  }

  /* ---------- water, stand-up, screen break ---------- */
  function tickIntervals(n) {
    const s = S();
    if (s.waterOn) { const r = W.intervalStep(st.water, n, s.waterEvery, s.waterFrom, s.waterTo); st.water = r.st; if (r.fire) alert({ kind: 'water', title: 'Water', text: 'Time for a glass of water.', action: 'drank' }); } else st.water = null;
    if (s.breakOn) { const r = W.intervalStep(st.brk, n, s.breakEvery, s.assistWorkStart, s.assistWorkEnd); st.brk = r.st; if (r.fire) alert({ kind: 'break', title: 'Stand up', text: 'Stand up, stretch and walk around for a minute.' }); } else st.brk = null;
    if (s.screenBreakOn) {
      const gap = st.lastTick ? n - st.lastTick : 5000, idle = D.idleSec ? D.idleSec() : 0;
      if (gap > 30000) st.sb = { active: 0 };   // the PC was asleep: that was a break
      else { const r = W.screenBreakStep(st.sb, idle, s.screenBreakEvery, Math.max(1, Math.round(gap / 1000))); st.sb = r.st; if (r.fire) alert({ kind: 'screen', title: 'Screen break', text: 'You have been on the screen for ' + r.minutes + ' minutes. Look at something 20 feet away for 20 seconds.' }); }
    } else st.sb = { active: 0 };
  }

  /* ---------- storage ---------- */
  function tickStorage(n) {
    if (!S().storageOn || n - st.lastStorage < 5 * MIN) return;
    st.lastStorage = n; let drives = []; try { drives = D.drives ? D.drives() : []; } catch {}
    const r = W.storageStep(drives, S(), st.stor, P.ymd(new Date(n))); st.stor = r.state;
    for (const a of r.alerts) alert({ kind: 'storage', title: 'Low disk space', text: a.text, drive: a.drive });
  }

  /* ---------- battery (the island page reads it with navigator.getBattery and tells us) ---------- */
  function battery(cur) {
    if (!cur || typeof cur !== 'object' || !isFinite(+cur.pct)) return [];
    const pct = Math.max(0, Math.min(100, +cur.pct)), r = W.batteryStep(st.bat, { pct, charging: !!cur.charging }, S()); st.bat = r.state;
    return r.alerts.map((a) => alert({ kind: 'battery', level: a.level, title: a.level === 'full' ? 'Battery charged' : 'Battery low', text: a.text, pct: a.pct }));
  }

  /* ---------- the tick ---------- */
  function tick(n) {
    n = n || nowMs(); let changed = false;
    try { changed = tickEvents(n) || changed; } catch {}
    try { changed = tickAlarms(n) || changed; } catch {}
    try { changed = tickPomo(n) || changed; } catch {}
    try { changed = tickCountdowns(n) || changed; } catch {}
    try { tickIntervals(n); } catch {}
    try { tickStorage(n); } catch {}
    st.lastTick = n;
    if (changed) D.save();
    return changed;
  }
  function start() { if (st.started) return; st.started = true; timer = setInterval(() => tick(), 5000); if (timer.unref) timer.unref(); }
  function stop() { if (timer) clearInterval(timer); timer = null; st.started = false; }

  /* ---------- "I drank a glass" bumps the first goal that mentions water ---------- */
  function drank() {
    const g = (db().goals || []).find((x) => /water|glass|hydrat/i.test(x.text + ' ' + (x.unit || ''))); if (!g) return false;
    db().goals = db().goals.map((x) => (x.id === g.id ? P.bumpGoal(x, P.ymd(new Date(nowMs())), 1) : x)); D.save(); return true;
  }

  /* ---------- IPC ---------- */
  function register(ipc) {
    const ok = (e) => D.trusted(e);
    ipc.on('well:battery', (e, cur) => { if (ok(e)) battery(cur); });
    ipc.handle('well:alarm-snooze', (e, id, min) => (ok(e) ? alarmSnooze(id, min) : null));
    ipc.handle('well:pomo', (e, action) => (ok(e) && ['start', 'pause', 'resume', 'stop', 'skip'].includes(action) ? pomoAction(action) : null));
    ipc.handle('well:drank', (e) => (ok(e) ? drank() : false));
  }

  /* settings coming from the page: wellness keys are validated by wellness.js, the rest is left to the caller */
  function cleanSettings(p, current) {
    const wp = W.sanitizeSettings(p); for (const k of WELL_KEYS) delete p[k]; Object.assign(p, wp);
    const from = 'waterFrom' in p ? p.waterFrom : current.waterFrom, to = 'waterTo' in p ? p.waterTo : current.waterTo;
    if (to <= from) { delete p.waterFrom; delete p.waterTo; }
    return p;
  }

  return { tick, start, stop, register, battery, pomoAction, alarmSnooze, drank, cleanSettings, state: st, WELL_KEYS };
};
