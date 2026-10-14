'use strict';
let crop=null,drag=null;
function cropGeometry(){const view=$('#crop-viewport'),zoom=Number($('#crop-zoom').value);const base=Math.max(view.clientWidth/crop.width,view.clientHeight/crop.height),scale=base*zoom;return {width:view.clientWidth,height:view.clientHeight,scale};}
function drawCrop(){if(!crop)return;const g=cropGeometry();crop.x=Math.max(g.width-crop.width*g.scale,Math.min(0,crop.x));crop.y=Math.max(g.height-crop.height*g.scale,Math.min(0,crop.y));Object.assign($('#crop-image').style,{width:crop.width*g.scale+'px',height:crop.height*g.scale+'px',left:crop.x+'px',top:crop.y+'px'});}
function centerCrop(){const g=cropGeometry();crop.x=(g.width-crop.width*g.scale)/2;crop.y=(g.height-crop.height*g.scale)/2;drawCrop();}
async function openCropEditor(id,kind){const source=await api('pack:crop-source',id,kind);if(!source)return;crop={...source,id,kind,x:0,y:0};$('#crop-viewport').classList.toggle('square-crop',source.ratio===1);$('#crop-image').src=source.image;$('#crop-zoom').value=1;$('#crop-dialog').showModal();centerCrop();}
$('#crop-viewport').addEventListener('pointerdown',e=>{if(!crop)return;drag={x:e.clientX,y:e.clientY,left:crop.x,top:crop.y};e.currentTarget.setPointerCapture(e.pointerId);});
$('#crop-viewport').addEventListener('pointermove',e=>{if(!drag||!crop)return;crop.x=drag.left+e.clientX-drag.x;crop.y=drag.top+e.clientY-drag.y;drawCrop();});
for(const event of ['pointerup','pointercancel'])$('#crop-viewport').addEventListener(event,()=>drag=null);
$('#crop-zoom').addEventListener('input',()=>{if(!crop)return;const view=$('#crop-viewport'),img=$('#crop-image'),oldScale=img.clientWidth/crop.width,newScale=cropGeometry().scale;crop.x=view.clientWidth/2-(view.clientWidth/2-crop.x)*newScale/oldScale;crop.y=view.clientHeight/2-(view.clientHeight/2-crop.y)*newScale/oldScale;drawCrop();});
bind('#crop-reset','click',()=>{$('#crop-zoom').value=1;centerCrop();});bind('#crop-close','click',()=>$('#crop-dialog').close());
bind('#crop-save','click',async()=>{const g=cropGeometry(),p=await api('pack:crop-save',crop.token,{x:-crop.x/g.scale,y:-crop.y/g.scale,width:g.width/g.scale,height:g.height/g.scale});$('#crop-dialog').close();const field=crop.kind==='packIcon'?'pack-icon-preview':'pack-cover-preview';$('#'+field).innerHTML='<img src="'+escape(p[crop.kind])+'" alt="">';renderPacks();crop=null;});
$('#crop-dialog').addEventListener('close',()=>drag=null);
