// HUD + settings panel wiring. Owns DOM; app.js supplies the heavy lifting
// through callbacks.

import { get, set, onChange, getAll } from './settings.js';
import { bridge } from './bridge.js';
import { movementResponse } from './response.js';
import { BAND_CHOICES, bandChoiceIndex } from './band-choices.js';
import { imageAccent, PURPLE_ACCENT } from './ui-accent.js';

const $ = (sel) => document.getElementById(sel.replace(/^#/, ''));

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
    this._wireStartup();
    this._wireTooltips();
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
    seg('depthSeg', 'depthMode');
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
    const slider = (id, key, fmt, decode = (v) => v) => {
      const el = $(id);
      const val = el.parentElement.querySelector('.val');
      el.oninput = () => {
        const v = decode(Number(el.value));
        val.textContent = fmt ? fmt(v) : String(v);
        set({ [key]: v });
      };
    };
    slider('depthScale', 'depthScale', (v) => v.toFixed(2));
    slider('pointCount', 'pointCount', (v) => `${Math.round(v / 1000)}k`);
    slider('pointSize', 'pointSize', (v) => v.toFixed(1));
    slider('glow', 'glow', (v) => v.toFixed(2));
    slider('boost', 'boost', (v) => v.toFixed(2));
    slider('sizePulse', 'sizePulse', (v) => `${Math.round(v * 100)}%`);
    slider('vibrancyPulse', 'vibrancyPulse', (v) => `${Math.round(v * 100)}%`);
    slider('hueReaction', 'hueReaction', (v) => `${Math.round(v)}°`);
    slider('hueFocus', 'hueFocus', (v) => `${Math.round(v * 100)}%`);
    slider('intensity', 'intensity', (v) => v.toFixed(2));
    for (const key of ['motionWave', 'motionRipple', 'motionBands', 'motionDrift',
      'motionSwirl', 'motionBreathe', 'motionSweep']) {
      slider(key, key, (v) => `${Math.round(v * 100)}%`);
    }
    slider('speedVol', 'speedVol', (v) => v.toFixed(2));
    slider('motionSpeed', 'motionSpeed', (v) => v.toFixed(2));
    slider('sensGain', 'sensGain', (v) => v.toFixed(2));
    slider('sensFloor', 'sensFloor', (v) => v.toFixed(2));
    slider('sensCurve', 'sensCurve', (v) => v.toFixed(2));
    slider('eqCurve', 'eqCurve', (v) => v.toFixed(2));
    slider('tiltEQ', 'tiltEQ', (v) => v.toFixed(2));
    slider('tiltPivot', 'tiltPivot', (v) => v.toFixed(2));
    slider('highBoost', 'highBoost', (v) => v.toFixed(2));
    slider('stickyIn', 'stickyIn', (v) => v.toFixed(2));
    slider('stickyOut', 'stickyOut', (v) => v.toFixed(2));
    $('bands').max = String(BAND_CHOICES.length - 1);
    slider('bands', 'bands', (v) => String(v), (i) => BAND_CHOICES[i]);
    slider('depthMove', 'depthMove', (v) => v.toFixed(2));
    slider('xyMove', 'xyMove', (v) => v.toFixed(2));
    slider('quietMovement', 'quietMovement', (v) => `${Math.round(v * 100)}%`);
    slider('energyResponse', 'energyResponse', (v) => v.toFixed(2));
    $('calibrateEnergy').onclick = () => this.cb.onCalibrateEnergy();

    $('autoQuality').onchange = (e) => set({ autoQuality: e.target.checked });
    $('previewPaused').onchange = (e) => set({ previewPaused: e.target.checked });
    $('previewFullQuality').onchange = (e) => set({ previewFullQuality: e.target.checked });
    $('idleSleep').onchange = (e) => set({ idleSleep: e.target.checked });
    $('invertBands').onchange = (e) => set({ invertBands: e.target.checked });
    $('preserveBoostColor').onchange = (e) => set({ preserveBoostColor: e.target.checked });
    $('matchImageAccent').onchange = (e) => set({ matchImageAccent: e.target.checked });
    $('hideBackdrop').onchange = (e) => set({ hideBackdrop: e.target.checked });
    $('flybyExit').onchange = (e) => set({ flybyExit: e.target.checked });
    $('cursorRipple').onchange = (e) => set({ cursorRipple: e.target.checked });
    const cmw = $('centeredMotion');
    if (cmw) cmw.onchange = (e) => set({ centeredMotion: e.target.checked });
    $('equalDepthMovement').onchange = (e) => set({ equalDepthMovement: e.target.checked });

    // Parallax auto-raises zoom/crop (so the edges stay hidden) until the user
    // takes manual control of it.
    const parallaxEl = $('parallax');
    parallaxEl.oninput = () => {
      const v = Number(parallaxEl.value);
      parallaxEl.parentElement.querySelector('.val').textContent = v.toFixed(2);
      const patch = { parallax: v };
      // music parallax shifts the camera too — count it in the auto overscan
      if (get('overscanAuto')) patch.overscan = Math.round((1 + (v + get('musicParallax')) * 0.15) * 20) / 20;
      set(patch);
    };
    const musicEl = $('musicParallax');
    musicEl.oninput = () => {
      const v = Number(musicEl.value);
      musicEl.parentElement.querySelector('.val').textContent = v.toFixed(2);
      const patch = { musicParallax: v };
      if (get('overscanAuto')) patch.overscan = Math.round((1 + (get('parallax') + v) * 0.15) * 20) / 20;
      set(patch);
    };
    const overscanEl = $('overscan');
    overscanEl.oninput = () => {
      const v = Number(overscanEl.value);
      overscanEl.parentElement.querySelector('.val').textContent = v.toFixed(2);
      set({ overscan: v, overscanAuto: false });
    };

    // Adjust only the range under the pointer; keep the panel scrollable
    // everywhere else. Dispatch input so special sliders use their own logic.
    for (const el of document.querySelectorAll('#panel input[type="range"]')) {
      let wheelCarry = 0;
      el.addEventListener('wheel', (event) => {
        event.preventDefault();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
        if (Math.sign(delta) !== Math.sign(wheelCarry)) wheelCarry = 0;
        wheelCarry += delta;
        if (Math.abs(wheelCarry) < 80) return;
        // Some devices report an entire page in one event; still move just
        // one notch so precision does not depend on mouse or trackpad speed.
        wheelCarry = 0;
        const step = Number(el.step) || 1;
        const min = Number(el.min) || 0;
        const max = Number(el.max);
        const next = Math.max(min, Math.min(max, el.valueAsNumber - Math.sign(delta) * step));
        if (next === el.valueAsNumber) return;
        el.value = String(next);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, { passive: false });
    }
  }

  async _wireStartup() {
    const cfg = await bridge.getConfig();
    const la = $('#launchAtStartup');
    const st = $('#startInTray');
    const ag = $('#autoGameMode');
    if (!la || !st) return;
    la.checked = !!cfg.launchAtStartup;
    st.checked = !!cfg.startInTray;
    la.onchange = async (e) => { await bridge.setConfig({ launchAtStartup: e.target.checked }); };
    st.onchange = async (e) => { await bridge.setConfig({ startInTray: e.target.checked }); };
    if (ag) {
      ag.checked = !!cfg.autoGameMode;
      ag.onchange = async (e) => { await bridge.setConfig({ autoGameMode: e.target.checked }); };
    }
    const mo = $('#wallpaperPrimaryOnly');
    if (mo) {
      mo.checked = !!cfg.wallpaperPrimaryOnly;
      mo.onchange = async (e) => { await bridge.setConfig({ wallpaperPrimaryOnly: e.target.checked }); };
    }
  }

  _wireImageButtons() {
    $('useWallpaper').onclick = () => this.cb.onImagePicked({ kind: 'wallpaper' });
    $('uploadImage').onclick = () => this.cb.onImagePicked({ kind: 'upload' });
    $('wallpaperToggle').onclick = () => this.cb.onWallpaperToggle();
  }

  /** floating "?" tooltips: a single body-level box so the scrollable
   *  settings panel (overflow + transform) can never clip them */
  _wireTooltips() {
    let box = document.getElementById('tipBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'tipBox';
      document.body.appendChild(box);
    }
    const place = (q) => {
      box.textContent = q.dataset.tip || '';
      box.style.display = 'block';
      box.style.visibility = 'hidden';
      const r = q.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      let left = r.left - br.width - 10;
      if (left < 8) left = Math.min(r.right + 10, window.innerWidth - br.width - 8);
      let top = r.top + r.height / 2 - br.height / 2;
      top = Math.max(8, Math.min(top, window.innerHeight - br.height - 8));
      box.style.left = `${Math.round(left)}px`;
      box.style.top = `${Math.round(top)}px`;
      box.style.visibility = 'visible';
    };
    const hide = () => { box.style.display = 'none'; };
    document.addEventListener('mouseover', (e) => {
      const q = e.target.closest ? e.target.closest('.q') : null;
      if (q) place(q); else hide();
    });
    document.addEventListener('scroll', () => {
      const q = document.querySelector('.q:hover');
      if (q) place(q); else hide();
    }, true);
    window.addEventListener('blur', hide);
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

  setImageAccent(image) {
    try {
      const sample = document.createElement('canvas');
      sample.width = sample.height = 24;
      const context = sample.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, 24, 24);
      this.imageAccent = imageAccent(context.getImageData(0, 0, 24, 24).data);
    } catch {
      this.imageAccent = PURPLE_ACCENT;
    }
    this._applyAccent();
  }

  _applyAccent() {
    const rgb = get('matchImageAccent') ? this.imageAccent || PURPLE_ACCENT : PURPLE_ACCENT;
    const key = rgb.join(',');
    if (key === this._accentKey) return;
    this._accentKey = key;
    const style = document.documentElement.style;
    style.setProperty('--accent-rgb', key);
    style.setProperty('--accent-2-rgb', rgb.map(value => Math.round(value + (255 - value) * 0.12)).join(','));
  }

  _syncAll() {
    this._applyAccent();
    $('matchImageAccent').checked = !!get('matchImageAccent');
    const syncSeg = (id, v) => {
      $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    };
    syncSeg('depthSeg', get('depthMode'));
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
      const fill = (el.valueAsNumber - Number(el.min)) / (Number(el.max) - Number(el.min)) * 100;
      el.style.setProperty('--range-fill', `${fill}%`);
      const val = el.parentElement.querySelector('.val');
      if (val) {
        val.textContent =
          id === 'pointCount' ? `${Math.round(v / 1000)}k` :
          id === 'pointSize' ? Number(v).toFixed(1) :
          id === 'bands' ? String(get('bands')) :
          Number(v).toFixed(2);
      }
    };
    setSlider('depthScale', get('depthScale'));
    setSlider('pointCount', get('pointCount'));
    setSlider('pointSize', get('pointSize'));
    setSlider('glow', get('glow'));
    setSlider('boost', get('boost'));
    setSlider('sizePulse', get('sizePulse'));
    $('sizePulse').parentElement.querySelector('.val').textContent = `${Math.round(get('sizePulse') * 100)}%`;
    setSlider('vibrancyPulse', get('vibrancyPulse'));
    $('vibrancyPulse').parentElement.querySelector('.val').textContent = `${Math.round(get('vibrancyPulse') * 100)}%`;
    setSlider('hueReaction', get('hueReaction'));
    $('hueReaction').parentElement.querySelector('.val').textContent = `${Math.round(get('hueReaction'))}°`;
    setSlider('hueFocus', get('hueFocus'));
    $('hueFocus').parentElement.querySelector('.val').textContent = `${Math.round(get('hueFocus') * 100)}%`;
    setSlider('intensity', get('intensity'));
    for (const key of ['motionWave', 'motionRipple', 'motionBands', 'motionDrift',
      'motionSwirl', 'motionBreathe', 'motionSweep']) {
      setSlider(key, get(key));
      $(key).parentElement.querySelector('.val').textContent = `${Math.round(get(key) * 100)}%`;
    }
    setSlider('speedVol', get('speedVol'));
    setSlider('motionSpeed', get('motionSpeed'));
    setSlider('sensGain', get('sensGain'));
    setSlider('sensFloor', get('sensFloor'));
    setSlider('sensCurve', get('sensCurve'));
    setSlider('eqCurve', get('eqCurve'));
    setSlider('tiltEQ', get('tiltEQ'));
    setSlider('tiltPivot', get('tiltPivot'));
    setSlider('highBoost', get('highBoost'));
    setSlider('stickyIn', get('stickyIn'));
    setSlider('stickyOut', get('stickyOut'));
    setSlider('bands', bandChoiceIndex(get('bands')));
    setSlider('depthMove', get('depthMove'));
    setSlider('xyMove', get('xyMove'));
    setSlider('parallax', get('parallax'));
    setSlider('musicParallax', get('musicParallax'));
    setSlider('quietMovement', get('quietMovement'));
    $('quietMovement').parentElement.querySelector('.val').textContent = `${Math.round(get('quietMovement') * 100)}%`;
    setSlider('energyResponse', get('energyResponse'));
    const curveKey = `${get('quietMovement')}:${get('energyResponse')}:${get('sensGain')}:${get('sensFloor')}:${get('sensCurve')}`;
    if (this._curveKey !== curveKey) {
      this._curveKey = curveKey;
      const gain = get('sensGain');
      const floor = get('sensFloor');
      const curve = get('sensCurve');
      const threshold = Math.min(1, floor / gain);
      const cutoffX = 28 + threshold * 238;
      $('noiseFloorShade').setAttribute('width', String(threshold * 238));
      $('noiseFloorLine').setAttribute('d', `M${cutoffX} 8V72`);
      const points = Array.from({ length: 65 }, (_, i) => {
        const x = i / 64;
        const amplified = Math.min(1, x * gain);
        const aboveFloor = amplified <= floor ? 0 : (amplified - floor) / (1 - floor);
        const band = Math.pow(aboveFloor, curve);
        const motion = band * movementResponse(x, get('quietMovement'), get('energyResponse'));
        return `${i ? 'L' : 'M'}${28 + x * 238},${72 - motion * 64}`;
      });
      $('responseLine').setAttribute('d', points.join(' '));
    }
    setSlider('overscan', get('overscan'));

    $('autoQuality').checked = get('autoQuality');
    $('previewPaused').checked = !!get('previewPaused');
    $('previewFullQuality').checked = !!get('previewFullQuality');
    $('idleSleep').checked = get('idleSleep');
    $('invertBands').checked = !!get('invertBands');
    $('preserveBoostColor').checked = !!get('preserveBoostColor');
    $('hideBackdrop').checked = !!get('hideBackdrop');
    $('flybyExit').checked = !!get('flybyExit');
    $('cursorRipple').checked = !!get('cursorRipple');
    const cm = $('centeredMotion');
    if (cm) cm.checked = !!get('centeredMotion');
    $('equalDepthMovement').checked = !!get('equalDepthMovement');

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

  setLevel(v) {
    const width = `${Math.round(v * 100)}%`;
    if (width === this._levelWidth) return;
    this._levelWidth = width;
    this.levelBar.style.width = width;
  }

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
