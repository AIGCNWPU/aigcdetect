import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../scripts/serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const listen = async server => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = server => new Promise(resolve => {
  server.closeAllConnections();
  server.close(resolve);
});

test('brand icons, favicon assets, and HTML/JS/CSS references are updated', async () => {
  const gateway = createServer({ proxy: false });
  const base = await listen(gateway);
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /<link rel="icon" href="\.\/public\/favicon\.png\?v=5" type="image\/png" sizes="64x64">/);
    assert.match(html, /<link rel="icon" href="\.\/public\/favicon\.svg\?v=5" type="image\/svg\+xml">/);
    assert.match(html, /<link rel="apple-touch-icon" href="\.\/public\/brand-logo\.png\?v=5">/);
    assert.doesNotMatch(html, /href="\.\/public\/favicon\.svg"/);

    for (const route of ['/public/favicon.png', '/public/brand-logo.png']) {
      const res = await fetch(`${base}${route}`);
      assert.equal(res.status, 200, route);
      assert.equal(res.headers.get('content-type'), 'image/png');
      const buf = Buffer.from(await res.arrayBuffer());
      assert.ok(buf.subarray(0, 8).equals(PNG_MAGIC), `${route} must be a valid PNG`);
    }

    const svgRes = await fetch(`${base}/public/favicon.svg`);
    assert.equal(svgRes.status, 200);
    assert.equal(svgRes.headers.get('content-type'), 'image/svg+xml');
    const svg = await svgRes.text();
    assert.ok(!svg.includes('m32 12 17 7v13'), 'old shield SVG path must be removed');
    assert.match(svg, /<image[^>]+href="data:image\/png;base64,/);

    const [appJs, authJs, stylesCss] = await Promise.all([
      readFile(path.join(root, 'src/app.js'), 'utf8'),
      readFile(path.join(root, 'src/lib/auth-client.js'), 'utf8'),
      readFile(path.join(root, 'src/styles.css'), 'utf8'),
    ]);
    assert.match(appJs, /class="brand-mark"><img src="\.\/public\/brand-logo\.png\?v=5"/);
    assert.match(authJs, /class="auth-head"><img src="\.\/public\/brand-logo\.png\?v=5"/);
    assert.doesNotMatch(authJs, /favicon\.svg\?v=4/);
    assert.doesNotMatch(stylesCss, /\.brand-mark\{[^}]*linear-gradient/);
  } finally {
    await close(gateway);
  }
});
