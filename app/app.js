'use strict';
const $=id=>document.getElementById(id), canvas=$('preview'),ctx=canvas.getContext('2d');
const styles={
 win1:['windows','Windows 1.0', '#2177a8','#ffffff','#ffffff','monospace','classic'],
 win3:['windows','Windows 3.1','#000080','#c0c0c0','#ffffff','Arial','classic'],
 win95:['windows','Windows 95','#000080','#c0c0c0','#ffffff','Tahoma','classic'],
 win98:['windows','Windows 98','#000080','#c0c0c0','#ffffff','Tahoma','classic'],
 win2000:['windows','Windows 2000','#205ca5','#d4d0c8','#ffffff','Tahoma','classic'],
 winxp:['windows','Windows XP','#0866e8','#ece9d8','#ffffff','Tahoma','xp'],
 vista:['windows','Windows Vista','#84afc8','#f0f0f0','#152839','Segoe UI','aero'],
 win7:['windows','Windows 7','#88badd','#f0f0f0','#142b3f','Segoe UI','aero'],
 win8:['windows','Windows 8 / 8.1','#1676c4','#f5f5f5','#ffffff','Segoe UI','flat'],
 win10:['windows','Windows 10','#ffffff','#f5f5f5','#202020','Segoe UI','flat'],
 win11:['windows','Windows 11','#f3f3f3','#ffffff','#202020','Segoe UI','modern'],
 macclassic:['mac','System 1–6','#ffffff','#ffffff','#111111','WCP Mono','macclassic'],
 macos9:['mac','Mac OS 8 / 9','#dddddd','#eeeeee','#111111','Arial','macclassic'],
 aqua:['mac','Mac OS X Aqua','#d4dfec','#f3f3f3','#222222','Lucida Sans Unicode','aqua'],
 macyosemite:['mac','OS X Yosemite','#dedddd','#ececec','#333333','Arial','mac'],
 macmodern:['mac','macOS Big Sur и новее','#e5e4e6','#f5f5f7','#262626','Arial','mac'],
 cde:['linux','CDE / Motif','#707a9b','#a9aebc','#ffffff','WCP Mono','classic'],
 kde3:['linux','KDE 3 / Plastik','#457ba8','#eeeeee','#ffffff','Arial','aero'],
 kde:['linux','KDE Plasma','#e5e9ed','#eff0f1','#232629','Arial','modern'],
 gnome2:['linux','GNOME 2','#7396bd','#e8e5dc','#ffffff','WCP Sans','aero'],
 gnome:['linux','GNOME / Adwaita','#deddda','#fafafa','#242424','WCP Sans','modern'],
 ubuntu:['linux','Ubuntu / Ambiance','#4a4541','#f2f1f0','#f5f5f5','WCP Sans','ubuntu']
};
let mode='image',icon='info',buttons=['ОК','Отмена'],ghostButton=false,ghostIcon=null,photo=null,stream=null,sending=false,lastSent=0;
let cameraRun=0,cameraState='idle',frameCallback=null;
const cameraProfiles={auto:null,'720':[1280,720],'1080':[1920,1080],'1440':[2560,1440],'2160':[3840,2160]};
let lastCameraRegion=null,qualityInfoKey="";
let frameSocket=null,awaitingFrameAck=0,frameAckStarted=0,nextFrameConnect=0,transportEpoch=0,visualRevision=0,lastPublishedRevision=-1,lastFeedback=0;
const textLayoutCache=new Map();
const ids=['width','height','titleHeight','titleColor','bodyColor','textColor','titleTextColor','title','titleFont','iconStyle','iconSize','titleIcon','bodyIcon','body','font','fontSize','titleFontSize','align','imageFit','mirror','zoom','cropX','cropY','cameraQuality','cameraFps','streamResolution','cameraFit'];
const initial={};ids.forEach(id=>initial[id]=$(id).type==='checkbox'?$(id).checked:$(id).value);
function number(id,min,max){return Math.max(min,Math.min(max,Number($(id).value)||min))}
function setStatus(t,error=false){$('status').textContent=t;$('status').style.color=error?'#bc3434':''}
function fillGenerations(key){$('generation').replaceChildren();for(const [k,v]of Object.entries(styles))if(v[0]===$('os').value){const o=new Option(v[1],k);$('generation').add(o)}if(key&&styles[key]&&styles[key][0]===$('os').value)$('generation').value=key}
function preset(key){const s=styles[key];$('os').value=s[0];fillGenerations(key);$('titleColor').value=s[2];$('bodyColor').value=s[3];$('titleTextColor').value=s[4];$('font').value='auto';$('titleFont').value='auto';draw();save()}
function save(){try{const data={key:$('generation').value,icon,buttons,theme:$('appTheme').value,accent:$('accent').value};ids.forEach(id=>data[id]=$(id).type==='checkbox'?$(id).checked:$(id).value);localStorage.setItem('wcp-layout-v1',JSON.stringify(data))}catch{}}
function restore(){try{const d=JSON.parse(localStorage.getItem('wcp-layout-v1'));if(!d)return;preset(styles[d.key]?d.key:'win8');for(const id of ids)if(d[id]!==undefined){if($(id).type==='checkbox')$(id).checked=Boolean(d[id]);else $(id).value=d[id]}icon=['none','error','warning','info','question'].includes(d.icon)?d.icon:'info';buttons=Array.isArray(d.buttons)?d.buttons.slice(0,8).map(x=>String(x).slice(0,80)):['ОК'];$('appTheme').value=d.theme||'win8';$('accent').value=d.accent||'#0078d7'}catch{}}
function applyTheme(){document.body.dataset.theme=$('appTheme').value;document.documentElement.style.setProperty('--accent',$('accent').value);save()}
function buttonList(){const list=$('buttons');list.replaceChildren();buttons.forEach((name,i)=>{const row=document.createElement('div');row.className='buttonRow';const input=document.createElement('input');input.value=name;input.maxLength=80;input.setAttribute('aria-label','Название кнопки '+(i+1));input.addEventListener('input',()=>{buttons[i]=input.value;draw();save()});const remove=document.createElement('button');remove.className='quiet';remove.textContent='×';remove.setAttribute('aria-label','Удалить кнопку');remove.onclick=()=>{buttons.splice(i,1);buttonList();draw();save()};row.append(input,remove);list.append(row)});$('addButton').disabled=buttons.length>=8}
function fontFamily(){return $('font').value==='auto'?styles[$('generation').value][5]:$('font').value}
function font(size){return `${size}px "${fontFamily().replace(/["\\]/g,'')}", "WCP Sans", "Segoe UI", sans-serif`}
function round(x,y,w,h,r,fill,stroke){if(w<=0||h<=0)return;ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}}
function bevel(x,y,w,h,fill,pressed=false){ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);ctx.lineWidth=2;ctx.strokeStyle=pressed?'#555':'#ffffff';ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x,y);ctx.lineTo(x+w,y);ctx.stroke();ctx.strokeStyle=pressed?'#fff':'#555';ctx.beginPath();ctx.moveTo(x+w,y);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.stroke()}
// Every icon is a vector drawing; no system font or installed Linux resources are needed.
function iconDraw(type,x,y,size,alpha=1){
 if(type==='none'||size<=0)return;
 const os=$('iconStyle').value==='auto'?$('os').value:$('iconStyle').value;
 ctx.save();ctx.globalAlpha*=alpha;ctx.translate(x,y);ctx.scale(size/100,size/100);
 ctx.lineWidth=os==='linux'?3:2;ctx.strokeStyle=os==='mac'?'#7b7e85':'#00000045';
 const colors={error:['#fa8178','#d0272e'],warning:['#ffe99a','#eab52a'],info:['#70ccfa','#147cc0'],question:['#b5a0ed','#7552b8']};
 const colorset=colors[type]||colors.info;
 if(os==='linux')ctx.fillStyle=colorset[1];else{const g=ctx.createLinearGradient(0,0,0,100);g.addColorStop(0,os==='mac'&&type!=='warning'?'#fafafa':colorset[0]);g.addColorStop(1,os==='mac'&&type!=='warning'?'#d4d6dc':colorset[1]);ctx.fillStyle=g}
 ctx.beginPath();
 if(type==='warning'){ctx.moveTo(50,4);ctx.lineTo(97,91);ctx.lineTo(3,91);ctx.closePath()}
 else if(os==='linux'&&type==='error'){const d=29;ctx.moveTo(d,4);ctx.lineTo(100-d,4);ctx.lineTo(96,d);ctx.lineTo(96,100-d);ctx.lineTo(100-d,96);ctx.lineTo(d,96);ctx.lineTo(4,100-d);ctx.lineTo(4,d);ctx.closePath()}
 else if(os==='linux'){ctx.roundRect(4,4,92,92,type==='question'?26:16)}
 else ctx.arc(50,50,46,0,Math.PI*2);
 ctx.fill();ctx.stroke();
 const ink=type==='warning'?'#3f3211':os==='mac'?colorset[1]:'#fff';ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.lineWidth=9;ctx.lineCap='round';ctx.lineJoin='round';
 if(type==='error'){ctx.beginPath();ctx.moveTo(34,34);ctx.lineTo(66,66);ctx.moveTo(66,34);ctx.lineTo(34,66);ctx.stroke()}
 else if(type==='warning'){ctx.beginPath();ctx.moveTo(50,36);ctx.lineTo(50,59);ctx.stroke();ctx.beginPath();ctx.arc(50,76,5,0,Math.PI*2);ctx.fill()}
 else if(type==='question'){ctx.beginPath();ctx.moveTo(35,35);ctx.bezierCurveTo(37,20,66,20,67,37);ctx.bezierCurveTo(68,50,50,48,50,60);ctx.stroke();ctx.beginPath();ctx.arc(50,77,5,0,Math.PI*2);ctx.fill()}
 else{ctx.beginPath();ctx.arc(50,27,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(46,47);ctx.lineTo(51,47);ctx.lineTo(51,75);ctx.moveTo(43,75);ctx.lineTo(60,75);ctx.stroke()}
 ctx.restore();
}
function inkMetrics(text,fontString){ctx.font=fontString;const m=ctx.measureText(text||'MgЙ');return {left:Math.max(0,m.actualBoundingBoxLeft||0),right:Math.max(m.width,m.actualBoundingBoxRight||0),ascent:Math.max(1,m.actualBoundingBoxAscent||0),descent:Math.max(0,m.actualBoundingBoxDescent||0)}}
// Clip to the actual title/button/line rectangle and size by glyph ink, including decorative overhangs.
function clippedText(text,x,y,max,fontString,color,align='left',boxHeight=24,shrink=true){
 if(max<=0||boxHeight<=0)return;
 ctx.save();ctx.beginPath();ctx.rect(x,y-boxHeight/2,max,boxHeight);ctx.clip();ctx.textAlign='left';ctx.textBaseline='alphabetic';
 let f=fontString,m=inkMetrics(text,f),size=parseFloat(fontString),space=Math.max(1,max-4),height=Math.max(1,boxHeight-4);
 if(shrink){const factor=Math.min(1,space/Math.max(1,m.left+m.right),height/Math.max(1,m.ascent+m.descent));if(factor<1){f=fontString.replace(/^[\d.]+px/,Math.max(1,size*factor)+'px');m=inkMetrics(text,f)}}
 ctx.font=f;ctx.fillStyle=color;const ink=m.left+m.right;const left=align==='center'?x+(max-ink)/2:align==='right'?x+max-ink-2:x+2;
 ctx.fillText(text,left+m.left,y+(m.ascent-m.descent)/2);ctx.restore();
}
function textLayout(text,maxWidth,maxHeight,requested){
 if(!text.trim())return {size:requested,lines:[],lineHeight:0,truncated:false};
 const key=JSON.stringify([text,maxWidth,maxHeight,requested,fontFamily()]);if(textLayoutCache.has(key))return textLayoutCache.get(key);
 function measure(size){const lines=wrap(text,maxWidth-4,size);ctx.font=font(size);const metric=ctx.measureText(text.replace(/\s/g,'').slice(0,2000)||'MgЙ');const lineHeight=Math.max(size*1.35,(metric.actualBoundingBoxAscent||size)+(metric.actualBoundingBoxDescent||size*.25)+4);return {size,lines,lineHeight}}
 let low=8,high=Math.floor(requested),layout=measure(8);
 while(low<=high){const mid=Math.floor((low+high)/2),candidate=measure(mid);if(candidate.lines.length*candidate.lineHeight<=maxHeight){layout=candidate;low=mid+1}else high=mid-1}
 const count=Math.max(0,Math.floor(maxHeight/layout.lineHeight));layout.truncated=layout.lines.length>count;layout.lines=layout.lines.slice(0,count);if(layout.truncated&&count)layout.lines[count-1]=layout.lines[count-1].replace(/.{0,2}$/u,'…');
 if(textLayoutCache.size>24)textLayoutCache.clear();textLayoutCache.set(key,layout);return layout;
}
function wrap(text,max,size){
 ctx.font=font(size);const lines=[],words=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'word'}):null,graphemes=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
 for(const paragraph of text.split('\n')){let line='';const parts=words?[...words.segment(paragraph)].map(p=>p.segment):paragraph.split(/(\s+)/u);
  for(const token of parts){if(ctx.measureText(line+token).width<=max){line+=token;continue}if(line){lines.push(line.trimEnd());line=''}if(!token.trim())continue;
   if(ctx.measureText(token).width<=max){line=token;continue}
   for(const ch of graphemes?[...graphemes.segment(token)].map(p=>p.segment):Array.from(token)){if(line&&ctx.measureText(line+ch).width>max){lines.push(line);line=ch}else line+=ch}
  }lines.push(line.trimEnd())
 }return lines;
}
function cameraConstraints(device=$('cameraDevice').value){
 const profile=cameraProfiles[$('cameraQuality').value],video={frameRate:{ideal:number('cameraFps',15,60)},resizeMode:{ideal:'none'}};
 if(device)video.deviceId={exact:device};if(profile){video.width={ideal:profile[0]};video.height={ideal:profile[1]}}
 return {video,audio:false};
}
function streamScale(w,h){
 if(mode!=='camera'||$('streamResolution').value==='native')return 1;
 const target=cameraProfiles[$('streamResolution').value]||cameraProfiles['1080'];
 return Math.min(4096/w,4096/h,Math.max(1,Math.min(target[0]/w,target[1]/h)));
}
function updateQualityInfo(){
 const outputSize=`${canvas.width} × ${canvas.height}`;if($('obsSize').value!==outputSize)$('obsSize').value=outputSize;
 if(mode!=='camera')return;
 const video=$('video'),track=stream?.getVideoTracks()[0],settings=track?.getSettings?.()||{},actualWidth=stream?(video.videoWidth||settings.width||0):0,actualHeight=stream?(video.videoHeight||settings.height||0):0,profile=cameraProfiles[$('cameraQuality').value];
 const qualityKey=JSON.stringify([actualWidth,actualHeight,settings.frameRate,canvas.width,canvas.height,$('cameraQuality').value,$('zoom').value]);if(qualityKey===qualityInfoKey)return;qualityInfoKey=qualityKey;
 if(actualWidth&&actualHeight){$('qualityInfo').textContent=`Камера: ${actualWidth} × ${actualHeight} · ${Number.isFinite(settings.frameRate)?Math.round(settings.frameRate):'—'} FPS. Вывод OBS: ${canvas.width} × ${canvas.height}.`;
  $('qualityWarning').textContent=profile&&(actualWidth<profile[0]||actualHeight<profile[1])?'Камера выдала разрешение ниже выбранного. Доступное качество зависит от камеры и её драйвера.':number('zoom',1,4)>1?'Цифровое приближение уменьшает количество исходных деталей. Для максимальной чёткости используйте 1×.':'';
 }else{$('qualityInfo').textContent=`Вывод OBS: ${canvas.width} × ${canvas.height}. Подключите камеру, чтобы увидеть её фактическое разрешение.`;$('qualityWarning').textContent=''}
}
function fitImage(source,x,y,w,h,camera=false){if(w<1||h<1)return;let sw=source.videoWidth||source.naturalWidth,sh=source.videoHeight||source.naturalHeight;if(!sw||!sh)return;ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();if(camera&&$('mirror').checked){ctx.translate(x*2+w,0);ctx.scale(-1,1)}
 if(camera){
  const zoom=number('zoom',1,4),fit=$('cameraFit').value;
  if(fit==='contain'){
   const cw=sw/zoom,ch=sh/zoom,sx=(sw-cw)*number('cropX',0,100)/100,sy=(sh-ch)*number('cropY',0,100)/100,scale=Math.min(w/cw,h/ch),dw=cw*scale,dh=ch*scale,dx=x+(w-dw)/2,dy=y+(h-dh)/2;
   ctx.drawImage(source,sx,sy,cw,ch,dx,dy,dw,dh);lastCameraRegion={x:dx,y:dy,width:dw,height:dh,sourceWidth:cw,sourceHeight:ch};
  }else{const scale=Math.max(w/sw,h/sh)*zoom,cw=w/scale,ch=h/scale,sx=(sw-cw)*number('cropX',0,100)/100,sy=(sh-ch)*number('cropY',0,100)/100;ctx.drawImage(source,sx,sy,cw,ch,x,y,w,h);lastCameraRegion={x,y,width:w,height:h,sourceWidth:cw,sourceHeight:ch}}
 }else{const fit=$('imageFit').value;if(fit==='stretch')ctx.drawImage(source,x,y,w,h);else{const scale=(fit==='cover'?Math.max:Math.min)(w/sw,h/sh);const dw=sw*scale,dh=sh*scale;ctx.drawImage(source,x+(w-dw)/2,y+(h-dh)/2,dw,dh)}}ctx.restore()}
