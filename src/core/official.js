'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {atomic,readJson,noLinks}=require('./util');

function launcherCandidates(platform=process.platform,env=process.env,home=os.homedir()) {
  if(platform==='linux')return ['/usr/bin/minecraft-launcher','/usr/local/bin/minecraft-launcher',path.join(home,'.local/bin/minecraft-launcher')];
  return [env['ProgramFiles(x86)'],env.ProgramFiles,env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs')].filter(Boolean).flatMap(base=>['Minecraft Launcher/MinecraftLauncher.exe','Minecraft Launcher/Minecraft.exe'].map(p=>path.join(base,p)));
}
async function findLauncher(custom='',platform=process.platform,env=process.env,home=os.homedir()) {
  for(const candidate of custom?[custom]:launcherCandidates(platform,env,home)){
    if(!path.isAbsolute(candidate))continue;
    try {const st=await fs.stat(candidate);if(!st.isFile())continue;await fs.access(candidate,platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);return candidate;}catch{}
  }
  return null;
}
class OfficialLauncher {
  constructor(root,minecraft,packs,emit,launchProcess=spawn){this.root=root;this.mc=minecraft;this.packs=packs;this.emit=emit;this.spawn=launchProcess;}
  async prepare(instance,memory){
    if(!Number.isInteger(memory)||memory<2048||memory>32768)throw Error('Недопустимый объём памяти');
    const {profile,java:automaticJava}=await this.mc.install(instance);const java=instance.launchSettings?.javaPath||automaticJava;memory=instance.launchSettings?.memory||memory;await fs.access(java,process.platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);
    const workDir=this.mc.game,versionId='aurora-'+instance.id,gameDir=this.packs.dir(instance.id);
    const versionDir=path.join(workDir,'versions',versionId);
    await noLinks(workDir,versionDir);await fs.mkdir(versionDir,{recursive:true});
    const libraries=new Map();for(const lib of profile.libraries||[])libraries.set(lib.name.split(':').slice(0,2).join(':')+(lib.name.split(':')[3]||''),lib);
    const standalone={...profile,id:versionId,libraries:[...libraries.values()]};delete standalone.inheritsFrom;
    await atomic(path.join(versionDir,versionId+'.json'),JSON.stringify(standalone,null,2));
    await fs.copyFile(path.join(workDir,'versions',instance.version,instance.version+'.jar'),path.join(versionDir,versionId+'.jar'));
    const file=path.join(workDir,'launcher_profiles.json');await noLinks(workDir,file);
    const existing=await readJson(file,{profiles:{},settings:{},version:3});
    if(!existing||typeof existing.profiles!=='object'||Array.isArray(existing.profiles)||!existing.profiles)throw Error('Повреждён файл профилей официального лаунчера. Он сохранён без изменений.');
    await fs.copyFile(file,file+'.aurora-backup').catch(e=>{if(e.code!=='ENOENT')throw e;});
    const key=versionId,name='Aurora · '+instance.name,now=new Date().toISOString();
    existing.profiles[key]={...existing.profiles[key],name,type:'custom',created:existing.profiles[key]?.created||now,lastUsed:now,lastVersionId:versionId,gameDir,javaDir:java,javaArgs:`-Xmx${memory}M -Xms512M`,resolution:{width:instance.launchSettings?.width||1280,height:instance.launchSettings?.height||800}};
    existing.selectedProfile=key;
    await atomic(file,JSON.stringify(existing,null,2));
    await this.packs.save(instance);
    return {profileName:name,workDir,gameDir,versionId};
  }
  async open(executable,workDir=this.mc.game){
    const verified=await findLauncher(executable);if(!verified)throw Error('Официальный Minecraft Launcher не найден. Установи его или выбери исполняемый файл в настройках Aurora.');
    await fs.mkdir(workDir,{recursive:true});
    await new Promise((resolve,reject)=>{const child=this.spawn(verified,['--workDir',workDir],{detached:true,stdio:'ignore',shell:false,windowsHide:false});child.once('error',()=>reject(Error('Не удалось открыть Minecraft Launcher. Проверь путь в настройках.')));child.once('spawn',()=>{child.unref();resolve();});});
  }
  async launch(instance,settings){
    const executable=await findLauncher(settings.officialLauncherPath);if(!executable)throw Error('Установи официальный Minecraft Launcher и выбери его файл в настройках Aurora.');
    const prepared=await this.prepare(instance,settings.memory);await this.open(executable,prepared.workDir);
    this.emit('log','Сборка передана официальному лаунчеру: '+prepared.profileName);
    return {...prepared,external:true};
  }
}
module.exports={OfficialLauncher,findLauncher,launcherCandidates};
