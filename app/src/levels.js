// Public publisher endpoints; geometry is streamed, never bundled for Pages.
export const LEVELS = [
  {id:'fd3083e4',name:'San Juan',subtitle:'Historic district · Puerto Rico',author:'AJ Creek / virtualworldtours',lods:8,spawn:[-17.30658,-3.69054,49.652],target:[-36.3323,-5.76714,82.52482]},
  {id:'9cbaba42',name:'Fort Clatsop',subtitle:'National Historical Park · forest trail',author:'virtualworldtours',lods:6,spawn:[.0184927937,.8987190723,1.2264345884],target:[.2128686619,.8916610571,-.7640849436]},
  // Moved ~1m from the published camera to clear the railway obstacle; same look direction.
  {id:'b0ff3cb9',name:'El Romeral',subtitle:'Former railway station · Chile',author:'getarq',lods:6,spawn:[5.2787343981,1.25,-7.95],target:[6.4502807998,1.5636805956,-6.3596907998]},
  {id:'fb3b5ed5',name:'Nelson Ghost Town',subtitle:'Water tower · Nevada',author:'tosolini',lods:6,spawn:[4.0826249123,1.0312490463,-2.0296020508],target:[5.4374977843,1.3123579572,-3.4736578949],license:'CC BY 4.0'},
].map(level => ({...level,
  source: `https://superspl.at/scene/${level.id}`,
  contentUrl: `https://d28zzqy0iyovbz.cloudfront.net/${level.id}/v1/lod-meta.json`,
  collisionUrl: `https://s3-eu-west-1.amazonaws.com/splats.playcanvas.com/${level.id}/v1/scene.voxel.json`,
  posterUrl: `https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/${level.id}/v1/xl.webp`,
}));
export function levelById(id) {return LEVELS.find(level=>level.id===id)||LEVELS[0];}
export function levelBase(level) {return new URL('.',level.contentUrl).href.replace(/\/$/,'');}
export function lodOptions(level) {
  return [{value:-1,label:`Adaptive 0–${level.lods-1}`},...Array.from({length:level.lods},(_,i)=>({value:i,label:`${i}${i===0?' · highest':i===level.lods-1?' · lowest':''}`}))];
}
