'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createWriteStream}=require('node:fs');const {pipeline}=require('node:stream/promises');const yazl=require('yazl');
const {files,safePath,noLinks}=require('./util');
async function serverPlan(packs,catalog,id){
 const pack=await packs.get(id),inventory=await catalog.inventory(id),mods=new Map(inventory.items.filter(i=>i.type==='mod').map(i=>[i.path,i]));
 const included=[],excluded=[],unknown=[];
 for(const file of await files(packs.dir(id))){
  if(!/^(mods|config|defaultconfigs|kubejs)\//.test(file.path))continue;if(/^kubejs\/(client_scripts|assets)\//.test(file.path))continue;
  if(/(?:^|\/)(?:\.index|\.connector|\.cache)(?:\/|$)/.test(file.path)||file.path.endsWith('.disabled'))continue;
  if(file.path.startsWith('mods/')){const mod=mods.get(file.path);if(!mod)continue;if(mod.side==='client'){excluded.push(file.path);continue;}if(mod.side==='unknown')unknown.push(file.path);}
  if(/(?:^|\/)(?:\.env(?:\..*)?|accounts?\.json|credentials?\.[^/]+|tokens?\.[^/]+)$/i.test(file.path))continue;
  included.push(file);
 }return {pack,included,excluded,unknown};
}
async function exportServer(packs,catalog,id,destination,emit=()=>{}){
 const plan=await serverPlan(packs,catalog,id),dir=packs.dir(id),output=path.resolve(destination);
 const relative=path.relative(dir,output);if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw Error('Сохрани ZIP вне папки игры');
 await fs.mkdir(path.dirname(output),{recursive:true});const temporary=output+'.'+crypto.randomUUID()+'.tmp',zip=new yazl.ZipFile();
 zip.on('error',e=>zip.outputStream.destroy(e));
 const report={name:plan.pack.name,minecraft:plan.pack.version,loader:plan.pack.loader,loaderVersion:plan.pack.loaderVersion,included:plan.included.map(f=>f.path),excludedClientMods:plan.excluded,unknownMods:plan.unknown,date:new Date().toISOString()};
 try{
  for(const f of plan.included){const target=safePath(dir,f.path);await noLinks(dir,target);zip.addFile(target,f.path,{compress:!f.path.endsWith('.jar')});}
  zip.addBuffer(Buffer.from(JSON.stringify(report,null,2)),'aurora-server-export.json');
  zip.addBuffer(Buffer.from(`Сервер: ${plan.pack.name}\nMinecraft ${plan.pack.version}; ${plan.pack.loader} ${plan.pack.loaderVersion||''}\n\nУстановите сервер этой версии Minecraft и загрузчика, затем распакуйте ZIP в его папку.\nJava, серверный загрузчик и согласие с EULA не включены в архив.\nИсключено клиентских модов: ${plan.excluded.length}. Неопределённых включено: ${plan.unknown.length}.\nКонфиги сохранены: для них нет надёжного общего способа определить сторону.\nМиры, аккаунты, логи, шейдеры и ресурспаки не экспортируются.\n`),'README-server.txt');
  let current=0,last=0;const total=0;zip.outputStream.on('data',b=>{current+=b.length;if(Date.now()-last<250)return;last=Date.now();emit('progress',{label:'Экспорт сервера · '+plan.pack.name,current,total,unit:'bytes',phase:'commit'});});
  const written=pipeline(zip.outputStream,createWriteStream(temporary,{flags:'wx'}));zip.end({forceZip64Format:true});await written;await fs.rename(temporary,output);return {...report,path:output};
 }catch(e){zip.outputStream.destroy();await fs.rm(temporary,{force:true}).catch(()=>{});throw e;}
}
module.exports={serverPlan,exportServer};
