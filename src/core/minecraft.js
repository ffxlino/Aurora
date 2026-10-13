'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {json,request,download,extract,readJson,atomic,safePath,files}=require('./util');
function minecraftOS(platform=process.platform){return {win32:'windows',linux:'linux',darwin:'osx'}[platform]||platform;}
function ruleMatches(r,platform=process.platform){const os=r.os||{};if(os.name && os.name!==minecraftOS(platform))return false;if(os.arch && !['x86_64','amd64'].includes(os.arch))return false;if(os.version && !(new RegExp(os.version)).test(require('node:os').release()))return false;if(r.features && Object.values(r.features).some(Boolean))return false;return true;}
function allowed(rules,platform=process.platform){if(!rules)return true;let yes=false;for(const r of rules)if(ruleMatches(r,platform))yes=r.action==='allow';return yes;}
function argumentsFor(entries,vars){return (entries||[]).flatMap(e=>typeof e==='string'?[e]:allowed(e.rules)?(Array.isArray(e.value)?e.value:[e.value]):[]).map(a=>a.replace(/\$\{([^}]+)\}/g,(_,key)=>{if(!(key in vars))throw Error('Неизвестный параметр Minecraft: '+key);return String(vars[key]);}));}
function mavenPath(name){const [coord,ext='jar']=name.split('@');const [group,artifact,version,classifier]=coord.split(':');if(!group||!artifact||!version)throw Error('Некорректная библиотека');return `${group.replaceAll('.','/')}/${artifact}/${version}/${artifact}-${version}${classifier?'-'+classifier:''}.${ext}`;}
async function pool(items,fn,count=8){let index=0;const workers=Array.from({length:Math.min(count,items.length)},async()=>{while(index<items.length)await fn(items[index++]);});const results=await Promise.allSettled(workers);const error=results.find(r=>r.status==='rejected');if(error)throw error.reason;}
class Minecraft {
  constructor(root,emit){this.root=root;this.game=path.join(root,'engine');this.emit=emit;this.process=null;}
  progress(label,current=0,total=0){this.emit('progress',{label,current,total});}
  async versions(){const manifest=await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');this.manifest=manifest;return manifest.versions.filter(v=>v.type==='release' && new Date(v.releaseTime)>=new Date('2021-11-30')).map(v=>v.id);}
  async java(major){
    const target=path.join(this.root,'java',String(major));const list=await files(target);const linux=process.platform==='linux';const suffix=linux?'/bin/java':'/bin/java.exe';const found=list.find(f=>f.path.endsWith(suffix));if(found)return safePath(target,found.path);
    this.progress('Установка Java '+major);const builds=await json(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&heap_size=normal&image_type=jre&jvm_impl=hotspot&os=${linux?'linux':'windows'}&vendor=eclipse`);
    const binary=builds[0]?.binary?.package;if(!binary)throw Error('Не найдена Java '+major);const zip=path.join(this.root,'cache',`java-${major}-${linux?'linux.tar.gz':'windows.zip'}`);
    await download(binary.link,zip,binary.checksum,'sha256',(n,t)=>this.progress('Загрузка Java '+major,n,t));if(linux){await fs.mkdir(target,{recursive:true});await new Promise((resolve,reject)=>{const child=spawn('tar',['-xzf',zip,'-C',target],{stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Не удалось распаковать Java')));});}else await extract(zip,target);await fs.rm(zip,{force:true});
    const exe=(await files(target)).find(f=>f.path.endsWith(suffix));if(!exe)throw Error('Java не установлена');if(linux)await fs.chmod(safePath(target,exe.path),0o755);return safePath(target,exe.path);
  }
  async installForge(instance,vanilla,java){
    const v=instance.loaderVersion;if(!v||!/^[-a-zA-Z0-9.+_]+$/.test(v))throw Error('Укажите точную версию Forge / NeoForge');
    const neo=instance.loader==='neoforge';const full=neo?v:(v.startsWith(instance.version+'-')?v:instance.version+'-'+v);
    const url=neo?'https://maven.neoforged.net/releases/net/neoforged/neoforge/'+full+'/neoforge-'+full+'-installer.jar':'https://maven.minecraftforge.net/net/minecraftforge/forge/'+full+'/forge-'+full+'-installer.jar';
    const marker=path.join(this.game,'loaders',instance.loader+'-'+full+'.json');const cached=await readJson(marker,null);if(cached)return cached;
    this.progress('Установка '+instance.loader+' '+v);const installer=path.join(this.root,'cache',instance.loader+'-'+full+'.jar');
    const sha=(await (await request(url+'.sha1')).text()).trim().split(/\s+/)[0];if(!/^[a-f0-9]{40}$/i.test(sha))throw Error('Не удалось проверить установщик');await download(url,installer,sha);
    await fs.mkdir(this.game,{recursive:true});const launchProfiles=path.join(this.game,'launcher_profiles.json');if(!await readJson(launchProfiles,null))await atomic(launchProfiles,JSON.stringify({profiles:{},settings:{},version:3}));
    await atomic(path.join(this.game,'versions',instance.version,instance.version+'.json'),JSON.stringify(vanilla));
    await download(vanilla.downloads.client.url,path.join(this.game,'versions',instance.version,instance.version+'.jar'),vanilla.downloads.client.sha1);
    await new Promise((resolve,reject)=>{const child=spawn(java,['-Djava.awt.headless=true','-jar',installer,'--installClient',this.game],{cwd:this.game,windowsHide:true,stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>{child.kill();reject(Error('Установщик не завершился за 15 минут'));},900000);child.stdout.on('data',data=>this.emit('log',String(data)));child.stderr.on('data',data=>this.emit('log',String(data)));child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Установщик '+instance.loader+' завершился с кодом '+code+'. Откройте журнал.'));});});
    const zip=new (require('adm-zip'))(installer);const install=JSON.parse(zip.readAsText('install_profile.json'));const mod=JSON.parse(zip.readAsText((install.json||'/version.json').replace(/^\//,'')));
    if(mod.inheritsFrom!==instance.version)throw Error('Загрузчик предназначен для другой версии Minecraft');await atomic(marker,JSON.stringify(mod));return mod;
  }
  async install(instance){
    if(!this.manifest)await this.versions();const ver=this.manifest.versions.find(v=>v.id===instance.version);if(!ver)throw Error('Версия Minecraft не найдена');
    this.progress('Подготовка Minecraft '+instance.version);const vanilla=await json(ver.url);if(!vanilla.arguments)throw Error('Поддерживаются Minecraft 1.18 и новее');
    const java=await this.java(vanilla.javaVersion?.majorVersion||17);let profile=vanilla;
    if(instance.loader==='fabric'||instance.loader==='quilt'){
      const host=instance.loader==='fabric'?'https://meta.fabricmc.net':'https://meta.quiltmc.org';
      let loader=instance.loaderVersion;if(!loader){const list=await json(`${host}/${instance.loader==='quilt'?'v3':'v2'}/versions/loader/${encodeURIComponent(instance.version)}`);loader=(list.find(v=>v.loader.stable)||list[0])?.loader.version;if(!loader)throw Error('Нет загрузчика для выбранной версии');}instance.loaderVersion=loader;
      const mod=await json(`${host}/${instance.loader==='quilt'?'v3':'v2'}/versions/loader/${encodeURIComponent(instance.version)}/${encodeURIComponent(loader)}/profile/json`);
      profile={...vanilla,...mod,downloads:vanilla.downloads,assetIndex:vanilla.assetIndex,assets:vanilla.assets,arguments:{game:[...vanilla.arguments.game,...(mod.arguments?.game||[])],jvm:[...vanilla.arguments.jvm,...(mod.arguments?.jvm||[])]},libraries:[...vanilla.libraries,...mod.libraries]};
     }else if(['forge','neoforge'].includes(instance.loader)){
      const mod=await this.installForge(instance,vanilla,java);
      profile={...vanilla,...mod,downloads:vanilla.downloads,assetIndex:vanilla.assetIndex,assets:vanilla.assets,arguments:{game:[...vanilla.arguments.game,...(mod.arguments?.game||[])],jvm:[...vanilla.arguments.jvm,...(mod.arguments?.jvm||[])]},libraries:[...vanilla.libraries,...mod.libraries]};
    }else if(instance.loader!=='vanilla')throw Error('Неизвестный загрузчик');
    const natives=path.join(this.game,'natives',instance.id);await fs.mkdir(natives,{recursive:true});const libraries=new Map();
    for(const lib of profile.libraries)libraries.set(lib.name.split(':').slice(0,2).join(':')+(lib.name.split(':')[3]||''),lib);
    const classpath=[];const downloads=[];
    for(const lib of libraries.values()){
      if(!allowed(lib.rules))continue;
      const a=lib.downloads?.artifact || (!lib.downloads?{path:mavenPath(lib.name),url:(lib.url||'https://libraries.minecraft.net/')+mavenPath(lib.name)}:null);
      if(a){const target=safePath(path.join(this.game,'libraries'),a.path);classpath.push(target);downloads.push(async()=>{if(a.url)await download(a.url,target,a.sha1);else await fs.access(target);});}
      if(lib.natives?.[minecraftOS()]){const classifier=lib.natives[minecraftOS()].replace('${arch}','64');const n=lib.downloads?.classifiers?.[classifier];if(n){const target=safePath(path.join(this.game,'libraries'),n.path);downloads.push(async()=>{await download(n.url,target,n.sha1);await extract(target,natives,'',name=>name.endsWith(process.platform==='linux'?'.so':'.dll'));});}}
    }
    let done=0;await pool(downloads,async fn=>{await fn();this.progress('Библиотеки Minecraft',++done,downloads.length);});
    const jar=path.join(this.game,'versions',instance.version,instance.version+'.jar');await download(vanilla.downloads.client.url,jar,vanilla.downloads.client.sha1,'sha1',(n,t)=>this.progress('Клиент Minecraft',n,t));classpath.push(jar);
    const indexFile=path.join(this.game,'assets','indexes',vanilla.assetIndex.id+'.json');await download(vanilla.assetIndex.url,indexFile,vanilla.assetIndex.sha1);const index=await readJson(indexFile);const objects=Object.values(index.objects);done=0;
    await pool(objects,async asset=>{await download(`https://resources.download.minecraft.net/${asset.hash.slice(0,2)}/${asset.hash}`,path.join(this.game,'assets','objects',asset.hash.slice(0,2),asset.hash),asset.hash);if(++done%30===0||done===objects.length)this.progress('Ресурсы Minecraft',done,objects.length);},12);
    return {profile,java,natives,classpath};
  }
  async launch(instance,account,settings){
    if(this.process)throw Error('Minecraft уже запущен');const {profile,java:automaticJava,natives,classpath}=await this.install(instance);const java=instance.launchSettings?.javaPath||automaticJava;if(typeof account==='function')account=await account();const dir=path.join(this.root,'instances',instance.id,'game');await fs.mkdir(dir,{recursive:true});
    const vars={auth_player_name:account.name,version_name:profile.id,game_directory:dir,assets_root:path.join(this.game,'assets'),assets_index_name:profile.assetIndex.id,auth_uuid:account.id,auth_access_token:account.token,clientid:settings.clientId,auth_xuid:'',user_type:'msa',version_type:'release',natives_directory:natives,launcher_name:'Aurora',launcher_version:'0.4.1',classpath:classpath.join(path.delimiter),classpath_separator:path.delimiter,library_directory:path.join(this.game,'libraries'),user_properties:'{}',resolution_width:String(instance.launchSettings?.width||1280),resolution_height:String(instance.launchSettings?.height||800)};
    const args=[`-Xmx${instance.launchSettings?.memory||settings.memory}M`,'-Xms512M',...argumentsFor(profile.arguments.jvm,vars),profile.mainClass,...argumentsFor(profile.arguments.game,vars)];
    const argsFile=path.join(this.root,'instances',instance.id,'launch.args');await atomic(argsFile,args.map(a=>'"'+String(a).replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join('\n'));
    this.progress('Запуск игры');const child=spawn(java,['@'+argsFile],{cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe']});this.process=child;
    const clean=s=>String(s).replaceAll(account.token,'[token]').replace(/Bearer\s+\S+/gi,'Bearer [hidden]');
    child.stdout.on('data',s=>this.emit('log',clean(s)));child.stderr.on('data',s=>this.emit('log',clean(s)));
    child.once('exit',async code=>{this.process=null;await fs.rm(argsFile,{force:true});this.emit('game',{running:false,code});this.progress(code===0?'Игра закрыта':'Игра завершилась: код '+code);});
    child.once('error',async e=>{this.process=null;await fs.rm(argsFile,{force:true});this.emit('log',e.message);this.emit('game',{running:false});});
    child.once('spawn',()=>{this.emit('game',{running:true});setTimeout(()=>fs.rm(argsFile,{force:true}).catch(()=>{}),30000);});return {started:true};
  }
  stop(){if(this.process)this.process.kill();}
}
module.exports={Minecraft,minecraftOS,allowed,argumentsFor,mavenPath,pool};
