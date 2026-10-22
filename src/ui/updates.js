'use strict';
const automaticUpdates=new Map();
function automaticUpdateFor(item){const entry=automaticUpdates.get(inventoryPack);return entry?.result?.items.find(i=>i.path===item.path&&i.sha1===item.sha1);}
function renderAutomaticUpdateStatus(){
 const host=$('#inventory-update-status'),entry=automaticUpdates.get(inventoryPack);if(!host)return;
 if(!entry){host.replaceChildren();return;}
 const count=entry.result?.items.length||0;
 host.innerHTML='<div class="inline wrap"><span class="hint">'+(entry.checking?'Проверяем обновления модов…':entry.error?'Не удалось проверить обновления':entry.result?.failed?'Часть модов не проверена':entry.result?.blocked?.length&&!count?'Версии зависимостей закреплены автором':count?'Доступны обновления':'Совместимых обновлений не найдено.')+'</span>'+(count?'<strong>'+count+'</strong><button class="secondary" data-auto-update-all>Обновить всё</button>':'')+(!entry.checking?'<button class="text-button" data-auto-update-check>Проверить снова</button>':'')+'</div>';
 host.querySelector('[data-auto-update-check]')?.addEventListener('click',()=>void refreshAutomaticUpdates(inventoryPack,true));
 host.querySelector('[data-auto-update-all]')?.addEventListener('click',()=>guard(()=>updateAvailableResources(inventoryPack)));
}
async function refreshAutomaticUpdates(id,force=false){
 if(inventoryPack!==id||selected!==id)return;
 const eligible=inventoryItems.filter(i=>['modrinth','curseforge'].includes(i.source)&&i.projectId&&i.versionId&&!i.disabled);
 if(!eligible.length){automaticUpdates.delete(id);renderAutomaticUpdateStatus();return;}
 const signature=JSON.stringify([selectedPack()?.version,selectedPack()?.loader,eligible.map(i=>[i.path,i.sha1,i.versionId])]);
 const previous=automaticUpdates.get(id);if(!force&&previous?.signature===signature&&(previous.checking||previous.until>Date.now())){renderAutomaticUpdateStatus();return;}
 if(previous?.checking)api('updates:cancel',previous.requestId).catch(()=>{});
 const entry={signature,checking:true,requestId:crypto.randomUUID(),until:Date.now()+300000};automaticUpdates.set(id,entry);renderAutomaticUpdateStatus();
 try{const result=await api('updates:scan',id,entry.requestId);if(automaticUpdates.get(id)!==entry)return;entry.result=result;entry.until=Date.now()+(result.failed?60000:300000);}
 catch{entry.error=true;entry.until=Date.now()+60000;}
 finally{entry.checking=false;if(automaticUpdates.get(id)===entry&&inventoryPack===id&&selected===id){renderAutomaticUpdateStatus();drawInventoryCards();}}
 while(automaticUpdates.size>30){const key=automaticUpdates.keys().next().value,old=automaticUpdates.get(key);if(old?.checking)api('updates:cancel',old.requestId).catch(()=>{});automaticUpdates.delete(key);}
}
async function updateAvailableResources(id,key=null){
 if(isBusy)throw Error('Дождись завершения текущей операции');const pack=state.packs.find(p=>p.id===id);if(!pack)return;
 await openUpdatePanel(pack,key?[key]:null);if($('#updates-dialog').open&&updateScan?.items.length)await previewSelectedUpdates();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-update-resource]');if(!button)return;const item=inventoryItems[Number(button.dataset.updateResource)],update=item&&automaticUpdateFor(item);if(update)guard(()=>updateAvailableResources(inventoryPack,update.key));});
window.aurora.onEvent(({type,data})=>{if(type==='operation'&&data.state==='completed'){for(const entry of automaticUpdates.values())entry.until=0;}});
setInterval(()=>{if(page==='library'&&!isBusy&&selected===inventoryPack)void refreshAutomaticUpdates(selected);},300000);
let updateScene=null,updateDialogVersion=0,activeUpdatePlan=null;
const updatesDialog=$('#updates-dialog');updatesDialog.querySelector('#updates-list').insertAdjacentHTML('beforebegin','<div id="update-scan-status"><p id="update-scan-label" role="status" aria-live="polite"></p><progress id="update-scan-progress" max="1"></progress><button type="button" id="update-scan-cancel" class="secondary">Отменить проверку</button></div>');
async function openUpdatePanel(pack,selectedKeys=null){featurePack=pack.id;if(updateScene)api('updates:cancel',updateScene.id).catch(()=>{});const scene={id:crypto.randomUUID(),packId:pack.id,generation:++updateDialogVersion};updateScene=scene;updateScan=null;$('#updates-list').replaceChildren();$('#apply-updates').disabled=true;$('#update-scan-status').classList.remove('hidden');$('#update-scan-label').textContent='Читаем установленные файлы…';$('#update-scan-progress').removeAttribute('value');featureDialog('#updates-dialog');try{const result=await api('updates:scan',pack.id,scene.id);if(updateScene!==scene||!updatesDialog.open)return;updateScan=result;$('#updates-list').innerHTML=result.items.length?result.items.map(i=>`<label class="update-row check-label"><input type="checkbox" data-update-project="${escape(i.key||i.projectId)}" ${!selectedKeys||selectedKeys.includes(i.key||i.projectId)?'checked':''}><span><strong>${escape(i.title)}</strong><small class="update-version-change"><span>${escape(i.from)}</span><b aria-hidden="true">→</b><span>${escape(i.to)}</span></small>${sourceMark(i.source||'modrinth')}</span></label>`).join(''):'<p>'+(result.failed?'Проверка завершена не для всех файлов. Можно повторить её позже.':'Совместимых обновлений не найдено.')+'</p>';$('#updates-list').insertAdjacentHTML('beforeend',`<p class="hint">Проверено: ${result.checked??result.total??0} · пропущено: ${result.skipped} · ошибок: ${result.failed||0}</p>`+(result.warnings||[]).map(w=>'<p class="notice">'+escape(w)+'</p>').join(''));$('#apply-updates').disabled=!result.items.length;}catch(e){if(updateScene===scene&&updatesDialog.open){$('#updates-list').textContent=e.message;throw e;}}finally{if(updateScene===scene){updateScene=null;$('#update-scan-status').classList.add('hidden');}}}
$('#update-scan-cancel').addEventListener('click',()=>updatesDialog.close());updatesDialog.addEventListener('close',()=>{updateDialogVersion++;if(updateScene){const id=updateScene.id;updateScene=null;api('updates:cancel',id).catch(()=>{});}});
window.aurora.onEvent(({type,data})=>{if(type==='update-scan-progress'&&updateScene&&data.requestId===updateScene.id&&updatesDialog.open){$('#update-scan-label').textContent=data.phase==='inventory'?'Читаем установленные файлы…':'Проверяем версии: '+data.current+' / '+data.total;const bar=$('#update-scan-progress');if(data.total){bar.max=data.total;bar.value=data.current;}else bar.removeAttribute('value');}if(type==='update-plan-progress'&&activeUpdatePlan?.id===data.requestId&&activeUpdatePlan.generation===updateDialogVersion&&data.id===featurePack&&updatesDialog.open)$('#apply-updates').textContent='Подготовка: '+data.current+' / '+data.total;});
