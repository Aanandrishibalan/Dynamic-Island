const QR = require('../dynamic-island/qr.js');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const grid = (t) => QR.matrix(t).rows.map((r) => r.split('').map((c) => c === '1'));
// format information: 15 bits, BCH(15,5) with mask 0x5412, level M = 00
const bch = (d) => { let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((d << 10) | r) ^ 0x5412; };
const fmtOf = (g) => { let v = 0; const n = g.length, pos = []; for (let i = 0; i <= 5; i++) pos.push([8, i]); pos.push([8, 7], [8, 8], [7, 8]); for (let i = 9; i < 15; i++) pos.push([14 - i, 8]); pos.forEach(([x, y], i) => { if (g[y][x]) v |= 1 << i; }); return v; };
ok(QR.matrix('').ok === false && QR.matrix(null).ok === false, 'empty / non-text refused');
ok(QR.matrix('x'.repeat(QR.MAX_BYTES + 1)).ok === false && QR.matrix('x'.repeat(QR.MAX_BYTES)).ok === true, 'size limit: 666 bytes accepted, 667 refused');
ok(QR.matrix('\u0b95'.repeat(300)).ok === false, 'limit counts UTF-8 bytes, not characters');
const sizes = [[1, 14], [2, 26], [3, 42], [5, 84], [10, 213], [20, 666]];
for (const [v, n] of sizes) { const m = QR.matrix('a'.repeat(n)); ok(m.ok && m.version === v && m.size === 4 * v + 17 && m.rows.length === m.size && m.rows.every((r) => r.length === m.size && /^[01]+$/.test(r)), 'version ' + v + ' at ' + n + ' bytes has the right size'); }
for (const t of ['hello', 'https://example.com/a?b=1', 'WIFI:T:WPA;S:Home;P:secret;;', 'தமிழ்']) {
  const g = grid(t), n = g.length, m = QR.matrix(t);
  const finder = (cx, cy) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); if (g[cy + dy][cx + dx] !== (d !== 2)) return false; } return true; };
  ok(finder(3, 3) && finder(n - 4, 3) && finder(3, n - 4), 'finder patterns: ' + t.slice(0, 12));
  ok(g[n - 8][8] === true, 'dark module present');
  let timing = true; for (let i = 8; i < n - 8; i++) if (g[6][i] !== (i % 2 === 0) || g[i][6] !== (i % 2 === 0)) timing = false; ok(timing, 'timing patterns');
  const fv = fmtOf(g), mask = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => bch(k) === fv); ok(mask !== undefined, 'format information is a valid BCH codeword (mask ' + mask + ')');
  ok(JSON.stringify(QR.matrix(t).rows) === JSON.stringify(m.rows), 'deterministic');
}
console.log(f ? '\n' + f + ' QR TEST(S) FAILED' : '\nQR TESTS PASSED'); process.exit(f ? 1 : 0);
