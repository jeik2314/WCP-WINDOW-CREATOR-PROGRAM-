'use strict';
// One decoding operation and one replaceable pending frame. Never replay a queue of old frames.
function createLatestFramePlayer(canvas,options={}){
 const context=canvas.getContext('2d',{alpha:true});let socket=null,pending=null,decoding=false,closed=false,retry=null,lastReceived=0,epoch=0;
 const maxAge=400;
 function clear(){epoch++;pending=null;context.clearRect(0,0,canvas.width,canvas.height);canvas.dataset.state='waiting'}
 async function decode(){
  if(decoding)return;decoding=true;
  try{while(pending&&!closed){const packet=pending;pending=null;const stamp=new DataView(packet).getFloat64(0,true),version=epoch;
    if(!Number.isFinite(stamp)||Date.now()-stamp>maxAge)continue;
    let bitmap;try{bitmap=await createImageBitmap(new Blob([packet.slice(8)],{type:'image/png'}))}catch{continue}
    try{if(closed||version!==epoch||Date.now()-stamp>maxAge)continue;
     if(canvas.width!==bitmap.width)canvas.width=bitmap.width;if(canvas.height!==bitmap.height)canvas.height=bitmap.height;
     context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0);
     const age=Date.now()-stamp;canvas.dataset.latencyMs=String(age);canvas.dataset.state='live';canvas.dataset.captureTime=String(stamp);options.onFrame?.(age,stamp);
    }finally{bitmap.close()}
  }}finally{decoding=false}
 }
 function connect(){if(closed)return;socket=new WebSocket(`ws://${location.host}/stream?role=subscribe`);socket.binaryType='arraybuffer';
  socket.onopen=()=>{canvas.dataset.transport='websocket';options.onState?.('connected')};
  socket.onmessage=e=>{lastReceived=Date.now();if(!(e.data instanceof ArrayBuffer)||e.data.byteLength<=8){clear();return}pending=e.data;decode()};
  socket.onclose=()=>{clear();if(!closed){options.onState?.('reconnecting');retry=setTimeout(connect,250)}};
  socket.onerror=()=>socket.close();
 }
 const expiry=setInterval(()=>{if(lastReceived&&Date.now()-lastReceived>750)clear()},100);connect();
 return {close(){closed=true;clearTimeout(retry);clearInterval(expiry);clear();socket?.close()},get connected(){return socket?.readyState===WebSocket.OPEN}};
}
