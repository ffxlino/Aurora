'use strict';
(()=>{
 const host=document.createElement('dialog');host.id='help-dialog';host.setAttribute('aria-labelledby','help-title');
 host.innerHTML='<div class="dialog-top"><div><h2 id="help-title">Справка Aurora</h2><p id="help-version" class="hint"></p></div><button class="text-button square" id="help-close" aria-label="Закрыть">×</button></div><input type="search" id="help-search" aria-label="Поиск по справке" placeholder="Найти ответ…"><div class="help-tabs" role="group" aria-label="Разделы справки"><button class="secondary" data-help-tab="guide">Инструкции</button><button class="secondary" data-help-tab="faq">Частые вопросы</button><button class="secondary" data-help-tab="about">О проекте</button></div><div id="help-results" class="help-results"></div><div class="help-footer"><button class="secondary" data-help-link="website">Сайт проекта ↗</button><button class="secondary" data-help-link="support">Сообщить об ошибке ↗</button><button class="secondary" data-help-link="security">Безопасность ↗</button></div>';
 document.body.append(host);let tab='guide';
 const isEnglish=()=>document.documentElement.lang==='en';
 const pick=(item,key)=>isEnglish()?item[key+'En']||item[key]:item[key];
 function draw(){const query=$('#help-search').value.trim().toLocaleLowerCase(),result=$('#help-results');result.replaceChildren();
  host.querySelectorAll('[data-help-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.helpTab===tab)));
  if(tab==='about'){
   const intro=document.createElement('p');intro.textContent=isEnglish()?'Independent, MIT-licensed Minecraft Java launcher. Review builds may differ from published releases.':'Независимый лаунчер Minecraft Java с открытым кодом под MIT. Проверочные версии могут отличаться от опубликованных выпусков.';result.append(intro);
   for(const [key,ru,en]of [['license','Лицензия MIT','MIT license'],['notices','Сторонние компоненты','Third-party notices'],['privacy','Конфиденциальность','Privacy'],['terms','Условия использования','Terms of use'],['brand','Авторство и бренд','Attribution and brand']]){const b=document.createElement('button');b.className='secondary';b.textContent=isEnglish()?en:ru;b.addEventListener('click',()=>guard(async()=>{const text=await api('help:legal',key);const pre=document.createElement('pre');pre.className='help-document';pre.textContent=text;result.replaceChildren(pre);result.scrollTop=0;}));result.append(b);}return;
  }
  const items=tab==='faq'?window.AuroraHelpData.faq:window.AuroraHelpData.articles;let count=0;
  for(const item of items){const title=pick(item,tab==='faq'?'q':'title'),paragraphs=tab==='faq'?[pick(item,'a')]:pick(item,'steps');if(query&&!([title,...paragraphs].join(' ').toLocaleLowerCase().includes(query)))continue;count++;const detail=document.createElement('details');detail.className='help-article';detail.open=!!query;const summary=document.createElement('summary');summary.textContent=title;detail.append(summary);const body=document.createElement(tab==='faq'?'div':'ol');for(const text of paragraphs){const p=document.createElement(tab==='faq'?'p':'li');p.textContent=text;body.append(p);}detail.append(body);result.append(detail);}
  if(!count){const p=document.createElement('p');p.textContent=isEnglish()?'No matching answers. Try another word or report the problem.':'Ответ не найден. Попробуй другое слово или сообщи о проблеме.';result.append(p);}result.scrollTop=0;
 }
 function openHelp(){draw();if(!host.open)host.showModal();$('#help-search').focus();}
 const button=document.createElement('button');button.id='help-button';button.className='nav';button.textContent='?  Справка';$('.sidebar-bottom').prepend(button);button.addEventListener('click',openHelp);
 $('#help-close').addEventListener('click',()=>host.close('cancel'));$('#help-search').addEventListener('input',draw);
 host.querySelectorAll('[data-help-tab]').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.helpTab;draw();}));
 host.querySelectorAll('[data-help-link]').forEach(b=>b.addEventListener('click',()=>guard(()=>api('help:open',b.dataset.helpLink))));
 document.addEventListener('keydown',e=>{if(e.key==='F1'){e.preventDefault();if(!document.querySelector('dialog[open]')||host.open)openHelp();}});
 new MutationObserver(()=>{if(host.open)draw();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 guard(async()=>{const info=await api('help:info');$('#help-version').textContent='Aurora '+info.version+' · '+info.platform+' · '+(isEnglish()?'offline help':'справка работает без интернета');const version=$('.version');if(version)version.textContent='AURORA '+info.version;});
})();
