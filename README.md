# Dynamic Visualizer

An audio-reactive **point-cloud music visualizer** for **Linux and Windows**.
It takes your current desktop wallpaper (or any image you drop in), rebuilds it
as a GPU point cloud with estimated depth, and moves the depth layers in waves
that follow the music — bass swells the background, highs shimmer the
foreground, and bass hits move the regions mapped to bass.

Built with **Electron + Three.js (WebGL2)**. All animation runs in vertex
shaders: per frame the CPU only uploads the selected 8–128 band values, so the app idles at
a few percent CPU and holds a steady frame rate without spinning fans.

## Highlights

- **Native wallpaper mode** — one click puts the visualizer fullscreen *behind
  your desktop icons*, click-through, no taskbar entry: it behaves like the OS
  wallpaper. Controlled from the tray icon; exit anytime from the tray or the
  settings panel. (Windows: WorkerW parenting incl. 24H2 Progman fallback.
  Linux/X11: `_NET_WM_WINDOW_TYPE_DESKTOP` via xprop/wmctrl, best effort.
  Linux/Wayland: native layer-shell background surfaces on compatible compositors.)
  Windows wallpaper windows disable the native thick frame so reparenting does
  not leave side or bottom margins on newer Electron versions.
- **Image → point cloud**: jittered-grid sampling of up to 400k points, each
  point keeps its pixel color and a depth estimate.
- **Spatial frequency mapping** — you choose *where* each band acts on the
  image: **Radial** (bass rings from the center, highs at the edges),
  **Vertical** (bass at the ground, highs in the sky), **Horizontal**, or by
  **Depth** layer. Regions whose band is quiet go dim while loud ones glow.
- **Motion styles**: audio-driven spectrum displacement (no self-motion — the
  image only moves when the music does), traveling wave, radial ripple,
  band bars, or ambient drift.
  **Light follows layers** keeps its spatial contrast even at low motion
  amounts; amounts weight the pattern mix without washing out the base glow.
  **Music parallax** slowly cycles the audio sway direction while music plays,
  preserving displacement strength and pausing the cycle in silence.
  When the plain wallpaper fades in, the camera smoothly returns to the centred
  cover fit, including zoom and framing. The final centred, full-brightness frame
  is drawn before idle sleep; normal parallax resumes as the particles return.
  The Bands slider includes every count from 5 to 16, then even counts to 32
  and the existing four-band steps to 128.
- **Depth estimation**
  - *Heuristic* (default): instant luminance/saturation/position prior — no
    downloads, works offline.
  - *AI fast*: Depth Anything V2 Small via onnxruntime-web (~50 MB download).
  - *AI detail*: Depth Anything V2 Base (~195 MB download). It can give finer
    depth, but takes longer and uses more memory while processing a new image.
    The Base model is licensed CC-BY-NC-4.0 for non-commercial use.
  - AI models are fetched only when selected, cached in the browser Cache API,
    and fall back to the heuristic if unavailable. The depth worker exits after
    each image; model choice does not change animation workload.
- **Hidden background** (optional, under Depth): local MI-GAN inpainting
  reconstructs up to four hidden depth slices with separate masks, retaining
  context appropriate to each depth instead of one shared distant background.
  Strips cover depth steps from 0.06, so small figures just in front of a wall
  (a person on a balcony) get the wall reconstructed behind them; an occluding
  object is never used as context for the background it hides. Reveals
  particles as parallax or audio motion exposes them, including with static
  Depth strength at zero. Best with AI depth. It prepares narrow strips once
  per wallpaper, caches results by image content and depth map, and releases
  the AI worker afterward. The model downloads once (~27 MB, MIT weights);
  inference uses one CPU worker and never runs in the animation loop. Adds
  one particle draw call. **Hidden points** defaults to the original 40k/20%
  cap and can increase density and budget up to 200k (~10 MB extra geometry).
  **Fill width** ranges from 0.5× to 2.5×. The maximum coverage is prepared
  once; both controls resample cached colours without rerunning AI. Off has
  no extra geometry; zero Hidden brightness skips its drawing. It invents
  plausible hidden content; large openings and imperfect depth masks remain
  limitations. Wallpaper windows reuse the preview's completed asset.
  **Sides hide background** optionally extends the reconstruction occlusion
  boundary along filled sides, so background particles do not show through
  the side shell. Uses the cached local thickness and live Thickness bias;
  with both automatic and manual thickness limits off it covers the full side span. It adds a boundary
  evaluation per hidden vertex while enabled, with no extra draw call or AI.
  Off preserves the existing front-only reveal; empty/invisible Gap fill
  leaves reconstruction unchanged.
