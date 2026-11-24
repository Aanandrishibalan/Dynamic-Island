const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const createTransfer = require('../dynamic-island/transfer.js');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const RISKY = /\.(exe|com|bat|cmd|ps1|vbs|js|msi|scr|lnk|dll|url)$/i;

// raw request helper (lets us send odd Host headers and paths that fetch would normalise)
const req = (port, method, p, { body, headers } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: '127.0.0.1:' + port, ...(headers || {}) } }, (rs) => { const c = []; rs.on('data', (d) => c.push(d)); rs.on('end', () => res({ status: rs.statusCode, headers: rs.headers, body: Buffer.concat(c) })); });
  r.on('error', rej); if (body) r.write(body); r.end();
});

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfer-')), recv = path.join(tmp, 'received'), src = path.join(tmp, 'src'); fs.mkdirSync(src);
  const bin = crypto.randomBytes(300000), fa = path.join(src, 'photo one.jpg'), fb = path.join(src, 'notes ü.txt');
  fs.writeFileSync(fa, bin); fs.writeFileSync(fb, 'hello');
  const events = [];
  const T = createTransfer({ receiveDir: () => recv, risky: RISKY, maxBytes: 1000000, onChange: (s) => events.push(s), ifaces: { 'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', internal: false }], 'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], 'Public': [{ family: 'IPv4', address: '8.8.8.8', internal: false }] } });

  ok(!T.state().running && T.state().urls.length === 0, 'off until started');
  const st = await T.start({ files: [fa, fb, path.join(src, 'missing.txt'), src], receive: true, minutes: 5 });
  ok(st.running && st.port > 0 && st.files.length === 2, 'started; missing files and folders are ignored');
  ok(st.urls[0].startsWith('http://192.168.1.20:' + st.port + '/') && st.urls.length === 2 && st.urls[1].includes('172.20.0.1') && !st.urls.join().includes('8.8.8.8'), 'link uses the real Wi-Fi address first, virtual adapter last, public address never');
  const token = st.urls[0].split('/')[3]; ok(/^[0-9a-f]{32}$/.test(token), '128-bit random token in the link');
  const P = st.port, base = '/' + token + '/';

  // ---- download side ----
  let r = await req(P, 'GET', base); ok(r.status === 200 && /text\/html/.test(r.headers['content-type']) && r.body.toString().includes('photo one.jpg') && r.body.toString().includes('notes ü.txt'), 'page lists the shared files');
  ok(/default-src 'none'/.test(r.headers['content-security-policy']) && r.headers['x-content-type-options'] === 'nosniff', 'page has a strict CSP');
  const id = st.files.find((x) => x.name === 'photo one.jpg').id;
  r = await req(P, 'GET', base + 'f/' + id); ok(r.status === 200 && Buffer.compare(r.body, bin) === 0 && /attachment/.test(r.headers['content-disposition']) && Number(r.headers['content-length']) === bin.length, 'download is byte-identical, sent as attachment');
  r = await req(P, 'GET', base + 'f/' + st.files.find((x) => x.name.startsWith('notes')).id); ok(r.status === 200 && r.body.toString() === 'hello' && /filename\*=UTF-8''notes%20%C3%BC\.txt/.test(r.headers['content-disposition']), 'unicode file name is encoded for the browser');
  r = await req(P, 'GET', base + 'f/doesnotexist'); ok(r.status === 404, 'unknown file id = 404');
  fs.unlinkSync(fb); r = await req(P, 'GET', base + 'f/' + st.files[1].id); ok(r.status === 404, 'a file deleted after sharing = 404, no crash');

  // ---- who may connect ----
  r = await req(P, 'GET', '/'); ok(r.status === 404 && r.body.length === 0, 'no token: 404, empty body');
  r = await req(P, 'GET', '/' + 'a'.repeat(32) + '/'); ok(r.status === 404, 'wrong token: 404');
  r = await req(P, 'GET', '/' + token.slice(0, 31) + '/'); ok(r.status === 404, 'truncated token: 404');
  r = await req(P, 'GET', '/' + token.toUpperCase() + '/'); ok(r.status === 404, 'token is case-sensitive');
  r = await req(P, 'GET', base, { headers: { Host: 'evil.example.com' } }); ok(r.status === 403, 'DNS-rebinding guard: Host must be an IP address');
  r = await req(P, 'GET', base + '..%2f..%2fetc%2fpasswd'); ok(r.status === 404, 'path tricks: 404');
  r = await req(P, 'POST', base); ok(r.status === 404, 'POST: 404'); r = await req(P, 'DELETE', base + 'f/' + id); ok(r.status === 404, 'DELETE: 404');
  ok(T.constructor && createTransfer.isLocalAddress('192.168.1.5') && createTransfer.isLocalAddress('10.0.0.1') && createTransfer.isLocalAddress('172.16.5.5') && createTransfer.isLocalAddress('172.31.255.1') && createTransfer.isLocalAddress('::ffff:192.168.0.9') && createTransfer.isLocalAddress('fe80::1') && createTransfer.isLocalAddress('fd12::1') && createTransfer.isLocalAddress('127.0.0.1') && createTransfer.isLocalAddress('::1'), 'local addresses accepted');
  ok(!createTransfer.isLocalAddress('8.8.8.8') && !createTransfer.isLocalAddress('172.32.0.1') && !createTransfer.isLocalAddress('172.15.0.1') && !createTransfer.isLocalAddress('100.64.0.1') && !createTransfer.isLocalAddress('2001:db8::1') && !createTransfer.isLocalAddress('') && !createTransfer.isLocalAddress(undefined) && !createTransfer.isLocalAddress('193.168.1.1') && !createTransfer.isLocalAddress('11.0.0.1'), 'internet / CGNAT / malformed addresses refused');

  // ---- upload side ----
  const up = (name, body, extra) => req(P, 'PUT', base + 'up?name=' + encodeURIComponent(name), { body, headers: { 'Content-Length': body.length, ...(extra || {}) } });
  r = await up('from phone.jpg', bin.subarray(0, 100000)); let j = JSON.parse(r.body); ok(r.status === 200 && j.ok && j.name === 'from phone.jpg' && Buffer.compare(fs.readFileSync(path.join(recv, 'from phone.jpg')), bin.subarray(0, 100000)) === 0, 'upload saved, content identical');
  r = await up('from phone.jpg', Buffer.from('second')); j = JSON.parse(r.body); ok(j.name === 'from phone (1).jpg' && fs.readFileSync(path.join(recv, 'from phone.jpg')).length === 100000, 'same name never overwrites: gets (1)');
  r = await up('..\\..\\evil.txt', Buffer.from('x')); j = JSON.parse(r.body); ok(r.status === 200 && j.name === 'evil.txt' && fs.existsSync(path.join(recv, 'evil.txt')) && !fs.existsSync(path.join(tmp, 'evil.txt')), 'path traversal in the name is flattened into the receive folder');
  r = await up('../../../x/y/z.txt', Buffer.from('x')); j = JSON.parse(r.body); ok(j.name === 'z.txt', 'forward-slash traversal flattened');
  r = await up('C:\\Windows\\win.ini', Buffer.from('x')); j = JSON.parse(r.body); ok(j.name === 'win.ini', 'drive path flattened');
  r = await up('CON.txt', Buffer.from('x')); j = JSON.parse(r.body); ok(j.name === '_CON.txt', 'reserved Windows device name is prefixed');
  r = await up('bad<>:"|?*name.txt', Buffer.from('x')); j = JSON.parse(r.body); ok(!/[<>:"|?*]/.test(j.name), 'characters Windows rejects are replaced');
  r = await up('setup.exe', Buffer.from('MZ')); ok(r.status === 415 && !fs.existsSync(path.join(recv, 'setup.exe')), 'programs refused (.exe)');
  for (const bad of ['run.BAT', 'x.ps1', 'x.vbs', 'x.js', 'x.lnk', 'photo.jpg.exe', 'x.exe.']) { r = await up(bad, Buffer.from('x')); ok(r.status === 415 || (bad.endsWith('.') && r.status === 415), 'refused: ' + bad); }
  r = await up('doc.pdf', Buffer.alloc(1000001)); ok(r.status === 413 && !fs.existsSync(path.join(recv, 'doc.pdf')), 'over the size cap (declared length) refused before writing');
  r = await req(P, 'PUT', base + 'up?name=x.txt', { body: Buffer.from('abc') }); ok(r.status === 411 || r.status === 200, 'no content-length handled');
  r = await req(P, 'PUT', base + 'up?name=%E0%A4%A', { body: Buffer.from('a'), headers: { 'Content-Length': 1 } }); ok(r.status === 400, 'malformed URL escape = 400, no crash');
  // lying client: declares 5 bytes, sends 50
  r = await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: P, method: 'PUT', path: base + 'up?name=liar.txt', headers: { Host: '127.0.0.1:' + P, 'Content-Length': 5 } }, (rs) => { rs.resume(); rs.on('end', () => res({ status: rs.statusCode })); }); q.on('error', () => res({ status: 0 })); q.write(Buffer.alloc(50, 65)); q.end(); });
  await new Promise((r2) => setTimeout(r2, 150)); ok(!fs.existsSync(path.join(recv, 'liar.txt')) || fs.statSync(path.join(recv, 'liar.txt')).size <= 5, 'client that sends more than it declared does not get a bigger file');
  // client that disconnects half-way: partial file removed
  await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: P, method: 'PUT', path: base + 'up?name=half.bin', headers: { Host: '127.0.0.1:' + P, 'Content-Length': 100000 } }); q.on('error', () => {}); q.write(Buffer.alloc(1000)); setTimeout(() => { q.destroy(); setTimeout(res, 250); }, 100); });
  ok(!fs.existsSync(path.join(recv, 'half.bin')), 'an interrupted upload leaves no partial file behind');
  ok(T.state().received.length >= 6 && events.some((e) => e.received.length), 'received list updates and notifies');
  ok(fs.readdirSync(recv).every((n) => !/\.(exe|bat)$/i.test(n)), 'nothing dangerous in the receive folder');

  // ---- receive switched off ----
  await T.start({ files: [fa], receive: false, minutes: 5 });
  r = await up('no.txt', Buffer.from('x')); ok(r.status === 403 && !fs.existsSync(path.join(recv, 'no.txt')), 'receiving switched off = 403'); r = await req(P, 'GET', base); ok(/Receiving files is switched off/.test(r.body.toString()), 'page says so');
  ok(T.state().port === P && T.state().urls[0].includes(token), 'start again keeps the same link while running');

  // ---- stop ----
  T.stop(); ok(!T.state().running && T.state().urls.length === 0, 'stop clears everything');
  r = await req(P, 'GET', base).catch((e) => ({ status: 'refused' })); ok(r.status === 'refused', 'port is closed after stop');
  const s2 = await T.start({ files: [fa] }); ok(s2.urls[0].split('/')[3] !== token, 'a new session gets a new token'); T.stop();

  // ---- idle timeout ----
  const T2 = createTransfer({ receiveDir: () => recv, risky: RISKY, idleMs: 300 }); const s3 = await T2.start({ files: [fa] });
  await new Promise((r2) => setTimeout(r2, 150)); await req(s3.port, 'GET', '/' + s3.urls[0].split('/')[3] + '/'); await new Promise((r2) => setTimeout(r2, 200)); ok(T2.state().running, 'activity keeps the session alive');
  await new Promise((r2) => setTimeout(r2, 450)); ok(!T2.state().running, 'stops by itself after the idle time');

  // ---- helpers ----
  const sn = createTransfer.safeName;
  ok(sn('') === 'file' && sn('..') === 'file' && sn('.') === 'file' && sn(null) === 'file' && sn('a/b/c.txt') === 'c.txt' && sn('name. . ') === 'name' && sn('x'.repeat(300) + '.pdf').length <= 150 && sn('x'.repeat(300) + '.pdf').endsWith('.pdf'), 'safeName edge cases');
  fs.writeFileSync(path.join(recv, 'dup.txt'), '1'); fs.writeFileSync(path.join(recv, 'dup (1).txt'), '1'); ok(createTransfer.uniqueName(recv, 'dup.txt') === 'dup (2).txt', 'uniqueName counts up');
  ok(createTransfer.lanAddresses({ 'Ethernet': [{ family: 4, address: '10.1.1.9', internal: false }] })[0] === '10.1.1.9', 'old Node numeric family handled');
  ok(createTransfer.lanAddresses({}).length === 0, 'no network = no addresses');
  const T3 = createTransfer({ receiveDir: () => recv, ifaces: {} }); const s4 = await T3.start({}); ok(s4.noNetwork && s4.urls[0].startsWith('http://127.0.0.1:'), 'no network is reported'); T3.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(f ? '\n' + f + ' TRANSFER TEST(S) FAILED' : '\nTRANSFER TESTS PASSED'); process.exit(f ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
