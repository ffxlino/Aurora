'use strict';
const fs=require('node:fs/promises');const path=require('node:path');
const {atomic,readJson,json}=require('./util');
class Accounts {
  constructor(root,secure,emit){this.file=path.join(root,'account.bin');this.secure=secure;this.emit=emit;this.current=null;this.pending=false;}
  async load(){try{this.current=JSON.parse(this.secure.decryptString(await fs.readFile(this.file)));}catch(e){if(e.code!=='ENOENT')this.emit('log','Не удалось прочитать сохранённый вход. Войдите повторно.');}return this.public();}
  public(){return this.current?{name:this.current.name,id:this.current.id}:null;}
  async save(){if(!this.secure.isEncryptionAvailable()||this.secure.getSelectedStorageBackend?.()==='basic_text')throw Error('Защищённое хранилище аккаунта недоступно');await atomic(this.file,this.secure.encryptString(JSON.stringify(this.current)));}
  async oauth(data){const r=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok){const e=Error(j.error_description||j.error);e.code=j.error;throw e;}return j;}
  async exchange(ms,generation=this.generation){
    const post=(url,body)=>json(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});
    const xbox=await post('https://user.auth.xboxlive.com/user/authenticate',{Properties:{AuthMethod:'RPS',SiteName:'user.auth.xboxlive.com',RpsTicket:'d='+ms.access_token},RelyingParty:'http://auth.xboxlive.com',TokenType:'JWT'});
    let xsts;try{xsts=await post('https://xsts.auth.xboxlive.com/xsts/authorize',{Properties:{SandboxId:'RETAIL',UserTokens:[xbox.Token]},RelyingParty:'rp://api.minecraftservices.com/',TokenType:'JWT'});}catch{throw Error('Xbox не разрешил вход. Проверьте Xbox-профиль, возрастные и семейные ограничения аккаунта.');}
    let mc;try{mc=await post('https://api.minecraftservices.com/authentication/login_with_xbox',{identityToken:`XBL3.0 x=${xsts.DisplayClaims.xui[0].uhs};${xsts.Token}`});}catch{throw Error('Minecraft API отклонил вход. Проверьте разрешение Minecraft API у вашего приложения Microsoft.');}
    let profile;try{profile=await json('https://api.minecraftservices.com/minecraft/profile',{headers:{Authorization:'Bearer '+mc.access_token}});}catch{throw Error('Не найден профиль Minecraft Java. Нужна купленная Java Edition и созданное имя игрока.');}
    if(generation!==this.generation)throw Error('Вход отменён');this.current={id:profile.id,name:profile.name,token:mc.access_token,refresh:ms.refresh_token||this.current?.refresh,expires:Date.now()+mc.expires_in*1000};await this.save();this.emit('account',this.public());return this.public();
  }
  async login(clientId){
    if(this.pending)throw Error('Вход уже выполняется');if(!/^[a-f0-9-]{36}$/i.test(clientId))throw Error('Укажите Client ID приложения Microsoft в настройках');
    this.pending=true;const generation=this.generation=Symbol();
    try{const r=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',{method:'POST',body:new URLSearchParams({client_id:clientId,scope:'XboxLive.signin offline_access'}),signal:AbortSignal.timeout(30000)});const d=await r.json();if(generation!==this.generation)throw Error('Вход отменён');if(!r.ok)throw Error(['AADSTS70002','AADSTS7000218'].some(code=>d.error_description?.includes(code))?'Для приложения Aurora не включён вход общедоступных клиентов. Владелец должен включить Allow public client flows в Microsoft Entra.':d.error_description||'Microsoft отклонил запрос');
      this.emit('device',{code:d.user_code,url:d.verification_uri,expires:d.expires_in});let interval=d.interval||5;const until=Date.now()+d.expires_in*1000;
      while(Date.now()<until && generation===this.generation){await new Promise(r=>setTimeout(r,interval*1000));if(generation!==this.generation)break;try{const ms=await this.oauth({grant_type:'urn:ietf:params:oauth:grant-type:device_code',client_id:clientId,device_code:d.device_code});if(generation!==this.generation)break;return await this.exchange(ms,generation);}catch(e){if(e.code==='authorization_pending')continue;if(e.code==='slow_down'){interval+=5;continue;}throw e;}}
      throw Error('Вход отменён или время ожидания истекло');
    }finally{this.pending=false;this.emit('device',null);}
  }
  async token(clientId){if(!this.current)throw Error('Сначала войдите в Microsoft');if(this.current.expires<Date.now()+120000){const ms=await this.oauth({client_id:clientId,grant_type:'refresh_token',refresh_token:this.current.refresh,scope:'XboxLive.signin offline_access'});await this.exchange(ms);}return this.current;}
  cancel(){this.generation=null;this.emit('device',null);}
  async logout(){this.generation=null;this.current=null;await fs.rm(this.file,{force:true});this.emit('account',null);}
}
module.exports={Accounts};
