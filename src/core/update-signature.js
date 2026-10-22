'use strict';
const crypto=require('node:crypto');
const APP='games.aurora.launcher',REPO='https://github.com/ffxlino/Aurora/releases/download/';
const b64=value=>typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
function keyId(publicKey){const key=crypto.createPublicKey(publicKey);if(key.asymmetricKeyType!=='ed25519')throw Error('Ключ обновлений должен быть Ed25519');return 'ed25519-'+crypto.createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex').slice(0,24);}
function unpack(envelope,publicKey){if(!envelope||!b64(envelope.payload)||!b64(envelope.signature)||envelope.payload.length>90000)throw Error('Неверный формат подписи обновления');const bytes=Buffer.from(envelope.payload,'base64url'),signature=Buffer.from(envelope.signature,'base64url');if(signature.length!==64||!crypto.verify(null,bytes,publicKey,signature))throw Error('Подпись обновления не прошла проверку');return {value:JSON.parse(bytes.toString('utf8')),digest:crypto.createHash('sha256').update(bytes).digest('hex')};}
function sign(value,privateKey){const publicKey=crypto.createPublicKey(privateKey),bytes=Buffer.from(JSON.stringify(value));return {keyId:keyId(publicKey.export({format:'pem',type:'spki'})),payload:bytes.toString('base64url'),signature:crypto.sign(null,bytes,privateKey).toString('base64url')};}
function instant(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))throw Error('Неверная дата подписи');const n=Date.parse(value);if(!Number.isFinite(n))throw Error('Неверная дата подписи');return n;}
function verify(envelope,{keys,tag,now=Date.now(),previous=null}={}){
 if(!Array.isArray(keys)||!keys.length||keys.length>8)throw Error('Не настроен доверенный ключ обновлений');
 let publicKey=keys.find(k=>k.id===envelope?.keyId)?.publicKey;
 if(!publicKey){const delegation=envelope?.delegation,root=keys.find(k=>k.id===delegation?.keyId);if(!root||keyId(root.publicKey)!==root.id)throw Error('Неизвестный ключ подписи обновления');const certificate=unpack(delegation,root.publicKey).value;
  if(certificate.appId!==APP||certificate.purpose!=='update-key'||certificate.channel!=='stable'||certificate.keyId!==envelope.keyId||keyId(certificate.publicKey)!==certificate.keyId||instant(certificate.notBefore)>now||instant(certificate.expiresAt)<=now||instant(certificate.expiresAt)-instant(certificate.notBefore)>366*86400000)throw Error('Не прошла проверку смена ключа обновлений');publicKey=certificate.publicKey;
 }
 if(keyId(publicKey)!==envelope.keyId)throw Error('Отпечаток ключа обновлений не совпадает');const {value:m,digest}=unpack(envelope,publicKey);
 if(m.schema!==1||m.appId!==APP||m.channel!=='stable'||typeof m.version!=='string'||!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(m.version)||tag!=='v'+m.version||!Number.isSafeInteger(m.sequence)||m.sequence<1)throw Error('Неверные сведения подписанного выпуска');
 const issued=instant(m.publishedAt),expires=instant(m.expiresAt);if(issued>now+300000||expires<=now||expires<=issued||expires-issued>366*86400000)throw Error('Подпись выпуска истекла или неверно время компьютера');
 if(previous&&(!Number.isSafeInteger(previous.sequence)||previous.sequence<1||!/^[a-f0-9]{64}$/.test(previous.digest)))throw Error('Повреждена история доверенных обновлений');
 if(previous?.version){const a=m.version.split('.').map(Number),b=previous.version.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]>b[i])break;if(a[i]<b[i])throw Error('Отклонён откат версии обновления');}}
 if(previous&&(m.sequence<previous.sequence||m.sequence===previous.sequence&&digest!==previous.digest))throw Error('Отклонён откат или подмена ранее проверенного выпуска');
 if(!Array.isArray(m.assets)||!m.assets.length||m.assets.length>12)throw Error('Неверный список подписанных файлов');const names=new Set();
 for(const asset of m.assets){if(!asset||!['Windows-x64.exe','Linux-x86_64.AppImage','Linux-x64.pacman'].some(suffix=>asset.name==='Aurora-'+m.version+'-'+suffix)||names.has(asset.name)||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>1024**3||!/^[a-f0-9]{64}$/.test(asset.sha256)||asset.url!==REPO+tag+'/'+asset.name)throw Error('Недопустимый подписанный файл обновления');names.add(asset.name);}
 return {manifest:m,digest,keyId:envelope.keyId};
}
module.exports={APP,keyId,sign,verify};
