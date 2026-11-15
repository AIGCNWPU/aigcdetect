import { refundMaskSvg } from '../../image/refund/localization.js';

export function renderFrameLocalization(value,{onPosition,open=false,visibility=new Map()}={}){
  const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const section=node('section','av-frame-localization');
  section.dataset.frameLocalization=value.status;
  section.append(node('h5','','关键帧局部检测'));
  const messages={not_triggered:'来源信号未达到复核条件，本次未执行关键帧局部检测。',source_incomplete:'来源依据尚不完整，本次未执行关键帧局部检测。',unavailable:value.error,failed:value.error,localized:'已检查抽样画面，以下标记为候选编辑痕迹。',partial:'部分抽样画面未取得定位结果，已保留有效画面，可重试来源检测。'};
  section.append(node('p','av-muted',messages[value.status]));
  if(!value.frames.length)return section;
  const details=node('details','av-frame-evidence');details.dataset.avEvidence='frame-localization';details.open=open;
  details.append(node('summary','','查看原画面与候选标记'));
  details.append(node('p','av-muted','仅检查这些采样画面，标记不代表已确认篡改。关闭候选标记可对照原图；画面原有字幕、红圈不会随开关消失。'));
  const gallery=node('div','av-frame-gallery');
  for(const frame of value.frames){
    const item=node('figure','av-frame-card'),stamp=`${frame.time.toFixed(3)} 秒`;
    item.dataset.avFrame=String(frame.frameIndex);
    item.append(node('figcaption','',`原视频 ${stamp}`));
    if(frame.status==='failed'){item.append(node('p','av-muted',frame.error));gallery.append(item);continue;}
    const picture=node('div','av-frame-picture'),image=node('img');
    picture.style.aspectRatio=`${frame.width} / ${frame.height}`;
    image.src=frame.preview.dataUrl;image.alt=`原视频 ${stamp} 的完整画面`;image.loading='lazy';picture.append(image);
    if(frame.markedPixels){
      const overlay=node('div','av-frame-mask');overlay.setAttribute('aria-hidden','true');overlay.innerHTML=refundMaskSvg(frame.mask);
      const label=node('label','av-frame-toggle'),toggle=node('input');toggle.type='checkbox';toggle.checked=visibility.get(String(frame.frameIndex))!==false;
      toggle.dataset.avMaskSwitch='';toggle.setAttribute('aria-label',`显示 ${stamp} 的候选标记`);overlay.hidden=!toggle.checked;
      toggle.addEventListener('change',()=>{overlay.hidden=!toggle.checked;});
      label.append(toggle,document.createTextNode(' 显示候选标记'));picture.append(overlay);item.append(picture,label);
      item.append(node('p','av-muted','发现候选编辑区域，需结合原画面复核。'));
    }else item.append(picture,node('p','av-muted','本画面未返回候选区域，仍不能排除修改。'));
    const button=node('button','av-position',`回看原视频 ${stamp}`);button.type='button';button.disabled=!onPosition;
    button.addEventListener('click',()=>onPosition?.(frame.time));item.append(button);gallery.append(item);
  }
  details.append(gallery);section.append(details);return section;
}
