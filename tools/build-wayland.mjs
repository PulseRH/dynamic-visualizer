import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux') process.exit(0);
const optional = process.argv.includes('--optional');
const cwd = fileURLToPath(new URL('../electron/vendor/wayland-wallpaper', import.meta.url));
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/node-gyp/bin/node-gyp.js', import.meta.url)),
  'rebuild', '--directory', cwd,
], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('Wayland helper build failed. Install a C++ compiler, Python and Wayland development headers, then run npm run build:wayland.');
  process.exit(optional ? 0 : 1);
}
