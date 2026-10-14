'use strict';
let lines=[],running=false,scheduled=false,logBytes=0;
const output=document.querySelector('#console-output'),query=document.querySelector('#console-filter'),follow=document.querySelector('#console-follow');
function draw(){scheduled=false;const filter=query.value.toLowerCase();output.textContent=(filter?lines.filter(s=>s.toLowerCase().includes(filter)):lines).join('\n');if(follow.checked)output.scrollTop=output.scrollHeight;document.querySelector('#console-status').textContent=running?'Minecraft работает':'Minecraft остановлен';document.querySelector('#console-stop').disabled=!running;}
function schedule(){if(!scheduled){scheduled=true;setTimeout(draw,100);}}
window.gameConsole.onEvent(({type,data})=>{if(type==='log'){const message=String(data);lines.push(message);logBytes+=message.length;while(lines.length>2000||logBytes>2*1024*1024)logBytes-=lines.shift().length;schedule();}if(type==='game'){running=data.running;schedule();}if(type==='settings')document.documentElement.dataset.theme=data.theme||'aurora';});
window.gameConsole.state().then(state=>{lines=state.logs;logBytes=lines.reduce((n,s)=>n+s.length,0);running=state.running;document.documentElement.dataset.theme=state.theme;draw();});
query.addEventListener('input',schedule);document.querySelector('#console-clear').addEventListener('click',()=>{lines=[];logBytes=0;draw();});document.querySelector('#console-stop').addEventListener('click',()=>{const dialog=document.querySelector('#console-confirm');dialog.returnValue='cancel';dialog.showModal();});document.querySelector('#console-confirm').addEventListener('close',async e=>{if(e.target.returnValue==='accept')await window.gameConsole.stop();});

document.querySelector('#console-confirm').addEventListener('cancel',e=>e.target.returnValue='cancel');
