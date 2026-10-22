'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),lock=require('../package-lock.json');
const components=[],notices=[],missing=[];
for(const [relative,meta]of Object.entries(lock.packages||{})){
 if(!relative||meta.dev||meta.devOptional)continue;
 const dir=path.join(root,relative);if(!fs.existsSync(path.join(dir,'package.json'))){if(!meta.optional)missing.push(relative+' (not installed)');continue;}
 const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8')),license=typeof p.license==='string'?p.license:'UNKNOWN';
 const names=fs.readdirSync(dir).filter(n=>/^(?:licen[cs]e|copying|unlicense)(?:[.-].*)?$/i.test(n)&&fs.statSync(path.join(dir,n)).isFile());
 if(!names.length)missing.push(p.name+'@'+p.version+' (license text missing)');
 const purl='pkg:npm/'+p.name.replace('@','%40')+'@'+p.version;
 components.push({type:'library','bom-ref':purl,name:p.name,version:p.version,purl,licenses:[{license:{name:license}}],hashes:[{alg:'SHA-256',content:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'package.json'))).digest('hex')}]});
 notices.push('## '+p.name+' '+p.version+'\n\nDeclared license: '+license+'\n\n'+names.map(n=>'### '+n+'\n\n'+fs.readFileSync(path.join(dir,n),'utf8')).join('\n\n'));
}
const electron=JSON.parse(fs.readFileSync(path.join(root,'node_modules/electron/package.json'),'utf8'));
components.push({type:'framework','bom-ref':'pkg:npm/electron@'+electron.version,name:'Electron',version:electron.version,purl:'pkg:npm/electron@'+electron.version,licenses:[{license:{id:'MIT'}}]});
notices.push('## Electron '+electron.version+'\n\n'+fs.readFileSync(path.join(root,'node_modules/electron/dist/LICENSE'),'utf8')+'\n\nChromium and bundled runtime notices are provided in LICENSES.chromium.html with the Electron distribution. This summary does not replace that file. Game Java and Minecraft downloads are not redistributed by this launcher package; their own licenses apply.');
if(missing.length)throw Error('Review required before distributing dependencies: '+missing.join('; '));
components.sort((a,b)=>(a.name+'@'+a.version).localeCompare(b.name+'@'+b.version));
const notice='# Aurora — third-party notices\n\nGenerated from package-lock.json for Aurora '+pkg.version+'. Includes installed production packages and Electron; platform-specific optional packages may differ on Linux. Each package retains its own license. MIT for Aurora does not relicense these components.\n\n'+notices.join('\n\n---\n\n')+'\n';
const bom={bomFormat:'CycloneDX',specVersion:'1.6',version:1,metadata:{component:{type:'application',name:pkg.name,version:pkg.version,licenses:[{license:{id:'MIT'}}]}},components};
for(const [name,content]of [['THIRD_PARTY_NOTICES.md',notice],['SBOM.cdx.json',JSON.stringify(bom,null,2)+'\n'],['src/legal/THIRD_PARTY_NOTICES.txt',notice],['docs/THIRD_PARTY_NOTICES.txt',notice],['docs/SBOM.cdx.json',JSON.stringify(bom,null,2)+'\n']]){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
console.log('Collected licenses for '+components.length+' installed runtime components.');
