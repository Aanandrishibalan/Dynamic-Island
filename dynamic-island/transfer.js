/* Quick File Transfer: a short-lived web page on the local network.
 *  - A phone / tablet / other PC opens the link (or scans the QR code), downloads the files you chose and can send files back.
 *  - Off until you press Start. Stops by itself after a period of no activity, and when the island quits.
 *  - The link contains a random 128-bit token; every other URL answers 404. Only private-network addresses may connect
 *    (a router that forwards the port from the internet gets 403), and the Host header must be an IP address (DNS-rebinding guard).
 *  - Received files go to one folder, never overwrite anything, and programs / scripts are refused.
 *  - Plain HTTP: anyone on the same network who can see the link could read it, so use it on networks you trust. */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_FILES = 200, KEEP_RECEIVED = 50;

/** A file name that is safe to create: no path parts, no characters Windows rejects, no reserved names. */
function safeName(n) {
  n = String(n == null ? '' : n).replace(/[\\/]+/g, '/').split('/').pop();
  n = n.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').replace(/^\s+/, '');
  if (!n || n === '.' || n === '..') n = 'file';
  if (RESERVED.test(n.split('.')[0])) n = '_' + n;
  if (n.length > 150) { const ext = path.extname(n).slice(0, 20); n = n.slice(0, 150 - ext.length) + ext; }
  return n;
}
function uniqueName(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  for (let i = 0; i < 1000; i++) { const cand = i ? `${base} (${i})${ext}` : name; if (!fs.existsSync(path.join(dir, cand))) return cand; }
  return `${base} (${Date.now()})${ext}`;
}
/** Only machines on the local network (private IPv4, link-local, loopback, IPv6 unique-local / link-local). */
function isLocalAddress(a) {
  a = String(a || '').replace(/^::ffff:/i, '').toLowerCase();
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (m) { const [x, y] = [+m[1], +m[2]]; return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254); }
  return a === '::1' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}
const HOST_OK = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|localhost)(?::\d{1,5})?$/i;
const rfc5987 = (s) => encodeURIComponent(s).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');

/** Private IPv4 addresses of this PC, real Wi-Fi / Ethernet adapters first (virtual adapters such as WSL / Hyper-V / VPN last). */
function lanAddresses(ifaces) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || os.networkInterfaces())) {
    for (const i of list || []) {
      if ((i.family !== 'IPv4' && i.family !== 4) || i.internal || !isLocalAddress(i.address) || /^127\./.test(i.address)) continue;
      const virtual = /vethernet|virtual|vmware|vbox|wsl|hyper-v|docker|loopback|bluetooth|tailscale|zerotier|vpn|tap|tun/i.test(name);
      const real = /wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d/i.test(name);
      out.push({ ip: i.address, name, rank: virtual ? 2 : real ? 0 : 1 });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.ip);
}

