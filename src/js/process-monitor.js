// Sample only while the resource fold is visible. An in-flight sample cannot
// repaint after closing it, and slow IPC never creates overlapping requests.
export class ProcessMonitor {
  constructor({sample, render, schedule = (callback, ms) => setInterval(callback, ms), cancel = timer => clearInterval(timer)}) {
    Object.assign(this, {sample, render, schedule, cancel});
    this.timer = null;
    this.active = false;
    this.pending = false;
    this.generation = 0;
  }
  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    this.generation++;
    if (active) {
      this.poll();
      this.timer = this.schedule(() => this.poll(), 1000);
    } else {
      this.cancel(this.timer);
      this.timer = null;
    }
  }
  async poll() {
    if (!this.active || this.pending) return;
    this.pending = true;
    const generation = this.generation;
    try {
      const rows = await this.sample();
      if (this.active && generation === this.generation) this.render(rows);
    } catch {
      if (this.active && generation === this.generation) this.render(null);
    } finally { this.pending = false; }
  }
}
