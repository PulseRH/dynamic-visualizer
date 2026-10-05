Derived from @covas-labs/electron-overlay 0.5.2 (MIT), https://github.com/COVAS-Labs/electron-overlay
Native source revision: e9b9cf9706a263c9fd3eb0a13d54152d04e8e891

Local changes: use the Background layer, load only the bundled native addon, report background capabilities. DMA-BUF rendering and bounded SHM fallback retain upstream texture lease handling.

Build with npm run build:wayland from the application root.
