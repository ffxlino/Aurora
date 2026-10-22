'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {request,hash,noLinks}=require('./util');
async function checksum(file,algorithm){const digest=crypto.createHash(algorithm);for await(const chunk of require('node:fs').createReadStream(file))digest.update(chunk);return digest.digest('hex');}
class Downloads {
 constructor(emit,network=request,limit=3){this.emit=emit;this.network=network;this.limit=limit;this.tasks=new Map();this.active=0;this.waiters=[];this.last=0;}
 setLimit(limit){if(!Number.isInteger(limit)||limit<1||limit>8)throw Error('Неверный лимит загрузок');this.limit=limit;this.dispatch();}
 dispatch(){while(this.active<this.limit&&this.waiters.length){this.active++;this.waiters.shift()();}}
 async external(name,total,fn,context=this.context){const t={id:crypto.randomUUID(),name,total,current:0,status:'running',context:context?{...context}:null,external:true};this.tasks.set(t.id,t);this.notify(true);const started=Date.now();try{const result=await fn(n=>{t.current=n;t.speed=n/Math.max(.1,(Date.now()-started)/1000);this.notify();});t.current=total;t.status='done';return result;}catch(e){t.status='error';t.error=e.message;throw e;}finally{for(const [id,value]of this.tasks)if(this.tasks.size>100&&['done','error','cancelled'].includes(value.status))this.tasks.delete(id);this.notify(true);}}
 setContext(context){this.context=context;}
 state(){return [...this.tasks.values()].map(t=>({id:t.id,name:t.name,...t.context,status:t.status,current:t.current,total:t.total,speed:t.status==='running'?t.speed||0:0,etaSeconds:t.status==='running'&&t.speed>0&&t.total>t.current?(t.total-t.current)/t.speed:null,external:!!t.external,error:t.error||''}));}
 notify(force=false){if(!force&&Date.now()-this.last<250)return;this.last=Date.now();this.emit('downloads',this.state());}
 async acquire(){await new Promise(resolve=>{this.waiters.push(resolve);this.dispatch();});}
 release(){this.active--;this.dispatch();}
 control(id,action){const t=this.tasks.get(id);if(!t||!['pause','resume','cancel'].includes(action))throw Error('Неверная загрузка');if(['done','error','cancelled'].includes(t.status))return;if(t.external)throw Error('Для этого файлового протокола пауза не поддерживается');
  if(action==='pause'){t.paused=true;t.status='paused';t.controller?.abort();}
  if(action==='resume'){t.paused=false;t.status='queued';t.wake?.();}
  if(action==='cancel'){t.cancelled=true;t.paused=false;t.controller?.abort();t.wake?.();}
  this.notify(true);
 }
 async download(url,file,expected,algorithm='sha1',progress=()=>{}){
  if(expected){try{if(await checksum(file,algorithm)===expected.toLowerCase())return;}catch(e){if(e.code!=='ENOENT')throw e;}}
  const t={context:this.context?{...this.context}:null,id:crypto.randomUUID(),name:path.basename(file),status:'queued',current:0,total:0,paused:false,cancelled:false},part=file+'.'+hash(Buffer.from(url+algorithm+(expected||''))).slice(0,20)+'.part';
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
     if(t.total>2*1024**3)throw Error('Файл слишком большой');t.current=append?offset:0;await require('./disk-space').requireSpace(path.dirname(file),Math.max(0,t.total-t.current)||16*1024**2);handle=await fs.open(part,append?'a':'w');let lastTime=Date.now(),lastBytes=t.current,spaceChecked=t.current;
     for await(const chunk of r.body){if(t.paused||t.cancelled)throw Error('Загрузка приостановлена');t.current+=chunk.length;if(t.current>2*1024**3)throw Error('Файл слишком большой');if(t.current-spaceChecked>=64*1024**2){await require('./disk-space').requireSpace(path.dirname(file),t.total?Math.max(0,t.total-t.current):16*1024**2);spaceChecked=t.current;}await handle.writeFile(chunk);const elapsed=Date.now()-lastTime;if(elapsed>=250){t.speed=Math.round((t.current-lastBytes)*1000/elapsed);lastTime=Date.now();lastBytes=t.current;}progress(t.current,t.total);this.notify();}
     await handle.close();handle=null;if(t.total&&t.current!==t.total)throw Error('Загрузка оборвалась');if(expected&&await checksum(part,algorithm)!==expected.toLowerCase())throw Error('Контрольная сумма не совпадает: '+t.name);
     if(t.cancelled)throw Error('Загрузка отменена');await fs.rename(part,file);t.status='done';this.notify(true);return;
    }catch(e){if(t.cancelled)throw Error('Загрузка отменена');if(t.paused)continue;if(e.code==='AURORA_DISK_SPACE')throw e;if(++failures<3&&!/сумма|слишком большой|Некорректный/.test(e.message)){await new Promise(r=>setTimeout(r,500*failures));continue;}throw e;
    }finally{await handle?.close().catch(()=>{});t.controller=null;this.release();}
   }
  }catch(e){t.status=t.cancelled?'cancelled':'error';t.error=e.message;await fs.rm(part,{force:true});this.notify(true);throw e;}
 }
}
module.exports={Downloads};
