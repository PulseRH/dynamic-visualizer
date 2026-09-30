// Keep enough source pixels for a cover-fitted wallpaper, including zoom.
// A contain-style limit would shrink the cropped axis below screen resolution.
export function backdropTextureSize(imageW, imageH, viewW, viewH, zoom = 1, maxTextureSize = Infinity) {
  const coverScale = Math.max(viewW * zoom / imageW, viewH * zoom / imageH);
  const scale = Math.min(1, coverScale, maxTextureSize / imageW, maxTextureSize / imageH);
  return {
    width: Math.max(1, Math.round(imageW * scale)),
    height: Math.max(1, Math.round(imageH * scale)),
  };
}
