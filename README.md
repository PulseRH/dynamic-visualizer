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
  Linux/X11: `_NET_WM_WINDOW_TYPE_DESKTOP` via xprop/wmctrl, best effort.)
- **Image → point cloud**: jittered-grid sampling of up to 400k points, each
  point keeps its pixel color and a depth estimate.
- **Spatial frequency mapping** — you choose *where* each band acts on the
  image: **Radial** (bass rings from the center, highs at the edges),
  **Vertical** (bass at the ground, highs in the sky), **Horizontal**, or by
  **Depth** layer. Regions whose band is quiet go dim while loud ones glow.
- **Motion styles**: audio-driven spectrum displacement (no self-motion — the
  image only moves when the music does), traveling wave, radial ripple,
  band bars, or ambient drift.
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
  reconstructs a separate background behind foreground depth edges. Reveals
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
- **Audio sources**
  - **System loopback** — visualize whatever the OS is playing
    (Windows: WASAPI loopback via Electron desktop capture; macOS works too).
  - **Linux system audio** — captures the PulseAudio/PipeWire monitor via
    `parec` (works with PipeWire's pulse compatibility layer).
  - **Microphone**, **audio file playback** (plays aloud and analyzes), and a
    built-in silent **demo track** for testing without any audio device.
- **Quiet by design**
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
  the mode again. Wayland isn't supported yet (needs layer-shell).
- Linux wallpaper mode needs an X11 session; on GNOME Wayland it will fall
  back to a normal window.