- **Gap fill points**: independently cap ordinary seam infill at 0–400k extra
  points (180k default). The Gap fill percentage scales that budget, with a
  150% of Count ceiling. Higher budgets add GPU work and memory. **Auto
  thickness** works like Fill thickness with a different percentage per
  object. Each object gets one depth estimate: its inscribed width, scaled by
  its AI object type when AI object masks are on (buildings deep, people and
  poles thin, vehicles long), with any depth slope across it as a minimum.
  **Thickness bias** multiplies every percentage; **Size balance** sets how
  strongly size matters (Equal gives every object the image's typical depth,
  100% uses the estimate, 200% exaggerates). Both update live. Depth scale and
  audio motion stretch walls without changing their share, and samples are
  redistributed instead of deleting whole seams.
  Each seam uses one estimate at its foreground endpoint; outline influence
  blends continuously into unchanged interior seams without separate wall or
  outline geometry. Object-edge fill uses the original foreground endpoint's
  colour and audio lighting, extending it towards the background. Camera or
  audio depth reversals cannot transfer ownership to the background. Bias
  changes live; point-budget edits resample cached
  image/depth data without AI. Thickness remains a visual estimate.
  **Limit Gap fill thickness** restores the manual percentage control: 60%
  occupies the front 60% of a foreground bridge, redistributing the same
  points across that shorter span. At 0%, foreground edge fill is hidden.
  It works with reconstruction; Auto thickness can remain on, in which case
  the smaller limit wins. Side/background occlusion follows the same cap.
- **AI object masks** (near Bands) supplies quantised SegFormer B0 ADE20K
  contours (~4.5 MB, downloaded once) to Clean object edges, Keep surfaces together and Auto
  thickness. Runs in one CPU worker during wallpaper preparation, caches up
  to eight estimates, and releases the worker afterwards. The status shows
  detected masks, coherent surface coverage and which controls use them.
  Masks alone do not change the picture. Auto thickness still needs
  reconstruction and visible Gap fill; unavailable masks use depth-only
  thickness and independent band motion.
- **Clean object edges** (under Depth) collapses softened foreground/background
  transitions onto their front or back surface, avoiding intermediate depth
  strips that become extra moving slabs. AI contours refine the cut when
  available. Gap fill forms a foreground-coloured sidewall at these silhouettes;
  Limit Gap fill thickness controls its extent, exposing reconstructed background
  beyond the wall. Interior slopes and the cached source
  depth are retained; switching off restores original geometry. Runs in the
  sampling worker during rebuilds, with no additional per-frame work or new
  inpainting. This is separate from sharing a surface's audio motion.
- **Keep surfaces together** (Depth band mapping) blends audio motion toward
  a shared frequency response on confident object faces. Connected AI masks
  plus a robust depth-plane check separate abrupt jumps and reject uncertain
  regions. At 100%, direct audio depth motion and band shake are shared;
  at 0%, bands move independently. Original depth/slope, frequency colour and
  point growth remain intact, as do spatial motion layers. It works without
  hidden-background reconstruction. The live slider reuses one small surface
  texture (about 1 MB for the usual grid), with no additional draw calls or
  ongoing AI inference. Screen framing uses the same response as the GPU.
