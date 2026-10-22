'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const RESERVE=256*1024**2;
async function requireSpace(target,bytes,{reserve=RESERVE,statfs=fs.statfs}={}){if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(reserve)||reserve<0)throw Error('Неверный размер файлов');let directory=path.resolve(target),stat;while(true){try{stat=await statfs(directory,{bigint:true});break;}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(directory);if(parent===directory)throw e;directory=parent;}}
 const free=BigInt(stat.bavail)*BigInt(stat.bsize),needed=BigInt(bytes)+BigInt(reserve);if(free<needed){const e=Error('Недостаточно свободного места: требуется ещё '+Math.ceil(Number(needed)/1024**2)+' МБ с запасом, доступно '+Math.floor(Number(free)/1024**2)+' МБ. Освободи место и повтори.');e.code='AURORA_DISK_SPACE';throw e;}return {free:Number(free),required:Number(needed)};}
module.exports={requireSpace,RESERVE};
