'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const AGENT = 'AuroraLauncher/0.5.0';
function safePath(root, name) {
  if (typeof name !== 'string' || !name || name.length > 500 || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/')) throw Error('Недопустимый путь файла');
  const parts = name.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw Error('Небезопасное имя файла');
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('Путь выходит за пределы сборки');
  return target;
}
async function noLinks(root, target) {
  let current = path.resolve(root);
  for (const part of ['', ...path.relative(root, target).split(path.sep)]) {
    if (part) current = path.join(current, part);
    const st = await fs.lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (st?.isSymbolicLink()) throw Error('Ссылки на внешние файлы запрещены');
  }
}
async function atomic(file, data) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { await fs.writeFile(temp, data); await fs.rename(temp, file); } finally { await fs.rm(temp,{force:true}).catch(()=>{}); }
}
async function readJson(file, fallback) { try { return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')); } catch(e) { if(e.code === 'ENOENT') return fallback; throw e; } }
const hash = (data, algorithm='sha256') => crypto.createHash(algorithm).update(data).digest('hex');
function approvedURL(value) {
  const u = new URL(value);
  const domains = ['minecraftforge.net','neoforged.net','mojang.com','minecraft.net','minecraftservices.com','fabricmc.net','quiltmc.org','modrinth.com','forgecdn.net','adoptium.net','github.com','githubusercontent.com','microsoftonline.com','xboxlive.com'];
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !domains.some(d=>u.hostname===d || u.hostname.endsWith('.'+d))) throw Error('Источник загрузки не разрешён: ' + u.hostname);
  return u;
}
async function request(url, options={}) {
  let current = approvedURL(url);
  for(let i=0;i<8;i++) {
    let r;for(let attempt=0;attempt<6;attempt++){try{r=await fetch(current,{...options,redirect:'manual',headers:{'User-Agent':AGENT,...options.headers},signal:options.signal||AbortSignal.timeout(120000)});if(r.status===404&&(options.method||'GET')==='GET'&&current.hostname==='github.com'&&current.pathname.includes('/releases/download/')&&attempt<5){await r.body?.cancel();await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**attempt,8000)));continue;}break;}catch(e){if((options.method||'GET')!=='GET'||attempt>=2)throw Error('Не удалось подключиться к '+current.hostname+' ('+(e.cause?.code||e.name)+')');await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}}
    if ([301,302,303,307,308].includes(r.status)) { current=approvedURL(new URL(r.headers.get('location'),current).href); await r.body?.cancel(); continue; }
    if(!r.ok) { await r.body?.cancel(); throw Error(`Сервис ${current.hostname}: HTTP ${r.status}`); }
    return r;
  }
  throw Error('Слишком много перенаправлений');
}
async function json(url, options) { return (await request(url,options)).json(); }
let managedDownloads=null;function setDownloads(manager){managedDownloads=manager;}
async function download(url, file, expected, algorithm='sha1', progress=()=>{}) {
  if(managedDownloads)return managedDownloads.download(url,file,expected,algorithm,progress);
  if(expected) { try { if(hash(await fs.readFile(file),algorithm)===expected.toLowerCase()) return; } catch(e){if(e.code!=='ENOENT') throw e;} }
  const r=await request(url); const total=Number(r.headers.get('content-length'))||0;
  if(total>2*1024**3) throw Error('Файл слишком большой');
  await fs.mkdir(path.dirname(file),{recursive:true}); const temp=file+'.'+crypto.randomUUID()+'.part';
  const handle=await fs.open(temp,'wx'); const digest=crypto.createHash(algorithm); let size=0;
  try { for await (const chunk of r.body) {size+=chunk.length;if(size>2*1024**3)throw Error('Файл слишком большой');await handle.writeFile(chunk);digest.update(chunk);progress(size,total);} await handle.close();
    if(expected && digest.digest('hex')!==expected.toLowerCase())throw Error('Контрольная сумма не совпадает: '+path.basename(file));
    await fs.rename(temp,file);
  } catch(e){await handle.close().catch(()=>{});await fs.rm(temp,{force:true});throw e;}
}
async function extract(zipFile, root, prefix='', filter=()=>true) {
  const zip = new AdmZip(zipFile); let total=0;
  for(const entry of zip.getEntries()) {
    if(entry.isDirectory || !entry.entryName.startsWith(prefix))continue;
    const name=entry.entryName.slice(prefix.length);if(!name || !filter(name))continue;
    if(((entry.attr >>> 16) & 0o170000) === 0o120000)throw Error('Архив содержит символическую ссылку');
    total+=entry.header.size; if(total>3*1024**3 || entry.header.size>512*1024**2)throw Error('Слишком большой архив');
    const file=safePath(root,name);await noLinks(root,file);await atomic(file,entry.getData());
  }
}
async function files(root, prefix='') {
  const out=[];
  for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
    const name=prefix?prefix+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory())out.push(...await files(root,name));else if(entry.isFile()){const st=await fs.stat(safePath(root,name));out.push({path:name,size:st.size,modified:st.mtime.toISOString()});}
  }return out;
}
function shareable(name) { return /^(mods|config|resourcepacks|shaderpacks|defaultconfigs|kubejs)\//.test(name) && !/\.(exe|dll|bat|cmd|ps1|vbs|lnk|com|scr)$/i.test(name); }
module.exports={setDownloads,safePath,noLinks,atomic,readJson,hash,approvedURL,request,json,download,extract,files,shareable};