function page(token, files, receive, minutes) {
  const list = files.length
    ? '<h2>Download</h2><ul>' + files.map((f) => `<li><a href="f/${f.id}" download>${esc(f.name)}</a> <small>${fmt(f.size)}</small></li>`).join('') + '</ul>'
    : '<p class="dim">No files are being shared from the PC right now.</p>';
  const up = receive
    ? '<h2>Send to the PC</h2><input id="f" type="file" multiple><button id="go">Send</button><div id="out"></div>'
    : '<p class="dim">Receiving files is switched off.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dynamic Island transfer</title>
<style>body{font:16px system-ui,sans-serif;margin:0;padding:18px;background:#111;color:#f5f5f7;max-width:560px;margin:auto}h1{font-size:20px}h2{font-size:15px;color:#8e8e93;margin:22px 0 8px}ul{list-style:none;padding:0;margin:0}li{background:#1c1c1e;border-radius:12px;padding:12px 14px;margin:6px 0;word-break:break-all}a{color:#4aa3ff;text-decoration:none}small,.dim{color:#8e8e93}input[type=file]{width:100%;margin:6px 0}button{background:#0a84ff;color:#fff;border:0;border-radius:999px;padding:11px 22px;font-size:16px}.bar{height:6px;background:#2c2c2e;border-radius:3px;margin-top:6px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#30d158}.row{background:#1c1c1e;border-radius:12px;padding:10px 14px;margin:6px 0;font-size:14px;word-break:break-all}.bad{color:#ff453a}</style></head>
<body><h1>Dynamic Island · File transfer</h1>${list}${up}<p class="dim" style="margin-top:28px;font-size:13px">This page closes by itself after ${minutes} minutes without activity.</p>
<script>var go=document.getElementById('go');if(go)go.onclick=function(){var fs=document.getElementById('f').files,out=document.getElementById('out');if(!fs.length)return;go.disabled=true;
Array.prototype.forEach.call(fs,function(f){var row=document.createElement('div');row.className='row';row.textContent=f.name;var bar=document.createElement('div');bar.className='bar';var i=document.createElement('i');bar.appendChild(i);row.appendChild(bar);out.appendChild(row);
var x=new XMLHttpRequest();x.open('PUT','up?name='+encodeURIComponent(f.name));x.upload.onprogress=function(e){if(e.lengthComputable)i.style.width=(100*e.loaded/e.total)+'%'};
x.onload=function(){var r={};try{r=JSON.parse(x.responseText)}catch(e){}if(x.status===200){i.style.width='100%';row.appendChild(document.createTextNode(' ✓ sent'))}else{row.className+=' bad';row.appendChild(document.createTextNode(' ✕ '+(r.text||'failed')))}go.disabled=false};
x.onerror=function(){row.className+=' bad';row.appendChild(document.createTextNode(' ✕ connection lost'));go.disabled=false};x.send(f)})};</script></body></html>`;
}

function createTransfer(opts) {
  opts = opts || {};
  const maxBytes = opts.maxBytes || 2 * 1024 * 1024 * 1024, risky = opts.risky || /\.(exe|bat|cmd|ps1|vbs|js|msi|scr|lnk|dll)$/i;
  let server = null, token = '', port = 0, files = [], received = [], receive = true, minutes = 10, timer = null, expiresAt = 0, uploads = 0;
  const idleMs = () => opts.idleMs || minutes * 60000;
  const changed = () => { try { opts.onChange && opts.onChange(state()); } catch {} };

  function bump() { expiresAt = Date.now() + idleMs(); clearTimeout(timer); timer = setTimeout(() => { if (uploads > 0) bump(); else stop(); }, idleMs()); }
  function state() {
    const ips = lanAddresses(opts.ifaces);
    return { running: !!server, port, receive, minutes, expiresAt, files: files.map((f) => ({ id: f.id, name: f.name, size: f.size })), received: received.slice(),
      urls: server ? (ips.length ? ips : ['127.0.0.1']).map((ip) => `http://${ip}:${port}/${token}/`) : [], noNetwork: !!server && !ips.length };
  }
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const end = (res, code, body, headers) => { res.writeHead(code, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(headers || {}) }); res.end(body); };
  const json = (res, code, o) => end(res, code, JSON.stringify(o), { 'Content-Type': 'application/json' });

  function handle(req, res) {
    if (!isLocalAddress(req.socket.remoteAddress)) return end(res, 403, '');
    if (!HOST_OK.test(String(req.headers.host || ''))) return end(res, 403, '');
    let u; try { u = new URL(req.url, 'http://x'); } catch { return end(res, 400, ''); }
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length || !same(parts[0], token)) return end(res, 404, '');
    bump();
    const route = parts[1] || '';
    if (req.method === 'GET' && !route) return end(res, 200, page(token, files, receive, minutes), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'", 'Referrer-Policy': 'no-referrer' });
    if (req.method === 'GET' && route === 'f' && parts[2]) {
      const f = files.find((x) => x.id === parts[2]);
      if (!f) return end(res, 404, '');
      let st; try { st = fs.statSync(f.path); if (!st.isFile()) throw 0; } catch { return end(res, 404, ''); }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${f.name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${rfc5987(f.name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      const rs = fs.createReadStream(f.path); rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy()); rs.pipe(res); return;
    }
    if (req.method === 'PUT' && route === 'up' && parts.length === 2) return receiveFile(req, res, u);
    return end(res, 404, '');
  }

  function receiveFile(req, res, u) {
    if (!receive) return json(res, 403, { ok: false, text: 'Receiving is switched off' });
    let name; try { name = safeName(decodeURIComponent(u.searchParams.get('name') || '')); } catch { return json(res, 400, { ok: false, text: 'Bad file name' }); }
    if (risky.test(name)) return json(res, 415, { ok: false, text: 'Programs and scripts are not accepted' });
    const len = Number(req.headers['content-length']);
    if (!Number.isFinite(len) || len < 0) return json(res, 411, { ok: false, text: 'Length required' });
    if (len > maxBytes) return json(res, 413, { ok: false, text: 'File is larger than ' + fmt(maxBytes) });
    let dir; try { dir = opts.receiveDir(); fs.mkdirSync(dir, { recursive: true }); } catch { return json(res, 500, { ok: false, text: 'Cannot create the receive folder' }); }
    let target = null, fd = null;
    for (let i = 0; i < 50 && fd === null; i++) {   // 'wx' = never overwrite, even if two uploads race for one name
      const cand = path.join(dir, uniqueName(dir, name));
      try { fd = fs.openSync(cand, 'wx'); target = cand; } catch (e) { if (e.code !== 'EEXIST') return json(res, 500, { ok: false, text: 'Cannot write the file' }); }
    }
    if (fd === null) return json(res, 500, { ok: false, text: 'Cannot write the file' });
    const ws = fs.createWriteStream(target, { fd, autoClose: true });
    let got = 0, dead = false;
    uploads++;
    const fail = (code, text) => { if (dead) return; dead = true; uploads--; try { ws.destroy(); } catch {} setTimeout(() => { try { fs.unlinkSync(target); } catch {} }, 30); if (!res.headersSent) json(res, code, { ok: false, text }); try { req.destroy(); } catch {} };
    req.on('data', (c) => { got += c.length; if (got > len || got > maxBytes) fail(413, 'Too much data'); });
    req.on('aborted', () => fail(400, 'Upload cancelled'));
    req.on('error', () => fail(400, 'Upload failed'));
    ws.on('error', () => fail(500, 'Cannot write the file'));
    ws.on('finish', () => {
      if (dead) return; dead = true; uploads--;
      if (got !== len) { try { fs.unlinkSync(target); } catch {} return json(res, 400, { ok: false, text: 'Upload incomplete' }); }
      received.unshift({ name: path.basename(target), size: got, t: Date.now() }); received = received.slice(0, KEEP_RECEIVED);
      json(res, 200, { ok: true, name: path.basename(target), size: got }); changed();
    });
    req.pipe(ws);
  }

  async function start(o) {
    o = o || {};
    minutes = Math.max(1, Math.min(120, Math.round(Number(o.minutes) || minutes)));
    receive = o.receive !== false;
    const picked = [];
    for (const p of (Array.isArray(o.files) ? o.files : []).slice(0, MAX_FILES)) {
      try { const st = fs.statSync(p); if (st.isFile()) picked.push({ id: crypto.randomBytes(6).toString('hex'), name: safeName(path.basename(p)), size: st.size, path: p }); } catch {}
    }
    files = picked;
    if (!server) {
      token = crypto.randomBytes(16).toString('hex'); received = [];
      server = http.createServer(handle);
      server.on('clientError', (_e, sock) => { try { sock.destroy(); } catch {} });
      server.requestTimeout = 0;   // large uploads on slow Wi-Fi must not be cut off; the idle timer and the size cap are the limits
      await new Promise((res, rej) => { server.once('error', rej); server.listen(Number(opts.port) || 0, opts.host || '0.0.0.0', () => { port = server.address().port; res(); }); }).catch((e) => { server = null; throw e; });
    }
    bump(); changed(); return state();
  }
  function stop() {
    clearTimeout(timer); timer = null;
    if (server) { const s = server; server = null; try { s.close(); s.closeAllConnections && s.closeAllConnections(); } catch {} }
    files = []; port = 0; token = ''; changed(); return state();
  }
  return { start, stop, state };
}
module.exports = createTransfer; module.exports.safeName = safeName; module.exports.isLocalAddress = isLocalAddress; module.exports.lanAddresses = lanAddresses; module.exports.uniqueName = uniqueName;
