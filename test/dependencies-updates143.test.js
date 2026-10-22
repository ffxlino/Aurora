'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Catalog}=require('../src/core/catalog'),{Updates}=require('../src/core/updates');
test('latest dependency selection examines all pages and prefers the newest compatible stable file',async()=>{
 const catalog=new Catalog({},async()=>'',()=>{}),seen=[];catalog.versions=async r=>{seen.push(r.offset);return r.offset===0?{versions:[{id:'old',release:'release',date:'2020-01-01'}],hasMore:true,nextOffset:50}:{versions:[{id:'alpha',release:'alpha',date:'2026-10-15'},{id:'new',release:'release',date:'2026-10-14'}],hasMore:false};};
 assert.equal((await catalog.latest({source:'curseforge',projectId:'1'},{allowPrerelease:true,channels:['release','beta','alpha']})).version.id,'new');assert.deepEqual(seen,[0,50]);
});
test('pinned dependencies keep the exact author version and explain it in the installation preview',async()=>{
 const catalog=new Catalog({get:async()=>({id:'pack',version:'1.20.1',loader:'forge'}),dir:()=>process.cwd()},async()=>'',()=>{}),project=id=>({source:'modrinth',projectId:id,title:id,type:'mod'}),version=(id,deps=[])=>({id,name:id,release:'release',gameVersions:['1.20.1'],loaders:['forge'],side:'both',dependencies:deps,files:[{filename:id+'.jar',url:'https://cdn.modrinth.com/file.jar',hashes:{sha1:'a'.repeat(40)}}]});
 catalog.version=async(source,id,v)=>({project:project(id),version:version(v,id==='parent'?[{project_id:'dependency',version_id:'required-old',dependency_type:'required'}]:[])});catalog.latest=async()=>{throw Error('Pinned dependency must not be replaced by latest');};
 const result=await catalog.plan({source:'modrinth',projectId:'parent',versionId:'current',instanceId:'pack'});assert.equal(result.items[0].version,'required-old');assert.ok(result.warnings.some(w=>w.includes('задана автором')));
});
function bulkFixture(channel='release',pin=false,mismatch=false){
 const items=[{source:'modrinth',type:'mod',projectId:'dep',versionId:'old',version:'1',title:'Dependency',path:'mods/dep.jar',sha1:'a'.repeat(40)}];if(pin)items.push({source:'modrinth',type:'mod',projectId:'parent',versionId:'parent-old',title:'Parent',path:'mods/parent.jar',sha1:'b'.repeat(40)});
 const types=[],catalog={packs:{get:async()=>({version:'1.20.1',loader:'forge'})},inventory:async()=>({items}),json:async(url,options)=>{
  if(url.includes('/versions?'))return items.map(i=>({id:i.versionId,project_id:i.projectId,version_type:channel,date_published:'2026-01-01',files:[{hashes:{sha1:mismatch?'c'.repeat(40):i.sha1}}],dependencies:pin&&i.projectId==='parent'?[{project_id:'dep',version_id:'old',dependency_type:'required'}]:[]}));
  const body=JSON.parse(options.body);types.push(body.version_types);return {[items[0].sha1]:{id:'new',project_id:'dep',version_type:channel,date_published:'2026-10-15',game_versions:['1.20.1'],loaders:['forge'],name:'2'}};
 }};return {catalog,types};
}
test('beta installations receive newer beta updates, while stable stays on stable',async()=>{
 for(const channel of ['release','beta','alpha']){const f=bulkFixture(channel),result=await new Updates(f.catalog,{}).scan('pack');assert.equal(result.items.length,1);assert.deepEqual(f.types[0],channel==='release'?['release']:channel==='beta'?['release','beta']:['release','beta','alpha']);}
});
test('automatic update scan does not suggest breaking an unchanged parent mod exact dependency pin',async()=>{
 const f=bulkFixture('release',true),result=await new Updates(f.catalog,{}).scan('pack');assert.equal(result.items.length,0);assert.equal(result.blocked.length,1);assert.ok(result.warnings.some(w=>w.includes('закреплена')));
});
test('update scan compares source hashes and refuses a mismatched installed version',async()=>{
 const f=bulkFixture('release',false,true),result=await new Updates(f.catalog,{}).scan('pack');assert.equal(result.items.length,0);assert.equal(result.failed,1);assert.equal(f.types.length,0);
});
