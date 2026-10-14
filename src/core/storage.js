'use strict';
const path=require('node:path');
function folderName(name){let value=String(name).trim().replace(/[\s<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'_');if(!value||/^\.+$/.test(value))value='Modpack';if(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value))value='_'+value;return value.slice(0,100);}
function gameDir(root,pack){if(!/^[a-f0-9-]{36}$/.test(pack.id))throw Error('Неверный ID сборки');if(!pack.folder)return path.join(root,'instances',pack.id,'game');if(pack.folder!==folderName(pack.folder)||pack.folder==='.'||pack.folder==='..')throw Error('Неверная папка сборки');return inside(path.join(root,'modpacks'),path.join(root,'modpacks',pack.folder));}
function inside(root,target){const base=path.resolve(root),resolved=path.resolve(target),relative=path.relative(base,resolved);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Путь вне папки данных');return resolved;}
module.exports={folderName,gameDir,inside};
