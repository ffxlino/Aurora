'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('gameConsole',{state:()=>ipcRenderer.invoke('console:state'),stop:()=>ipcRenderer.invoke('console:stop'),onEvent:fn=>{ipcRenderer.on('console:event',(_event,data)=>fn(data));}});
