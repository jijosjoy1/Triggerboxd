import { getFamilyAwkwardnessVerdict, type FamilyAwkwardnessLevel } from './signature-questions';
import { isUuid } from './validation';
import { CATEGORY_SLUGS, type CategoryRating } from './contracts';
import type { FamilySummaryResult } from './representation-contracts';

// Deliberately accepts no warning, note, identity or revealed-category payload.
export const FAMILY_REPORT_COLORS = ['#328763','#849544','#d5a342','#c57443','#ac4949'] as const;
export const FAMILY_REPORT_ART = ['grandma','silence','phone','fan','remote'] as const;
export function storyLevel(summary:FamilySummaryResult['familySummary']|null,personal=false):number|null {
  return summary && (personal && summary.count>0 || !summary.provisional && summary.count>=3) && Number.isInteger(summary.value) && summary.value!>=1 && summary.value!<=5 ? summary.value : null;
}
export function storyCaption(summary: FamilySummaryResult['familySummary'] | null, personal=false): string {
  if(!summary || summary.value===null || summary.count===0)return 'The jury is still out.';
  if(storyLevel(summary,personal)===null)return 'Early votes. Too soon for a verdict.';
  return getFamilyAwkwardnessVerdict(storyLevel(summary,personal) as FamilyAwkwardnessLevel,0);
}

export function wrapStoryText(context: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxWidth: number, maxLines: number): string[] {
  const lines:string[]=[];
  let current='';
  for(const word of text.replace(/\s+/g,' ').trim().split(' ')){
    if(context.measureText(word).width<=maxWidth){
      const next=current?`${current} ${word}`:word;
      if(current && context.measureText(next).width>maxWidth){lines.push(current);current=word;}
      else current=next;
    }else{
      if(current){lines.push(current);current='';}
      for(const char of Array.from(word)){
        if(current && context.measureText(current+char).width>maxWidth){lines.push(current);current=char;}
        else current+=char;
      }
    }
  }
  if(current)lines.push(current);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && context.measureText(last + '…').width > maxWidth) last = Array.from(last).slice(0, -1).join('');
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

/** Original pen-and-ink objects; no generated images, posters or private data. */
export function drawFamilyArt(ctx:CanvasRenderingContext2D,level:number|null) {
  ctx.save();ctx.translate(540,790);ctx.strokeStyle='#222d29';ctx.lineWidth=9;ctx.lineCap='round';ctx.lineJoin='round';
  const path=(points:number[][])=>{ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();};
  const circle=(x:number,y:number,r:number)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();};
  if(level===1){
    // Grandma, round glasses, an armchair and a cup of tea.
    circle(0,-105,66);circle(-24,-110,20);circle(25,-110,20);path([[-5,-110],[5,-110]]);
    ctx.beginPath();ctx.arc(0,-115,73,Math.PI,Math.PI*2);ctx.stroke();circle(59,-169,22);ctx.beginPath();ctx.arc(0,-95,22,0,Math.PI);ctx.stroke();
    path([[-55,-39],[-85,28],[-75,127],[76,127],[83,28],[52,-39]]);
    path([[-125,-15],[-146,132],[-92,151],[93,151],[145,131],[128,-16]]);
    path([[-124,150],[-133,188]]);path([[126,147],[136,188]]);
    path([[35,13],[35,67],[91,67],[91,13],[35,13]]);circle(108,36,18);
    path([[44,-4],[39,-19],[45,-31]]);
  }else if(level===2){
    // A conversation stopped mid-sentence.
    path([[-166,-125],[152,-125],[175,-100],[175,81],[139,106],[-79,106],[-131,154],[-113,106],[-166,106],[-189,78],[-189,-99],[-166,-125]]);
    circle(-78,-10,10);circle(-8,-10,10);circle(62,-10,10);
  }else if(level===3){
    // The suddenly fascinating phone.
    path([[-92,-178],[82,-178],[103,-156],[103,149],[80,173],[-91,173],[-112,149],[-112,-153],[-92,-178]]);
    path([[-86,-130],[77,-130],[77,115],[-86,115],[-86,-130]]);path([[-35,-151],[29,-151]]);circle(-4,145,9);
    path([[-60,-50],[55,-50],[55,24],[10,24],[-20,48],[-16,24],[-60,24],[-60,-50]]);
    circle(-30,-12,3);circle(-3,-12,3);circle(24,-12,3);
  }else if(level===4){
    // Three-bladed ceiling fan, drawn as a recognisable ordinary object.
    circle(0,0,27);
    for(let i=0;i<3;i++){ctx.save();ctx.rotate(i*Math.PI*2/3);path([[14,-20],[44,-69],[60,-167],[115,-181],[153,-134],[106,-57],[23,15]]);ctx.restore();}
    circle(0,0,9);path([[-18,177],[16,177]]);
  }else if(level===5){
    // A remote with an unhelpful pause button.
    path([[-70,-180],[77,-180],[103,-155],[87,158],[61,178],[-77,170],[-99,146],[-94,-153],[-70,-180]]);
    circle(54,-127,17);path([[-61,-76],[54,-76]]);
    ctx.strokeRect(-56,-29,113,77);path([[-22,-10],[-22,27]]);path([[20,-10],[20,27]]);
    for(let y=86;y<=128;y+=42){circle(-45,y,7);circle(0,y,7);circle(42,y,7);}
    path([[127,-43],[151,-57]]);path([[-128,30],[-153,42]]);
  }else{
    // Unknown is always a question, never a reassuring character.
    ctx.font='160px Georgia';ctx.textAlign='center';ctx.fillStyle='#222d29';ctx.fillText('?',0,50);
    circle(0,-10,133);
  }
  ctx.restore();
}

