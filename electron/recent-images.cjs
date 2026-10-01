'use strict';
const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
class RecentImages {
  constructor(dir, toUrl) { this.dir = dir; this.toUrl = toUrl; this.queue = Promise.resolve(); }
  async list() {
    try { return JSON.parse(await fs.readFile(path.join(this.dir, 'history.json'), 'utf8')); }
    catch { return []; }
  }
  add(source, thumb) {
    const run = this.queue.then(async () => {
      const entries = await this.list();
      const existing = entries.find(e => e.url === this.toUrl(source));
      const stat = await fs.stat(source);
      const key = createHash('sha256').update(`${source}/${stat.size}/${stat.mtimeMs}`).digest('hex').slice(0, 24);
      let entry = existing || entries.find(e => e.key === key);
      if (!entry) {
        await fs.mkdir(this.dir, { recursive: true });
        const ext = path.extname(source).toLowerCase() || '.jpg';
        const file = path.join(this.dir, key + ext);
        await fs.copyFile(source, file);
        entry = { key, url: this.toUrl(file), sourceUrl: this.toUrl(source), thumb, name: path.basename(source) };
      }
      const next = [entry, ...entries.filter(e => e.key !== entry.key)].slice(0, 8);
      await fs.writeFile(path.join(this.dir, 'history.json'), JSON.stringify(next));
      // Delete only generated snapshots from this cache, never source images.
      for (const old of entries.filter(e => !next.some(n => n.key === e.key))) {
        if (!/^[a-f0-9]{24}$/.test(old.key)) continue;
        for (const file of await fs.readdir(this.dir)) {
          if (file.startsWith(old.key + '.')) await fs.unlink(path.join(this.dir, file)).catch(() => {});
        }
      }
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
module.exports = { RecentImages };
