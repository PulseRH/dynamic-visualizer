// HUD + settings panel wiring. Owns DOM; app.js supplies the heavy lifting
// through callbacks.

import { get, set, onChange, getAll, DEFAULTS } from './settings.js';
import { bridge, isElectron } from './bridge.js';
import { ProcessMonitor } from './process-monitor.js';
import {createPresetStore} from './presets.js';
import { responsePlots } from './response-plots.js';
import { easingBendAt, constrainBezier, moveBezierControl, DEFAULT_BEZIER } from './easing.js';
import { BAND_CHOICES, bandChoiceIndex } from './band-choices.js';
import { imageAccent, PURPLE_ACCENT } from './ui-accent.js';
import { SettingsNavigation } from './settings-navigation.js';

const $ = (sel) => document.getElementById(sel.replace(/^#/, ''));

export class UI {
  constructor(callbacks) {
    this.cb = callbacks; // { onImagePicked(source), onAudioMode(mode, opts) }
    this.stats = $('statsChip');
    this.dot = $('audioDot');
    this.label = $('audioLabel');
    this.levelBar = $('levelBar');
    this.hint = $('audioHint');

    this.navigation = new SettingsNavigation($('panel'), get);
    this._wirePresets();
    this._wirePanel();
    this._wireProcessUsage();
    this._wireSegments();
    this._wireSliders();
    this._wireEasingGraphs();
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

  _wireEasingGraphs() {
    for(const part of ['In','Out']) {
      const prefix=`ease${part}`, fall=part==='Out';
      for(const tangent of [false,true]) {
        const handle=$(`easing${part}${tangent ? 'SlopeHandle':'Handle'}`), graph=handle.ownerSVGElement;
        let pointer=null, offset={x:0,y:0};
        const local=event=>new DOMPoint(event.clientX,event.clientY).matrixTransform(graph.getScreenCTM().inverse());
        const key=()=>`${prefix}${tangent ? 'Slope':get(`${prefix}Style`)==='s' ? 'Position':'Shape'}`;
        const isCustom=()=>get(`${prefix}Style`)==='custom';
        const changeControl=(x,y)=>set({[`${prefix}Bezier`]:moveBezierControl(get(`${prefix}Bezier`),tangent ? 2:0,x,y)});
        const change=value=>{
          const active=key(), position=active.endsWith('Position'), slope=active.endsWith('Slope');
          set({[active]:Math.max(position ? .15:slope ? 0:-1,Math.min(position ? .85:1,Math.round(value*100)/100))});
        };
        handle.addEventListener('pointerdown',event=>{
          if(event.button!==0) return;
          event.preventDefault(); pointer=event.pointerId;
          const point=local(event), matrix=handle.transform.baseVal.getItem(0).matrix;
          offset={x:point.x-matrix.e,y:point.y-matrix.f};
          handle.setPointerCapture(pointer);
        });
        handle.addEventListener('pointermove',event=>{
          if(pointer!==event.pointerId) return;
          const point=local(event), x=point.x-offset.x, y=point.y-offset.y;
          if(isCustom()) changeControl((x-60)/224,fall ? (y-20)/96:(116-y)/96);
          else if(tangent) {
            const p=get(`${prefix}Position`), dx=(x-(60+224*p))/224, dy=(68-y)/96*(fall ? -1:1);
            // Constrain the tangent to the forward quadrant; it cannot reverse.
            if(dx<=0 || dy<0) return;
            change((4*p*(1-p)*dy/Math.max(.001,dx)-1)/3);
          } else if(get(`${prefix}Style`)==='s') change((x-60)/224);
          else {
            const height=Math.max(0,Math.min(1,(116-y)/96));
            change(easingBendAt(.5,fall ? 1-height:height));
          }
        });
        handle.addEventListener('lostpointercapture',()=>{pointer=null;});
        handle.addEventListener('pointerup',event=>{if(pointer===event.pointerId) handle.releasePointerCapture(pointer);});
        handle.addEventListener('dblclick',()=>isCustom() ? set({[`${prefix}Bezier`]:[...DEFAULT_BEZIER]}):change(key().endsWith('Shape') ? 0:.5));
        handle.addEventListener('keydown',event=>{
          if(isCustom()) {
            const controls=constrainBezier(get(`${prefix}Bezier`)), index=tangent ? 2:0, step=event.shiftKey ? .1:.01;
            if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
              event.preventDefault();
              changeControl(controls[index]+(event.key==='ArrowLeft' ? -step:event.key==='ArrowRight' ? step:0),
                controls[index+1]+(event.key==='ArrowUp' ? (fall ? -step:step):event.key==='ArrowDown' ? (fall ? step:-step):0));
            }
            return;
          }
          const isShape=key().endsWith('Shape');
          const direction={ArrowLeft:-1,ArrowRight:1,ArrowUp:isShape && !fall ? -1:1,ArrowDown:isShape && !fall ? 1:-1}[event.key];
          if(direction) {event.preventDefault();change(get(key())+direction*(event.shiftKey ? .1:.01));}
          else if(event.key==='Home' || event.key==='End') {
            event.preventDefault();
            const position=key().endsWith('Position');
            change(event.key==='Home' ? (position ? .15:isShape ? -1:0):(position ? .85:1));
          }
        });
        handle.addEventListener('wheel',event=>{
          if(!event.deltaY) return;
          event.preventDefault();
          if(isCustom()) {
            const controls=constrainBezier(get(`${prefix}Bezier`)), index=tangent ? 2:0;
            changeControl(controls[index],controls[index+1]+Math.sign(event.deltaY)*(fall ? 1:-1)*.01);
          } else change(get(key())+Math.sign(event.deltaY)*.01);
        },{passive:false});
      }
    }
  }
  _wirePresets() {
    const store=createPresetStore(DEFAULTS),name=$('presetName');
    const refresh=()=>{
      $('presetNames').replaceChildren(...store.names().map(value=>{const option=document.createElement('option');option.value=value;return option;}));
    };
    refresh();
    $('savePreset').onclick=()=>{
      try{name.value=store.save(name.value,getAll());refresh();this.toast(`Saved “${name.value}”`);}catch(error){this.toast(error.message,'err');}
    };
    $('loadPreset').onclick=()=>{
      try{set(store.load(name.value));this.toast(`Loaded “${name.value.trim()}”`);}catch(error){this.toast(error.message,'err');}
    };
    window.addEventListener('storage',event=>{if(event.key==='dv.presets.v1')refresh();});
  }

  _wirePanel() {
    this.narrowWindow = window.matchMedia('(max-width: 480px)');
    this.narrowWindow.addEventListener('change', () => this._syncWindowLayout());
    $('showPreview').onclick = () => {
      if (get('settingsOnly')) set({ settingsOnly: false });
      else bridge.settingsOnly(false, true);
    };
    $('pinWallpaperSelector').onchange = event => set({pinWallpaperSelector:event.target.checked});
    $('gearBtn').onclick = () => {
      $('panel').classList.toggle('open');
      $('hud').classList.remove('faded');
    };
    $('closePanel').onclick = () => {
      if (document.body.classList.contains('settings-only')) set({ settingsOnly: false });
      else $('panel').classList.remove('open');
    };
  }

  _wireProcessUsage() {
    const fold = $('processUsage'), body = $('processUsageRows'), status = $('processUsageStatus');
    let nativeVisible = false;
    const monitor = new ProcessMonitor({
      sample: () => bridge.getProcessUsage(),
      render: rows => {
        status.textContent = rows === null ? 'Unable to read processes. Retrying…' : rows.length ? '' : 'No visible desktop processes.';
        body.replaceChildren(...(rows || []).map(item => {
          const row = document.createElement('tr');
          for (const value of [item.name, item.pid, item.cpu === null ? '—' : `${item.cpu.toFixed(1)}%`, item.ramMB === null ? '—' : `${item.ramMB.toFixed(1)}`]) {
            const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
          }
          return row;
        }));
      },
    });
    const sync = () => monitor.setActive(isElectron && fold.open && !fold.closest('.search-hidden') && $('panel').classList.contains('open') && nativeVisible && !document.hidden);
    $('panel').addEventListener('settings-visibility', sync);
    fold.addEventListener('toggle', sync);
    const observer = new MutationObserver(sync);
    observer.observe($('panel'), {attributes:true, attributeFilter:['class']});
    document.addEventListener('visibilitychange', sync);
    const off = bridge.onWindowVisibility(visible => {nativeVisible = visible; sync();});
    bridge.isWindowVisible().then(visible => {nativeVisible = visible; sync();});
    window.addEventListener('pagehide', () => {monitor.setActive(false); observer.disconnect(); off();}, {once:true});
    if (!isElectron) status.textContent = 'Process usage is available in the desktop app.';
  }

  _syncWindowLayout() {
    if (new URLSearchParams(location.search).get('wallpaper') === '1') return;
    const compact = get('settingsOnly') || this.narrowWindow.matches;
    document.body.classList.toggle('settings-only', compact);
    $('showPreview').hidden = !compact;
    if (compact) $('panel').classList.add('open');
    if (this.lastSettingsOnly !== !!get('settingsOnly')) {
      this.lastSettingsOnly = !!get('settingsOnly');
      bridge.settingsOnly(this.lastSettingsOnly).catch(console.warn);
    }
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
    seg('easeInStyle','easeInStyle');
    seg('easeOutStyle','easeOutStyle');
    seg('bandMapSeg', 'bandMap');
    seg('curvatureSourceSeg','curvatureSource');
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
    for(const key of ['depthSmoothing','depthSpikeCleanup'])slider(key,key,v=>`${Math.round(v*100)}%`);
    slider('depthShape','depthShape',v=>`${Math.round(v*100)}%`);
    slider('gapFill','gapFill',v=>`${Math.round(v*100)}%`);
    slider('gapFillDensity','gapFillDensity',v=>String(Math.round(v)));
    slider('gapFillRows','gapFillRows',v=>String(Math.round(v)));
    slider('gapFillSpread','gapFillSpread',v=>`${Number(v).toFixed(2)}×`);
    slider('gapFillBrightness','gapFillBrightness',v=>`${Math.round(v*100)}%`);
    $('gapFillOnlyOpen').onchange=e=>set({gapFillOnlyOpen:e.target.checked});
    slider('gapFillAdaptive','gapFillAdaptive',v=>`${Math.round(v*100)}%`);
    slider('gapFillDepthLimit','gapFillDepthLimit',v=>`${Math.round(v*100)}%`);
    slider('depthShading','depthShading',v=>`${Math.round(v*100)}%`);
    $('occludedBackground').onchange=e=>set({occludedBackground:e.target.checked});
    $('reconstructionOcclusion').onchange=e=>set({reconstructionOcclusion:e.target.checked});
    $('reconstructionSideOcclusion').onchange=e=>set({reconstructionSideOcclusion:e.target.checked});
    $('reconstructionSharedOcclusion').onchange=e=>set({reconstructionSharedOcclusion:e.target.checked});
    slider('reconstructionBrightness','reconstructionBrightness',v=>`${Math.round(v*100)}%`);
    slider('reconstructionPointLimit','reconstructionPointLimit',v=>`${Math.round(v/1000)}k`);
    slider('reconstructionWidth','reconstructionWidth',v=>`${v.toFixed(2)}×`);
    slider('gapFillPointLimit','gapFillPointLimit',v=>v===0 ? 'Off':`${Math.round(v/1000)}k`);
    $('cleanDepthEdges').onchange=e=>set({cleanDepthEdges:e.target.checked});
    $('smartDepthBands').onchange=e=>set({smartDepthBands:e.target.checked});
    $('gapFillForegroundLimit').onchange=e=>set({gapFillForegroundLimit:e.target.checked});
    $('gapFillManualLimit').onchange=e=>set({gapFillManualLimit:e.target.checked});
    slider('gapFillThickness','gapFillThickness',v=>`${Math.round(v*100)}%`);
    $('aiFillThickness').onchange=e=>set({aiFillThickness:e.target.checked});
    slider('gapFillThicknessBias','gapFillThicknessBias',v=>`${v.toFixed(2)}×`);
    slider('pointCount', 'pointCount', (v) => `${Math.round(v / 1000)}k`);
    slider('pointSize', 'pointSize', (v) => v.toFixed(1));
    slider('glow', 'glow', (v) => v.toFixed(2));
    slider('boost', 'boost', (v) => v.toFixed(2));
    slider('sizePulse', 'sizePulse', (v) => `${Math.round(v * 100)}%`);
    slider('vibrancyPulse', 'vibrancyPulse', (v) => `${Math.round(v * 100)}%`);
    slider('hueReaction', 'hueReaction', (v) => `${Math.round(v)}°`);
    slider('hueCycle', 'hueCycle', (v) => `±${Math.round(v)}°`);
    slider('hueFocus', 'hueFocus', (v) => `${Math.round(v * 100)}%`);
    slider('intensity', 'intensity', (v) => v.toFixed(2));
    for (const key of ['motionWave', 'motionRipple', 'motionBands', 'motionDrift',
      'motionSwirl', 'motionBreathe', 'motionSweep', 'motionBandShake']) {
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
    slider('easeInShape', 'easeInShape', (v) => v.toFixed(2));
    slider('easeOutShape', 'easeOutShape', (v) => v.toFixed(2));
    for(const part of ['In','Out']) {
      slider(`ease${part}Slope`,`ease${part}Slope`,v=>`${Math.round(v*100)}%`);
      slider(`ease${part}Position`,`ease${part}Position`,v=>`${Math.round(v*100)}%`);
    }
    $('bands').max = String(BAND_CHOICES.length - 1);
    slider('bands', 'bands', (v) => String(v), (i) => BAND_CHOICES[i]);
    slider('depthMove', 'depthMove', (v) => v.toFixed(2));
    slider('xyMove', 'xyMove', (v) => v.toFixed(2));
    slider('parallax', 'parallax', (v) => v.toFixed(2));
    slider('musicParallax', 'musicParallax', (v) => v.toFixed(2));
    slider('audioCurvature','audioCurvature',v=>`${Math.round(v*100)}%`);
    slider('dollyZoom','dollyZoom',v=>`${Math.round(v*100)}%`);
    slider('quietMovement', 'quietMovement', (v) => `${Math.round(v * 100)}%`);
    slider('energyResponse', 'energyResponse', (v) => v.toFixed(2));
    slider('fillStrength','fillStrength',v=>`${Math.round(v*100)}%`);
    const placement = v => Math.abs(v)<.005 ? 'Even' : `${Math.round(v*100)}%`;
    slider('bandDistribution','bandDistribution',placement);
    slider('surfaceCohesion','surfaceCohesion',v=>`${Math.round(v*100)}%`);
    slider('wallpaperCycleMinutes','wallpaperCycleMinutes',v=>`${v} min`);
    slider('wallpaperCrossfade','wallpaperCrossfade',v=>`${v.toFixed(1)} s`);
    $('wallpaperCycle').onchange=e=>set({wallpaperCycle:e.target.checked});
    $('nextWallpaper').onclick=()=>this.cb.onNextWallpaper?.();
    slider('framingSmoothing','framingSmoothing',v=>`${(.25+1.75*v*v).toFixed(2)} s`);
    $('calibrateEnergy').onclick = () => this.cb.onCalibrateEnergy();

    $('autoQuality').onchange = (e) => set({ autoQuality: e.target.checked });
    $('previewPaused').onchange = (e) => set({ previewPaused: e.target.checked });
    $('settingsOnly').onchange = (e) => set({ settingsOnly: e.target.checked });
    $('previewFullQuality').onchange = (e) => set({ previewFullQuality: e.target.checked });
    $('idleSleep').onchange = (e) => set({ idleSleep: e.target.checked });
    $('invertBands').onchange = (e) => set({ invertBands: e.target.checked });
    $('preserveBoostColor').onchange = (e) => set({ preserveBoostColor: e.target.checked });
    $('lightFollowMotion').onchange = (e) => set({ lightFollowMotion: e.target.checked });
    $('depthShadingMotion').onchange = (e) => set({ depthShadingMotion: e.target.checked });
    $('depthShapeMotion').onchange = (e) => set({ depthShapeMotion: e.target.checked });
    $('matchImageAccent').onchange = (e) => set({ matchImageAccent: e.target.checked });
    $('hideBackdrop').onchange = (e) => set({ hideBackdrop: e.target.checked });
    $('flybyExit').onchange = (e) => set({ flybyExit: e.target.checked });
    $('cursorRipple').onchange = (e) => set({ cursorRipple: e.target.checked });
    const cmw = $('centeredMotion');
    if (cmw) cmw.onchange = (e) => set({ centeredMotion: e.target.checked });
    $('equalDepthMovement').onchange = (e) => set({ equalDepthMovement: e.target.checked });
    $('keepScreenCovered').onchange = (e) => set({ keepScreenCovered: e.target.checked });

    // Adjust only the range under the pointer; keep the panel scrollable
    // everywhere else. Dispatch input so special sliders use their own logic.
    for (const el of document.querySelectorAll('#panel input[type="range"]')) {
      let wheelCarry = 0;
      el.addEventListener('wheel', (event) => {
        if (el.disabled) return;
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
    this.navigation.update();
    for(const [key,fmt] of [['gapFillPointLimit',v=>v===0 ? 'Off':`${Math.round(v/1000)}k`],['reconstructionPointLimit',v=>`${Math.round(v/1000)}k`],['reconstructionWidth',v=>`${v.toFixed(2)}×`],['gapFillThicknessBias',v=>`${v.toFixed(2)}×`]]){
      $(key).value=get(key);$(key).parentElement.querySelector('.val').textContent=fmt(get(key));
    }
    $('occludedBackground').checked=!!get('occludedBackground');
    $('reconstructionOcclusion').checked=!!get('reconstructionOcclusion');
    $('reconstructionSideOcclusion').checked=!!get('reconstructionSideOcclusion');
    $('reconstructionSharedOcclusion').checked=!!get('reconstructionSharedOcclusion');
    $('cleanDepthEdges').checked=!!get('cleanDepthEdges');
    $('cleanDepthEdges').disabled=get('depthMode')==='flat';
    for(const key of ['depthSmoothing','depthSpikeCleanup'])$(key).disabled=!['onnx','onnx-base'].includes(get('depthMode'));
    $('smartDepthBands').checked=!!get('smartDepthBands');
    $('gapFillForegroundLimit').checked=!!get('gapFillForegroundLimit');
    $('gapFillManualLimit').checked=!!get('gapFillManualLimit');
    $('gapFillThickness').value=get('gapFillThickness');
    $('gapFillThickness').parentElement.querySelector('.val').textContent=`${Math.round(get('gapFillThickness')*100)}%`;
    $('gapFillThickness').disabled=!get('gapFillManualLimit');
    $('pinWallpaperSelector').checked=!!get('pinWallpaperSelector');
    $('panel').classList.toggle('pin-wallpaper',!!get('pinWallpaperSelector'));
    $('aiFillThickness').checked=!!get('aiFillThickness');
    this._applyAccent();
    $('matchImageAccent').checked = !!get('matchImageAccent');
    const syncSeg = (id, v) => {
      $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    };
    syncSeg('depthSeg', get('depthMode'));
    syncSeg('bandMapSeg', get('bandMap'));
    syncSeg('curvatureSourceSeg',get('curvatureSource'));
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
    $('gapFillOnlyOpen').checked=get('gapFillOnlyOpen')!==false;
    for(const key of ['depthSmoothing','depthSpikeCleanup','depthShape','gapFill','depthShading','gapFillBrightness','gapFillDepthLimit','gapFillAdaptive','reconstructionBrightness']){
      setSlider(key,get(key));
      $(key).parentElement.querySelector('.val').textContent=`${Math.round(get(key)*100)}%`;
    }
    for(const key of ['gapFillDensity','gapFillRows','gapFillSpread']){
      setSlider(key,get(key));
      $(key).parentElement.querySelector('.val').textContent=key==='gapFillSpread' ? `${Number(get(key)).toFixed(2)}×`:String(Math.round(get(key)));
    }
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
    setSlider('hueCycle', get('hueCycle'));
    $('hueCycle').parentElement.querySelector('.val').textContent = `±${Math.round(get('hueCycle'))}°`;
    setSlider('hueFocus', get('hueFocus'));
    $('hueFocus').parentElement.querySelector('.val').textContent = `${Math.round(get('hueFocus') * 100)}%`;
    setSlider('intensity', get('intensity'));
    for (const key of ['motionWave', 'motionRipple', 'motionBands', 'motionDrift',
      'motionSwirl', 'motionBreathe', 'motionSweep', 'motionBandShake']) {
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
    setSlider('easeInShape', get('easeInShape'));
    setSlider('easeOutShape', get('easeOutShape'));
    for(const part of ['In','Out']) {
      const prefix=`ease${part}`, isS=get(`${prefix}Style`)==='s', isCustom=get(`${prefix}Style`)==='custom';
      syncSeg(`${prefix}Style`,get(`${prefix}Style`));
      $(`${prefix}SControls`).hidden=!isS;
      $(`${prefix}Shape`).parentElement.hidden=isS || isCustom;
      $(`${prefix}CustomHint`).hidden=!isCustom;
      for(const name of ['Slope','Position']) {
        setSlider(`${prefix}${name}`,get(`${prefix}${name}`));
        $(`${prefix}${name}`).parentElement.querySelector('.val').textContent=`${Math.round(get(`${prefix}${name}`)*100)}%`;
      }
    }
    setSlider('bands', bandChoiceIndex(get('bands')));
    setSlider('depthMove', get('depthMove'));
    setSlider('xyMove', get('xyMove'));
    setSlider('parallax', get('parallax'));
    setSlider('musicParallax', get('musicParallax'));
    for(const key of ['audioCurvature','dollyZoom']){
      setSlider(key,get(key));$(key).parentElement.querySelector('.val').textContent=`${Math.round(get(key)*100)}%`;
    }
    setSlider('quietMovement', get('quietMovement'));
    $('quietMovement').parentElement.querySelector('.val').textContent = `${Math.round(get('quietMovement') * 100)}%`;
    setSlider('energyResponse', get('energyResponse'));
    const curveKey = ['quietMovement','energyResponse','sensGain','sensFloor','sensCurve',
      'eqCurve','tiltEQ','tiltPivot','highBoost','stickyIn','stickyOut','easeInShape','easeOutShape',
      'easeInStyle','easeOutStyle','easeInSlope','easeOutSlope','easeInPosition','easeOutPosition','easeInBezier','easeOutBezier','bands'].map(get).join(':');
    if (this._curveKey !== curveKey) {
      this._curveKey = curveKey;
      const plots = responsePlots(getAll());
      $('noiseFloorShade').setAttribute('width', String(plots.threshold * 224));
      $('noiseFloorLine').setAttribute('d', `M${60 + plots.threshold * 224} 20V116`);
      $('noiseFloorLabel').textContent = `Noise cutoff: ${Math.round(plots.threshold * 100)}%`;
      $('energyOrigin').setAttribute('cy', String(plots.energyOriginY));
      for (const [id,key] of Object.entries({ energyLine:'energy', responseLine:'band', frequencyLine:'frequency',
        highBoostLine:'highBoost', frequencyZero:'frequencyZero', easingInLine:'easingIn', easingOutLine:'easingOut' })) $(id).setAttribute('d', plots[key]);
      $('frequencyMax').textContent = `+${plots.max}`;
      $('frequencyMin').textContent = String(plots.min);
      $('frequencyZeroLabel').setAttribute('y', String(plots.zeroY + 3));
      $('easingTimeEnd').textContent = `${plots.easingInSeconds.toFixed(2)} s`;
      $('easingOutTimeEnd').textContent = `${plots.easingOutSeconds.toFixed(2)} s`;
      for(const part of ['In','Out']) {
        const prefix=`ease${part}`, plotPrefix=`easing${part}`, isS=get(`${prefix}Style`)==='s', fall=part==='Out';
        const x=plots[`${plotPrefix}MidX`], y=plots[`${plotPrefix}MidY`], dx=224*.25/plots[`${plotPrefix}Tangent`], dy=fall ? 24:-24;
        const handle=$(`${plotPrefix}Handle`), slopeHandle=$(`${plotPrefix}SlopeHandle`), tangent=$(`${plotPrefix}Tangent`);
        if(get(`${prefix}Style`)==='custom') {
          const points=constrainBezier(get(`${prefix}Bezier`)), coords=[];
          for(const [control,index] of [[handle,0],[slopeHandle,2]]) {
            const cx=60+224*points[index], cy=116-96*(fall ? 1-points[index+1]:points[index+1]);
            coords.push([cx,cy]);control.toggleAttribute('hidden',false);
            control.setAttribute('transform',`translate(${cx} ${cy})`);
            control.setAttribute('aria-label',`Ease ${part.toLowerCase()} ${index===0 ? 'start':'finish'} curve handle`);
            control.setAttribute('aria-valuemin','0');control.setAttribute('aria-valuemax','1');
            control.setAttribute('aria-valuenow',String(points[index+1]));
            control.setAttribute('aria-valuetext',`Time ${Math.round(points[index]*100)}%, progress ${Math.round(points[index+1]*100)}%`);
            control.style.cursor='move';
          }
          tangent.toggleAttribute('hidden',false);
          tangent.setAttribute('d',`M60 ${fall ? 20:116}L${coords[0].join(' ')} M${coords[1].join(' ')}L284 ${fall ? 116:20}`);
          continue;
        }
        handle.removeAttribute('aria-valuetext');slopeHandle.removeAttribute('aria-valuetext');
        slopeHandle.setAttribute('aria-label',`Ease ${part.toLowerCase()} middle slope`);
        handle.setAttribute('transform',`translate(${x} ${y})`);
        handle.setAttribute('aria-label',`Ease ${part.toLowerCase()} ${isS ? 'transition point':'curve bend'}`);
        handle.setAttribute('aria-valuemin',isS ? '.15':'-1');
        handle.setAttribute('aria-valuemax',isS ? '.85':'1');
        handle.setAttribute('aria-valuenow',String(get(`${prefix}${isS ? 'Position':'Shape'}`)));
        handle.style.cursor=isS ? 'ew-resize':'ns-resize';
        slopeHandle.toggleAttribute('hidden',!isS); tangent.toggleAttribute('hidden',!isS);
        slopeHandle.style.cursor='crosshair';
        slopeHandle.setAttribute('transform',`translate(${x+dx} ${y+dy})`);
        slopeHandle.setAttribute('aria-valuenow',String(get(`${prefix}Slope`)));
        tangent.setAttribute('d',`M${x-dx} ${y-dy}L${x+dx} ${y+dy}`);
      }
    }
    $('keepScreenCovered').checked = !!get('keepScreenCovered');
    setSlider('bandDistribution',get('bandDistribution'));
    const placement=get('bandDistribution');
    $('bandDistribution').parentElement.querySelector('.val').textContent=Math.abs(placement)<.005 ? 'Even' : `${Math.round(placement*100)}%`;
    $('bandDistributionRow').hidden=get('bandMap')!=='depth';
    $('smartDepthBands').parentElement.hidden=get('bandMap')!=='depth';
    $('surfaceCohesionRow').hidden=get('bandMap')!=='depth';
    $('surfaceCohesion').disabled=!get('aiFillThickness')||get('depthMode')==='flat';
    setSlider('surfaceCohesion',get('surfaceCohesion'));
    $('surfaceCohesion').parentElement.querySelector('.val').textContent=`${Math.round(get('surfaceCohesion')*100)}%`;
    $('wallpaperCycle').checked=!!get('wallpaperCycle');
    $('cycleControls').hidden=!get('wallpaperCycle');
    setSlider('wallpaperCycleMinutes',get('wallpaperCycleMinutes'));
    $('wallpaperCycleMinutes').parentElement.querySelector('.val').textContent=`${get('wallpaperCycleMinutes')} min`;
    setSlider('wallpaperCrossfade',get('wallpaperCrossfade'));
    $('wallpaperCrossfade').parentElement.querySelector('.val').textContent=`${get('wallpaperCrossfade').toFixed(1)} s`;
    $('framingControls').hidden=!get('keepScreenCovered');
    setSlider('fillStrength',get('fillStrength'));
    $('fillStrength').parentElement.querySelector('.val').textContent=`${Math.round(get('fillStrength')*100)}%`;
    setSlider('framingSmoothing',get('framingSmoothing'));
    $('framingSmoothing').parentElement.querySelector('.val').textContent=`${(.25+1.75*get('framingSmoothing')**2).toFixed(2)} s`;

    $('autoQuality').checked = get('autoQuality');
    $('previewPaused').checked = !!get('previewPaused');
    $('settingsOnly').checked = !!get('settingsOnly');
    this._syncWindowLayout();
    $('previewFullQuality').checked = !!get('previewFullQuality');
    $('idleSleep').checked = get('idleSleep');
    $('invertBands').checked = !!get('invertBands');
    $('preserveBoostColor').checked = !!get('preserveBoostColor');
    $('lightFollowMotion').checked = !!get('lightFollowMotion');
    $('depthShadingMotion').checked = !!get('depthShadingMotion');
    $('depthShapeMotion').checked = !!get('depthShapeMotion');
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

  setRecentImages(entries, currentUrl) {
    const strip = $('recentWallpapers');
    strip.replaceChildren();
    strip.hidden = !entries.length;
    for (const entry of entries) {
      const button = document.createElement('button');
      button.className = 'recent-wallpaper';
      button.title = entry.name;
      button.setAttribute('aria-label', `Use recent wallpaper: ${entry.name}`);
      button.setAttribute('aria-pressed', String(entry.url === currentUrl || entry.sourceUrl === currentUrl));
      const image = document.createElement('img');
      image.src = entry.thumb; image.alt = ''; image.width = 80; image.height = 45;
      button.append(image);
      button.onclick = () => this.cb.onImagePicked({ kind: 'recent', url: entry.url });
      strip.append(button);
    }
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
  setObjectMaskStatus(text) { $('objectMaskStatus').textContent=text; }
  setReconstructionStatus(text) { $('reconstructionStatus').textContent=text; }

  get settings() { return getAll(); }
}
