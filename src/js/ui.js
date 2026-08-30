// HUD + settings panel wiring. Owns DOM; app.js supplies the heavy lifting
// through callbacks.

import { get, set, onChange, getAll } from './settings.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(callbacks) {
    this.cb = callbacks; // { onImagePicked(source), onAudioMode(mode, opts) }
    this.stats = $('statsChip');
    this.dot = $('audioDot');
    this.label = $('audioLabel');
    this.levelBar = $('levelBar');
    this.hint = $('audioHint');

    this._wirePanel();
    this._wireSegments();
    this._wireSliders();
    this._wireImageButtons();
    this._wireDragDrop();
    this._syncAll();

    let lastInteract = performance.now();
    const bump = () => {
      lastInteract = performance.now();
      $('hud').classList.remove('faded');
    };
    window.addEventListener('pointermove', bump);
    window.addEventListener('keydown', bump);
    setInterval(() => {
      if (performance.now() - lastInteract > 4500 && !$('panel').classList.contains('open')) {
        $('hud').classList.add('faded');
      }
    }, 1500);

    onChange(() => this._syncAll());
  }

  // ------------------------------------------------------------------ panel

  _wirePanel() {
    $('gearBtn').onclick = () => {
      $('panel').classList.toggle('open');
      $('hud').classList.remove('faded');
    };
    $('closePanel').onclick = () => $('panel').classList.remove('open');
  }

  _wireSegments() {
    const seg = (id, key, extra) => {
      const el = $(id);
      el.querySelectorAll('button').forEach((btn) => {
        btn.onclick = () => {
          const v = btn.dataset.v;
          set({ [key]: v });
          if (extra) extra(v);
        };
      });
    };
    seg('depthSeg', 'depthMode', () => this.cb.onDepthChanged());
    seg('waveSeg', 'waveMode');
    seg('bandMapSeg', 'bandMap');
    seg('fpsSeg', 'fpsCap', (v) => set({ fpsCap: Number(v) }));
    seg('audioSeg', 'audioSource', async (v) => {
      if (v === 'file') {
        const picked = await this.cb.pickAudioFile();
        if (!picked) { set({ audioSource: get('audioFileUrl') ? 'file' : 'demo' }); return; }
        set({ audioFileUrl: picked.url });
        this.cb.onAudioMode('file', { fileUrl: picked.url });
      } else {
        this.cb.onAudioMode(v);
      }
    });
  }

  _wireSliders() {
    const slider = (id, key, fmt) => {
      const el = $(id);
      const val = el.parentElement.querySelector('.val');
      el.oninput = () => {
        const v = Number(el.value);
        val.textContent = fmt ? fmt(v) : String(v);
        set({ [key]: v });
      };
    };
    slider('depthScale', 'depthScale', (v) => v.toFixed(2));
    slider('pointCount', 'pointCount', (v) => `${Math.round(v / 1000)}k`);
    slider('pointSize', 'pointSize', (v) => v.toFixed(1));
    slider('glow', 'glow', (v) => v.toFixed(2));
    slider('boost', 'boost', (v) => v.toFixed(2));
    slider('intensity', 'intensity', (v) => v.toFixed(2));
    slider('depthMove', 'depthMove', (v) => v.toFixed(2));
    slider('xyMove', 'xyMove', (v) => v.toFixed(2));
    slider('parallax', 'parallax', (v) => v.toFixed(2));

    $('autoQuality').onchange = (e) => set({ autoQuality: e.target.checked });
    $('idleSleep').onchange = (e) => set({ idleSleep: e.target.checked });
  }

  _wireImageButtons() {
    $('useWallpaper').onclick = () => this.cb.onImagePicked({ kind: 'wallpaper' });
    $('uploadImage').onclick = () => this.cb.onImagePicked({ kind: 'upload' });
    $('wallpaperToggle').onclick = () => this.cb.onWallpaperToggle();
  }

  _wireDragDrop() {
    const overlay = $('dropOverlay');
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; overlay.classList.add('show'); });
    window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('show'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      overlay.classList.remove('show');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        this.cb.onImagePicked({ kind: 'blob', file });
      }
    });
    window.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) {
        const file = item.getAsFile();
        if (file) this.cb.onImagePicked({ kind: 'blob', file });
      }
    });
  }

  _syncAll() {
    const syncSeg = (id, v) => {
      $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    };
    syncSeg('depthSeg', get('depthMode'));
    syncSeg('waveSeg', get('waveMode'));
    syncSeg('bandMapSeg', get('bandMap'));
    syncSeg('audioSeg', get('audioSource'));
    syncSeg('fpsSeg', get('fpsCap'));

    const bmHints = {
      radial: 'Bass rings from the center out, highs at the edges.',
      vertical: 'Bass at the ground, highs up in the sky.',
      horizontal: 'Bass on the left sweeping to highs on the right.',
      depth: 'Bass far behind, highs up close (by depth layer).',
    };
    const bmHint = $('bandMapHint');
    if (bmHint) bmHint.textContent = bmHints[get('bandMap')] || '';

    const setSlider = (id, v) => {
      const el = $(id);
      el.value = v;
      const val = el.parentElement.querySelector('.val');
      if (val) {
        val.textContent =
          id === 'pointCount' ? `${Math.round(v / 1000)}k` :
          id === 'pointSize' ? Number(v).toFixed(1) :
          Number(v).toFixed(2);
      }
    };
    setSlider('depthScale', get('depthScale'));
    setSlider('pointCount', get('pointCount'));
    setSlider('pointSize', get('pointSize'));
    setSlider('glow', get('glow'));
    setSlider('boost', get('boost'));
    setSlider('intensity', get('intensity'));
    setSlider('depthMove', get('depthMove'));
    setSlider('xyMove', get('xyMove'));
    setSlider('parallax', get('parallax'));

    $('autoQuality').checked = get('autoQuality');
    $('idleSleep').checked = get('idleSleep');

    const src = get('audioSource');
    const hints = {
      system: 'Windows & macOS: captures whatever the OS is playing (loopback). On Linux use the PulseAudio build — see README.',
      mic: 'Listens through your microphone. Nothing is monitored back to speakers.',
      file: get('audioFileUrl') ? 'Plays the chosen file aloud and analyzes it.' : 'Pick a music file to play and analyze.',
      demo: 'Built-in silent demo track — great for testing or showing off.',
    };
    this.hint.textContent = hints[src] || '';
  }

  // ----------------------------------------------------------------- status

  setThumb(url) {
    const wrap = $('imgThumb');
    if (!url) { wrap.parentElement.classList.remove('show'); wrap.src = ''; return; }
    wrap.src = url;
    wrap.parentElement.classList.add('show');
  }

  setWallpaperActive(on) {
    const b = $('wallpaperToggle');
    b.textContent = on ? 'Stop wallpaper mode' : 'Run as my wallpaper';
    b.classList.toggle('active', on);
  }

  setAudioStatus(status, kind) {
    this.label.textContent = status;
    this.dot.className = 'dot' + (kind === 'live' ? ' live' : kind === 'warn' ? ' warn' : kind === 'err' ? ' err' : '');
  }

  setStats(text) { this.stats.textContent = text; }

  setLevel(v) { this.levelBar.style.width = `${Math.round(v * 100)}%`; }

  toast(msg, kind = '', ms = 3800) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
    }, ms);
  }

  setAbout(text) { $('aboutInfo').textContent = text; }

  get settings() { return getAll(); }
}
