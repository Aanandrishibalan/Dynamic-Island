/* Downloads the NSIS installer tools straight into electron-builder's cache and unpacks them in place.
 * electron-builder downloads to a temp folder and then renames it; on PCs where antivirus locks that folder the rename fails
 * ("Access is denied") and the installer cannot be built. Unpacking directly into the final folder avoids the rename. */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'electron-builder', 'Cache');
const sz = path.join(root, 'node_modules', '7zip-bin', process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux', process.arch === 'ia32' ? 'ia32' : 'x64', process.platform === 'win32' ? '7za.exe' : '7za');
const BASE = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/';
const TOOLS = ['nsis-3.0.4.1', 'nsis-resources-3.4.1'];   // versions used by electron-builder 25

(async () => {
  for (const name of TOOLS) {
    const dest = path.join(cache, 'nsis', name);
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) { console.log('  • ' + name + ' already in cache'); continue; }
    fs.mkdirSync(dest, { recursive: true });
    const tmp = path.join(cache, 'nsis', name + '.7z');
    console.log('  • downloading ' + name);
    const r = await fetch(BASE + name + '/' + name + '.7z');
    if (!r.ok) throw new Error('download failed: HTTP ' + r.status + ' for ' + name);
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    const x = spawnSync(sz, ['x', '-y', '-bso0', '-bsp0', '-o' + dest, tmp], { stdio: 'inherit' });
    try { fs.rmSync(tmp, { force: true }); } catch {}
    if (x.status !== 0 || !fs.readdirSync(dest).length) { fs.rmSync(dest, { recursive: true, force: true }); throw new Error('could not unpack ' + name); }
    console.log('  • unpacked ' + name);
  }
})().catch((e) => { console.error('prefetch-tools: ' + e.message + ' (electron-builder will try its own download)'); });
