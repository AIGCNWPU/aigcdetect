import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api.js';
import { createAudioApi } from '../src/modules/audio/pages/forgery.js';

test('音频后端地址不改变其他场景的公共 API 配置',async()=>{
  const platform={...api};
  platform.configure({baseUrl:'http://localhost:4173'});
  const audio=createAudioApi(platform,'http://localhost:8000');
  const originalFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async url=>{
    requests.push(String(url));
    return new Response(JSON.stringify({data:{status:'completed'}}),{headers:{'Content-Type':'application/json'}});
  };
  try {
    await audio.invoke('/audio/forgery',{fileName:'sample.wav'});
    await platform.invoke('/text/news',{});
    assert.deepEqual(requests,['http://localhost:8000/api/v1/audio/forgery','http://localhost:4173/api/v1/text/news']);
    assert.equal(platform.baseUrl,'http://localhost:4173');
    assert.equal(api.baseUrl,'');
  } finally { globalThis.fetch=originalFetch; }
});
