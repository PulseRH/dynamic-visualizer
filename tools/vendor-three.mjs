// Copies the Three.js ES module next to the renderer sources so the app runs
// with zero bundling, both under Electron (app://) and a plain static server.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'src', 'vendor');
mkdirSync(dest, { recursive: true });
// three.module.js re-exports from three.core.js, so both must be vendored.
for (const name of ['three.module.js', 'three.core.js']) {
  copyFileSync(path.join(path.dirname(require.resolve('three')), name), path.join(dest, name));
}
console.log('vendored three module files ->', dest);
