import { getFamilyAwkwardnessVerdict, type FamilyAwkwardnessLevel } from './signature-questions';
import { CATEGORY_SLUGS, type CategoryRating } from './contracts';
import type { FamilySummaryResult } from './representation-contracts';

export const STORY_REACTIONS = [
  {color:'#4A986C',asset:'/story/reactions/level-1-grandma.svg'},
  {color:'#D5B84E',asset:'/story/reactions/level-2-silence.svg'},
  {color:'#E58B43',asset:'/story/reactions/level-3-phone.svg'},
  {color:'#D65C4D',asset:'/story/reactions/level-4-fan.svg'},
  {color:'#8D3438',asset:'/story/reactions/level-5-remote.svg'},
] as const;
export const FAMILY_REPORT_COLORS=STORY_REACTIONS.map(reaction=>reaction.color);
export function storyReaction(level:number|null){return level!==null && Number.isInteger(level) && level>=1 && level<=5?STORY_REACTIONS[level-1]:null;}
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

export type StoryPresentation={year?:number|null;genres?:string[];reaction?:HTMLImageElement|null;accent?:string;backdrop?:boolean;compactTitle?:boolean};

/** Cover a full-width hero without distorting portrait art. Lower edges fade away. */
export function storyArtworkBounds(width:number,height:number,backdrop=false){
  const scale=backdrop?Math.max(1080/width,1050/height):1080/width;
  const w=width*scale,h=height*scale;
  return {x:(1080-w)/2,y:0,width:w,height:h};
}
function fittedText(ctx:CanvasRenderingContext2D,text:string,maxWidth:number,maxLines:number,maxSize:number,minSize:number){
  let size=maxSize;
  for(;size>minSize;size-=2){ctx.font=`bold ${size}px Georgia`;if(wrapStoryText(ctx,text,maxWidth,maxLines+1).length<=maxLines)break;}
  ctx.font=`bold ${size}px Georgia`;
  return {size,lines:wrapStoryText(ctx,text,maxWidth,maxLines)};
}
export function drawStoryCard(canvas:HTMLCanvasElement,title:string,summary:FamilySummaryResult['familySummary']|null,_movieId?:string,warning?:CategoryRating,personal=false,artwork?:HTMLImageElement|null,presentation:StoryPresentation={}){
  canvas.width=1080;canvas.height=1920;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Your browser could not create the image. Copy the film link instead.');
  const level=storyLevel(summary,personal),accent=/^#[0-9a-f]{6}$/i.test(presentation.accent??'')?presentation.accent!:'#D5B875';
  ctx.fillStyle='#111318';ctx.fillRect(0,0,1080,1920);
  if(artwork && artwork.naturalWidth>0 && artwork.naturalHeight>0){
    const bounds=storyArtworkBounds(artwork.naturalWidth,artwork.naturalHeight,presentation.backdrop);
    ctx.drawImage(artwork,bounds.x,bounds.y,bounds.width,bounds.height);
  }
  const fade=ctx.createLinearGradient(0,0,0,1450);
  fade.addColorStop(0,'rgba(17,19,24,.55)');fade.addColorStop(.22,'rgba(17,19,24,.18)');fade.addColorStop(.4,'rgba(17,19,24,.17)');fade.addColorStop(.58,'rgba(17,19,24,.62)');fade.addColorStop(.82,'rgba(17,19,24,.94)');fade.addColorStop(1,'#111318');
  ctx.fillStyle=fade;ctx.fillRect(0,0,1080,1920);
  const headerShade=ctx.createLinearGradient(0,100,0,430);headerShade.addColorStop(0,'rgba(17,19,24,.65)');headerShade.addColorStop(.55,'rgba(17,19,24,.5)');headerShade.addColorStop(1,'rgba(17,19,24,0)');ctx.fillStyle=headerShade;ctx.fillRect(0,0,1080,430);
  const glow=ctx.createRadialGradient(540,1160,20,540,1160,660);glow.addColorStop(0,`${accent}24`);glow.addColorStop(1,`${accent}00`);ctx.fillStyle=glow;ctx.fillRect(0,650,1080,1270);
  // Readable, localized title wash; continuous artwork remains behind it.
  const wash=ctx.createLinearGradient(0,400,0,825);wash.addColorStop(0,'rgba(17,19,24,0)');wash.addColorStop(.45,'rgba(17,19,24,.44)');wash.addColorStop(1,'rgba(17,19,24,0)');ctx.fillStyle=wash;ctx.fillRect(0,400,1080,425);
  ctx.textAlign='left';ctx.font='bold 38px Arial';ctx.fillStyle='#FFFFFF';ctx.fillText('trigger',72,262);ctx.fillStyle='#EF233C';ctx.fillText('boxd',72+ctx.measureText('trigger').width,262);
  ctx.fillStyle='#F7EBD5';
  ctx.textAlign='right';ctx.font='bold 22px Arial';ctx.fillText('SPOILER SAFE',1008,258);
  ctx.textAlign='left';ctx.font='22px Arial';ctx.fillText('MOVIE WARNING REPORT',72,309);
  if(presentation.compactTitle){ctx.font='bold 34px Arial';wrapStoryText(ctx,title,936,1).forEach(line=>ctx.fillText(line,72,708));}
  else {const fitted=fittedText(ctx,title,936,2,96,56),start=fitted.lines.length===1?656:603;fitted.lines.forEach((line,i)=>ctx.fillText(line,72,start+i*fitted.size*1.08));}
  ctx.font='26px Arial';ctx.fillStyle='#F7EBD5';const meta=[presentation.year?String(presentation.year):'',...(presentation.genres??[]).slice(0,2)].filter(Boolean).join(' · ');
  wrapStoryText(ctx,meta,936,1).forEach(line=>ctx.fillText(line,72,753));
  if(warning){ctx.font='25px Arial';wrapStoryText(ctx,storyWarningText(warning),936,2).forEach((line,i)=>ctx.fillText(line,72,788+i*29));}
  ctx.fillStyle='#F7EBD5';ctx.textAlign='center';ctx.font='bold 34px Arial';ctx.fillText('WATCH WITH YOUR PARENTS?',540,871);
  if(level!==null){
    ctx.fillStyle='rgba(89,65,52,.42)';ctx.beginPath();ctx.roundRect(108,903,864,183,34);ctx.fill();
    ctx.beginPath();ctx.moveTo(510,1082);ctx.lineTo(568,1082);ctx.lineTo(540,1118);ctx.fill();
  }
  const verdict=fittedText(ctx,storyCaption(summary,personal),800,2,level===null?52:82,level===null?46:62);ctx.fillStyle=level===null?'#B9ADA0':accent;
  const verdictStart=verdict.lines.length===1?1010:970;
  verdict.lines.forEach((line,i)=>ctx.fillText(line,540,verdictStart+i*verdict.size*1.03));
  if(level!==null && presentation.reaction?.naturalWidth && presentation.reaction.naturalHeight){ctx.drawImage(presentation.reaction,190,1088,700,700*presentation.reaction.naturalHeight/presentation.reaction.naturalWidth);}
  else if(level===null){ctx.font='72px Georgia';ctx.fillStyle='#B9ADA0';ctx.fillText('?',540,1220);}
  ctx.font='22px Arial';ctx.fillStyle='#F7EBD5';ctx.fillText('AWKWARDNESS METER',540,1398);
  for(let i=0;i<5;i++){
    const selected=level===i+1;
    ctx.save();ctx.fillStyle=selected?STORY_REACTIONS[i].color:'#292C32';ctx.shadowColor=selected?STORY_REACTIONS[i].color:'transparent';ctx.shadowBlur=selected?18:0;
    ctx.beginPath();ctx.roundRect(72+i*190,1420,176,52,12);ctx.fill();ctx.shadowBlur=0;
    if(selected){ctx.strokeStyle='#F7EBD5';ctx.lineWidth=2;ctx.stroke();}
    ctx.font='bold 28px Arial';ctx.fillStyle=selected&&i<3?'#111318':'#F7EBD5';ctx.fillText(String(i+1),160+i*190,1456);ctx.restore();
  }
  ctx.fillStyle='#F7EBD5';ctx.font='bold 32px Arial';ctx.fillText(level===null?'—':`${level}/5`,540,1520);
  ctx.font='24px Arial';ctx.fillStyle='#B9ADA0';const evidence=personal?'MY VERDICT':`COMMUNITY VERDICT${summary&&summary.count>0?` · ${summary.count} viewer votes`:''}`;ctx.fillText(evidence,540,1555);
  ctx.font='20px Arial';ctx.fillText('Subjective family opinion. Not a safety guarantee.',540,1590);
  ctx.font='bold 27px Arial';ctx.fillStyle='#FFFFFF';ctx.textAlign='left';ctx.fillText('TRIGGER',72,1638);ctx.fillStyle='#EF233C';ctx.fillText('BOXD',72+ctx.measureText('TRIGGER').width,1638);
  ctx.font='22px Arial';ctx.fillStyle='#F7EBD5';ctx.fillText('Know what you’re walking into.',72,1669);ctx.textAlign='right';ctx.font='bold 25px Arial';ctx.fillText('triggerboxd.com',1008,1638);
  ctx.textAlign='left';ctx.font='18px Arial';ctx.fillStyle='#B9ADA0';ctx.fillText(artwork?'Artwork via TMDb':'Artwork unavailable',72,354);
}

/** An explicit own-warning share still respects the report's spoiler protection. */
export function storyWarningText(warning:CategoryRating):string {
  if(!CATEGORY_SLUGS.includes(warning.category) || !Number.isInteger(warning.severity) || warning.severity<0 || warning.severity>3)return 'My warning: not assessed';
  if(warning.spoilerLevel!==undefined && warning.spoilerLevel!==0)return 'I added a spoiler-protected warning.';
  return `My warning: ${warning.category.replaceAll('_',' ')} · ${['None','Mild','Moderate','Severe'][warning.severity]}`;
}
