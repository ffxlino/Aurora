'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell,safeStorage}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const {OfficialLauncher,findLauncher}=require('./core/official');
const {atomic,readJson,files}=require('./core/util');const {Accounts}=require('./core/auth');const {Minecraft}=require('./core/minecraft');const {Packs}=require('./core/packs');const {HubServer,HubClient}=require('./core/hub');const {Catalog}=require('./core/catalog');
const smoke=process.argv.includes('--smoke');if(smoke)app.setPath('userData',path.join(process.cwd(),'artifacts','smoke-data'));
const single=app.requestSingleInstanceLock();if(!single)app.quit();let win,root,settings,accounts,mc,packs,host,client,catalog,official,distribution,busy=false,closeTicket=null,allowClose=false,fatal=false;
function emit(type,data){if(win&&!win.isDestroyed())win.webContents.send('event',{type,data});}
async function run(label,fn){if(busy)throw Error('Дождитесь окончания текущей операции');if(mc.process)throw Error('Закройте Minecraft перед изменением сборок');busy=true;emit('busy',true);emit('progress',{label,current:0,total:0});try{return await fn();}finally{busy=false;emit('busy',false);}}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Доступ запрещён');try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}});}
async function saveSettings(input){const clientId=String(input.clientId===undefined?settings.clientId:input.clientId||'').trim();if(clientId&&!/^[a-f0-9-]{36}$/i.test(clientId))throw Error('Неверный Microsoft Client ID');const memory=Number(input.memory);if(!Number.isInteger(memory)||memory<2048||memory>Math.min(32768,Math.floor(os.totalmem()/1024**2)))throw Error('Выберите допустимый объём памяти');if(clientId!==settings.clientId)await accounts.logout();settings={...settings,clientId,memory};if(input.officialLauncherPath!==undefined){const value=String(input.officialLauncherPath).trim();if(value&&!await findLauncher(value))throw Error('Исполняемый файл Minecraft Launcher не найден');settings.officialLauncherPath=value;}if(input.curseKey){if(!safeStorage.isEncryptionAvailable())throw Error('Хранилище ключей недоступно');await atomic(path.join(root,'curse.bin'),safeStorage.encryptString(String(input.curseKey)));}await atomic(path.join(root,'settings.json'),JSON.stringify(settings,null,2));return settings;}
async function curseKey(){try{return safeStorage.decryptString(await fs.readFile(path.join(root,'curse.bin')));}catch{return '';}}
app.whenReady().then(async()=>{
 if(!single)return;root=app.getPath('userData');await fs.mkdir(root,{recursive:true});distribution=await readJson(path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'..'),'launcher.config.json'),{});settings=await readJson(path.join(root,'settings.json'),{clientId:distribution.microsoftClientId||'',memory:4096});
 if(!settings.clientId&&distribution.microsoftClientId){settings.clientId=distribution.microsoftClientId;await atomic(path.join(root,'settings.json'),JSON.stringify(settings,null,2));}
 settings.launchMode=distribution.launchMode||settings.launchMode||'official';
 accounts=new Accounts(root,safeStorage,emit);mc=new Minecraft(root,emit);packs=new Packs(root,emit);host=new HubServer(root);client=new HubClient(packs,emit);catalog=new Catalog(packs,async()=>distribution.enabledProviders?.includes('curseforge')?curseKey():'',emit);await accounts.load();official=new OfficialLauncher(root,mc,packs,emit);
 win=new BrowserWindow({width:1440,height:940,icon:path.join(__dirname,'ui','icon.ico'),minWidth:1100,minHeight:760,backgroundColor:'#0d1115',title:'Aurora — Minecraft Launcher',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
 handle('state',async()=>({settings,account:accounts.public(),packs:await packs.list(),root,totalMemory:Math.floor(os.totalmem()/1024**2),appVersion:app.getVersion(),platform:process.platform,enabledProviders:distribution.enabledProviders||['modrinth'],officialLauncher:await findLauncher(settings.officialLauncherPath),curseConfigured:!!(await curseKey()),host:host.info||null,whitelist:await readJson(path.join(root,'hub','whitelist.json'),[])}));
 handle('settings:save',saveSettings);handle('versions',()=>mc.versions());handle('account:login',async()=>{if(settings.launchMode==='official'){await official.open(settings.officialLauncherPath||await findLauncher()||'');return {external:true};}return accounts.login(settings.clientId);});handle('account:logout',()=>accounts.logout());handle('account:cancel',()=>accounts.cancel());
 handle('account:browser',()=>shell.openExternal('https://www.microsoft.com/link'));
 handle('official:choose',async()=>{const result=await dialog.showOpenDialog(win,{title:'Выбрать официальный Minecraft Launcher',properties:['openFile'],...(process.platform==='win32'?{filters:[{name:'Minecraft Launcher',extensions:['exe']}]}:{})});if(result.canceled)return null;const value=result.filePaths[0];if(!await findLauncher(value))throw Error('Выбери исполняемый файл лаунчера');settings.officialLauncherPath=value;await atomic(path.join(root,'settings.json'),JSON.stringify(settings,null,2));return value;});
 handle('official:download',()=>shell.openExternal('https://www.minecraft.net/download'));
 handle('pack:log',async id=>{await packs.get(id);const file=path.join(packs.dir(id),'logs','latest.log');try{await fs.access(file);}catch{throw Error('Журнал появится после первого запуска Minecraft');}return shell.openPath(file);});
 handle('pack:prepare',id=>run('Установка и проверка файлов',async()=>{const p=await packs.get(id);await mc.install(p);await packs.save(p);return true;}));
 handle('pack:rename',(id,name)=>run('Переименование сборки',()=>packs.rename(id,name)));handle('pack:archive',id=>run('Архивация сборки',()=>packs.archive(id)));
 handle('pack:create',input=>run('Создание сборки',()=>packs.create(input)));
 handle('pack:import',()=>run('Импорт сборки',async()=>{const result=await dialog.showOpenDialog(win,{title:'Импорт модпака',properties:['openFile'],filters:[{name:'Minecraft modpack',extensions:['mrpack']}]});if(result.canceled)return null;const archive=new (require('adm-zip'))(result.filePaths[0]);if(!archive.getEntry('modrinth.index.json'))throw Error('В этой версии доступен импорт сборок Modrinth (.mrpack)');return packs.import(result.filePaths[0]);}));
 handle('pack:files',async id=>{await packs.get(id);return files(packs.dir(id));});handle('pack:history',id=>packs.history(id));
 handle('pack:folder',async id=>{await packs.get(id);return shell.openPath(packs.dir(id));});
 handle('pack:add',(id,folder)=>run('Добавление файлов',async()=>{await packs.get(id);const result=await dialog.showOpenDialog(win,{title:'Добавить в '+folder,properties:['openFile','multiSelections']});if(result.canceled)return [];return packs.add(id,result.filePaths,folder);}));
 handle('pack:toggle',(id,name)=>run('Изменение мода',()=>packs.toggle(id,name)));
 handle('pack:export',id=>run('Экспорт сборки',async()=>{const p=await packs.get(id);const result=await dialog.showSaveDialog(win,{defaultPath:p.name.replace(/[^\wа-яё -]/gi,'_')+'.mrpack',filters:[{name:'Modrinth pack',extensions:['mrpack']}]});if(result.canceled)return null;const AdmZip=require('adm-zip');const zip=new AdmZip();const deps={minecraft:p.version};if(p.loader!=='vanilla'){if(!p.loaderVersion)throw Error('Для экспорта укажите точную версию загрузчика при создании сборки');deps[p.loader==='fabric'?'fabric-loader':p.loader==='quilt'?'quilt-loader':p.loader]=p.loaderVersion;}zip.addFile('modrinth.index.json',Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',versionId:'1.0.0',name:p.name,files:[],dependencies:deps},null,2)));const snapshot=await packs.snapshot(id);for(const f of snapshot.files)zip.addFile('overrides/'+f.path,await fs.readFile(require('./core/util').safePath(packs.dir(id),f.path)));await atomic(result.filePath,zip.toBuffer());return result.filePath;}));
 handle('launch',id=>run('Подготовка запуска',async()=>{const p=await packs.get(id);if(settings.launchMode==='official')return official.launch(p,settings);if(!accounts.current)throw Error('Сначала войдите в Microsoft');await mc.launch(p,()=>accounts.token(settings.clientId),settings);p.lastPlayed=new Date().toISOString();await packs.save(p);return {started:true};}));handle('game:stop',()=>mc.stop());
 const catalogRequest=r=>{if(!(distribution.enabledProviders||['modrinth']).includes(r.source)&&r.source!=='all')throw Error('Этот источник временно отключён');return {...r,source:r.source==='all'?'modrinth':r.source};};
 handle('catalog:search',r=>catalog.search(catalogRequest(r)));
 handle('catalog:versions',r=>catalog.versions(catalogRequest(r)));
 handle('catalog:plan',r=>catalog.plan(catalogRequest(r)));
 handle('catalog:install',id=>run('Установка ресурсов',()=>catalog.apply(id)));
 handle('pack:resources',id=>catalog.inventory(id));
 handle('pack:identify',id=>run('Распознавание файлов',()=>catalog.identify(id)));
 handle('pack:side',(id,digest,side)=>run('Изменение категории',()=>catalog.setSide(id,digest,side)));
 handle('resource:website',async(source,projectId)=>{require('./core/catalog').validateRequest({source,projectId});const p=await catalog.project(source,projectId);const u=new URL(p.url);if(u.protocol!=='https:'||!['modrinth.com','www.curseforge.com','curseforge.com'].includes(u.hostname))throw Error('Недопустимый адрес');return shell.openExternal(u.href);});
 handle('hub:host',input=>run('Запуск сервера сборок',()=>host.start(input)));handle('hub:stop',()=>host.stop());
 handle('hub:connect',input=>run('Подключение к серверу',async()=>{const a=input.master?null:await accounts.token(settings.clientId);return client.connect({...input,minecraftToken:a?.token});}));
 handle('hub:state',()=>client.state());handle('hub:publish',(id,revision)=>run('Публикация сборки',()=>client.publish(id,revision)));
 handle('hub:pull',(id,conflicts)=>run('Синхронизация сборки',()=>client.pull(id,conflicts===true)));
 handle('backup:folder',async()=>{const dir=path.join(root,'backups');await fs.mkdir(dir,{recursive:true});return shell.openPath(dir);});
 handle('window:close-response',input=>{if(!closeTicket||input.ticket!==closeTicket)return;closeTicket=null;if(input.accept===true){allowClose=true;win.close();}});
 handle('app:fatal-close',()=>{if(fatal)app.exit(1);});
 win.on('close',e=>{if(!allowClose&&(busy||mc.process||host.server)){e.preventDefault();if(!closeTicket){closeTicket=require('node:crypto').randomUUID();emit('close-request',{ticket:closeTicket,message:'Текущая операция, Minecraft и сервер общих сборок будут остановлены. Закрыть Aurora?'});}}});
 await win.loadFile(path.join(__dirname,'ui','index.html'));
 if(smoke)await require('./smoke')(win,app);
});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{mc?.stop();host?.server?.close();});
process.on('uncaughtException',e=>{if(smoke||!win||win.isDestroyed()){console.error(e);app.exit(1);}else{fatal=true;emit('fatal',e.message);}});
