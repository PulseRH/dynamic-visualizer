const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { RecentImages } = require('../electron/recent-images.cjs');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dv-history-'));
  try {
    const cache = path.join(root, 'cache');
    const history = new RecentImages(cache, p => p);
    const source = path.join(root, 'wallpaper.jpg');
    await fs.writeFile(source, 'first wallpaper');
    let entries = await history.add(source, 'small thumbnail');
    const first = entries[0];
    assert.equal((await history.add(source, 'small thumbnail')).length, 1, 'deduplicate unchanged image');
    await fs.writeFile(source, 'replacement wallpaper with a new size');
    entries = await history.add(source, 'new thumbnail');
    assert.equal(entries.length, 2, 'OS wallpaper replacement remains a separate recent image');
    assert.equal(await fs.readFile(first.url, 'utf8'), 'first wallpaper', 'snapshot survives source replacement');
    entries = await history.add(first.url, first.thumb);
    assert.equal(entries[0].key, first.key, 'reuse snapshot without copying it again');
    const requests = [];
    for (let i = 0; i < 10; i++) {
      const file = path.join(root, `source-${i}.png`);
      await fs.writeFile(file, `image ${i}`);
      requests.push(history.add(file, `thumbnail ${i}`));
    }
    await Promise.all(requests);
    entries = await new RecentImages(cache, p => p).list();
    assert.equal(entries.length, 8, 'bounded persistent history');
    assert.equal(entries[0].name, 'source-9.png', 'serialized selection order');
    assert.equal((await fs.readdir(cache)).length, 9, 'only eight full snapshots and one index remain');
    assert.equal(await fs.readFile(source, 'utf8'), 'replacement wallpaper with a new size', 'original files untouched');
    console.log('PASS: persistent recent images, deduplication, original replacement, snapshot reuse, concurrent updates and bounded cache.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
