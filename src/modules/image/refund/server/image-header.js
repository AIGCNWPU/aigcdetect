import { RefundServiceError } from './providers.js';

// Container/dimension limits are checked locally. Full pixel decoding is also
// required by the browser and independently by the image inference service.
export function inspectRefundImage(bytes,type) {
  const invalid=()=>{throw new RefundServiceError('图片容器损坏、包含动画或尺寸超限。');};
  let width=0,height=0;
  try {
    if(type==='image/png') {
      if(bytes.toString('ascii',12,16)!=='IHDR')invalid();
      width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
      let cursor=8,ended=false,pixels=false;
      while(cursor+12<=bytes.length) {
        const length=bytes.readUInt32BE(cursor),tag=bytes.toString('ascii',cursor+4,cursor+8);
        if(cursor+12+length>bytes.length || tag==='acTL')invalid();
        if(tag==='IDAT')pixels=true;
        cursor+=12+length;
        if(tag==='IEND'){ended=true;break;}
      }
      if(!ended || !pixels || cursor!==bytes.length)invalid();
    } else if(type==='image/jpeg') {
      let cursor=2;
      while(cursor+4<bytes.length) {
        if(bytes[cursor]!==255)invalid();
        while(bytes[cursor]===255)cursor++;
        const marker=bytes[cursor++];
        if(marker===0xda || marker===0xd9)break;
        if(marker===0x01 || (marker>=0xd0 && marker<=0xd7))continue;
        const length=bytes.readUInt16BE(cursor);if(length<2 || cursor+length>bytes.length)invalid();
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=bytes.readUInt16BE(cursor+3);width=bytes.readUInt16BE(cursor+5);}
        cursor+=length;
      }
      if(bytes.lastIndexOf(Buffer.from([255,217]))<cursor)invalid();
    } else if(type==='image/webp') {
      if(bytes.readUInt32LE(4)+8!==bytes.length)invalid();
      let cursor=12,found=false;
      while(cursor+8<=bytes.length) {
        const tag=bytes.toString('ascii',cursor,cursor+4),length=bytes.readUInt32LE(cursor+4),start=cursor+8;
        if(start+length>bytes.length || ['ANIM','ANMF'].includes(tag))invalid();
        if(tag==='VP8X') {if(bytes[start]&2)invalid();width=bytes.readUIntLE(start+4,3)+1;height=bytes.readUIntLE(start+7,3)+1;}
        if(tag==='VP8 ') {found=true;if(bytes[start+3]!==157 || bytes[start+4]!==1 || bytes[start+5]!==42)invalid();width=bytes.readUInt16LE(start+6)&0x3fff;height=bytes.readUInt16LE(start+8)&0x3fff;}
        if(tag==='VP8L') {found=true;if(bytes[start]!==47)invalid();width=1+bytes[start+1]+((bytes[start+2]&63)<<8);height=1+(bytes[start+2]>>6)+(bytes[start+3]<<2)+((bytes[start+4]&15)<<10);}
        cursor=start+length+(length%2);
      }
      if(!found || cursor!==bytes.length)invalid();
    } else invalid();
    if(!width || !height || width*height>40000000)invalid();
    return {width,height};
  } catch(error) {if(error instanceof RefundServiceError)throw error;invalid();}
}
