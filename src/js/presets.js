// Keep image/device/window choices outside visual presets. Audio response,
// rendering quality, motion, colours, bands and fill are included.
const EXCLUDED=new Set(['imageUrl','audioSource','audioFileUrl','settingsOnly','previewPaused','previewFullQuality',
  'matchImageAccent','pinWallpaperSelector','wallpaperCycle','wallpaperCycleMinutes','waveMode','motionMix','overscan','overscanAuto','swirlRangeVersion']);
export function createPresetStore(defaults,storage=globalThis.localStorage){
  const key='dv.presets.v1';
  const clean=settings=>{
    const result={};
    for(const [name,example] of Object.entries(defaults)){
      const value=settings?.[name];if(EXCLUDED.has(name))continue;
      if(Array.isArray(example)){
        if(Array.isArray(value)&&value.length===example.length&&value.every(Number.isFinite))result[name]=value.slice();
      }else if(typeof value===typeof example&&(typeof value!=='number'||Number.isFinite(value)))result[name]=value;
    }
    return result;
  };
  const read=()=>{try{const records=JSON.parse(storage.getItem(key)||'[]');return Array.isArray(records) ? records.filter(r=>typeof r?.name==='string'&&r.settings&&typeof r.settings==='object'):[];}catch{return [];}};
  return {
    names:()=>read().map(r=>r.name),
    save(name,settings){
      name=name.trim().slice(0,80);if(!name)throw Error('Enter a preset name.');
      const records=read(),record={name,settings:clean(settings)},index=records.findIndex(r=>r.name===name);
      if(index>=0)records[index]=record;else records.push(record);
      storage.setItem(key,JSON.stringify(records));return name;
    },
    load(name){const record=read().find(r=>r.name===name.trim());if(!record)throw Error('Choose a saved preset.');return clean(record.settings);},
  };
}
