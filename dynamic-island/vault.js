/* Encrypted vault for API keys and the Gmail app password.
 *
 * All secrets live in ONE file (vault.dat) as a JSON object encrypted with AES-256-GCM (fresh random IV on every save,
 * authentication tag checked on every open, so a modified file is rejected rather than decrypted).
 * The 32-byte vault key itself is protected in one of two ways:
 *   device     - wrapped by Windows DPAPI (Electron safeStorage): bound to this Windows account, opens automatically.
 *   passphrase - wrapped (AES-256-GCM) by a key derived from the user's passphrase with scrypt (N=65536, r=8, p=1).
 *                Nothing on disk can open it without the passphrase, it works on any PC (portable use), and it can
 *                be locked again (manually, on idle, on Windows lock/sleep).
 * The windows of the app never receive a secret: only status() is sent to them.
 */
const crypto = require('crypto');
const fs = require('fs'), path = require('path');

const KDF = { N: 65536, r: 8, p: 1, keylen: 32, maxmem: 160 * 1024 * 1024 };
const AAD = Buffer.from('dynamic-island-vault-v1');
const COMMON = ['password', 'password1', 'passw0rd', '1234567890', '12345678910', 'qwertyuiop', '1q2w3e4r5t', 'iloveyou123',
  'letmein1234', 'administrator', 'welcome1234', '0123456789'];
const b64 = (b) => Buffer.from(b).toString('base64'), unb64 = (s) => Buffer.from(String(s), 'base64');

const passKey = (pass, salt, k = KDF) => new Promise((res, rej) =>
  crypto.scrypt(String(pass).normalize('NFKC'), salt, KDF.keylen, { N: k.N, r: k.r, p: k.p, maxmem: KDF.maxmem }, (e, key) => (e ? rej(e) : res(key))));

function seal(key, plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(AAD);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) };
}
function open(key, o) {   // throws if the key is wrong or the data was modified
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64(o.iv));
  d.setAAD(AAD); d.setAuthTag(unb64(o.tag));
  return Buffer.concat([d.update(unb64(o.ct)), d.final()]);
}

function checkPassphrase(p) {   // '' = fine, otherwise the reason (settings.html repeats these rules for live feedback)
  p = String(p || '');
  if (p.length < 10) return 'Use at least 10 characters.';
  if (COMMON.includes(p.toLowerCase())) return 'That passphrase is too common.';
  if (/^(.)\1+$/.test(p)) return 'Do not repeat one character.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (p.length < 16 && classes < 3) return 'Mix upper and lower case letters, numbers or symbols, or make it 16+ characters (a few words works well).';
  return '';
}

