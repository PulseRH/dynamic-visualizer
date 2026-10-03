// Content identity survives recent-image copies and distinguishes a wallpaper
// overwritten at the same path. Only the preview writes this small table.
export class WallpaperBands {
  constructor(storage=globalThis.localStorage){this.storage=storage;this.active=null;}
  read(){try{const records=JSON.parse(this.storage.getItem('dv.wallpaper-bands.v1')||'[]');return Array.isArray(records) ? records:[];}catch{return [];}}
  remember(settings){
    if(!this.active)return;
    const record={key:this.active,bands:Math.max(4,Math.min(256,Math.round(settings.bands))),invertBands:!!settings.invertBands};
    if(!Number.isFinite(record.bands))return;
    const records=this.read().filter(r=>r?.key!==this.active);records.push(record);
    try{this.storage.setItem('dv.wallpaper-bands.v1',JSON.stringify(records.slice(-100)));}catch{}
  }
  activate(key,settings){
    this.active=key||null;if(!this.active)return null;
    const record=this.read().find(r=>r?.key===key);
    if(record&&Number.isFinite(record.bands)&&typeof record.invertBands==='boolean')return {bands:Math.max(4,Math.min(256,Math.round(record.bands))),invertBands:record.invertBands};
    this.remember(settings);return null;
  }
}
