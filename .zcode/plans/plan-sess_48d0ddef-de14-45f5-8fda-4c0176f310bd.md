**Two changes, both in `src/js/app.js`:**

**1. Points clear in 0.5 s**
- Fade-out easing `tau` goes 100 → 160 ms, so the points visibly clear over ~0.5 s (with the endpoint snap landing right at the end).

**2. Minimized state = near-zero cost, background keeps playing**
This is already mostly guaranteed by the relay architecture (the preview is minimized → it renders nothing automatically, while its 33 ms analysis ticker keeps feeding the wallpaper windows). I'll add the last piece:
- When the app is minimized/hidden **and** wallpaper mode is off, the analysis ticker now idles completely (skips the FFT work) — because nothing is watching and nothing needs feeding. CPU drops to ~0.
- When minimized **with wallpaper mode on**, the ticker keeps running at 30 Hz — that tiny cost is what drives the wallpaper windows, so they play perfectly smoothly.

**Resource answers (no code change needed):**
- Render count: with wallpaper mode on = exactly **one render per display** (3 total). The preview only renders when it's visible.
- Minimized with wallpaper on: 3 wallpaper renders (they're the wallpaper — that's the job) + ~1 % CPU for the audio analysis ticker. Minimized with wallpaper off: ~0.

Implementation is a timing constant plus a 3-line early-return in the ticker. After this I'll restart the app, re-enable wallpaper mode, and push.