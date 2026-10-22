'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const links=Object.freeze({website:'https://ffxlino.github.io/Aurora/',help:'https://ffxlino.github.io/Aurora/help.html',releases:'https://github.com/ffxlino/Aurora/releases',support:'https://github.com/ffxlino/Aurora/issues',security:'https://github.com/ffxlino/Aurora/security/policy',source:'https://github.com/ffxlino/Aurora'});
const documents=Object.freeze({license:'LICENSE.txt',notices:'THIRD_PARTY_NOTICES.txt',privacy:'PRIVACY.txt',terms:'TERMS.txt',brand:'BRAND.txt'});
function externalLink(key){if(typeof key!=='string'||!Object.hasOwn(links,key))throw Error('Неизвестный раздел справки');return links[key];}
async function legalDocument(key){if(typeof key!=='string'||!Object.hasOwn(documents,key))throw Error('Неизвестный документ');return fs.readFile(path.join(__dirname,'..','legal',documents[key]),'utf8');}
module.exports={links,externalLink,legalDocument};
