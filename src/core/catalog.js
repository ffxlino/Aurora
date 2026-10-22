'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {json, download, atomic, readJson, safePath, noLinks, hash} = require('./util');
const {readInventory, identifyInventory, setSide, metadataFile} = require('./inventory');
const {pool}=require('./minecraft');

const TYPES = ['modpack', 'mod', 'resourcepack', 'shader','datapack'];
const FOLDERS = {mod:'mods', resourcepack:'resourcepacks', shader:'shaderpacks',datapack:'datapacks'};
const LOADER_IDS = {forge:1, fabric:4, quilt:5, neoforge:6};
const SIDE_MAP = {client_only:'client', singleplayer_only:'client', server_only:'server', dedicated_server_only:'server', client_and_server:'both', client_only_server_optional:'both', server_only_client_optional:'both', client_or_server:'both', client_or_server_prefers_both:'both'};
function sideOf(value) {
  const env = value?.environment;
  if (env) {
    const sides = [...new Set((Array.isArray(env) ? env : [env]).map(e=>SIDE_MAP[e]).filter(Boolean))];
    if (sides.length===1) return sides[0];
    if (sides.length>1) return 'both';
  }
  const client=['required','optional'].includes(value?.client_side), server=['required','optional'].includes(value?.server_side);
  if (client && server) return 'both';
  if (client && value.server_side==='unsupported') return 'client';
  if (server && value.client_side==='unsupported') return 'server';
  return 'unknown';
}
function normalizeMR(p) {
  return {source:'modrinth', projectId:String(p.id||p.project_id), type:p.project_type, title:p.title, description:p.description||'', icon:p.icon_url||'', author:p.author||'', downloads:p.downloads||0, categories:p.categories||[], side:sideOf(p), sideEvidence:'Modrinth', url:`https://modrinth.com/${p.project_type}/${p.slug||p.id||p.project_id}`};
}
function normalizeCF(p,type) {
  return {source:'curseforge',projectId:String(p.id),type,title:p.name,description:p.summary||'',icon:p.logo?.thumbnailUrl||p.logo?.url||'',author:(p.authors||[]).map(a=>a.name).join(', '),downloads:p.downloadCount||0,categories:(p.categories||[]).map(c=>c.name),side:'unknown',sideEvidence:'Сервис не указывает сторону',url:p.links?.websiteUrl||`https://www.curseforge.com/minecraft/${type==='modpack'?'modpacks':'mc-mods'}/${p.slug}`};
}
function compatible(version, pack, type) {
  if (!pack || type==='modpack') return true;
  return version.gameVersions.includes(pack.version) && (type!=='mod' || version.loaders.includes(pack.loader));
}
function validateRequest(r) {
  if (!r || !['modrinth','curseforge'].includes(r.source) || !/^[-a-zA-Z0-9_]{1,100}$/.test(String(r.projectId))) throw Error('Неверный источник или проект');
  if (r.versionId && !/^[-a-zA-Z0-9_]{1,100}$/.test(String(r.versionId))) throw Error('Неверная версия ресурса');
}
class Catalog {
  constructor(packs, getKey, emit, network={}) {
    this.packs=packs;this.getKey=getKey;this.emit=emit;this.json=network.json||json;this.fetch=network.fetch||fetch;this.download=network.download||download;
    this.cfProxy=network.cfProxy||null;if(this.cfProxy){const u=new URL(this.cfProxy);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Неверный сервер каталога');this.cfProxy=u.origin;}this.projectCache=new Map();this.plans=new Map();this.inventoryPending=new Map();
  }
  async cf(route, body) {
    const key=this.cfProxy?'':await this.getKey();if(!this.cfProxy&&!key)throw Error('Добавьте CurseForge API key в настройках, чтобы открыть этот источник');
    const response=await this.fetch(this.cfProxy?this.cfProxy+'/catalog/curseforge?route='+encodeURIComponent(route):'https://api.curseforge.com/v1'+route,{method:body?'POST':'GET',headers:{...(this.cfProxy?{}:{'x-api-key':key}),'Accept':'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok&&this.cfProxy){let info;try{info=await response.json();}catch{}throw Error(typeof info?.error==='string'?info.error:'Сервер каталога: HTTP '+response.status);}if(!response.ok)throw Error(response.status===403||response.status===401?'CurseForge не принял API key. Проверьте ключ в настройках.':`CurseForge: HTTP ${response.status}`);
    return response.json();
  }
  async classes() {
    if(this.classMap)return this.classMap;
    const {data}=await this.cf('/categories?gameId=432&classesOnly=true');
    const aliases={mod:['mc-mods','mods'],modpack:['modpacks'],resourcepack:['texture-packs','resource-packs'],shader:['shaders']};
    const result={};for(const [type,names] of Object.entries(aliases)){const c=data.find(c=>names.includes(c.slug));if(c)result[type]=c.id;}
    this.classMap=result;return result;
  }
  async search({query='',type='modpack',source='all',offset=0,instanceId=null,limit=20,sort='relevance',categories=[]}) {
    if(!TYPES.includes(type)||!['all','modrinth','curseforge'].includes(source))throw Error('Неизвестный фильтр каталога');
    if(!['relevance','popular','downloads','updated','newest'].includes(sort)||!Array.isArray(categories)||categories.length>10||categories.some(c=>typeof c!=='string'||!/^[-a-z0-9]{1,60}$/.test(c)))throw Error('Неверные фильтры поиска');
    offset=Number(offset);if(!Number.isInteger(offset)||offset<0||offset>9900)throw Error('Неверная страница');
    limit=Number(limit);if(![20,40,60].includes(limit))throw Error('Неверный размер страницы');const pack=instanceId&&type!=='modpack'?await this.packs.get(instanceId):null;
    const providers=source==='all'?['modrinth','curseforge']:[source];
    const results=await Promise.allSettled(providers.map(async provider=>{
      if(provider==='modrinth'){
        const facets=[['project_type:'+type]];if(categories.length)facets.push(categories.map(c=>'categories:'+c));if(pack){facets.push(['versions:'+pack.version]);if(type==='mod')facets.push(['categories:'+pack.loader]);}
        const q=new URLSearchParams({query:String(query).slice(0,150),facets:JSON.stringify(facets),limit:String(limit),offset:String(offset),index:({popular:'follows',downloads:'downloads',updated:'updated',newest:'newest',relevance:'relevance'})[sort]});
        const data=await this.json('https://api.modrinth.com/v2/search?'+q);
        return {hits:data.hits.map(normalizeMR),total:data.total_hits,more:offset+data.hits.length<data.total_hits};
      }
      const classes=await this.classes();if(!classes[type])throw Error('CurseForge не предоставил эту категорию');
      const q=new URLSearchParams({gameId:'432',classId:String(classes[type]),searchFilter:String(query).slice(0,150),sortField:String(({popular:2,downloads:6,updated:3,newest:11,relevance:query?1:2})[sort]),sortOrder:'desc',pageSize:String(Math.min(limit,50)),index:String(offset)});
      if(pack){q.set('gameVersion',pack.version);if(type==='mod'){if(!LOADER_IDS[pack.loader])return {hits:[],total:0,more:false};q.set('modLoaderType',String(LOADER_IDS[pack.loader]));}}
      if(categories.length){const available=await this.categoryList('curseforge',type),aliases={'adventure':'adventure-rpg','utility':'utility-qol'};const ids=categories.map(tag=>available.find(c=>c.slug===tag||c.slug===aliases[tag])?.id);if(ids.some(id=>!id))throw Error('Выбранная категория недоступна в CurseForge');q.set('categoryIds',JSON.stringify(ids));}const data=await this.cf('/mods/search?'+q);if(limit>50&&data.data.length===50&&offset+50<(data.pagination?.totalCount||0)){q.set('index',String(offset+50));q.set('pageSize',String(limit-50));const tail=await this.cf('/mods/search?'+q);data.data.push(...tail.data);}
      return {hits:data.data.map(p=>normalizeCF(p,type)),total:data.pagination?.totalCount||0,more:offset+data.data.length<(data.pagination?.totalCount||0)};
    }));
    const warnings=[],pages=[];results.forEach((r,i)=>{if(r.status==='fulfilled')pages.push(r.value);else warnings.push({source:providers[i],message:r.reason.message});});
    const hits=[];for(let i=0;i<limit;i++)for(const p of pages)if(p.hits[i])hits.push(p.hits[i]);
    return {hits:require('../ui/catalog-merge').merge(hits),pageTotal:Math.max(0,...pages.map(p=>p.total)),warnings,hasMore:pages.some(p=>p.more)&&offset+limit<=9900,nextOffset:offset+limit,totals:pages.reduce((n,p)=>n+p.total,0)};
  }
  async categoryList(source,type){if(!TYPES.includes(type)||!['modrinth','curseforge'].includes(source))throw Error('Неверный каталог');this.categoryCache||=new Map();const key=source+':'+type,cached=this.categoryCache.get(key);if(cached&&cached.expires>Date.now())return cached.data;let data;if(source==='modrinth'){data=(await this.json('https://api.modrinth.com/v2/tag/category')).filter(c=>c.project_type===type).map(c=>({slug:c.name,title:c.name}));}else{const classes=await this.classes();if(!classes[type])return [];data=(await this.cf('/categories?gameId=432&classId='+classes[type])).data.filter(c=>!c.isClass).map(c=>({slug:c.slug,title:c.name,id:c.id}));}this.categoryCache.set(key,{data,expires:Date.now()+3600000});return data;}
  async project(source,id) {
    const key=source+':'+id;const cached=this.projectCache.get(key);if(cached)return cached;
    let p;if(source==='modrinth')p=normalizeMR(await this.json('https://api.modrinth.com/v2/project/'+encodeURIComponent(id)));
    else {const [{data},classes]=await Promise.all([this.cf('/mods/'+encodeURIComponent(id)),this.classes()]);const type=Object.keys(classes).find(t=>classes[t]===data.classId);if(!type)throw Error('Этот тип ресурса не поддерживается');p=normalizeCF(data,type);}
    this.projectCache.set(key,p);if(this.projectCache.size>500)this.projectCache.delete(this.projectCache.keys().next().value);return p;
  }
  mrVersion(v,project) {
    const side=sideOf(v);return {source:'modrinth',projectId:String(v.project_id),id:String(v.id),name:v.name,gameVersions:v.game_versions||[],loaders:v.loaders||[],date:v.date_published,release:v.version_type,side:side==='unknown'?project.side:side,environment:v.environment||null,files:v.files||[],dependencies:v.dependencies||[]};
  }
  cfVersion(v,project) {
    const fileHash=v.hashes?.find(h=>h.algo===1);
    return {source:'curseforge',projectId:String(v.modId),id:String(v.id),name:v.displayName||v.fileName,gameVersions:v.gameVersions||[],loaders:(v.gameVersions||[]).map(v=>v.toLowerCase()).filter(v=>v in LOADER_IDS),date:v.fileDate,release:({1:'release',2:'beta',3:'alpha'})[v.releaseType]||'release',side:project.side,files:[{filename:v.fileName,url:v.downloadUrl,hashes:{sha1:fileHash?.value},primary:true}],dependencies:v.dependencies||[],available:v.isAvailable!==false};
  }
  async versions(r) {
    validateRequest(r);const original=await this.project(r.source,r.projectId),p=r.type==='datapack'?{...original,type:'datapack'}:original,pack=r.instanceId&&p.type!=='modpack'?await this.packs.get(r.instanceId):null;
    const offset=Math.max(0,Math.min(9950,Number(r.offset)||0));
    if(r.source==='modrinth') {
      const q=new URLSearchParams();if(pack){q.set('game_versions',JSON.stringify([pack.version]));if(p.type==='mod')q.set('loaders',JSON.stringify([pack.loader]));if(p.type==='datapack')q.set('loaders',JSON.stringify(['datapack']));}
      const list=await this.json(`https://api.modrinth.com/v2/project/${encodeURIComponent(r.projectId)}/version?${q}`);
      const compatibleList=list.map(v=>this.mrVersion(v,p)).filter(v=>compatible(v,pack,p.type)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      return {project:p,versions:compatibleList.slice(offset,offset+50),...(r.all?{allVersions:compatibleList}:{}),hasMore:offset+50<compatibleList.length,nextOffset:offset+50};
    }
    const q=new URLSearchParams({pageSize:'50',index:String(offset)});if(pack){q.set('gameVersion',pack.version);if(p.type==='mod'){if(!LOADER_IDS[pack.loader])return {project:p,versions:[],hasMore:false};q.set('modLoaderType',LOADER_IDS[pack.loader]);}}
    const data=await this.cf(`/mods/${encodeURIComponent(r.projectId)}/files?${q}`);
    return {project:p,versions:data.data.map(v=>this.cfVersion(v,p)).filter(v=>v.available&&compatible(v,pack,p.type)),hasMore:offset+data.data.length<(data.pagination?.totalCount||0),nextOffset:offset+50};
  }
  async version(source,projectId,id,type) {
    const original=await this.project(source,projectId),p=type==='datapack'?{...original,type:'datapack'}:original;
    const v=source==='modrinth'?this.mrVersion(await this.json('https://api.modrinth.com/v2/version/'+encodeURIComponent(id)),p):this.cfVersion((await this.cf(`/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(id)}`)).data,p);
    if(v.projectId!==p.projectId)throw Error('Файл не принадлежит выбранному проекту');return {project:p,version:v};
  }
  async latest(r,{allowPrerelease=false,channels=['release'],preferStable=true,firstPage=null}={}) {
    let offset=0,project,stable=null,fallback=null,hasVersions=false;const newer=(a,b)=>!b||String(a.date||'').localeCompare(String(b.date||''))>0;
    for(let page=0;page<200;page++){const list=page===0&&firstPage?firstPage:await this.versions({...r,offset,all:true});project=list.project;hasVersions||=list.versions.length>0;for(const v of (list.allVersions||list.versions)){if(v.release==='release'&&newer(v,stable))stable=v;if(channels.includes(v.release)&&newer(v,fallback))fallback=v;}if(list.allVersions||!list.hasMore)break;if(!Number.isFinite(list.nextOffset)||list.nextOffset<=offset)throw Error('Неверная следующая страница версий');offset=list.nextOffset;}
    return {project,hasVersions,version:preferStable?stable||(allowPrerelease?fallback:null):fallback};
  }
  async plan(r) {
    validateRequest(r);if(!r.versionId){const choice=await this.latest(r);if(!choice.version)return {requiresVersionSelection:true,reason:choice.hasVersions?'prerelease-only':'incompatible',project:choice.project};r={...r,versionId:choice.version.id};}const root=await this.version(r.source,r.projectId,r.versionId,r.type);
    const pack=root.project.type==='modpack'?null:await this.packs.get(r.instanceId);
    let targetFolder=null;if(root.project.type==='datapack'){if(!root.version.loaders.includes('datapack'))throw Error('Это версия мода, а не датапака');const world=String(r.world||'');if(!world||world.includes('/')||world.includes('\\'))throw Error('Выбери существующий мир для датапака');targetFolder='saves/'+world+'/datapacks';await noLinks(this.packs.dir(pack.id),safePath(this.packs.dir(pack.id),'saves/'+world));await fs.access(safePath(this.packs.dir(pack.id),'saves/'+world+'/level.dat'));}const entries=new Map(),active=new Set(),warnings=[];
    const resolve=async node=>{
      const {project:p,version:v}=node,key=p.source+':'+p.projectId;
      if(entries.has(key)){if(entries.get(key).version.id!==v.id)throw Error('Конфликт версий зависимости: '+p.title);return;}
      if(active.has(key))return;if(entries.size+active.size>=100)throw Error('Слишком много зависимостей');
      if(!compatible(v,pack,p.type))throw Error('Несовместимая версия: '+p.title);
      if(v.available===false)throw Error('Файл недоступен: '+p.title);
      const file=p.type==='datapack'?(v.files.find(f=>f.primary&&f.filename.toLowerCase().endsWith('.zip'))||v.files.find(f=>f.filename.toLowerCase().endsWith('.zip'))):(v.files.find(f=>f.primary)||v.files[0]);if(!file?.url)throw Error('Автор запретил стороннюю загрузку: '+p.title);
      if(!file.hashes?.sha512&&!file.hashes?.sha1)throw Error('Нет контрольной суммы: '+p.title);
      if(!TYPES.includes(p.type)||pack&&p.type==='modpack')throw Error('Недопустимый тип зависимости');
      if(pack){const ext=p.type==='mod'?'.jar':'.zip';if(!file.filename.toLowerCase().endsWith(ext))throw Error('Неподдерживаемый формат: '+file.filename);safePath(this.packs.dir(pack.id),(p.type==='datapack'?targetFolder:FOLDERS[p.type])+'/'+file.filename);}
      active.add(key);
      if(pack){for(const dep of v.dependencies){const required=p.source==='modrinth'?dep.dependency_type==='required':dep.relationType===3;if(!required)continue;
        let projectId=p.source==='modrinth'?dep.project_id:String(dep.modId),versionId=p.source==='modrinth'?dep.version_id:null;
        if(!projectId&&versionId){const raw=await this.json('https://api.modrinth.com/v2/version/'+encodeURIComponent(versionId));projectId=raw.project_id;}
        if(!projectId)throw Error('Не найдена обязательная зависимость: '+p.title);
        const pinned=!!versionId;if(!versionId){const choice=await this.latest({source:p.source,projectId,instanceId:pack.id,type:root.project.type==='datapack'?'datapack':undefined},{allowPrerelease:true,channels:['release','beta','alpha']});versionId=choice.version?.id;}
        if(!versionId)throw Error('Нет совместимой зависимости для '+p.title);const dependency=await this.version(p.source,projectId,versionId,root.project.type==='datapack'?'datapack':undefined);if(pinned)warnings.push('Версия зависимости '+dependency.project.title+' · '+dependency.version.name+' задана автором '+p.title);await resolve(dependency);
      }}
      active.delete(key);entries.set(key,{project:p,version:v,file});
    };
    await resolve(root);
    if([...entries.values()].some(e=>['beta','alpha'].includes(e.version.release)))warnings.push('В установке есть предварительные версии (Beta/Alpha). Они могут содержать ошибки. Проверь выбранные версии перед установкой.');
    if(root.project.type==='datapack')warnings.push('Датапак будет установлен в выбранный мир. Перед установкой закрой Minecraft. Для нового мира добавь его при создании мира или создай мир и установи датапак после этого.');if(root.project.type==='shader')warnings.push('Шейдер будет установлен в shaderpacks. Для его использования нужен Iris или OptiFine; включите шейдер в настройках игры.');
    if(root.project.type==='resourcepack')warnings.push('После установки включите ресурспак в настройках Minecraft.');
    if([...entries.values()].some(e=>e.version.side==='server'))warnings.push('В списке есть серверный мод. Он будет сохранён в сборке, но может быть не нужен клиенту.');
    const id=crypto.randomUUID(),plan={id,root,pack,targetFolder,entries:[...entries.values()],expires:Date.now()+10*60000};this.plans.set(id,plan);
    for(const [k,p]of this.plans)if(p.expires<Date.now())this.plans.delete(k);if(this.plans.size>20)this.plans.delete(this.plans.keys().next().value);
    return {id,title:root.project.title,type:root.project.type,target:pack?.name||'Новая сборка',items:plan.entries.map(e=>({title:e.project.title,source:e.project.source,version:e.version.name,type:e.project.type,side:e.version.side})),warnings};
  }
  async apply(id) {
    const plan=this.plans.get(id);if(!plan||plan.expires<Date.now())throw Error('План установки устарел. Выберите версию заново.');this.plans.delete(id);
    if(!plan.pack){const e=plan.entries.at(-1),file=path.join(this.packs.root,'cache',crypto.randomUUID()+'.zip');try{await this.download(e.file.url,file,e.file.hashes.sha512||e.file.hashes.sha1,e.file.hashes.sha512?'sha512':'sha1');const p=await this.packs.import(file,this.cfProxy?this:await this.getKey());p.source=e.project.source;p.projectId=e.project.projectId;await this.packs.save(p);return p;}finally{await fs.rm(file,{force:true});}}
    const pack=await this.packs.get(plan.pack.id);if(pack.version!==plan.pack.version||pack.loader!==plan.pack.loader)throw Error('Сборка изменилась. Выберите версию заново.');
    const stage=path.join(this.packs.root,'staging',crypto.randomUUID()),dir=this.packs.dir(pack.id),meta=await readJson(metadataFile(this.packs,pack.id),{});
    const writes=[],removals=new Set(),names=new Set();let done=0;for(const e of plan.entries){const name=(e.project.type==='datapack'?plan.targetFolder:FOLDERS[e.project.type])+'/'+e.file.filename;if(names.has(name.toLowerCase()))throw Error('Зависимости используют одинаковое имя файла');names.add(name.toLowerCase());}
    try {
      await pool(plan.entries,async e=>{const name=(e.project.type==='datapack'?plan.targetFolder:FOLDERS[e.project.type])+'/'+e.file.filename,target=safePath(stage,name);if(writes.some(w=>w.name.toLowerCase()===name.toLowerCase()))throw Error('Зависимости используют одинаковое имя файла');
        await this.download(e.file.url,target,e.file.hashes.sha512||e.file.hashes.sha1,e.file.hashes.sha512?'sha512':'sha1');const bytes=await fs.readFile(target),sha1=hash(bytes,'sha1');
        writes.push({name,sha1,entry:{...e.project,side:e.version.side,sideEvidence:e.project.source==='modrinth'?'Modrinth · версия':'Не определено',version:e.version.name,versionId:e.version.id,path:name,provenance:'installed',installGroup:plan.id}});
        for(const [digest,old] of Object.entries(meta))if(old.source===e.project.source&&old.projectId===e.project.projectId&&old.path&&old.path!==name){for(const previous of [old.path,old.path+'.disabled']){const previousPath=safePath(dir,previous);await noLinks(dir,previousPath);const bytes=await fs.readFile(previousPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(bytes&&hash(bytes,'sha1')===digest)removals.add(previous);}}
        // Do not create a second enabled copy when reinstalling a disabled mod.
        if(e.project.type==='mod')removals.add(name+'.disabled');
        this.emit('progress',{label:'Загрузка ресурсов',current:++done,total:plan.entries.length});
      },this.parallel||3);
      const changed=[...new Set([...writes.map(w=>w.name),...removals])],before=new Map();
      for(const name of changed){const target=safePath(dir,name);await noLinks(dir,target);before.set(name,await fs.readFile(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;}));}
      await this.packs.backup(pack.id,changed);
      try {
        for(const w of writes)await atomic(safePath(dir,w.name),await fs.readFile(safePath(stage,w.name)));
        for(const name of removals)if(!writes.some(w=>w.name===name))await fs.rm(safePath(dir,name),{force:true});
        for(const w of writes)meta[w.sha1]=w.entry;
        await atomic(metadataFile(this.packs,pack.id),JSON.stringify(meta,null,2));
      } catch(e) {for(const [name,data]of before){if(data===null)await fs.rm(safePath(dir,name),{force:true});else await atomic(safePath(dir,name),data);}throw e;}
      await this.packs.log(pack.id,'Установка ресурсов и зависимостей',writes.map(w=>`${w.entry.source}: ${w.name}`));return pack;
    } finally {await fs.rm(stage,{recursive:true,force:true});}
  }
  inventory(id){if(this.inventoryPending.has(id))return this.inventoryPending.get(id);const task=readInventory(this.packs,id).finally(()=>this.inventoryPending.delete(id));this.inventoryPending.set(id,task);return task;}
  identify(id){return identifyInventory(this,id);}
  setSide(id,digest,side){return setSide(this.packs,id,digest,side);}
}
module.exports={Catalog,sideOf,normalizeMR,normalizeCF,compatible,validateRequest,TYPES,FOLDERS};
