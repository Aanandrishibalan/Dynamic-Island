/* Headless UI check for the Network speed slide and the slide-stuck fix. Run: node tests/ui.speed.js [screenshot-dir]  (needs Playwright + Chromium) */
const path = require('path');
const { chromium } = require('playwright');
const out = process.argv[2] || null;
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => {
    const db = { settings: { theme: 'dark', accent: '#0a84ff', clock24: true, currency: '₹', hiddenSlides: [], slideOrder: [], homeButtons: null, homeHide: [] }, conversations: [], tasks: [], events: [], notes: ['', '', ''], habits: [], goals: [], journal: [], expenses: [], memory: [], meetings: [], snippets: [], layouts: [], folders: [], favApps: [], calcHistory: [],
      speedTests: [{ t: Date.now() - 3600e3, down: 87.4, up: 21.3, ping: 18, jitter: 2.1, net: 'Wi-Fi · Home' }, { t: Date.now() - 86400e3, down: 12.5, up: 4.2, ping: 61, jitter: 9, net: 'Wi-Fi · Home' }] };
    window.__db = db; window.__speedCb = null; window.__live = 0;
    const mk = (path) => new Proxy(function () {}, {
      get: (_t, k) => { if (k === 'then') return undefined; const p = path + '.' + String(k); return mk(p); },
      apply: (_t, _this, a) => {
        if (path === 'island.getData' || path === 'island.setData' || path === 'island.setSettings') return Promise.resolve(JSON.parse(JSON.stringify(db)));
        if (path === 'island.onSpeed') { window.__speedCb = a[0]; return; }
        if (path === 'island.speed.live') { window.__live++; return Promise.resolve({ down: 1250000 * (1 + window.__live % 3), up: 250000, name: 'Wi-Fi', type: 'Wi-Fi', link: 866, ip: '192.168.1.20' }); }
        if (path === 'island.speed.start') return new Promise((res) => { window.__speedDone = res; });
        if (path === 'island.speed.clear') { db.speedTests = []; return Promise.resolve(JSON.parse(JSON.stringify(db))); }
        if (/^island\.on[A-Z]/.test(path)) return;
        if (path === 'island.net.radios') return Promise.resolve({ wifi: true, bluetooth: false });
        if (path === 'island.net.online') return Promise.resolve(true);
        if (path === 'island.media') return Promise.resolve('Stopped|||');
        if (path === 'island.sys.get') return Promise.resolve({ vol: 50, mute: 0, bri: 80 });
        return Promise.resolve(null);
      } });
    window.island = mk('island');
  });
  await pg.goto('file://' + path.resolve(__dirname, '../dynamic-island/index.html'));
  await pg.waitForTimeout(400);
  // open the island panel, go to the speed slide through its dot
  await pg.evaluate(() => document.getElementById('island').classList.add('open'));
  const dots = await pg.$$eval('#dots button', (b) => b.map((x) => x.dataset.go));
  ok(dots.includes('speed') && dots.indexOf('speed') === dots.indexOf('connect') + 1, 'Network speed slide is registered right after Wi-Fi & Bluetooth: ' + dots.slice(9, 14).join(','));
  await pg.click('#dots button[data-go="speed"]'); await pg.waitForTimeout(900);
  const pos = await pg.evaluate(() => { const t = document.getElementById('track'), sl = [...t.children].filter((x) => !x.hidden), i = sl.findIndex((x) => x.querySelector('#spGo')); return { i, tx: getComputedStyle(t).transform, w: t.getBoundingClientRect().width, left: sl[i].getBoundingClientRect().left, pl: document.querySelector('.v-panel').getBoundingClientRect().left }; });
  ok(pos.i > 0 && Math.abs(pos.left - pos.pl) < 1, 'speed slide sits exactly in the panel (offset ' + (pos.left - pos.pl).toFixed(2) + 'px)');
  await pg.waitForTimeout(2300);
  const live = await pg.evaluate(() => ({ dn: document.getElementById('spDn').textContent, up: document.getElementById('spUp').textContent, pts: document.getElementById('spLD').getAttribute('points').split(' ').length, info: document.getElementById('spInfo').textContent, hist: document.querySelectorAll('#spHist .sph').length, sub: document.getElementById('spSub').textContent }));
  ok(/Mb\/s/.test(live.dn) && /Kb\/s|Mb\/s/.test(live.up) && live.pts >= 2, 'live speed updates and the graph grows: ' + live.dn + ' / ' + live.up + ', ' + live.pts + ' points');
  ok(/Wi-Fi/.test(live.info) && /866 Mb\/s/.test(live.info) && /192\.168\.1\.20/.test(live.info), 'connection info shows network, link speed and local IP');
  ok(live.hist === 2, 'history lists the 2 saved tests');
  // run a test with fake progress events
  await pg.click('#spGo'); await pg.waitForTimeout(100);
  await pg.evaluate(() => { const c = window.__speedCb; c({ phase: 'ping', pct: 50, value: 22 }); });
  let st = await pg.evaluate(() => ({ n: document.getElementById('spNum').textContent, u: document.getElementById('spUnit').textContent, p: document.getElementById('spPhase').textContent, b: document.getElementById('spGo').textContent }));
  ok(st.u === 'ms' && st.n === '22' && /latency/.test(st.p) && st.b === 'Stop', 'ping phase shows ms and a Stop button');
  await pg.evaluate(() => { const c = window.__speedCb; for (let i = 0; i < 6; i++) c({ phase: 'down', pct: 10 + i * 15, value: 80 + i }); });
  st = await pg.evaluate(() => ({ n: +document.getElementById('spNum').textContent, u: document.getElementById('spUnit').textContent, bar: document.getElementById('spBar').style.width }));
  ok(st.u === 'Mb/s' && st.n > 40 && parseInt(st.bar) > 15, 'download phase shows Mb/s and the bar moves (' + st.n + ' Mb/s, bar ' + st.bar + ')');
  if (out) await pg.screenshot({ path: path.join(out, 'speed-running.png') });
  await pg.evaluate(() => window.__speedDone({ ok: true, result: { t: Date.now(), ping: 21.4, jitter: 3.2, down: 93.7, up: 24.1, server: 'MAA, IN', ip: '203.0.113.9' } }));
  await pg.waitForTimeout(200);
  st = await pg.evaluate(() => ({ res: document.getElementById('spRes').textContent, g: document.getElementById('spGrade').textContent, go: document.getElementById('spGo').textContent, info: document.getElementById('spInfo').textContent, n: document.getElementById('spNum').textContent }));
  ok(/93\.7/.test(st.res) && /24\.1/.test(st.res) && /21\.4/.test(st.res) && st.go === 'Start speed test' && /Good|Excellent/.test(st.g) && /MAA/.test(st.info) && st.n === '93.7', 'finished test shows ping, jitter, download, upload, verdict and server');
  // the slide itself scrolls vertically
  const sc = await pg.evaluate(() => { const s = document.getElementById('spGo').closest('.slide'); const r = { can: s.scrollHeight > s.clientHeight, oy: getComputedStyle(s).overflowY }; s.scrollTop = 9999; r.moved = s.scrollTop > 0; return r; });
  ok(sc.can && sc.oy === 'auto' && sc.moved, 'the slide scrolls vertically (' + sc.oy + ')');
  if (out) { await pg.evaluate(() => { document.getElementById('spGo').closest('.slide').scrollTop = 0; }); await pg.screenshot({ path: path.join(out, 'speed-top.png') }); await pg.evaluate(() => { document.getElementById('spGo').closest('.slide').scrollTop = 9999; }); await pg.screenshot({ path: path.join(out, 'speed-bottom.png') }); }
  await pg.click('#spClr'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => /No tests yet/.test(document.getElementById('spHist').textContent)), 'Clear empties the history');

  // ---- stuck between two slides: force the panel / slides to scroll sideways, as focus or a drag does
  await pg.click('#dots button[data-go="connect"]'); await pg.waitForTimeout(900);
  const before = await pg.evaluate(() => { const p = document.querySelector('.v-panel'); return { ov: getComputedStyle(p).overflowX, sl: p.scrollLeft }; });
  await pg.evaluate(() => { const p = document.querySelector('.v-panel'); p.scrollLeft = 12; const i = document.getElementById('island'); i.scrollLeft = 9; document.querySelector('.slide:not([hidden])').scrollLeft = 7; });
  await pg.waitForTimeout(250);
  const after = await pg.evaluate(() => { const p = document.querySelector('.v-panel'), i = document.getElementById('island'); const sl = [...document.querySelectorAll('.slide')].map((s) => s.scrollLeft); return { p: p.scrollLeft, i: i.scrollLeft, sl: Math.max(...sl), ov: getComputedStyle(p).overflowX }; });
  ok(after.p === 0 && after.i === 0 && after.sl === 0, 'panel, island and slides cannot stay scrolled sideways (overflow: ' + after.ov + ')');
  // focus an input on a hidden neighbouring slide: must not drag the track half-way
  await pg.evaluate(() => { const i = document.querySelector('#url'); if (i) i.focus({ preventScroll: false }); });
  await pg.waitForTimeout(250);
  const off = await pg.evaluate(() => { const sl = [...document.querySelectorAll('#track .slide')].filter((x) => !x.hidden); const p = document.querySelector('.v-panel').getBoundingClientRect(); return Math.min(...sl.map((s) => Math.abs(s.getBoundingClientRect().left - p.left))) });
  ok(off < 1, 'after focusing an input on another slide, the visible slide is still exactly aligned (offset ' + off.toFixed(2) + 'px)');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await br.close(); console.log(f ? f + ' FAILED' : 'UI OK'); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
