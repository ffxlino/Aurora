'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
module.exports=async function(win,app){
 const out=path.join(process.cwd(),'artifacts');await fs.mkdir(out,{recursive:true});
 const socket=require('node:net').createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const check=async port=>{
  const wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout');};
  await wait(()=>typeof state!=='undefined'&&state.packs);const before=await window.aurora.call('state');
  const p=await window.aurora.call('pack:create',{name:'Тестовая сборка',version:'1.21.1',loader:'fabric',loaderVersion:'0.19.5'});
  await wait(()=>document.querySelector('[data-select="'+p.id+'"]'));document.querySelector('[data-select="'+p.id+'"]').click();await wait(()=>document.querySelector('#resource-panel .resource-types'));
  const details=!!document.querySelector('#play-btn');const views=[];
  for(const page of ['catalog','community','activity','settings','library']){document.querySelector('[data-page="'+page+'"]').click();views.push({page,visible:document.querySelector('#page-'+page).classList.contains('active'),overflow:document.documentElement.scrollWidth>innerWidth});}
  let response=uiConfirm('Проверка отмены',{title:'Встроенное подтверждение'});document.querySelector('#confirm-cancel').click();const canceled=await response===false;
  response=uiConfirm('Проверка подтверждения');document.querySelector('#confirm-accept').click();const accepted=await response===true;
  await window.aurora.call('pack:archive',p.id);
  const resources=before.packs.find(p=>p.name==='Aurora · ресурсы 1.21.1');let inventory=null;
  if(resources){selected=resources.id;renderPacks();await renderDetail();document.querySelector('#pack-detail').scrollIntoView();await wait(()=>document.querySelector('.installed-card'));
   const count=document.querySelectorAll('.installed-card').length;document.querySelector('[data-mod-toggle]').click();await wait(()=>document.querySelector('[data-mod-toggle][aria-checked="false"]')&&!isBusy);
   document.querySelector('[data-mod-toggle][aria-checked="false"]').click();await wait(()=>document.querySelector('[data-manual-side]')&&!document.querySelector('[data-mod-toggle][aria-checked="false"]')&&!isBusy);
   const manual=document.querySelector('[data-manual-side]');manual.value='server';manual.dispatchEvent(new Event('change'));await wait(()=>document.querySelector('.side-pill.server')&&!isBusy);
   const reset=[...document.querySelectorAll('[data-manual-side]')].find(s=>s.value==='server');reset.value='auto';reset.dispatchEvent(new Event('change'));await wait(()=>document.querySelector('[data-manual-side]')&&!document.querySelector('.side-pill.server')&&!isBusy);
   inventory={cards:count,sourceBadges:document.querySelectorAll('.installed-card .source-pill.modrinth').length,toggle:true,manualSide:true,overflow:document.documentElement.scrollWidth>innerWidth};
  }
  const host=await window.aurora.call('hub:host',{password:'smoke-check-master-password',port,whitelist:[]});const connected=await window.aurora.call('hub:connect',{url:'https://127.0.0.1:'+port,fingerprint:host.fingerprint,master:'smoke-check-master-password'});
  return {title:document.title,details,views,bridge:typeof window.require==='undefined',confirm:{canceled,accepted},inventory,hub:connected.role};
 };
 const report=await win.webContents.executeJavaScript('('+check.toString()+')('+port+')');
 await win.webContents.executeJavaScript("document.querySelector('#resource-panel')?.scrollIntoView({behavior:'instant',block:'start'})");await new Promise(r=>setTimeout(r,300));
 await fs.writeFile(path.join(out,'aurora-0.2-resources.png'),(await win.webContents.capturePage()).toPNG());
 win.close();
 await new Promise(r=>setTimeout(r,250));
 report.closeConfirmation=await win.webContents.executeJavaScript("document.querySelector('#confirm-dialog').open");
 await fs.writeFile(path.join(out,'aurora-0.2-confirm.png'),(await win.webContents.capturePage()).toPNG());
 await win.webContents.executeJavaScript("document.querySelector('#confirm-cancel').click()");
 await new Promise(r=>setTimeout(r,100));
 report.closeCanceled=!win.isDestroyed();
 await win.webContents.executeJavaScript("window.aurora.call('hub:stop')");
 await fs.writeFile(path.join(out,'smoke.json'),JSON.stringify(report,null,2));
 if(report.hub!=='admin'||!report.details||!report.bridge||!report.confirm.canceled||!report.confirm.accepted||!report.closeConfirmation||!report.closeCanceled||report.views.some(v=>!v.visible||v.overflow)||report.inventory?.overflow)throw Error('Проверка интерфейса не пройдена');
 app.quit();
};
