'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const handlerSource = source.slice(source.indexOf('function registerAppProtocol()'), source.indexOf('// ---------------------------------------------------------------------------\n// Wallpaper detection'));
const allowedSource = source.slice(source.indexOf('const SERVE_EXTENSIONS'), source.indexOf('// ---------------------------------------------------------------------------\n// app:// protocol'));
function handler(platform, pathApi, root) {
  let handle;
  const context = { URL, Response, Headers, process: { platform }, path: pathApi, PROJECT_ROOT: root,
    protocol: { handle: (_scheme, fn) => { handle = fn; } },
    net: { fetch: url => new Response(url) }, pathToFileURL };
  vm.runInNewContext(allowedSource + handlerSource + '\nregisterAppProtocol();', context);
  return handle;
}
(async () => {
const linux = handler('linux', path.posix, '/opt/visualizer');
const uploaded = await linux({ url: 'app://abs/home/user/My%20wallpaper%20%23%20%3F%20%25.png' });
assert.equal(uploaded.headers.get('Access-Control-Allow-Origin'), 'app://bundle');
assert.equal(await uploaded.text(), 'file:///home/user/My%20wallpaper%20%23%20%3F%20%25.png');
assert.equal(await (await linux({ url: 'app://bundle/src/index.html' })).text(), 'file:///opt/visualizer/src/index.html');
assert.equal(await (await linux({ url: 'app://abs/home/user/picture.bmp' })).text(), 'file:///home/user/picture.bmp');
assert.equal((await linux({ url: 'app://abs/home/user/secret.exe' })).status, 403);
const windows = handler('win32', path.win32, 'C:\\visualizer');
// On a Linux host, compare resolution before pathToFileURL applies host rules.
const expected = pathToFileURL('C:\\Users\\Loz\\My wallpaper # %.jpg').href;
assert.equal(await (await windows({ url: 'app://abs/C%3A/Users/Loz/My%20wallpaper%20%23%20%25.jpg' })).text(), expected);
assert.equal(await (await windows({ url: 'app://abs//server/share/wallpaper.png' })).text(), pathToFileURL('\\\\server\\share\\wallpaper.png').href);
console.log('PASS: image CORS, absolute images, Windows drives and network shares, BMP, special filenames, bundled assets and extension restrictions.');
})().catch(error => { console.error(error); process.exitCode = 1; });
