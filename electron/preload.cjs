'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dv', {
  isElectron: true,
  info: () => ipcRenderer.invoke('app:info'),
  getWallpaper: () => ipcRenderer.invoke('wallpaper:get'),
  chooseImage: () => ipcRenderer.invoke('image:choose'),
  recentImages: () => ipcRenderer.invoke('images:recent'),
  rememberImage: (url, thumb) => ipcRenderer.invoke('images:remember', url, thumb),
  settingsOnly: (enabled, expand) => ipcRenderer.invoke('window:settingsOnly', enabled, expand),
  saveImage: (dataUrl) => ipcRenderer.invoke('image:saveDataUrl', dataUrl),
  chooseAudioFile: () => ipcRenderer.invoke('audio:chooseFile'),
  startPulseCapture: () => ipcRenderer.invoke('capture:startPulse'),
  stopPulseCapture: () => ipcRenderer.invoke('capture:stopPulse'),
  enableWallpaper: () => ipcRenderer.invoke('wallpaperMode:enable'),
  disableWallpaper: () => ipcRenderer.invoke('wallpaperMode:disable'),
  isWallpaperActive: () => ipcRenderer.invoke('wallpaperMode:state'),
  isVisualizerPaused: () => ipcRenderer.invoke('gamemode:state'),
  isWindowVisible: () => ipcRenderer.invoke('window:visible'),
  onWindowVisibility: (cb) => {
    const handler = (_e, visible) => cb(visible);
    ipcRenderer.on('window:visibility', handler);
    return () => ipcRenderer.removeListener('window:visibility', handler);
  },
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
  sendSpectrum: (bands, energy, loud) => ipcRenderer.send('spectrum', bands, energy, loud),
  onSpectrum: (cb) => {
    const handler = (_e, bands, energy, loud) => cb(bands, energy, loud);
    ipcRenderer.on('spectrum', handler);
    return () => ipcRenderer.removeListener('spectrum', handler);
  },
  sendDepthGrid: (payload) => ipcRenderer.send('depthgrid', payload),
  onDepthGrid: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('depthgrid', handler);
    return () => ipcRenderer.removeListener('depthgrid', handler);
  },
  requestDepthGrid: () => ipcRenderer.send('depthgrid:request'),
  onDepthGridRequest: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('depthgrid:send', handler);
    return () => ipcRenderer.removeListener('depthgrid:send', handler);
  },
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  onGameMode: (cb) => {
    const handler = (_e, on) => cb(on);
    ipcRenderer.on('gamemode', handler);
    return () => ipcRenderer.removeListener('gamemode', handler);
  },
  requestDepthGrid: () => ipcRenderer.send('depthgrid:request'),
  onDepthGridRequest: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('depthgrid:send', handler);
    return () => ipcRenderer.removeListener('depthgrid:send', handler);
  },
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  onGameMode: (cb) => {
    const handler = (_e, on) => cb(on);
    ipcRenderer.on('gamemode', handler);
    return () => ipcRenderer.removeListener('gamemode', handler);
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
