'use strict';
class Social{
 constructor(sharing,settings){this.sharing=sharing;this.settings=settings;this.playing=null;this.timer=setInterval(()=>this.heartbeat().catch(()=>{}),30000);this.timer.unref();}
 setSettings(settings){const hide=this.settings.sharePresence&&!settings.sharePresence;this.settings=settings;this.heartbeat(hide).catch(()=>{});}
 setPlaying(pack){this.playing=pack;this.heartbeat().catch(()=>{});}
 async state(){try{return await this.sharing.request('/social/state');}catch{return {connected:false,message:'Подключи персональное приглашение сообщества. Для каждого друга используется отдельное приглашение; мастер-пароль передавать друзьям не нужно.'};}}
 heartbeat(offline=false){const next=(this.queue||Promise.resolve()).catch(()=>{}).then(()=>this.sendHeartbeat(offline));this.queue=next;return next;}
 async sendHeartbeat(offline=false){if(!this.settings.sharePresence&&!offline)return;const p=this.playing;return this.sharing.request('/social/heartbeat',{method:'POST',data:{visible:!offline&&this.settings.sharePresence===true,playing:!offline&&!!p,packId:!offline&&p?.remote?.provider==='github'?p.remote.packId:null}});}
 async action(action,code){if(!['request','accept','decline','remove'].includes(action))throw Error('Неверное действие друзей');return this.sharing.request('/social/'+action,{method:'POST',data:{code}});}
 close(){clearInterval(this.timer);this.heartbeat(true).catch(()=>{});}
}
module.exports={Social};
