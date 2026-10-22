'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {atomic,readJson,files,scopedFiles,safePath,noLinks,hash}=require('./util');
const SCOPES=['mods','config','resourcepacks','shaderpacks','defaultconfigs','kubejs','options.txt','servers.dat','screenshots'];
async function digest(file){const h=crypto.createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file))h.update(chunk);return h.digest('hex');}
const recordId=id=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Неверный ID копии');return id;};
class Backups {
 constructor(packs){this.packs=packs;this.root=path.join(packs.root,'snapshots');}
 dir(id,key){this.packs.dir(id);return safePath(path.join(this.root,id),recordId(key));}
 async list(id){await this.packs.get(id);const root=path.join(this.root,id);const entries=await fs.readdir(root).catch(e=>{if(e.code==='ENOENT')return [];throw e;});const result=[];for(const key of entries){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(key))continue;const m=await readJson(path.join(this.dir(id,key),'manifest.json'),null);if(m?.id===key&&m.packId===id)result.push({id:key,date:m.date,label:m.label,worlds:m.scopes.includes('saves'),size:m.files.reduce((n,f)=>n+f.size,0),count:m.files.length});}return result.sort((a,b)=>b.date.localeCompare(a.date));}
 async create(id,{worlds=false,label='Ручная копия'}={}){
  const pack=await this.packs.get(id),game=this.packs.dir(id),base=pack.launchSettings?.backupScopes?.filter(s=>s!=='saves')||SCOPES,scopes=worlds?[...base,'saves']:base;
  const key=Date.now()+'-'+crypto.randomUUID(),dir=this.dir(id,key),selected=await scopedFiles(game,scopes),saved=[];
  await require('./disk-space').requireSpace(this.root,selected.reduce((n,f)=>n+f.size,0)+1024**2);
  let done=0;for(const f of selected){const from=safePath(game,f.path),to=safePath(path.join(dir,'game'),f.path);await noLinks(game,from);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to);saved.push({...f,hash:await digest(to)});if(++done%20===0||done===selected.length)this.packs.emit('progress',{label:'Резервная копия',current:done,total:selected.length});}
  const metadata={};for(const name of ['resources.json','installed-mods.json'])metadata[name]=await readJson(path.join(this.packs.root,'instances',id,name),{});
  await atomic(path.join(dir,'manifest.json'),JSON.stringify({id:key,packId:id,date:new Date().toISOString(),label:String(label).slice(0,100),scopes,files:saved,pack,metadata},null,2));
  await this.packs.log(id,'Резервная копия: '+label,selected.map(f=>f.path));return key;
 }
 async restore(id,key){
  await this.packs.get(id);const dir=this.dir(id,key);await noLinks(this.root,dir);const m=await readJson(path.join(dir,'manifest.json'));
  if(m.packId!==id||m.id!==key||!Array.isArray(m.files)||!m.scopes?.every(s=>[...SCOPES,'saves'].includes(s)))throw Error('Неверная копия');
  for(const f of m.files){if(!m.scopes.some(s=>f.path===s||f.path.startsWith(s+'/')))throw Error('Файл вне области копии');const source=safePath(path.join(dir,'game'),f.path);await noLinks(dir,source);if(await digest(source)!==f.hash)throw Error('Копия повреждена: '+f.path);}
  const originalPack=await this.packs.get(id);const originalMetadata={};for(const name of ['resources.json','installed-mods.json'])originalMetadata[name]=await readJson(path.join(this.packs.root,'instances',id,name),{});
  const before=await this.create(id,{worlds:m.scopes.includes('saves'),label:'Перед восстановлением'});
  const game=this.packs.dir(id),stage=safePath(path.join(this.packs.root,'staging'),crypto.randomUUID()),rollback=path.join(stage,'previous');await fs.mkdir(rollback,{recursive:true});
  const moved=[];
  try{
   for(const f of m.files){const target=safePath(path.join(stage,'next'),f.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(safePath(path.join(dir,'game'),f.path),target);}
   for(const scope of m.scopes){const target=safePath(game,scope),old=safePath(rollback,scope),next=safePath(path.join(stage,'next'),scope);await noLinks(game,target);const entry={target,old,had:false,placed:false};moved.push(entry);try{await fs.rename(target,old);entry.had=true;}catch(e){if(e.code!=='ENOENT')throw e;}try{await fs.rename(next,target);entry.placed=true;}catch(e){if(e.code!=='ENOENT')throw e;}}
   for(const name of ['resources.json','installed-mods.json'])await atomic(path.join(this.packs.root,'instances',id,name),JSON.stringify(m.metadata?.[name]||{}));
   const current=await this.packs.get(id);await this.packs.save({...current,version:m.pack.version,loader:m.pack.loader,loaderVersion:m.pack.loaderVersion,launchSettings:m.pack.launchSettings});
   await this.packs.log(id,'Восстановление копии',m.files.map(f=>f.path));return {restored:true,safetyBackup:before};
  }catch(e){for(const entry of moved.reverse()){if(entry.placed)await fs.rm(entry.target,{recursive:true,force:true});if(entry.had)await fs.rename(entry.old,entry.target);}if(moved.length){for(const name of ['resources.json','installed-mods.json'])await atomic(path.join(this.packs.root,'instances',id,name),JSON.stringify(originalMetadata[name]));await this.packs.save(originalPack).catch(()=>{});}throw e;}finally{await fs.rm(stage,{recursive:true,force:true});}
 }
}
module.exports={Backups,SCOPES};
