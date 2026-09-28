// electron-builder afterPack hook: ad-hoc sign the macOS app.
// With `identity: null` electron-builder skips signing, leaving Electron's
// linker signature, which no longer matches the bundle once resources are
// added — macOS then reports the downloaded app as "damaged". A proper ad-hoc
// signature fixes that (recipients still need to approve it once, since it
// isn't notarized).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
