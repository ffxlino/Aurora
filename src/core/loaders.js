'use strict';
const {json,request}=require('./util');
async function loaderVersions(version,loader){
 if(!/^[a-zA-Z0-9.+_-]{1,80}$/.test(version)||!['vanilla','fabric','quilt','forge','neoforge'].includes(loader))throw Error('Неверная версия или загрузчик');
 if(loader==='vanilla')return [];
 if(['fabric','quilt'].includes(loader)){const host=loader==='fabric'?'https://meta.fabricmc.net':'https://meta.quiltmc.org';const list=await json(`${host}/${loader==='quilt'?'v3':'v2'}/versions/loader/${encodeURIComponent(version)}`);return list.map(v=>({version:v.loader.version,stable:v.loader.stable!==false&&!/(alpha|beta|rc)/i.test(v.loader.version)})).sort((a,b)=>Number(b.stable)-Number(a.stable)||b.version.localeCompare(a.version,'en',{numeric:true})).slice(0,100);}
 const neo=loader==='neoforge';const url=neo?'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml':'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
 const xml=await (await request(url)).text();if(xml.length>8*1024**2)throw Error('Слишком большой список загрузчиков');
 const pieces=version.split('.').map(Number),prefix=neo?(version==='1.20.1'?'47.':`${pieces[0]===1?pieces[1]:pieces[0]}.${pieces[0]===1?(pieces[2]||0):pieces[1]}.`):version+'-';
 return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m=>m[1]).filter(v=>v.startsWith(prefix)&&/^[-a-zA-Z0-9.+_]+$/.test(v)).reverse().slice(0,100).map(v=>({version:neo?v:v.slice(prefix.length),stable:!/(alpha|beta|rc)/i.test(v)}));
}
module.exports={loaderVersions};
