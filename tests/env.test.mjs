import test from 'node:test';
import assert from 'node:assert/strict';
import { applyServerEnv, parseServerEnv } from '../src/server/env.js';

test('服务端只从.env解析TEXT_MODEL与EGTE配置',()=>{
  const values=parseServerEnv(`
# local model configuration
TEXT_MODEL_PROVIDER=deepseek
TEXT_MODEL_API_KEY="unit-test-api-key"
EGTE_ROOT=/mnt/models/egte
PORT=9999
NODE_OPTIONS=--inspect
`);
  assert.deepEqual(values,{TEXT_MODEL_PROVIDER:'deepseek',TEXT_MODEL_API_KEY:'unit-test-api-key',EGTE_ROOT:'/mnt/models/egte'});
});

test('部署环境变量优先于本地.env',()=>{
  const target={TEXT_MODEL_API_KEY:'deployment-secret'};
  const applied=applyServerEnv('TEXT_MODEL_API_KEY=local-secret\nTEXT_MODEL_NAME=deepseek-v4-pro',target);
  assert.equal(applied,1);
  assert.equal(target.TEXT_MODEL_API_KEY,'deployment-secret');
  assert.equal(target.TEXT_MODEL_NAME,'deepseek-v4-pro');
});
