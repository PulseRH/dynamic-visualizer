'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dv', {
  isElectron: true,
  info: () => ipcRenderer.invoke('app:info'),
  getWallpaper: () => ipcRenderer.invoke('wallpaper:get'),
  chooseImage: () => ipcRenderer.invoke('image:choose'),
  saveImage: (dataUrl) => ipcRenderer.invoke('image:saveDataUrl', dataUrl),
  chooseAudioFile: () => ipcRenderer.invoke('audio:chooseFile'),
  startPulseCapture: () => ipcRenderer.invoke('capture:startPulse'),
  stopPulseCapture: () => ipcRenderer.invoke('capture:stopPulse'),
  enableWallpaper: () => ipcRenderer.invoke('wallpaperMode:enable'),
  disableWallpaper: () => ipcRenderer.invoke('wallpaperMode:disable'),
  isWallpaperActive: () => ipcRenderer.invoke('wallpaperMode:state'),
  onWallpaperState: (cb) => {
    const handler = (_e, on) => cb(on);
    ipcRenderer.on('wallpaperMode:changed', handler);
    return () => ipcRenderer.removeListener('wallpaperMode:changed', handler);
  },
  onCursor: (cb) => {
    const handler = (_e, pt) => cb(pt);
    ipcRenderer.on('cursor', handler);
    return () => ipcRenderer.removeListener('cursor', handler);
  },
  sendSpectrum: (bands, energy, beat) => ipcRenderer.send('spectrum', bands, energy, beat),
  onSpectrum: (cb) => {
    const handler = (_e, bands, energy, beat) => cb(bands, energy, beat);
    ipcRenderer.on('spectrum', handler);
    return () => ipcRenderer.removeListener('spectrum', handler);
  },
  onPcm: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('capture:pcm', handler);
    return () => ipcRenderer.removeListener('capture:pcm', handler);
  },
  onCaptureError: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('capture:error', handler);
    return () => ipcRenderer.removeListener('capture:error', handler);
  },
});