function draw(includeGhost=true){
 if(includeGhost)visualRevision++;
 const w=number('width',240,4096),h=number('height',180,4096),th=Math.min(number('titleHeight',24,160),h-110),scale=streamScale(w,h),pw=Math.round(w*scale),ph=Math.round(h*scale);if(canvas.width!==pw)canvas.width=pw;if(canvas.height!==ph)canvas.height=ph;ctx.setTransform(pw/w,0,0,ph/h,0,0);ctx.clearRect(0,0,w,h);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';lastCameraRegion=null;
 const s=styles[$('generation').value],kind=s[6],classic=kind==='classic'||kind==='macclassic',mac=s[0]==='mac',radius=['modern','mac','aqua','aero','ubuntu','xp'].includes(kind)?(kind==='modern'||kind==='mac'?10:6):0;
 ctx.save();round(1,1,w-2,h-2,radius,$('bodyColor').value,'#707070');ctx.clip();let titleFill=$('titleColor').value;
 if(['aero','aqua','xp','mac'].includes(kind)){const g=ctx.createLinearGradient(0,0,0,th);g.addColorStop(0,titleFill);g.addColorStop(.5,titleFill);g.addColorStop(1,kind==='xp'?'#0044bc':titleFill);titleFill=g}
 ctx.fillStyle=titleFill;ctx.fillRect(1,1,w-2,th);if(classic)bevel(2,2,w-4,h-4,$('bodyColor').value);if(classic){ctx.fillStyle=titleFill;ctx.fillRect(4,4,w-8,th-4)}
 if(kind==='macclassic'){ctx.strokeStyle='#888';for(let yy=7;yy<th-3;yy+=3){ctx.beginPath();ctx.moveTo(25,yy);ctx.lineTo(w-25,yy);ctx.stroke()}}
 ctx.strokeStyle='#00000025';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(1,th+1);ctx.lineTo(w-1,th+1);ctx.stroke();
 let titleX=12,titleMax=w-140;
 if(mac){if(kind==='macclassic'){bevel(9,Math.max(7,(th-14)/2),14,14,'#eee')}else{['#ff5f57','#febc2e','#28c840'].forEach((c,i)=>{ctx.beginPath();ctx.arc(18+i*20,th/2,6,0,7);ctx.fillStyle=c;ctx.fill();ctx.strokeStyle='#00000025';ctx.stroke()})}titleX=84;titleMax=w-168}else{if($('titleIcon').checked){iconDraw(includeGhost&&ghostIcon!==null?ghostIcon:icon,10,(th-18)/2,18,includeGhost&&ghostIcon!==null?.4:1);titleX=36;titleMax=w-164}const bx=w-104,by=Math.max(6,(th-22)/2);if(classic){['−','□','×'].forEach((t,i)=>{bevel(bx+i*30,by,26,21,'#c0c0c0');clippedText(t,bx+i*30,by+10,26,'15px Arial','#111','center')})}else{if(kind==='xp')round(w-34,4,28,th-8,3,'#d84425','#ffffff90');clippedText('−',w-108,th/2,34,'17px Arial',$('titleTextColor').value,'center');clippedText('□',w-73,th/2,34,'14px Arial',$('titleTextColor').value,'center');clippedText('×',w-38,th/2,34,'21px Arial',$('titleTextColor').value,'center')}}
 if(mac&&$('titleIcon').checked){iconDraw(includeGhost&&ghostIcon!==null?ghostIcon:icon,titleX,Math.max(3,(th-16)/2),16,includeGhost&&ghostIcon!==null?.4:1);titleX+=22;titleMax-=22}
 if(kind==='macclassic'){ctx.font=font(number('titleFontSize',8,72));const tw=Math.min(titleMax,ctx.measureText($('title').value).width+20);ctx.fillStyle=$('titleColor').value;ctx.fillRect((w-tw)/2,3,tw,th-5)}
 const tf=$('titleFont').value==='auto'?s[5]:$('titleFont').value;
 clippedText($('title').value,titleX,th/2,titleMax,`${number('titleFontSize',8,72)}px "${tf.replace(/["\\]/g,'')}", "WCP Sans", sans-serif`,$('titleTextColor').value,mac||$('generation').value==='win8'?'center':'left',th-6);
 const pad=24,types=buttons.map(t=>({text:t,ghost:false}));if(includeGhost&&ghostButton&&types.length<8)types.push({text:tr('Новая кнопка'),ghost:true});
 const available=w-pad*2;ctx.font=font(14);const gap=10,buttonHeight=32,maxRows=Math.max(1,Math.floor((h-th-pad*2-54)/42)),cols=Math.max(1,Math.ceil(types.length/maxRows)),maxButtonWidth=(available-gap*(cols-1))/cols;let rows=[[]],rowWidth=0;types.forEach(b=>{b.width=Math.min(maxButtonWidth,Math.max(80,ctx.measureText(b.text).width+28));if(rowWidth&&rowWidth+b.width+gap>available+.01){rows.push([]);rowWidth=0}rows[rows.length-1].push(b);rowWidth+=b.width+gap});if(!types.length)rows=[];const buttonArea=rows.length*(buttonHeight+10)+(rows.length?14:0);const top=th+16,bottom=Math.max(top,h-buttonArea-16),contentHeight=bottom-top,hasMedia=mode==='camera'||Boolean(photo);
 ctx.save();ctx.beginPath();ctx.rect(pad,top,available,Math.max(0,contentHeight));ctx.clip();const it=includeGhost&&ghostIcon!==null?ghostIcon:icon;const sz=Math.min(number('iconSize',16,96),hasMedia?contentHeight*.32:contentHeight);const hasIcon=$('bodyIcon').checked&&it!=='none'&&sz>0;if(hasIcon)iconDraw(it,pad,top,sz,includeGhost&&ghostIcon!==null?.4:1);const textX=pad+(hasIcon?sz+14:0),textW=Math.max(1,w-pad-textX),layout=textLayout($('body').value,textW,hasMedia?contentHeight*.38:contentHeight,number('fontSize',8,120));let y=top;for(const line of layout.lines){clippedText(line,textX,y+layout.lineHeight/2,textW,font(layout.size),$('textColor').value,$('align').value,layout.lineHeight,false);y+=layout.lineHeight}y=Math.max(y,hasIcon?top+sz:top)+(hasMedia?10:0);
 const camera=mode==='camera'&&stream&&$('video').readyState>=2&&$('video').videoWidth>0;if(camera||photo&&mode==='image')fitImage(camera?$('video'):photo,pad,y,available,bottom-y,camera);else if(mode==='camera'&&bottom>y){round(pad,y,available,bottom-y,3,'#e2e7ed','#b9c4d1');clippedText(tr(cameraState==='starting'?'Подключение камеры…':'Включите камеру'),pad+8,(y+bottom)/2,available-16,'15px "Segoe UI", sans-serif','#566579','center',Math.min(36,bottom-y))}ctx.restore();
 let by=h-buttonArea;rows.forEach(row=>{const rw=row.reduce((a,b)=>a+b.width,0)+gap*(row.length-1);let x=w-pad-rw;row.forEach((b,i)=>{ctx.save();if(b.ghost)ctx.globalAlpha=.4;if(classic)bevel(x,by,b.width,buttonHeight,'#c0c0c0');else{let fill=mac&&i===row.length-1?'#1677e8':kind==='xp'?'#faf9f5':'#f7f7f7';round(x,by,b.width,buttonHeight,mac?6:kind==='flat'?0:4,fill,mac&&i===row.length-1?'#1264c4':'#90969f')}clippedText(b.text,x+8,by+16,b.width-16,font(14),mac&&i===row.length-1?'#fff':'#202020','center');ctx.restore();x+=b.width+gap});by+=buttonHeight+10});ctx.restore();
 $('sizeLabel').textContent=`${w} × ${h} px`;$('zoomOut').textContent=number('zoom',1,4).toFixed(2)+'×';$('layoutNote').textContent=layout.truncated?'Текст сокращён многоточием. Увеличьте окно, чтобы показать его целиком.':layout.size<number('fontSize',8,120)?`Текст автоматически уменьшен до ${layout.size} px, чтобы поместиться в окно.`:'';document.querySelectorAll('[data-icon]').forEach(b=>b.classList.toggle('selected',b.dataset.icon===icon));updateQualityInfo();
}
ids.forEach(id=>$(id).addEventListener('input',()=>{draw();save()}));
$('os').onchange=()=>{fillGenerations();preset($('generation').value)};$('generation').onchange=()=>preset($('generation').value);
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>preset(b.dataset.preset));
document.querySelectorAll('[data-icon]').forEach(b=>{b.onclick=()=>{icon=b.dataset.icon;ghostIcon=null;draw();save()};b.onmouseenter=()=>{ghostIcon=b.dataset.icon;draw()};b.onmouseleave=()=>{ghostIcon=null;draw()};b.onfocus=()=>{ghostIcon=b.dataset.icon;draw()};b.onblur=()=>{ghostIcon=null;draw()}});
$('addButton').onclick=()=>{if(buttons.length<8)buttons.push(tr('Новая кнопка'));ghostButton=false;buttonList();draw();save()};$('addButton').onmouseenter=()=>{ghostButton=true;draw()};$('addButton').onmouseleave=()=>{ghostButton=false;draw()};
$('imageFile').onchange=async()=>{const f=$('imageFile').files[0];if(!f)return;if(f.size>30*1024*1024){setStatus('Изображение должно быть меньше 30 МБ.',true);return}const u=URL.createObjectURL(f),img=new Image();img.onload=()=>{photo=img;$('chosenFile').textContent=f.name;URL.revokeObjectURL(u);draw();setStatus('Изображение добавлено.')};img.onerror=()=>{URL.revokeObjectURL(u);setStatus('Не удалось открыть изображение. Попробуйте PNG, JPEG или WebP.',true)};img.src=u};$('clearImage').onclick=()=>{photo=null;$('imageFile').value='';$('chosenFile').textContent=tr('Файл не выбран');draw()};
function cameraStatus(text,error=false){$('cameraStatus').textContent=text;$('cameraStatus').classList.toggle('error',error)}
function stopCamera(message='Камера выключена.'){
 ++cameraRun;cameraState='idle';const old=stream;stream=null;
 if(frameCallback!==null&&$('video').cancelVideoFrameCallback)$('video').cancelVideoFrameCallback(frameCallback);frameCallback=null;
 $('video').pause();$('video').srcObject=null;if(old)old.getTracks().forEach(t=>t.stop());
 $('startCamera').disabled=false;$('startCamera').textContent='Включить камеру';cameraStatus(message);draw();
}
async function devices(){
 if(!navigator.mediaDevices?.enumerateDevices)return;
 const ds=await navigator.mediaDevices.enumerateDevices(),current=$('cameraDevice').value;
 $('cameraDevice').replaceChildren(new Option('Камера по умолчанию',''));
 ds.filter(d=>d.kind==='videoinput'&&d.deviceId).forEach((d,i)=>$('cameraDevice').add(new Option(d.label||'Камера '+(i+1),d.deviceId)));
 $('cameraDevice').value=[...$('cameraDevice').options].some(o=>o.value===current)?current:'';
}
function cameraError(e){return ({NotAllowedError:'Доступ к камере запрещён. Разрешите камеру для 127.0.0.1 в браузере и в параметрах конфиденциальности Windows.',PermissionDeniedError:'Разрешите программе доступ к камере в браузере и Windows.',NotFoundError:'Камера не найдена. Подключите устройство и нажмите «Обновить камеры».',DevicesNotFoundError:'Камера не найдена. Проверьте подключение.',NotReadableError:'Камера занята или недоступна. Закройте приложения, использующие её, затем подключите снова.',TrackStartError:'Не удалось получить видео. Проверьте, не занята ли камера.',OverconstrainedError:'Камера не поддерживает выбранный режим. Выберите камеру по умолчанию.',SecurityError:'Браузер заблокировал камеру. Откройте редактор через EXE в Microsoft Edge или Chrome.',AbortError:'Подключение прервано. Попробуйте ещё раз.'})[e.name]||e.message||'Не удалось получить изображение.'}
function waitForCameraVideo(ticket){return new Promise((resolve,reject)=>{const start=performance.now();function check(){if(ticket!==cameraRun)return reject(new DOMException('Подключение отменено.','AbortError'));const v=$('video');if(v.readyState>=2&&v.videoWidth>0&&v.videoHeight>0)return resolve();if(performance.now()-start>12000)return reject(new Error('Камера подключилась, но не прислала видеокадр. Закройте другие приложения камеры и попробуйте подключиться снова.'));setTimeout(check,50)}check()})}
function drawOnCameraFrame(ticket){
 if(ticket!==cameraRun||!stream||mode!=='camera')return;
 visualRevision++;if($('video').requestVideoFrameCallback)frameCallback=$('video').requestVideoFrameCallback(()=>drawOnCameraFrame(ticket));
}
async function startCamera(){
 stopCamera('Ожидается доступ к камере. Если браузер спрашивает разрешение, выберите «Разрешить».');
 const ticket=cameraRun;cameraState='starting';$('startCamera').disabled=true;$('startCamera').textContent='Подключение…';draw();
 let candidate=null;
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Откройте программу через её EXE в Microsoft Edge или Chrome. Адрес должен начинаться с http://127.0.0.1:47831/.');
  const device=$('cameraDevice').value;
  try{candidate=await navigator.mediaDevices.getUserMedia(cameraConstraints(device))}
  catch(e){if(e.name==='OverconstrainedError')candidate=await navigator.mediaDevices.getUserMedia({video:device?{deviceId:{exact:device}}:true,audio:false});else throw e}
  if(ticket!==cameraRun||mode!=='camera'){candidate.getTracks().forEach(t=>t.stop());return}
  stream=candidate;const video=$('video');video.muted=true;video.autoplay=true;video.playsInline=true;video.srcObject=stream;
  cameraStatus('Устройство подключено. Ожидается первый видеокадр…');
  // Wait for decoded pixels as well as play(): a fulfilled play promise alone is not a frame.
  await Promise.all([video.play(),waitForCameraVideo(ticket)]);
  if(ticket!==cameraRun)return;
  cameraState='live';$('startCamera').disabled=false;$('startCamera').textContent='Переподключить';
  const track=stream.getVideoTracks()[0];cameraStatus(`● ${track?.label||'Камера'} · ${video.videoWidth} × ${video.videoHeight} · сигнал получен`);
  track?.addEventListener('ended',()=>{if(ticket===cameraRun){stopCamera('Камера отключилась. Подключите её и нажмите «Включить камеру».');setStatus('Поток камеры завершился.',true)}});
  track?.addEventListener('mute',()=>{if(ticket===cameraRun)cameraStatus('Камера временно не передаёт кадры. Проверьте устройство.',true)});
  track?.addEventListener('unmute',()=>{if(ticket===cameraRun)cameraStatus(`● Сигнал камеры восстановлен · ${video.videoWidth} × ${video.videoHeight}`)});
  drawOnCameraFrame(ticket);setStatus('Изображение камеры получено и добавлено в окно.');
  // A failure to enumerate device names must never tear down a working camera stream.
  devices().catch(()=>{});
 }catch(e){if(ticket!==cameraRun){candidate?.getTracks().forEach(t=>t.stop());return}const message=cameraError(e);stopCamera(message);cameraStatus(message,true);setStatus(message,true)}
}
$('startCamera').onclick=startCamera;$('stopCamera').onclick=()=>stopCamera();
$('cameraDevice').onchange=()=>{if(stream||cameraState==='starting')startCamera()};
for(const id of ['cameraQuality','cameraFps'])$(id).addEventListener('change',()=>{if(stream||cameraState==='starting')startCamera()});
$('copyObsSize').onclick=async()=>{try{await navigator.clipboard.writeText($('obsSize').value);setStatus('Размер вывода OBS скопирован. Укажите эту ширину и высоту в свойствах источника «Браузер».')}catch{$('obsSize').select();setStatus('Нажмите Ctrl+C, чтобы скопировать размер вывода OBS.')}};
$('refreshCameras').onclick=()=>devices().then(()=>cameraStatus('Список камер обновлён. Выберите устройство и подключитесь.')).catch(e=>cameraStatus(cameraError(e),true));
navigator.mediaDevices?.addEventListener?.('devicechange',()=>devices().catch(()=>{}));
document.fonts?.addEventListener?.('loadingdone',()=>{textLayoutCache.clear();draw()});
async function post(path,body,headers={}){const signal=path==='/api/frame'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(1500):undefined;const r=await fetch(path,{method:'POST',headers:{'X-WCP':'1',...headers},body,signal});const d=await r.json();if(!r.ok)throw new Error(d.error||'Ошибка сервера');return d}

