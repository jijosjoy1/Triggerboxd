import {filmPoster} from './film-list';
export function storyImageUrl(path:string|null|undefined,backdrop=false){
  const safe=filmPoster(path??null,'w500');
  return safe?backdrop?safe.replace('/w500/','/w1280/'):safe.replace('/w500/','/w780/'):null;
}
const pending=new Map<string,Promise<HTMLImageElement|null>>();
export function loadStoryImage(url:string|null):Promise<HTMLImageElement|null>{
  if(!url)return Promise.resolve(null);
  const previous=pending.get(url);if(previous)return previous;
  const promise=new Promise<HTMLImageElement|null>(resolve=>{
    const image=new Image();image.crossOrigin='anonymous';
    const finish=(value:HTMLImageElement|null)=>{clearTimeout(timer);image.onload=null;image.onerror=null;resolve(value);};
    const timer=setTimeout(()=>finish(null),8000);
    image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0?image:null);
    image.onerror=()=>finish(null);image.src=url;
  });
  if(pending.size>=16)pending.delete(pending.keys().next().value!);
  pending.set(url,promise);void promise.then(image=>{if(!image && pending.get(url)===promise)pending.delete(url);});return promise;
}
/** Restrained image-derived light, independent of the fixed intensity colours. */
export function storyAccent(image:HTMLImageElement|null):string{
  if(!image)return '#D5B875';
  try{
    const sample=document.createElement('canvas');sample.width=16;sample.height=16;
    const ctx=sample.getContext('2d',{willReadFrequently:true});if(!ctx)return '#D5B875';
    ctx.drawImage(image,0,0,16,16);const pixels=ctx.getImageData(0,0,16,16).data;
    let r=0,g=0,b=0,count=0;
    for(let i=0;i<pixels.length;i+=4){const max=Math.max(pixels[i],pixels[i+1],pixels[i+2]),min=Math.min(pixels[i],pixels[i+1],pixels[i+2]);if(max-min>25 && max>60){r+=pixels[i];g+=pixels[i+1];b+=pixels[i+2];count++;}}
    if(!count)return '#D5B875';
    const values=[r/count,g/count,b/count];return '#'+values.map(value=>Math.round(180+value*.26).toString(16).padStart(2,'0')).join('');
  }catch{return '#D5B875';}
}
