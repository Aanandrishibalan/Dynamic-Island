/* Small QR code encoder: byte mode, error-correction level M (about 15% damage tolerated), versions 1-20 (up to 666 bytes).
 * No dependencies, no network. matrix(text) returns { ok, size, rows } where rows is an array of strings of '0' / '1' (1 = dark module).
 * The island page draws the rows on a canvas. Verified against an independent decoder (see tests/qr.test.js notes). */
'use strict';

const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];   // level M, index = version
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const MAX_VERSION = 20, MAX_BYTES = 666;

function rawModules(v) {   // data + error-correction modules of a version, before dividing into bytes
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];

/* Reed-Solomon over GF(256) with the QR polynomial 0x11D */
function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
function rsDivisor(deg) {
  const res = new Array(deg).fill(0); res[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { res[j] = gfMul(res[j], root); if (j + 1 < deg) res[j] ^= res[j + 1]; } root = gfMul(root, 0x02); }
  return res;
}
function rsRemainder(data, div) {
  const res = new Array(div.length).fill(0);
  for (const b of data) { const f = b ^ res.shift(); res.push(0); div.forEach((c, i) => { res[i] ^= gfMul(c, f); }); }
  return res;
}

function utf8(text) { return Array.from(Buffer.from(String(text), 'utf8')); }

function makeCodewords(bytes, v) {
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v <= 9 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  const cap = dataCodewords(v) * 8;
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - (bits.length % 8)) % 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
  for (let pad = 0xec; data.length < dataCodewords(v); pad ^= 0xec ^ 0x11) data.push(pad);
  // split into blocks, add error correction, interleave
  const nb = NUM_BLOCKS[v], ecl = ECC_PER_BLOCK[v], raw = Math.floor(rawModules(v) / 8), shortBlocks = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const div = rsDivisor(ecl), blocks = []; let k = 0;
  for (let i = 0; i < nb; i++) {
    const len = shortLen - ecl + (i < shortBlocks ? 0 : 1), d = data.slice(k, k + len); k += len;
    const ec = rsRemainder(d, div); if (i < shortBlocks) d.push(0); blocks.push(d.concat(ec));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecl || j >= shortBlocks) out.push(b[i]); });
  return out;
}

function build(codewords, v, mask) {
  const size = v * 4 + 17, mod = [], fn = [];
  for (let i = 0; i < size; i++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // timing
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, Math.max(Math.abs(dx), Math.abs(dy)) !== 2 && Math.max(Math.abs(dx), Math.abs(dy)) !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (v >= 2) {   // alignment patterns
    const n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((px, i) => pos.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const fmtBits = (() => {   // format information: level M = 0b00, plus the mask number
    const data = (0 << 3) | mask; let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  })();
  const bit = (n, i) => ((n >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(fmtBits, i));
  set(8, 7, bit(fmtBits, 6)); set(8, 8, bit(fmtBits, 7)); set(7, 8, bit(fmtBits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(fmtBits, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(fmtBits, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(fmtBits, i));
  set(8, size - 8, true);   // the always-dark module
  if (v >= 7) {   // version information
    let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (v << 12) | rem;
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3), d = bit(bits, i); set(a, b, d); set(b, a, d); }
  }
  // place data (zig-zag), applying the mask
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (fn[y][x] || i >= codewords.length * 8) continue;
      mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++;
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (fn[y][x]) continue;
    const m = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
    if (m) mod[y][x] = !mod[y][x];
  }
  return mod;
}

function penalty(m) {   // the standard four penalty rules, used to pick the best of the 8 masks
  const n = m.length; let p = 0;
  const run = (line) => { let s = 0, c = 1; for (let i = 1; i <= n; i++) { if (i < n && line[i] === line[i - 1]) c++; else { if (c >= 5) s += 3 + c - 5; c = 1; } } return s; };
  for (let i = 0; i < n; i++) { p += run(m[i]); p += run(m.map((r) => r[i])); }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  const pat = [true, false, true, true, true, false, true, false, false, false, false], pat2 = pat.slice().reverse();
  const has = (a, q) => q.every((b, k) => a[k] === b);
  for (let i = 0; i < n; i++) { const col = m.map((r) => r[i]); for (let k = 0; k + 11 <= n; k++) { if (has(m[i].slice(k, k + 11), pat) || has(m[i].slice(k, k + 11), pat2)) p += 40; if (has(col.slice(k, k + 11), pat) || has(col.slice(k, k + 11), pat2)) p += 40; } }
  let dark = 0; m.forEach((r) => r.forEach((d) => { if (d) dark++; }));
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

function matrix(text) {
  if (typeof text !== 'string' || !text) return { ok: false, text: 'Type something to turn into a QR code.' };
  const bytes = utf8(text);
  if (bytes.length > MAX_BYTES) return { ok: false, text: 'That is too long for a QR code (about ' + MAX_BYTES + ' characters at most).' };
  let v = 1; while (v <= MAX_VERSION && bytes.length * 8 + 4 + (v <= 9 ? 8 : 16) > dataCodewords(v) * 8) v++;
  if (v > MAX_VERSION) return { ok: false, text: 'That is too long for a QR code.' };
  const cw = makeCodewords(bytes, v);
  let best = null, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) { const m = build(cw, v, mask), p = penalty(m); if (p < bestP) { bestP = p; best = m; } }
  return { ok: true, size: best.length, version: v, rows: best.map((r) => r.map((d) => (d ? '1' : '0')).join('')) };
}

module.exports = { matrix, MAX_BYTES };
