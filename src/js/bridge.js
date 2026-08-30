// Bridges Electron-specific capabilities when running inside Electron,
// and degrades gracefully (browser dev mode) when not.

const ev = typeof window !== 'undefined' && window.dv;

export const isElectron = !!ev;
export const platform = ev ? (await ev.info()).platform : 'browser';

const dummyInputs = {};

function ensureInput(kind) {
  if (!dummyInputs[kind]) {
    const el = document.createElement('input');
    el.type = 'file';
    el.hidden = true;
    if (kind === 'image') el.accept = 'image/*';
    if (kind === 'audio') el.accept = 'audio/*';
    document.body.appendChild(el);
    dummyInputs[kind] = el;
  }
  return dummyInputs[kind];
}

function pickFileBrowser(kind) {
  return new Promise((resolve) => {
    const el = ensureInput(kind);
    el.value = '';
    el.onchange = () => {
      const f = el.files && el.files[0];
      resolve(f ? { file: f, url: URL.createObjectURL(f), path: f.name } : null);
    };
    el.click();
  });
}

export const bridge = {
  async getWallpaper() {
    if (ev) return ev.getWallpaper(); // { ok, path, url }
    return { ok: false, path: null };
  },

  async chooseImage() {
    if (ev) return ev.chooseImage(); // { path, url }
    return pickFileBrowser('image');
  },

  async chooseAudioFile() {
    if (ev) return ev.chooseAudioFile();
    return pickFileBrowser('audio');
  },

  async startPulseCapture(onPcm, onError) {
    if (!ev) throw new Error('PulseAudio capture requires the Electron app (Linux).');
    const offPcm = ev.onPcm((u8) => onPcm(u8));
    const offErr = ev.onCaptureError((m) => onError(m));
    const res = await ev.startPulseCapture();
    if (!res.ok) { offPcm(); offErr(); throw new Error(res.error); }
    return () => { offPcm(); offErr(); ev.stopPulseCapture(); };
  },

  stopPulseCapture() { if (ev) ev.stopPulseCapture(); },

  async enableWallpaper() {
    if (!ev) throw new Error('Wallpaper mode needs the desktop app.');
    const res = await ev.enableWallpaper();
    if (!res.ok) throw new Error(res.error || 'failed');
  },

  async disableWallpaper() {
    if (!ev) throw new Error('Wallpaper mode needs the desktop app.');
    const res = await ev.disableWallpaper();
    if (!res.ok) throw new Error(res.error || 'failed');
  },

  async isWallpaperActive() {
    if (!ev) return false;
    return !!(await ev.isWallpaperActive());
  },

  onWallpaperState(cb) {
    if (ev) ev.onWallpaperState(cb);
    else cb(false);
  },
};
