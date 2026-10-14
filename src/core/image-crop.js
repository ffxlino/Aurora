'use strict';
function validateCrop(rect,size,ratio){
 if(!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k])))throw Error('Неверная область изображения');
 const r=Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.round(rect[k])]));
 if(r.x<0||r.y<0||r.width<1||r.height<1||r.x+r.width>size.width||r.y+r.height>size.height||Math.abs(r.width-r.height*ratio)>ratio+1)throw Error('Область выходит за рамки изображения');
 return r;
}
module.exports={validateCrop};
