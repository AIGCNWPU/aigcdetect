export const refundFileLimits = Object.freeze({ count:10, bytes:5*1024*1024, pixels:40000000 });
export const refundFieldLimits = Object.freeze({ caseNumber:100, productName:200, style:200, productInfo:2000, description:2000 });

export function validateRefundFile(file) {
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const mime = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp' }[extension];
  if (!mime || (file.type && file.type !== mime)) return '格式不支持，请选择 JPG、PNG 或 WebP 图片。';
  if (!Number.isFinite(file.size) || file.size <= 0) return '文件为空，无法读取。';
  if (file.size > refundFileLimits.bytes) return '单张图片不能超过 5 MiB。';
  return '';
}

export function validateRefundFields(fields) {
  const errors = {};
  const names = {caseNumber:'案件编号',productName:'商品名称',style:'商品款式',productInfo:'商品资料',description:'问题描述'};
  for (const [key,limit] of Object.entries(refundFieldLimits)) {
    const value = String(fields[key] || '').trim();
    if (['caseNumber','productName','description'].includes(key) && !value) errors[key] = `请填写${names[key]}。`;
    else if (value.length > limit) errors[key] = `${names[key]}不能超过 ${limit} 字。`;
  }
  return errors;
}

export async function readRefundPreview(file) {
  const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
  const jpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const webp = String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  const ext = file.name.split('.').pop().toLowerCase();
  if (!(ext==='png' && png || ['jpg','jpeg'].includes(ext) && jpeg || ext==='webp' && webp)) {
    throw new Error('图片内容与格式不符，或文件已损坏。');
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve,reject)=>{
      const img = new Image();
      const timer = setTimeout(()=>finish(new Error('图片读取超时，请重试。')),15000);
      function finish(error) {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        if (error) { img.src=''; reject(error); }
        else resolve({url,width:img.naturalWidth,height:img.naturalHeight});
      }
      img.onerror = ()=>finish(new Error('图片无法读取，请重新选择完整文件。'));
      img.onload = ()=>finish(!img.naturalWidth || !img.naturalHeight ? new Error('图片尺寸无效。') :
        img.naturalWidth*img.naturalHeight > refundFileLimits.pixels ? new Error('图片分辨率超过 4000 万像素，请缩小后重试。') : null);
      img.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function createRefundMaterials({ readPreview=readRefundPreview, revoke=url=>URL.revokeObjectURL(url) }={}) {
  let items=[], sequence=0, disposed=false, queue=Promise.resolve();
  return {
    get items() { return items.slice(); },
    add(files) {
      const batch=Array.from(files);
      const work=queue.then(async()=>{
        const errors=[];
        let added=0;
        for (const file of batch) {
          if (disposed) break;
          const reason=validateRefundFile(file) || (items.length >= refundFileLimits.count ? '最多添加 10 张图片，请先移除部分图片。' : '');
          if (reason) { errors.push({name:file.name,message:reason}); continue; }
          try {
            const loaded=await readPreview(file);
            if (disposed) { revoke(loaded.url); break; }
            items.push({id:`refund-image-${++sequence}`,file,...loaded});
            added++;
          } catch (error) { errors.push({name:file.name,message:error.message || '图片无法读取。'}); }
        }
        return {added,errors};
      });
      queue=work.catch(()=>{});
      return work;
    },
    remove(id) {
      const found=items.find(item=>item.id===id);
      if (!found) return;
      revoke(found.url);
      items=items.filter(item=>item.id!==id);
    },
    dispose() {
      disposed=true;
      for (const item of items) revoke(item.url);
      items=[];
    },
  };
}