- **Save/Load presets** at the top store named snapshots of visualiser settings,
  including audio response, motion, colour, depth, fill and performance controls.
  Wallpaper, audio source and window/startup choices stay with the session.
  Saving an existing name replaces it. **Bands** and **Invert bands** are also
  remembered automatically per wallpaper image, including after a restart.
  **Pin selector** next to Image keeps wallpaper buttons, the preview and
  recent thumbnails at the top while scrolling. It is a saved window preference
  separate from visual presets, implemented with CSS and no polling.
- **Follow depth surfaces** (Depth band mapping): snap audio-band boundaries
  toward valleys in the wallpaper's depth distribution while retaining band
  count, frequency order and placement bias. A small lookup shared by the GPU,
  Gap fill and screen framing keeps their assignments consistent. This is a
  depth heuristic, not semantic segmentation; sloping objects can span bands.
  AI reconstruction slices are independent of audio band count.
- **Audio sources**
  - **System loopback** — visualize whatever the OS is playing
    (Windows: WASAPI loopback via Electron desktop capture; macOS works too).
  - **Linux system audio** — captures the PulseAudio/PipeWire monitor via
    `parec` (works with PipeWire's pulse compatibility layer).
  - **Microphone**, **audio file playback** (plays aloud and analyzes), and a
    built-in silent **demo track** for testing without any audio device.
- **Quiet by design**
  - Process usage under Performance names the main/tray, preview/audio,
    wallpaper, GPU and utility processes with native PIDs, CPU and working-set
    RAM. Sampling runs only while the fold and settings window are visible.
    Windows helper rows retain the shared executable name; use PIDs to match
    them in Task Manager. AI workers belong to their parent preview renderer.
  - FPS cap (30/60/uncapped) — 30 fps is the default; ambient waves look
    identical, GPU draw power roughly halves.
  - Adaptive resolution — if frame time runs over budget the render resolution
    steps down (and back up when there's headroom).
  - Idle sleep — when the music stops the render loop stops drawing entirely
    and wakes on the first sign of audio.
  - One draw call for the cloud, one for the dim backdrop; no post-processing.

## Quick start

```bash
npm install
npm start
```

Tip: **drag & drop** (or paste, Ctrl+V) any image onto the window to visualize
it. Open **⚙ Settings** for image/depth/points/motion/audio/performance.

### Linux system audio

The Linux loopback uses `parec` (PulseAudio utils). PipeWire users already have
it through `pipewire-pulse`:

```bash
# Debian/Ubuntu
sudo apt install pulseaudio-utils
# Arch
sudo pacman -S pulseaudio-alsa   # provides parec
# Fedora
sudo dnf install pulseaudio-utils
```

Then pick **System** in Settings → Audio. The app finds your default sink's
`.monitor` source automatically.

### Linux wallpaper detection

Works out of the box for GNOME, Cinnamon, MATE (gsettings), KDE Plasma
(config parse) and XFCE (xfconf). If detection fails, upload/drop an image —
your choice is remembered.

### Wayland wallpaper mode

Wallpaper mode uses native `wlr-layer-shell` Background surfaces on DriftWM
and other compatible compositors. Each selected monitor gets its own
click-through surface with no keyboard focus. The settings window remains an
ordinary Electron window. System audio still uses PulseAudio/PipeWire.

Windows uses the existing native wallpaper backend. The Wayland helper is built
only on Linux and is loaded only for native Wayland wallpaper mode; it creates
no renderers, native threads, surfaces or polling timers on Windows.

On Linux, `npm install` attempts to build the native helper. It requires a C++
compiler, Python, and Wayland development headers (`wayland-devel` on Fedora,
`libwayland-dev` on Debian/Ubuntu). Rebuild explicitly with:

```bash
npm run build:wayland
npm start -- --wallpaper
```

DriftWM must use `[background] type = "none"` to show external wallpapers.
Stopping or pausing the visualizer removes its surfaces, revealing the existing
wallpaper. Other wallpaper daemons can obscure it if they recreate their surfaces.
GNOME's default compositor does not provide this layer-shell protocol.

This version caps Wayland output at 30 fps and uses GPU-rendered bitmap
frames over shared memory. Frame copies add CPU and memory bandwidth overhead,
especially with several large monitors. Experimental direct DMA-BUF transport
can be tested with `DV_WAYLAND_SHARED_TEXTURE=1 npm start`, but currently fails
on some Linux GPU drivers; bitmap transport is the default. Global cursor
parallax is unavailable on Wayland. Automatic fullscreen game detection remains
Windows-only; the tray pause/resume controls work on Wayland.

Native transport is adapted from the MIT-licensed
[@covas-labs/electron-overlay](https://github.com/COVAS-Labs/electron-overlay).
Attribution and native source are under `electron/vendor/wayland-wallpaper`.
Live smoke tests are `electron tools/wayland-wallpaper-smoke.cjs` and
`electron tools/wayland-integration-smoke.cjs` in a layer-shell Wayland session.

## Packaging

```bash
npx electron-builder --linux   # AppImage + deb
npx electron-builder --win     # NSIS installer + portable exe
```

## How it stays fast

| Technique | Effect |
| --- | --- |
| All wave math in the vertex shader | CPU per frame uploads one small, configurable band texture (8–128×1) |
| Single `THREE.Points` draw call | no geometry churn, no post-processing passes |
| FPS cap (default 30) | half the GPU energy vs 60 for slow-moving content |
| Adaptive resolution | holds the frame budget on weak GPUs, restores quality when free |
| Idle sleep | zero GPU/CPU draw work between songs |
| Audio capture off the UI thread | `parec` runs as a child process; FFT is 2048-point (~µs) |

## Project layout

```
electron/main.cjs      app:// protocol, wallpaper detection, parec capture, IPC
electron/preload.cjs   contextBridge API (window.dv)
src/index.html         HUD + settings panel
src/js/scene.js        Three.js renderer, point-cloud shaders, camera, backdrop
src/js/sampler.js      image → positions/colors/nearness arrays
src/js/depth.js        heuristic depth + Depth-Anything ONNX path
src/js/audio.js        source switching, ring buffer, per-frame analysis
src/js/fft.js          radix-2 FFT (PulseAudio + demo paths)
src/js/bands.js        log bands, normalization, smoothing
src/js/demo.js         built-in demo track synthesizer
src/js/app.js          boot, render loop, adaptive quality, idle sleep
src/js/ui.js           settings panel wiring, toasts, drag & drop / paste
```

## Notes & limitations

- AI depth models download from Hugging Face on first use and are cached. Without
  network the heuristic is used automatically.
- Windows wallpaper is read from the registry (`HKCU\Control Panel\Desktop`),
  including the `TranscodedWallpaper` fallback.
- Wallpaper mode on Windows reparents a window into the desktop (WorkerW /
  Progman). Explorer restarts or Windows updates can detach it — just toggle
  the mode again.
- Wayland wallpaper mode requires `wlr-layer-shell`; unsupported compositors
  return an error rather than opening an ordinary wallpaper window.

AI depth preparation retains up to 512 pixels along the longest edge, smooths only
similar depths, and repairs isolated depth spikes while retaining continuous thin
ledges. Preparation runs in the short-lived depth worker and is cached per image.
Point budgets are unchanged; depth and mask grids use more memory. Saved results
from the older blurred pipeline are regenerated once.

Depth tuning exposes Surface smoothing and Spike cleanup (0–200%, default 100%).
They refine a saved raw AI prediction in a worker after adjustments settle; they
add no animation-frame work and are included in visual presets. A first tuning
change on an older saved wallpaper may need one AI depth run to populate the raw
cache. AI object classifications are also reused while surfaces and thickness are
recalculated. Hidden-background reconstruction refreshes when the resulting depth
changes, so adjustment can briefly use extra resources. Completed grids and raw
predictions have bounded caches. Cleanup preserves thin continuous ledges; it
cannot reliably correct every long strip assigned to the wrong depth.
