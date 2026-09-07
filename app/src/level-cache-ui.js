import {levelCacheCommand} from './level-cache.js';
export function mountLevelCache(container, levels) {
  const names = new Map(levels.map(l => [l.id,l.name]));
  const status = document.createElement('p'); status.setAttribute('role','status');
  const list = document.createElement('div'); list.className='level-cache-list';
  const refresh = document.createElement('button'); refresh.textContent='Refresh cache sizes';
  const note = document.createElement('p'); note.className='session-note';
  note.textContent='Downloaded chunks, textures and colliders are reused on later visits. Only visited detail is cached—not the entire level. Browser storage may be evicted. Purging pauses caching for that level until you launch it again; weapon media is untouched.';
  container.append(status,list,refresh,note);
  let busy=false;
  async function update(message='') {
    if(busy)return;busy=true;refresh.disabled=true;
    try {
      const info=await levelCacheCommand('stats');
      status.textContent=message || (info.available?`Level caching active · ${info.hits} reused / ${info.downloads} network reads this cache-worker session`:'Browser storage unavailable · streaming without persistent cache');
      list.replaceChildren();
      for(const id of new Set([...names.keys(),...Object.keys(info.levels)])) {
        const data=info.levels[id]??{files:0,bytes:0};
        const row=document.createElement('div');row.className='level-cache-row';
        const text=document.createElement('span');
        text.textContent=`${names.get(id)||`SuperSplat ${id}`} · ${data.files} cached files${data.bytes?` · ${(data.bytes/1048576).toFixed(1)}${data.unknown?'+':''} MiB`:''}${data.paused?' · cleared / paused':''}${data.error?' · '+data.error:''}`;
        const purge=document.createElement('button');purge.textContent='Purge cache';purge.setAttribute('aria-label',`Purge ${names.get(id)||id} cache`);
        purge.disabled=!info.available;
        purge.addEventListener('click',async()=>{
          purge.disabled=true;refresh.disabled=true;
          try{await levelCacheCommand('purge',id);await update(`${names.get(id)||id} cache cleared. Other levels and weapon media were kept.`);}
          catch(error){status.textContent=error.message;purge.disabled=false;}
          finally{refresh.disabled=false;}
        });
        row.append(text,purge);list.append(row);
      }
    } catch(error){status.textContent=error.message;}
    finally{busy=false;refresh.disabled=false;}
  }
  refresh.addEventListener('click',()=>void update());
  void update();
  return {add(level){names.set(level.id,level.name);void update();},refresh:update};
}