export function drawStoryCard(canvas: HTMLCanvasElement, title: string, summary: FamilySummaryResult['familySummary'] | null, movieId?:string, warning?:CategoryRating, personal=false, poster?:HTMLImageElement|null) {
  canvas.width=1080;canvas.height=1920;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Your browser could not create the image. Copy the film link instead.');
  const level=storyLevel(summary,personal);
  ctx.fillStyle='#f4eedf';ctx.fillRect(0,0,1080,1920);ctx.fillStyle='#222d29';ctx.textAlign='left';
  ctx.font='bold 34px sans-serif';ctx.fillText('triggerboxd',90,148);
  ctx.font='24px monospace';ctx.fillText(warning?'MY MOVIE WARNING REPORT':'THE FAMILY MOVIE REPORT',90,202);
  ctx.strokeStyle='#222d29';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(90,232);ctx.lineTo(990,232);ctx.stroke();
  ctx.font='bold 72px Georgia';wrapStoryText(ctx,title,900,3).forEach((line,i)=>ctx.fillText(line,90,333+i*86));
  if(warning){ctx.font='28px sans-serif';ctx.fillStyle='#222d29';ctx.fillText(storyWarningText(warning),90,586);}
  if(poster && poster.naturalWidth>0 && poster.naturalHeight>0){
    const scale=Math.min(400/poster.naturalWidth,400/poster.naturalHeight);
    const width=poster.naturalWidth*scale,height=poster.naturalHeight*scale;
    ctx.drawImage(poster,310-width/2,790-height/2,width,height);
    ctx.save();ctx.translate(200,395);ctx.scale(0.5,0.5);drawFamilyArt(ctx,level);ctx.restore();
    ctx.font='18px sans-serif';ctx.fillStyle='#222d29';ctx.fillText('Poster via TMDb',90,1020);
  }else drawFamilyArt(ctx,level);
  ctx.fillStyle='#222d29';ctx.font='bold 65px sans-serif';ctx.textAlign='center';
  wrapStoryText(ctx,storyCaption(summary,personal),880,3).forEach((line,i)=>ctx.fillText(line,540,1080+i*80));
  ctx.font='32px monospace';ctx.fillText('AWKWARDNESS METER',540,1275);
  for(let i=0;i<5;i++){
    ctx.fillStyle=level===null?'#d3d0c5':i<level?FAMILY_REPORT_COLORS[i]:'#ded9ca';ctx.fillRect(90+i*184,1314,164,38);
    ctx.fillStyle='#222d29';ctx.font='32px monospace';ctx.fillText(String(i+1),172+i*184,1393);
  }
  ctx.font='28px sans-serif';
  const evidence=!summary||summary.value===null||summary.count===0?'Community family opinion: unknown':personal?`My awkwardness vote: ${summary.value}/5`:`${summary.count} viewer votes · ${summary.value}/5${level===null?' · early result':''}`;
  ctx.fillText(evidence,540,1480);ctx.font='24px sans-serif';ctx.fillText('Subjective family opinion. Not a safety guarantee.',540,1530);
  ctx.textAlign='left';ctx.strokeStyle='#222d29';ctx.beginPath();ctx.moveTo(90,1590);ctx.lineTo(990,1590);ctx.stroke();
  ctx.font='bold 30px sans-serif';ctx.fillText('Find detailed trigger warnings at',90,1662);
  ctx.font='bold 42px sans-serif';ctx.fillText('triggerboxd.com',90,1720);
  const url=movieId&&isUuid(movieId)?`https://triggerboxd.com/movies/${movieId}/`:'https://triggerboxd.com/';
  ctx.font='25px monospace';wrapStoryText(ctx,url,900,3).forEach((line,i)=>ctx.fillText(line,90,1780+i*35));
}

/** An explicit own-warning share still respects the report's spoiler protection. */
export function storyWarningText(warning:CategoryRating):string {
  if(!CATEGORY_SLUGS.includes(warning.category) || !Number.isInteger(warning.severity) || warning.severity<0 || warning.severity>3)return 'My warning: not assessed';
  if(warning.spoilerLevel!==undefined && warning.spoilerLevel!==0)return 'I added a spoiler-protected warning.';
  return `My warning: ${warning.category.replaceAll('_',' ')} · ${['None','Mild','Moderate','Severe'][warning.severity]}`;
}
