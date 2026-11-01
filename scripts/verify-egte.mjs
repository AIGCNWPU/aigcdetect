import { createEgteClient } from '../src/modules/text/egte-client.js';
import { loadServerEnv } from '../src/server/env.js';
import { fileURLToPath } from 'node:url';

loadServerEnv(fileURLToPath(new URL('../.env', import.meta.url)));

const client = createEgteClient({ env: process.env });
try {
  const results = await client.analyze({
    classifier: 'cred',
    segments: [{
      segmentId: 'verify-00001',
      text: '这是一段用于验证服务器句级人工智能文本检测链路是否正常工作的中文测试句子。',
    }],
  });
  const result = results[0];
  if (!result || result.status !== 'success') throw new Error(result?.reason || 'EGTE未返回有效结果');
  console.log(JSON.stringify({
    status: 'ok',
    classifier: 'cred',
    aiScore: result.aiScore,
    predictedLabel: result.predictedLabel,
    documentTokens: result.documentTokens,
  }, null, 2));
} finally {
  client.close();
}