function connectFrameTransport(){
 if(frameSocket||performance.now()<nextFrameConnect||mode!=='camera')return;
 const ws=new WebSocket(`ws://${location.host}/stream?role=publish`);frameSocket=ws;ws.binaryType='arraybuffer';
 ws.onopen=()=>{lastPublishedRevision=-1;awaitingFrameAck=0};
 ws.onmessage=e=>{if(frameSocket!==ws)return;if(e.data instanceof ArrayBuffer&&e.data.byteLength===8){const stamp=new DataView(e.data).getFloat64(0,true);if(stamp===awaitingFrameAck)awaitingFrameAck=0;if(performance.now()-lastFeedback>500){lastFeedback=performance.now();$('streamStatus').textContent=`● Прямое соединение OBS · до 60 кадров/с · подготовка и отправка: ${Math.max(0,Date.now()-stamp)} мс`}}};
 ws.onclose=()=>{if(frameSocket===ws){frameSocket=null;awaitingFrameAck=0;nextFrameConnect=performance.now()+250}};ws.onerror=()=>ws.close();
}
function stopFrameTransport(){transportEpoch++;const old=frameSocket;frameSocket=null;awaitingFrameAck=0;lastPublishedRevision=-1;old?.close()}
function publishLatestFrame(){
 if(sending||mode!=='camera')return;
 const ws=frameSocket,now=performance.now();
 if(ws?.readyState===WebSocket.OPEN&&(awaitingFrameAck||ws.bufferedAmount>0)){
  // Do not append more frames to a congested connection. Reconnect instead of replaying old video.
  if(awaitingFrameAck&&now-frameAckStarted>300){ws.close();awaitingFrameAck=0}return;
 }
 sending=true;lastSent=now;const version=transportEpoch,revision=visualRevision,captured=Date.now();draw(false);
 canvas.toBlob(async blob=>{
  try{if(!blob||mode!=='camera'||version!==transportEpoch)return;
   if(Date.now()-captured>350){$('streamStatus').textContent='Подготовка кадра слишком долгая. Уменьшите размеры окна для трансляции.';return}
   if(ws&&ws===frameSocket&&ws.readyState===WebSocket.OPEN){
    if(ws.bufferedAmount>0||awaitingFrameAck)return;
    const header=new ArrayBuffer(8);new DataView(header).setFloat64(0,captured,true);awaitingFrameAck=captured;frameAckStarted=performance.now();ws.send(new Blob([header,blob]));
   }else{await post('/api/frame',blob,{'X-WCP-Capture-Time':String(captured)});$('streamStatus').textContent='● Передача OBS · восстановление прямого соединения…'}
   lastPublishedRevision=revision;
  }catch(e){$('streamStatus').textContent='Ошибка передачи: '+e.message}finally{sending=false}
 },'image/png');
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=async()=>{mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(t=>t.classList.toggle('active',t===b));$('cameraPanel').hidden=mode!=='camera';$('generate').hidden=mode==='camera';$('outputTitle').textContent=mode==='camera'?'Трансляция окна для OBS':'Готово к сохранению';$('modeNote').textContent=mode==='camera'?'Камера, обрезка и трансляция':'Создайте окно и сохраните его в PNG';if(mode==='image'){stopFrameTransport();stopCamera();await post('/api/frame',new Blob()).catch(()=>{})}else{connectFrameTransport();devices().catch(()=>{});setStatus('Включите камеру или транслируйте окно без камеры.')}draw()});
$('copyObs').onclick=async()=>{try{await navigator.clipboard.writeText($('obsUrl').value);setStatus('Адрес OBS скопирован.')}catch{ $('obsUrl').select();setStatus('Нажмите Ctrl+C, чтобы скопировать адрес.')}};
$('generate').onclick=async()=>{const b=$('generate');b.disabled=true;try{draw(false);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Не удалось создать PNG');const result=await post('/api/save',blob);setStatus('Сохранено: '+result.path)}catch(e){setStatus(e.message,true)}finally{b.disabled=false;draw()}};
$('settingsToggle').onclick=()=>$('settings').showModal();$('closeSettings').onclick=()=>$('settings').close();$('appTheme').onchange=applyTheme;$('accent').oninput=applyTheme;$('openFolder').onclick=()=>post('/api/folder').catch(e=>setStatus(e.message,true));$('reset').onclick=()=>{ids.forEach(id=>{if($(id).type==='checkbox')$(id).checked=initial[id];else $(id).value=initial[id]});icon='info';buttons=['ОК','Отмена'];photo=null;$('imageFile').value='';$('chosenFile').textContent=tr('Файл не выбран');preset('win8');buttonList();draw();save();if(stream||cameraState==='starting')startCamera()};
function tick(){const now=performance.now();if(mode==='camera'){connectFrameTransport();if(stream&&!$('video').requestVideoFrameCallback&&now-lastSent>=16)visualRevision++;if(now-lastSent>=16&&(visualRevision!==lastPublishedRevision||now-lastSent>200))publishLatestFrame()}setTimeout(tick,8)}
async function init(){await WcpI18n.ready;fillGenerations('win8');try{const r=await fetch('/api/info'),info=await r.json();$('folderLabel').textContent=info.folder;const preferred=['WCP Sans','WCP Serif','WCP Mono','Segoe UI','Tahoma','Arial','Verdana','Times New Roman','Courier New','Georgia','Trebuchet MS'];const all=[...new Set([...preferred,...info.fonts])];all.forEach(f=>{for(const id of ['font','titleFont']){const option=new Option(f,f);option.dataset.noI18n='';$(id).add(option)}})}catch(e){setStatus('Не удалось загрузить список шрифтов: '+e.message,true)}restore();buttonList();applyTheme();await Promise.all(['WCP Sans','WCP Serif','WCP Mono'].map(f=>document.fonts.load('16px "'+f+'"').catch(()=>{})));draw();tick()}
$ ('chooseImage').onclick=()=>$('imageFile').click();
window.addEventListener('wcp-languagechange',()=>{if(!$('imageFile').files.length)$('chosenFile').textContent=tr('Файл не выбран');if($('generation').value)draw()});
window.addEventListener('beforeunload',()=>{stopFrameTransport();if(stream)stream.getTracks().forEach(t=>t.stop())});const appReady=init();
