/* Network speed: live throughput maths, a ping / download / upload test, history sanitising, version compare.
 * No Electron or DOM here so tests/speed.test.js can run it anywhere. The test needs a fetch function, injected by main.js
 * (Electron's net.fetch, which honours the system proxy). Servers: Cloudflare's public speed-test endpoints, with OVH as a
 * download fallback. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Speed = factory(); })(this, function () {
  const CF = 'https://speed.cloudflare.com';
  const DOWN_FALLBACK = 'https://proof.ovh.net/files/10Mb.dat';

  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const jitterOf = (a) => { if (a.length < 2) return 0; let t = 0; for (let i = 1; i < a.length; i++) t += Math.abs(a[i] - a[i - 1]); return t / (a.length - 1); };
  const mbps = (bytes, ms) => (ms > 0 ? (bytes * 8) / 1e6 / (ms / 1000) : 0);
  const round1 = (n) => Math.round(n * 10) / 10;

  /* Live rates from two byte counters ({t: ms, rx, tx}). A counter that went backwards (adapter reset) gives 0, never a negative speed. */
  function rate(prev, cur) {
    if (!prev || !cur) return { down: 0, up: 0 };
    const dt = (cur.t - prev.t) / 1000;
    if (!(dt > 0)) return { down: 0, up: 0 };
    const d = (cur.rx - prev.rx) / dt, u = (cur.tx - prev.tx) / dt;
    return { down: d > 0 ? d : 0, up: u > 0 ? u : 0 };   // bytes per second
  }
  /* bytes/s -> "12.3 Mb/s", "850 Kb/s" (network speeds are quoted in bits) */
  function fmtBits(bytesPerSec) {
    const b = Math.max(0, +bytesPerSec || 0) * 8;
    if (b >= 1e9) return (b / 1e9).toFixed(2) + ' Gb/s';
    if (b >= 1e6) return (b / 1e6).toFixed(b >= 1e8 ? 0 : 1) + ' Mb/s';
    if (b >= 1e3) return Math.round(b / 1e3) + ' Kb/s';
    return Math.round(b) + ' b/s';
  }
  /* A plain-words verdict from the three numbers */
  function grade(t) {
    if (!t || !(t.down > 0)) return 'No result';
    const d = t.down, u = t.up || 0, p = t.ping == null ? 0 : t.ping;
    if (d >= 100 && p < 40) return 'Excellent: fine for 4K streaming, video calls and big downloads';
    if (d >= 25 && p < 80) return 'Good: HD streaming and video calls work well';
    if (d >= 8) return 'Fair: browsing and SD/HD video are fine, big downloads are slow';
    if (d >= 2) return 'Slow: basic browsing and music only';
    return 'Very slow: check the signal or restart the router';
  }

  /* history: whole numbers only, newest first, at most 50 */
  const num = (v, max) => { v = +v; return Number.isFinite(v) && v >= 0 ? Math.min(max, round1(v)) : 0; };
  function sanitizeTest(o) {
    if (!o || typeof o !== 'object') return null;
    const t = Math.round(+o.t); if (!Number.isFinite(t) || t <= 0) return null;
    return { t, down: num(o.down, 100000), up: num(o.up, 100000), ping: num(o.ping, 60000), jitter: num(o.jitter, 60000), net: String(o.net || '').slice(0, 60), server: String(o.server || '').slice(0, 40) };
  }
  const sanitizeTests = (l) => (Array.isArray(l) ? l : []).map(sanitizeTest).filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 50);

  /* "1.4.0" vs "1.10.2": -1, 0, 1. Missing or odd parts count as 0. */
  function cmpVer(a, b) {
    const p = (v) => String(v || '0').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
    const x = p(a), y = p(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }

  /* The test itself. opts: { fetch, now, send(progress), downMs, upMs, streams } */
  function createTester(opts) {
    const fetchFn = opts.fetch, now = opts.now || Date.now, send = opts.send || (() => {});
    const DOWN_MS = opts.downMs || 8000, UP_MS = opts.upMs || 6000, STREAMS = opts.streams || 4;
    let ctl = null, running = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const aborted = () => !ctl || ctl.signal.aborted;

    async function ping() {
      const t = [];
      for (let i = 0; i < 9 && !aborted(); i++) {
        const t0 = now();
        try { const r = await fetchFn(CF + '/__down?bytes=0&r=' + now() + i, { cache: 'no-store', signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(4000)]) }); await r.arrayBuffer(); }
        catch { if (aborted()) break; continue; }
        if (i > 0) t.push(now() - t0);   // the first request also pays for DNS and TLS, so it is not counted
        send({ phase: 'ping', pct: Math.round(((i + 1) / 9) * 100), value: t.length ? median(t) : null });
        await sleep(60);
      }
      return t;
    }

    /* Several parallel streams read for a fixed time; the first second (TCP ramp-up) is left out of the average. */
    async function download() {
      const urls = [CF + '/__down?bytes=50000000', DOWN_FALLBACK];
      let total = 0, usedFallback = false;
      const t0 = now(); let lastT = t0, lastB = 0, warmB = null, warmT = 0;
      const sampler = setInterval(() => {
        const n = now(), inst = mbps(total - lastB, n - lastT); lastT = n; lastB = total;
        if (warmB == null && n - t0 >= 1000) { warmB = total; warmT = n; }
        send({ phase: 'down', pct: Math.min(100, Math.round(((n - t0) / DOWN_MS) * 100)), value: inst });
      }, 250);
      const stream = async (k) => {
        while (!aborted() && now() - t0 < DOWN_MS) {
          const url = usedFallback ? urls[1] : urls[0];
          try {
            const r = await fetchFn(url + (url.includes('?') ? '&' : '?') + 'r=' + now() + k, { cache: 'no-store', signal: ctl.signal });
            if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
            const rd = r.body.getReader();
            for (;;) { const { done, value } = await rd.read(); if (done) break; total += value.byteLength; if (aborted() || now() - t0 >= DOWN_MS) { try { await rd.cancel(); } catch {} break; } }
          } catch (e) { if (aborted()) return; if (!usedFallback && total === 0) usedFallback = true; else await sleep(150); }
        }
      };
      try { await Promise.all(Array.from({ length: STREAMS }, (_, k) => stream(k))); } finally { clearInterval(sampler); }
      const end = now();
      if (warmB != null && end - warmT > 1500) return mbps(total - warmB, end - warmT);
      return mbps(total, end - t0);
    }

    async function upload() {
      const chunk = new Uint8Array(1024 * 1024);   // 1 MB blocks so progress is smooth; content does not matter
      for (let i = 0; i < chunk.length; i += 4099) chunk[i] = (i * 31) & 255;
      let sent = 0;
      const t0 = now(); let lastT = t0, lastB = 0, warmB = null, warmT = 0;
      const sampler = setInterval(() => {
        const n = now(), inst = mbps(sent - lastB, n - lastT); lastT = n; lastB = sent;
        if (warmB == null && n - t0 >= 1000) { warmB = sent; warmT = n; }
        send({ phase: 'up', pct: Math.min(100, Math.round(((n - t0) / UP_MS) * 100)), value: inst });
      }, 250);
      const stream = async () => {
        while (!aborted() && now() - t0 < UP_MS) {
          try {
            const r = await fetchFn(CF + '/__up', { method: 'POST', body: chunk, cache: 'no-store', signal: ctl.signal, headers: { 'Content-Type': 'application/octet-stream' } });
            await r.arrayBuffer(); if (r.ok) sent += chunk.length;
          } catch { if (aborted()) return; await sleep(200); }
        }
      };
      try { await Promise.all(Array.from({ length: 3 }, stream)); } finally { clearInterval(sampler); }
      const end = now();
      if (warmB != null && end - warmT > 1500) return mbps(sent - warmB, end - warmT);
      return mbps(sent, end - t0);
    }

    async function trace() {   // which Cloudflare city served us (and the public IP)
      try {
        const r = await fetchFn(CF + '/cdn-cgi/trace', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        const kv = {}; (await r.text()).split('\n').forEach((l) => { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1).trim(); });
        return { colo: String(kv.colo || '').slice(0, 8), loc: String(kv.loc || '').slice(0, 4), ip: String(kv.ip || '').slice(0, 64) };
      } catch { return { colo: '', loc: '', ip: '' }; }
    }

    async function run() {
      if (running) return { busy: true };
      running = true; ctl = new AbortController();
      try {
        send({ phase: 'start', pct: 0 });
        const tr = await trace();
        const pings = await ping();
        if (aborted()) return { cancelled: true };
        if (!pings.length) return { error: 'No internet connection to the speed server. Check your network and try again.' };
        const res = { t: now(), ping: round1(median(pings)), jitter: round1(jitterOf(pings)), down: 0, up: 0, server: tr.colo ? tr.colo + (tr.loc ? ', ' + tr.loc : '') : 'Cloudflare', ip: tr.ip };
        res.down = round1(await download());
        if (aborted()) return { cancelled: true };
        if (res.down <= 0) return { error: 'The download test could not read any data. A firewall or proxy may be blocking speed.cloudflare.com.' };
        res.up = round1(await upload());
        if (aborted()) return { cancelled: true };
        send({ phase: 'done', pct: 100 });
        return { ok: true, result: res };
      } catch (e) { return aborted() ? { cancelled: true } : { error: 'Speed test failed: ' + ((e && e.message) || e) }; }
      finally { running = false; }
    }
    return { run, cancel: () => { try { ctl && ctl.abort(); } catch {} }, isRunning: () => running };
  }

  return { median, jitterOf, mbps, rate, fmtBits, grade, sanitizeTest, sanitizeTests, cmpVer, createTester };
});