function createVault({ dir, safeStorage }) {
  const file = () => path.join(dir, 'vault.dat');
  const dpapi = () => { try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; } };
  let rec = null;            // the file as last read/written
  let key = null;            // vault key while unlocked
  let secrets = {};          // decrypted secrets while unlocked
  let error = '';
  let autoLockMin = 30, idleT = null, listeners = [];
  let fails = 0, blockedUntil = 0;

  const emit = () => { const s = status(); listeners.forEach((f) => { try { f(s); } catch {} }); };
  const mode = () => (rec ? rec.mode : 'none');
  const unlocked = () => !!key;
  const canStore = () => !!key && !error;

  function armIdle() {
    clearTimeout(idleT); idleT = null;
    if (key && mode() === 'passphrase' && autoLockMin > 0) { idleT = setTimeout(() => lock(), autoLockMin * 60000); if (idleT.unref) idleT.unref(); }
  }
  function forget() { if (key) key.fill(0); key = null; secrets = {}; clearTimeout(idleT); idleT = null; }
  function lock() { if (mode() !== 'passphrase' || !key) return false; forget(); emit(); return true; }

  function persist() {
    fs.mkdirSync(dir, { recursive: true });
    const out = { v: 1, mode: rec.mode, wrap: rec.wrap, data: seal(key, Buffer.from(JSON.stringify(secrets), 'utf8')) };
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, file());
    rec.data = out.data;   // keep the in-memory copy current so lock -> unlock works without a restart
  }
  function shred(f) {
    try { const n = fs.statSync(f).size; fs.writeFileSync(f, Buffer.alloc(n)); } catch {}
    try { fs.unlinkSync(f); } catch {}
  }
  function fresh() {   // empty vault: device mode when Windows can protect the key, otherwise nothing is stored yet
    forget(); error = ''; fails = 0; blockedUntil = 0;
    if (!dpapi()) { rec = null; return; }
    key = crypto.randomBytes(32); secrets = {};
    rec = { v: 1, mode: 'device', wrap: { device: b64(safeStorage.encryptString(b64(key))) }, data: null };
    persist();
  }

  function init() {
    let raw = null;
    try { raw = fs.readFileSync(file(), 'utf8'); } catch {}
    if (raw == null) { fresh(); return; }
    try {
      const f = JSON.parse(raw);
      if (!f || f.v !== 1 || !f.data || !f.wrap || !['device', 'passphrase'].includes(f.mode)) throw new Error('format');
      rec = f;
      if (f.mode === 'device') {
        if (!dpapi() || !f.wrap.device) throw new Error('no dpapi');
        const k = unb64(safeStorage.decryptString(unb64(f.wrap.device)));
        secrets = JSON.parse(open(k, f.data).toString('utf8')); key = k;
      }
    } catch {
      forget();
      error = 'The vault could not be opened. It may be damaged, or it was created on another PC or Windows account.';
    }
  }

  async function unwrap(pass) {   // returns the vault key, or null for a wrong passphrase
    const w = rec.wrap;
    try { return open(await passKey(pass, unb64(w.salt), w), w); } catch { return null; }
  }
  async function newPassWrap(vk, pass) {
    const salt = crypto.randomBytes(16), kek = await passKey(pass, salt);
    return { kdf: 'scrypt', salt: b64(salt), N: KDF.N, r: KDF.r, p: KDF.p, ...seal(kek, vk) };
  }

  async function unlock(pass) {
    if (error) return { ok: false, text: error };
    if (mode() !== 'passphrase') return { ok: true, text: 'Nothing to unlock.' };
    if (key) return { ok: true, text: 'Already unlocked.' };
    const wait = Math.ceil((blockedUntil - Date.now()) / 1000);
    if (wait > 0) return { ok: false, text: `Too many wrong tries. Wait ${wait} s.` };
    const k = await unwrap(String(pass || ''));
    let data = null;
    if (k) { try { data = JSON.parse(open(k, rec.data).toString('utf8')); } catch { data = null; } }
    if (!data) {
      fails++;
      if (fails >= 3) blockedUntil = Date.now() + Math.min(300, 5 * Math.pow(2, fails - 3)) * 1000;
      return { ok: false, text: fails >= 3 ? 'Wrong passphrase. Too many wrong tries, please wait.' : 'Wrong passphrase.' };
    }
    fails = 0; blockedUntil = 0; key = k; secrets = data; armIdle(); emit();
    return { ok: true, text: 'Unlocked.' };
  }

  async function setPassphrase(pass, oldPass) {
    pass = String(pass || '');
    const why = checkPassphrase(pass); if (why) return { ok: false, text: why };
    if (error) return { ok: false, text: error };
    const wasPass = mode() === 'passphrase';
    let vk = key, data = secrets;
    if (wasPass) {
      const k = await unwrap(String(oldPass || ''));
      if (!k) return { ok: false, text: 'The current passphrase is wrong.' };
      if (!key) { try { data = JSON.parse(open(k, rec.data).toString('utf8')); } catch { return { ok: false, text: 'The vault could not be opened.' }; } }
      k.fill(0);
    } else if (mode() === 'none') { data = {}; }
    const nk = crypto.randomBytes(32);   // a new vault key every time: everything is re-encrypted
    const wrap = await newPassWrap(nk, pass);
    forget(); key = nk; secrets = data;
    rec = { v: 1, mode: 'passphrase', wrap, data: null };
    persist(); armIdle(); emit();
    return { ok: true, text: wasPass ? 'Passphrase changed.' : 'Passphrase set. Your keys are now locked behind it.' };
  }

  async function removePassphrase(pass) {
    if (mode() !== 'passphrase') return { ok: false, text: 'No passphrase is set.' };
    if (!dpapi()) return { ok: false, text: 'Windows secure storage is not available on this PC, so the vault cannot go back to Windows-account protection.' };
    const k = await unwrap(String(pass || ''));
    if (!k) return { ok: false, text: 'The passphrase is wrong.' };
    let data = secrets;
    if (!key) { try { data = JSON.parse(open(k, rec.data).toString('utf8')); } catch { return { ok: false, text: 'The vault could not be opened.' }; } }
    k.fill(0);
    const nk = crypto.randomBytes(32);
    forget(); key = nk; secrets = data;
    rec = { v: 1, mode: 'device', wrap: { device: b64(safeStorage.encryptString(b64(nk))) }, data: null };
    persist(); emit();
    return { ok: true, text: 'Passphrase removed. Keys are protected by your Windows account again.' };
  }

  function get(name, background) {
    if (!key || error) return '';
    if (!background) armIdle();
    const v = secrets[name]; return typeof v === 'string' ? v : '';
  }
  const has = (name) => !!(key && !error && typeof secrets[name] === 'string' && secrets[name]);
  function set(name, value) {
    if (!canStore()) throw new Error('vault unavailable');
    if (value) secrets[name] = String(value); else delete secrets[name];
    persist(); armIdle(); emit();
    return true;
  }
  function wipe() {
    shred(file()); try { fs.unlinkSync(file() + '.tmp'); } catch {}
    rec = null; fresh(); emit();
  }
  function migrate(files) {   // import keys from the older DPAPI-only files, then overwrite and delete them
    if (!canStore() || !dpapi()) return 0;
    let n = 0; const done = [];
    for (const f of files) {
      let obj; try { obj = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
      let allOk = true;
      for (const name of Object.keys(obj || {})) {
        try { const v = safeStorage.decryptString(unb64(obj[name])); if (v) { secrets[name] = v; n++; } } catch { allOk = false; }
      }
      if (allOk) done.push(f);
    }
    if (n || done.length) {
      try { persist(); } catch { return 0; }
      done.forEach(shred);   // only after the new vault was written successfully
      emit();
    }
    return n;
  }
  function configure(o) {
    if (o && o.autoLockMin != null) { const m = Number(o.autoLockMin); autoLockMin = isFinite(m) && m >= 0 ? m : 30; armIdle(); }
  }
  function status() {
    const pm = mode() === 'passphrase';
    return {
      mode: mode(), locked: pm && !key, canStore: canStore(), dpapi: dpapi(), error, cipher: 'AES-256-GCM',
      kdf: pm ? `scrypt (N=${rec.wrap.N || KDF.N}, r=${rec.wrap.r || KDF.r}, p=${rec.wrap.p || KDF.p}, 64 MB)` : '',
      names: key && !error ? Object.keys(secrets).filter((k) => secrets[k]) : [], autoLockMin,
      retryIn: Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000))
    };
  }
  init();
  return { mode, unlocked, canStore, status, get, has, set, lock, unlock, setPassphrase, removePassphrase, wipe, migrate, configure, onChange: (f) => listeners.push(f) };
}
createVault.checkPassphrase = checkPassphrase;
module.exports = createVault;
