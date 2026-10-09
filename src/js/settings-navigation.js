// Event-driven organisation only: never changes saved visual settings.
export class SettingsNavigation {
  constructor(panel, get) {
    this.panel = panel;
    this.get = get;
    const byId = id => document.getElementById(id);
    const row = id => byId(id)?.closest('label') || byId(id);
    const group = (title, nodes) => {
      nodes = nodes.filter(Boolean);
      const fold = document.createElement('details');
      fold.className = 'fold settings-tier';
      const summary = document.createElement('summary');
      summary.textContent = title;
      fold.append(summary);
      nodes[0].before(fold);
      fold.append(...nodes);
      return fold;
    };
    const depth = byId('depthSeg').closest('section');
    const description = [...depth.querySelectorAll('p')].find(p => p.textContent.startsWith('AI fast uses'));
    if (description) byId('depthSeg').after(description);
    group('Advanced depth', [byId('depthTuning'), row('depthShape'), row('depthShapeMotion'),
      byId('occludedBackground').closest('details'), row('gapFill'), byId('gapFillRows').closest('details')]);
    group('Advanced colour & light', ['lightFollowMotion', 'preserveBoostColor', 'sizePulse',
      'vibrancyPulse', 'hueReaction', 'hueCycle', 'hueFocus'].map(row));
    // Keep response graphs and their explanations together when moving them.
    const start = row('audioCurvature'), motion = start.closest('section');
    const nodes = [...motion.children];
    group('Advanced motion & response', nodes.slice(nodes.indexOf(start)));
    this.dependencies = [
      [byId('depthTuning'), () => ['onnx', 'onnx-base'].includes(get('depthMode'))],
      [row('depthShapeMotion'), () => get('depthShape') > 0],
      [row('cleanDepthEdges'), () => get('depthMode') !== 'flat'],
      ...['reconstructionOcclusion', 'reconstructionPointLimit', 'reconstructionWidth', 'reconstructionBrightness']
        .map(id => [row(id), () => get('occludedBackground')]),
      [row('reconstructionSideOcclusion'), () => get('occludedBackground') && get('reconstructionOcclusion') && get('gapFill')>0],
      [row('reconstructionSharedOcclusion'), () => get('occludedBackground') && get('reconstructionOcclusion') && get('reconstructionSideOcclusion') && get('gapFill')>0],
      [byId('gapFillRows').closest('details'), () => get('gapFill') > 0],
      [row('gapFillThickness'), () => get('occludedBackground') && get('gapFillManualLimit')],
      [row('gapFillThicknessBias'), () => get('occludedBackground') && get('gapFillForegroundLimit')],
      ...['gapFillManualLimit', 'gapFillForegroundLimit'].map(id => [row(id), () => get('occludedBackground')]),
      ...['lightFollowMotion', 'preserveBoostColor'].map(id => [row(id), () => get('boost') > 0]),
      [row('hueFocus'), () => get('hueReaction') !== 0],
      [byId('curvatureSourceSeg'), () => get('audioCurvature') !== 0],
      [row('depthShadingMotion'), () => get('depthShading') > 0],
      [row('flybyExit'), () => get('idleSleep')],
      [row('previewFullQuality'), () => !get('settingsOnly') && !get('previewPaused')],
    ];
    this.badges = [];
    const badge = (id, tip, high = () => false) => {
      const control = byId(id), host = control.closest('label')?.querySelector('.lbl') || control.closest('label') || control;
      const mark = document.createElement('span');
      mark.className = 'resource-cost'; mark.textContent = '!'; mark.tabIndex = 0;
      mark.title = tip; mark.setAttribute('aria-label', tip);
      host.append(mark); this.badges.push([mark, high]);
    };
    badge('depthSeg', 'Preparation cost: AI depth downloads a model and uses extra memory while preparing an image. No continuous AI processing.');
    badge('aiFillThickness', 'Preparation cost: object masks run when needed for an image; results are cached.');
    badge('occludedBackground', 'Preparation and rendering cost: reconstructs hidden layers, then draws extra points while enabled.');
    badge('reconstructionSharedOcclusion', 'Rendering cost: one reduced-resolution GPU wall mask. Its render target is released when off or idle. No extra AI inference.');
    badge('pointCount', 'Rendering cost: more points use more GPU work and memory. Red indicates 300k or more.', () => get('pointCount') >= 300000);
    badge('gapFillPointLimit', 'Rendering cost: extra fill points use GPU work and memory. Red indicates 300k or more.', () => get('gapFillPointLimit') >= 300000);
    badge('reconstructionPointLimit', 'Rendering cost: hidden points add GPU work and memory. Red indicates 150k or more.', () => get('reconstructionPointLimit') >= 150000);
    badge('previewFullQuality', 'Rendering cost: an active full-quality preview adds work alongside the wallpaper.');
    const toolbar = document.createElement('div');
    toolbar.className = 'settings-search';
    toolbar.innerHTML = '<input id="settingsSearch" type="search" placeholder="Search all settings…" aria-label="Search all settings" /><p class="hint" id="settingsSearchStatus" role="status"></p>';
    panel.querySelector('.panel-head').after(toolbar);
    this.input = byId('settingsSearch'); this.status = byId('settingsSearchStatus');
    this.sections = [...panel.querySelectorAll(':scope > section')];
    this.folds = [...panel.querySelectorAll('details')];
    // Snapshot searchable text once, excluding changing status values and usage tables.
    this.index = new Map(this.sections.map(section => [section, this.text(section)]));
    this.foldIndex = new Map(this.folds.map(fold => [fold, this.text(fold)]));
    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { this.input.value = ''; this.update(); event.stopPropagation(); }
    });
  }
  text(element) {
    return (element.textContent + ' ' + [...element.querySelectorAll('[data-tip]')].map(q => q.dataset.tip).join(' ')).toLowerCase();
  }
  update() {
    for (const [element, enabled] of this.dependencies) element?.classList.toggle('dependency-hidden', !enabled());
    for (const [mark, high] of this.badges) mark.classList.toggle('high-cost', high());
    const query = this.input.value.trim().toLowerCase(), terms = query.split(/\s+/).filter(Boolean);
    const matches = text => terms.every(term => text.includes(term));
    if (query && !this.savedFolds) this.savedFolds = new Map(this.folds.map(fold => [fold, fold.open]));
    let count = 0;
    for (const section of this.sections) {
      const match = !query || matches(this.index.get(section));
      section.classList.toggle('search-hidden', !match);
      if (match) count++;
    }
    for (const fold of this.folds) {
      if (query) fold.open = fold.id !== 'processUsage' && matches(this.foldIndex.get(fold));
      else if (this.savedFolds) fold.open = this.savedFolds.get(fold);
    }
    if (!query) this.savedFolds = null;
    this.status.textContent = query ? (count ? `${count} matching sections. Dependent options appear when their effect is enabled.` : 'No matching settings.') : 'Main controls → Advanced → fine tuning';
    this.panel.dispatchEvent(new Event('settings-visibility'));
  }
}
