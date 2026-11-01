/** Bounded binary masks in oriented-image coordinates; no semantic damage labels. */
export function decodeRefundMask(value) {
  const fail=()=>{throw new Error('局部定位掩码无效，请重试。');};
  if(!value || value.encoding!=='bitpack-msb' || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width<1 || value.height<1 || value.width>512 || value.height>512 || typeof value.data!=='string')fail();
  const pixels=value.width*value.height,size=Math.ceil(pixels/8);
  if(value.data.length!==4*Math.ceil(size/3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data))fail();
  let binary;try{binary=atob(value.data);}catch{fail();}
  if(binary.length!==size || btoa(binary)!==value.data || pixels%8 && (binary.charCodeAt(size-1)&((1<<(8-pixels%8))-1)))fail();
  const bits=new Uint8Array(pixels);
  for(let i=0;i<pixels;i++)bits[i]=(binary.charCodeAt(i>>3)>>(7-(i&7)))&1;
  return bits;
}

export function analyzeRefundMask(mask) {
  const bits=decodeRefundMask(mask),seen=new Uint8Array(bits.length),queue=new Int32Array(bits.length),components=[];
  const {width,height}=mask;let markedPixels=0;
  for(let i=0;i<bits.length;i++) {
    markedPixels+=bits[i];
    if(!bits[i] || seen[i])continue;
    let head=0,tail=1,minX=width,minY=height,maxX=0,maxY=0;queue[0]=i;seen[i]=1;
    while(head<tail) {
      const index=queue[head++],x=index%width,y=Math.floor(index/width);
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        const nx=x+dx,ny=y+dy,j=ny*width+nx;
        if(nx>=0 && nx<width && ny>=0 && ny<height && bits[j] && !seen[j]){seen[j]=1;queue[tail++]=j;}
      }
    }
    components.push({area:tail,minX,minY,maxX,maxY});
  }
  components.sort((a,b)=>b.area-a.area || a.minY-b.minY || a.minX-b.minX);
  return {markedPixels,componentCount:components.length,regions:components.slice(0,20).map((c,i)=>({id:`flame-${i+1}`,type:'unknown',description:'候选编辑区域，需结合原图复核。',box:{x:c.minX/width,y:c.minY/height,width:(c.maxX-c.minX+1)/width,height:(c.maxY-c.minY+1)/height}}))};
}

export function validateRefundLocalization(value,regions) {
  const fail=()=>{throw new Error('局部定位结果与筛查或掩码不一致，请重试。');};
  const gate=value?.gate;
  if(!gate || gate.provider!=='CO-SPY' || !Number.isFinite(gate.score) || gate.score<0 || gate.score>1 || gate.threshold!==0.5)fail();
  const result={status:value.status,gate:Object.freeze({provider:'CO-SPY',score:gate.score,threshold:gate.threshold})};
  if(value.status==='not_triggered') {
    if(gate.score>=gate.threshold || value.mask!=null || regions.length || value.markedPixels!==0 || value.componentCount!==0)fail();
    return Object.freeze({...result,markedPixels:0,componentCount:0});
  }
  if(value.status!=='localized' || gate.score<gate.threshold)fail();
  const analyzed=analyzeRefundMask(value.mask);
  if(value.markedPixels!==analyzed.markedPixels || value.componentCount!==analyzed.componentCount || regions.length!==analyzed.regions.length)fail();
  for(let i=0;i<regions.length;i++)if(regions[i].id!==analyzed.regions[i].id || regions[i].type!=='unknown' || ['x','y','width','height'].some(k=>Math.abs(regions[i].box[k]-analyzed.regions[i].box[k])>1e-10))fail();
  return Object.freeze({...result,markedPixels:analyzed.markedPixels,componentCount:analyzed.componentCount,mask:Object.freeze({encoding:'bitpack-msb',width:value.mask.width,height:value.mask.height,data:value.mask.data})});
}

export function refundMaskPath(mask) {
  const bits=decodeRefundMask(mask),parts=[];
  for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;) {
    if(!bits[y*mask.width+x]){x++;continue;}
    const start=x;while(x<mask.width && bits[y*mask.width+x])x++;
    parts.push(`M${start} ${y}h${x-start}v1h-${x-start}z`);
  }
  return parts.join('');
}

export const refundMaskStyle=Object.freeze({color:'#e11d48',rgb:Object.freeze([225,29,72]),opacity:.5,outline:'#9f1239'});

// Draw only the mask boundary, not the edges between its adjacent filled rows.
export function refundMaskBoundaryPath(mask) {
  const bits=decodeRefundMask(mask),{width,height}=mask,parts=[];
  const at=(x,y)=>x>=0&&y>=0&&x<width&&y<height?bits[y*width+x]:0;
  for(let y=0;y<=height;y++)for(let x=0;x<width;){
    if(at(x,y-1)===at(x,y)){x++;continue;}
    const start=x;while(x<width&&at(x,y-1)!==at(x,y))x++;
    parts.push(`M${start} ${y}h${x-start}`);
  }
  for(let x=0;x<=width;x++)for(let y=0;y<height;){
    if(at(x-1,y)===at(x,y)){y++;continue;}
    const start=y;while(y<height&&at(x-1,y)!==at(x,y))y++;
    parts.push(`M${x} ${start}v${y-start}`);
  }
  return parts.join('');
}

export function refundMaskSvg(mask,{opacity=refundMaskStyle.opacity}={}) {
  const alpha=Number.isFinite(opacity)?Math.min(.75,Math.max(.25,opacity)):refundMaskStyle.opacity;
  const boundary=refundMaskBoundaryPath(mask);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mask.width} ${mask.height}" preserveAspectRatio="none"><path data-mask-fill fill="${refundMaskStyle.color}" fill-opacity="${alpha}" d="${refundMaskPath(mask)}"/><path fill="none" stroke="#fff" stroke-width="3" vector-effect="non-scaling-stroke" d="${boundary}"/><path fill="none" stroke="${refundMaskStyle.outline}" stroke-width="1.5" vector-effect="non-scaling-stroke" d="${boundary}"/></svg>`;
}

export function refundMaskRgba(mask) {
  const bits=decodeRefundMask(mask),pixels=new Uint8ClampedArray(bits.length*4),{width,height}=mask;
  for(let i=0;i<bits.length;i++)if(bits[i]){
    const x=i%width,y=Math.floor(i/width),edge=x===0||y===0||x===width-1||y===height-1||!bits[i-1]||!bits[i+1]||!bits[i-width]||!bits[i+width];
    pixels.set(refundMaskStyle.rgb,i*4);pixels[i*4+3]=edge?245:Math.round(255*refundMaskStyle.opacity);
  }
  return pixels;
}
