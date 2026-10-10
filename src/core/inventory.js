'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),AdmZip=require('adm-zip');
const {parse:parseToml}=require('smol-toml');
const {atomic,readJson,safePath,noLinks,files,hash}=require('./util');
const {pool}=require('./minecraft');
const metadataFile=(packs,id)=>path.join(packs.root,'instances',id,'resources.json');
const sideName=environment=>environment==='client'?'client':environment==='server'?'server':environment==='*'?'both':'unknown';
function jarMetadata(bytes) {
  const result={side:'unknown',sideEvidence:'В файле нет сведений о стороне'};
  try {
    const zip=new AdmZip(bytes);
    const text=name=>{const e=zip.getEntry(name);if(!e||e.header.size>1024**2)return null;return e.getData().toString('utf8');};
    let icon;
    const fabric=text('fabric.mod.json'),quilt=text('quilt.mod.json');
    if(fabric){const m=JSON.parse(fabric);Object.assign(result,{title:m.name||m.id,description:m.description||'',version:String(m.version||''),side:sideName(m.environment),sideEvidence:'fabric.mod.json',author:(m.authors||[]).map(a=>typeof a==='string'?a:a.name||'').join(', ')});icon=typeof m.icon==='string'?m.icon:Object.values(m.icon||{})[0];}
    else if(quilt){const m=JSON.parse(quilt),loader=m.quilt_loader||{},meta=loader.metadata||{};Object.assign(result,{title:meta.name||loader.id,description:meta.description||'',version:String(loader.version||''),side:sideName(m.minecraft?.environment),sideEvidence:'quilt.mod.json',author:Object.keys(meta.contributors||{}).join(', ')});icon=typeof meta.icon==='string'?meta.icon:Object.values(meta.icon||{})[0];}
    else {const toml=text('META-INF/neoforge.mods.toml')||text('META-INF/mods.toml');if(toml){const m=parseToml(toml),mod=m.mods?.[0];if(mod){Object.assign(result,{title:mod.displayName||mod.modId,description:mod.description||'',version:mod.version==='${file.jarVersion}'?'':String(mod.version||''),author:String(mod.authors||m.authors||'')});icon=mod.logoFile;}}}
    if(icon&&typeof icon==='string'&&/\.(png|jpg|jpeg|webp)$/i.test(icon)){const e=zip.getEntry(icon);if(e&&e.header.size<256*1024){const mime=/\.png$/i.test(icon)?'png':/\.webp$/i.test(icon)?'webp':'jpeg';result.icon=`data:image/${mime};base64,${e.getData().toString('base64')}`;}}
  } catch {result.metadataWarning='Не удалось прочитать метаданные файла';}
  return result;
}
function fingerprint(bytes) {
  const filtered=Buffer.allocUnsafe(bytes.length);let length=0;for(const b of bytes)if(b!==9&&b!==10&&b!==13&&b!==32)filtered[length++]=b;
  let h=(1^length)>>>0,i=0;
  while(i+4<=length){let k=filtered.readUInt32LE(i);k=Math.imul(k,0x5bd1e995)>>>0;k^=k>>>24;k=Math.imul(k,0x5bd1e995)>>>0;h=(Math.imul(h,0x5bd1e995)^k)>>>0;i+=4;}
  const left=length-i;if(left===3)h^=filtered[i+2]<<16;if(left>=2)h^=filtered[i+1]<<8;if(left>=1){h^=filtered[i];h=Math.imul(h,0x5bd1e995)>>>0;}
  h^=h>>>13;h=Math.imul(h,0x5bd1e995)>>>0;h^=h>>>15;return h>>>0;
}
async function readInventory(packs,id) {
  await packs.get(id);const dir=packs.dir(id),meta=await readJson(metadataFile(packs,id),{}),cacheFile=path.join(packs.root,'instances',id,'inventory-cache.json'),cache=await readJson(cacheFile,{}),next={},items=[];
  for(const [folder,type]of [['mods','mod'],['resourcepacks','resourcepack'],['shaderpacks','shader']]){
    const list=await files(path.join(dir,folder));
    for(const f of list){if(!/\.(jar|zip)(\.disabled)?$/i.test(f.path))continue;const name=folder+'/'+f.path,target=safePath(dir,name);await noLinks(dir,target);let info=cache[name];
      if(!info||info.size!==f.size||info.modified!==f.modified){if(f.size>256*1024**2){items.push({...f,path:name,type,title:path.basename(f.path),source:'local',side:'unknown',description:'Файл слишком большой для чтения метаданных',disabled:name.endsWith('.disabled')});continue;}const bytes=await fs.readFile(target);info={size:f.size,modified:f.modified,sha1:hash(bytes,'sha1'),fingerprint:fingerprint(bytes),...(type==='mod'?jarMetadata(bytes):{})};}
      next[name]=info;const saved=meta[info.sha1]||{},side=saved.sideOverride||((saved.side&&saved.side!=='unknown')?saved.side:info.side)||'unknown';
      items.push({...info,...saved,path:name,size:f.size,modified:f.modified,type,source:saved.source||'local',title:saved.title||info.title||path.basename(f.path).replace(/\.disabled$/,''),description:saved.description||info.description||'Описание пока не найдено. Нажмите «Распознать файлы», чтобы проверить каталоги.',icon:saved.icon||info.icon||'',side,sideEvidence:saved.sideOverride?'Указано вручную':saved.side&&saved.side!=='unknown'?saved.sideEvidence:info.sideEvidence||'Не определено',disabled:name.endsWith('.disabled')});
    }
  }
  await atomic(cacheFile,JSON.stringify(next));return {items:items.sort((a,b)=>a.title.localeCompare(b.title,'ru'))};
}
async function identifyInventory(catalog,id) {
  const {items}=await readInventory(catalog.packs,id),unknown=items.filter(i=>i.sha1&&(!i.projectId||!i.title||i.provenance==='imported')),warnings=[];
  const additions={},projectCache=new Map();let recognized=0;
  const project=async(source,id)=>{const key=source+':'+id;if(!projectCache.has(key))projectCache.set(key,catalog.project(source,id));return projectCache.get(key);};
  for(let offset=0;offset<unknown.length;offset+=100){const batch=unknown.slice(offset,offset+100),matches=new Set();
    try {
      const result=await catalog.json('https://api.modrinth.com/v2/version_files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hashes:batch.map(f=>f.sha1),algorithm:'sha1'})});
      await pool(batch.filter(item=>result[item.sha1]),async item=>{const v=result[item.sha1],p=await project('modrinth',v.project_id);const {sideOf}=require('./catalog');const side=sideOf(v);additions[item.sha1]={...p,version:v.name,versionId:v.id,path:item.path.replace(/\.disabled$/,''),side:side==='unknown'?p.side:side,sideEvidence:'Modrinth · версия',provenance:item.source==='modrinth'?'imported':'identified'};matches.add(item.sha1);recognized++;},4);
    } catch(e){warnings.push('Modrinth: '+e.message);}
    if(await catalog.getKey()){
      const remaining=batch.filter(i=>!matches.has(i.sha1)||i.source==='curseforge');
      if(remaining.length)try{
        const {data}=await catalog.cf('/fingerprints/432',{fingerprints:remaining.map(f=>f.fingerprint)});
        await pool(data.exactMatches||[],async match=>{const sha=match.file?.hashes?.find(h=>h.algo===1)?.value?.toLowerCase();const item=remaining.find(i=>i.sha1===sha&&i.fingerprint===match.file.fileFingerprint);if(!item)return;
          const p=await project('curseforge',match.id);additions[item.sha1]={...p,path:item.path.replace(/\.disabled$/,''),version:match.file.displayName,versionId:String(match.file.id),side:item.side,sideEvidence:item.sideEvidence,provenance:item.source==='curseforge'?'imported':'identified'};recognized++;},4);
      }catch(e){warnings.push('CurseForge: '+e.message);}
    }
    catalog.emit('progress',{label:'Распознавание ресурсов',current:Math.min(unknown.length,offset+100),total:unknown.length});
  }
  const meta=await readJson(metadataFile(catalog.packs,id),{});
  for(const [sha,entry]of Object.entries(additions)){const old=meta[sha];if(old?.source==='curseforge'&&entry.source!=='curseforge')continue;meta[sha]={...old,...entry,...(old?.sideOverride?{sideOverride:old.sideOverride}:{})};}
  await atomic(metadataFile(catalog.packs,id),JSON.stringify(meta,null,2));return {...await readInventory(catalog.packs,id),recognized,warnings:[...new Set(warnings)]};
}
async function setSide(packs,id,digest,side) {
  if(!/^[a-f0-9]{40}$/.test(digest)||!['client','server','both','auto'].includes(side))throw Error('Неверная категория');
  const {items}=await readInventory(packs,id);if(!items.some(i=>i.sha1===digest&&i.type==='mod'))throw Error('Мод больше не найден в сборке');
  const meta=await readJson(metadataFile(packs,id),{});meta[digest]||={};if(side==='auto')delete meta[digest].sideOverride;else meta[digest].sideOverride=side;
  await atomic(metadataFile(packs,id),JSON.stringify(meta,null,2));return readInventory(packs,id);
}
module.exports={metadataFile,jarMetadata,fingerprint,readInventory,identifyInventory,setSide};
