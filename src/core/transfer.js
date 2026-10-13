'use strict';
class Transfer {
  constructor(emit,label,total,direction,filesTotal=0,clock=Date.now){this.emit=emit;this.label=label;this.total=total;this.current=0;this.direction=direction;this.filesTotal=filesTotal;this.filesCurrent=0;this.clock=clock;this.samples=[{at:clock(),bytes:0}];this.phase='transfer';this.file='';}
  status(label=this.label,phase='transfer',file=this.file){this.label=label;this.phase=phase;this.file=file;return this.report();}
  set(bytes,file=this.file){this.current=Math.max(this.current,bytes);this.file=file;const at=this.clock();this.samples.push({at,bytes:this.current});while(this.samples.length>2&&this.samples[1].at<at-5000)this.samples.shift();return this.report();}
  add(bytes,file){return this.set(this.current+bytes,file);}
  skip(bytes){this.total=Math.max(this.current,this.total-bytes);return this.report();}
  fileDone(){this.filesCurrent++;return this.report();}
  report(){const now=this.clock(),first=this.samples[0],last=this.samples.at(-1),elapsed=(last.at-first.at)/1000;const speed=this.phase==='transfer'&&now-last.at<5000&&elapsed>=.25?Math.max(0,(last.bytes-first.bytes)/elapsed):0;const data={label:this.label,phase:this.phase,unit:'bytes',direction:this.direction,current:this.current,total:this.total,speed,etaSeconds:speed>0&&this.total>this.current?(this.total-this.current)/speed:null,file:this.file,filesCurrent:this.filesCurrent,filesTotal:this.filesTotal};this.emit('progress',data);return data;}
}
module.exports={Transfer};
