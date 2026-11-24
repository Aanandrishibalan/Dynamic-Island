const S = require('../dynamic-island/speed.js');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };

// ---- maths
ok(S.median([3, 1, 2]) === 2 && S.median([1, 2, 3, 4]) === 2.5 && S.median([]) === 0, 'median');
ok(S.jitterOf([10, 20, 10]) === 10 && S.jitterOf([5]) === 0, 'jitter = mean absolute difference');
ok(Math.round(S.mbps(12500000, 1000)) === 100 && S.mbps(100, 0) === 0, 'mbps: 12.5 MB in 1 s = 100 Mb/s, no divide by zero');
const r1 = S.rate({ t: 0, rx: 0, tx: 0 }, { t: 2000, rx: 2000000, tx: 500000 });
ok(r1.down === 1000000 && r1.up === 250000, 'rate: bytes per second from two counters');
ok(S.rate({ t: 0, rx: 100, tx: 100 }, { t: 1000, rx: 5, tx: 5 }).down === 0, 'rate: counter reset gives 0, never negative');
ok(S.rate(null, { t: 1, rx: 1, tx: 1 }).down === 0 && S.rate({ t: 5, rx: 1, tx: 1 }, { t: 5, rx: 9, tx: 9 }).up === 0, 'rate: first sample and zero time gap are safe');
ok(S.fmtBits(125000) === '1.0 Mb/s' && S.fmtBits(12500000) === '100 Mb/s' && S.fmtBits(1250) === '10 Kb/s' && S.fmtBits(0) === '0 b/s' && S.fmtBits(125000000) === '1.00 Gb/s' && S.fmtBits(-5) === '0 b/s', 'fmtBits units');
ok(/^Excellent/.test(S.grade({ down: 200, up: 50, ping: 10 })) && /^Slow/.test(S.grade({ down: 3, up: 1, ping: 50 })) && S.grade(null) === 'No result', 'grade words');

// ---- history
const h = S.sanitizeTests([{ t: 1, down: 10, up: 2, ping: 20, jitter: 1, net: 'Wi-Fi' }, { t: 5, down: -3, up: 'x', ping: 5 }, null, { t: 'bad' }, { t: 3, down: 1e12 }, 'x']);
ok(h.length === 3 && h[0].t === 5 && h[0].down === 0 && h[0].up === 0 && h[1].down === 100000, 'history: sorted newest first, bad numbers cleaned, junk dropped');
ok(S.sanitizeTests(Array.from({ length: 80 }, (_, i) => ({ t: i + 1, down: 1 }))).length === 50 && S.sanitizeTests('x').length === 0, 'history: capped at 50, non-array safe');
ok(S.sanitizeTest({ t: 1, net: 'x'.repeat(500) }).net.length === 60, 'history: text length capped');

// ---- versions
ok(S.cmpVer('1.4.0', '1.3.0') === 1 && S.cmpVer('1.3.0', '1.4.0') === -1 && S.cmpVer('1.10.0', '1.9.9') === 1 && S.cmpVer('1.4', '1.4.0') === 0 && S.cmpVer('1.4.0', undefined) === 1 && S.cmpVer('1.4.0-beta', '1.4.0') === 0, 'cmpVer');

// ---- tester against a fake server
function fakeFetch(opts = {}) {
  return async (url, o = {}) => {
    if (o.signal && o.signal.aborted) throw new Error('aborted');
    if (/cdn-cgi\/trace/.test(url)) return { ok: true, text: async () => 'ip=1.2.3.4\ncolo=MAA\nloc=IN\n' };
    if (/__down\?bytes=0/.test(url)) { await new Promise((r) => setTimeout(r, 5)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }; }
    if (/__down/.test(url) || /ovh/.test(url)) {
      if (opts.noDown) throw new Error('blocked');
      let n = 0; const chunk = new Uint8Array(250000);
      return { ok: true, body: { getReader: () => ({ read: async () => { await new Promise((r) => setTimeout(r, 10)); return n++ < 400 ? { done: false, value: chunk } : { done: true }; }, cancel: async () => {} }) } };
    }
    if (/__up/.test(url)) { await new Promise((r) => setTimeout(r, 20)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }; }
    throw new Error('unexpected ' + url);
  };
}
(async () => {
  const seen = []; const t = S.createTester({ fetch: fakeFetch(), send: (p) => seen.push(p.phase), downMs: 1800, upMs: 1800 });
  const r = await t.run();
  ok(r.ok && r.result.down > 0 && r.result.up > 0 && r.result.ping >= 0 && r.result.server === 'MAA, IN' && r.result.ip === '1.2.3.4', 'tester: full run returns ping, download, upload and server');
  ok(['ping', 'down', 'up', 'done'].every((x) => seen.includes(x)) && seen.indexOf('ping') < seen.indexOf('down') && seen.indexOf('down') < seen.indexOf('up'), 'tester: progress phases come in order ping > down > up');
  ok(!t.isRunning(), 'tester: not running afterwards');

  const t2 = S.createTester({ fetch: fakeFetch(), downMs: 3000, upMs: 3000 });
  const p = t2.run(); const again = await t2.run(); ok(again.busy === true, 'tester: a second start while running is refused');
  setTimeout(() => t2.cancel(), 400); const c = await p; ok(c.cancelled === true && !t2.isRunning(), 'tester: cancel stops the run cleanly');

  const t3 = S.createTester({ fetch: async () => { throw new Error('offline'); }, downMs: 500, upMs: 500 });
  const e3 = await t3.run(); ok(e3.error && /No internet/.test(e3.error), 'tester: offline gives a clear message');

  const t4 = S.createTester({ fetch: fakeFetch({ noDown: true }), downMs: 800, upMs: 500 });
  const e4 = await t4.run(); ok(e4.error && /download/i.test(e4.error), 'tester: blocked download server gives a clear message instead of hanging');

  console.log(f ? f + ' FAILED' : 'ALL PASSED'); process.exit(f ? 1 : 0);
})();
