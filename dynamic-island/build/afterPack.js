/* Puts the app icon and version info into "Dynamic Island.exe" using the rcedit npm package (it ships rcedit-x64.exe).
 * electron-builder normally does this itself with its winCodeSign download, which fails on PCs where antivirus blocks that
 * download's cache folder; this hook needs no download. */
const path = require('path'), fs = require('fs');
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  const icon = path.join(ctx.packager.projectDir, 'build', 'icon.ico');
  if (!fs.existsSync(exe) || !fs.existsSync(icon)) throw new Error('afterPack: missing ' + (fs.existsSync(exe) ? icon : exe));
  const { rcedit } = await import('rcedit');
  const v = ctx.packager.appInfo.version;
  await rcedit(exe, {
    icon,
    'file-version': v, 'product-version': v,
    'version-string': { ProductName: 'Dynamic Island', FileDescription: 'Dynamic Island', InternalName: 'Dynamic Island', OriginalFilename: 'Dynamic Island.exe', CompanyName: 'Dynamic Island' }
  });
  console.log('  • afterPack: icon and version info written to ' + path.basename(exe));
};
