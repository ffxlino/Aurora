'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {request,hash,noLinks}=require('./util');
class Downloads {
 constructor(emit,network=request,limit=3){this.emit=emit;this.network=network;this.limit=limit;this.tasks=new Map();this.active=0;this.waiters=[];this.last=0;}
 state(){return [...this.tasks.values()].map(t=>({id:t.id,name:t.name,status:t.status,current:t.current,total:t.total,speed:t.status==='running'?t.speed||0:0,etaSeconds:t.status==='running'&&t.speed>0&&t.total>t.current?(t.total-t.current)/t.speed:null,error:t.error||''}));}
 notify(force=false){if(!force&&Date.now()-this.last<250)return;this.last=Date.now();this.emit('downloads',this.state());}
 async acquire(){if(this.active>=this.limit)await new Promise(resolve=>this.waiters.push(resolve));this.active++;}
 release(){this.active--;this.waiters.shift()?.();}
 control(id,action){const t=this.tasks.get(id);if(!t||!['pause','resume','cancel'].includes(action))throw Error('Неверная загрузка');if(['done','error','cancelled'].includes(t.status))return;
  if(action==='pause'){t.paused=true;t.status='paused';t.controller?.abort();}
  if(action==='resume'){t.paused=false;t.status='queued';t.wake?.();}
  if(action==='cancel'){t.cancelled=true;t.paused=false;t.controller?.abort();t.wake?.();}
  this.notify(true);
 }
 async download(url,file,expected,algorithm='sha1',progress=()=>{}){
  if(expected){try{if(hash(await fs.readFile(file),algorithm)===expected.toLowerCase())return;}catch(e){if(e.code!=='ENOENT')throw e;}}
  const t={id:crypto.randomUUID(),name:path.basename(file),status:'queued',current:0,total:0,paused:false,cancelled:false},part=file+'.'+hash(Buffer.from(url+algorithm+(expected||''))).slice(0,20)+'.part';
  this.tasks.set(t.id,t);for(const [key,value]of this.tasks)if(this.tasks.size>100&&['done','error','cancelled'].includes(value.status))this.tasks.delete(key);this.notify(true);
  await fs.mkdir(path.dirname(file),{recursive:true});await noLinks(path.dirname(file),part);
  try{
   let failures=0;
   while(true){
    if(t.cancelled)throw Error('Загрузка отменена');if(t.paused)await new Promise(resolve=>{t.wake=resolve;});if(t.cancelled)throw Error('Загрузка отменена');
    await this.acquire();let handle;
    try{
     if(t.cancelled)throw Error('Загрузка отменена');if(t.paused)continue;
     const offset=(await fs.stat(part).catch(e=>{if(e.code==='ENOENT')return {size:0};throw e;})).size;t.controller=new AbortController();t.status='running';this.notify(true);
     const r=await this.network(url,{headers:offset?{Range:'bytes='+offset+'-'}:{},signal:t.controller.signal});let append=offset>0&&r.status===206;
     if(append){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')||'');if(!range||Number(range[1])!==offset)throw Error('Некорректный ответ докачки');t.total=Number(range[3]);}else{t.total=Number(r.headers.get('content-length'))||0;}
     if(t.total>2*1024**3)throw Error('Файл слишком большой');t.current=append?offset:0;handle=await fs.open(part,append?'a':'w');let lastTime=Date.now(),lastBytes=t.current;
     for await(const chunk of r.body){if(t.paused||t.cancelled)throw Error('Загрузка приостановлена');t.current+=chunk.length;if(t.current>2*1024**3)throw Error('Файл слишком большой');await handle.writeFile(chunk);const elapsed=Date.now()-lastTime;if(elapsed>=250){t.speed=Math.round((t.current-lastBytes)*1000/elapsed);lastTime=Date.now();lastBytes=t.current;}progress(t.current,t.total);this.notify();}
     await handle.close();handle=null;if(t.total&&t.current!==t.total)throw Error('Загрузка оборвалась');if(expected&&hash(await fs.readFile(part),algorithm)!==expected.toLowerCase())throw Error('Контрольная сумма не совпадает: '+t.name);
     await fs.rename(part,file);t.status='done';this.notify(true);return;
    }catch(e){if(t.cancelled)throw Error('Загрузка отменена');if(t.paused)continue;if(++failures<3&&!/сумма|слишком большой|Некорректный/.test(e.message)){await new Promise(r=>setTimeout(r,500*failures));continue;}throw e;
    }finally{await handle?.close().catch(()=>{});t.controller=null;this.release();}
   }
  }catch(e){t.status=t.cancelled?'cancelled':'error';t.error=e.message;await fs.rm(part,{force:true});this.notify(true);throw e;}
 }
}
module.exports={Downloads};
