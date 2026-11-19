const contentCredentialWarnings = {
  invalid: '凭证校验未通过',
  unverified: '已读取凭证，核验状态未知',
  absent: '未发现内嵌凭证',
  external: '凭证指向外部地址，本次仅检查原文件',
  unsupported: '当前文件格式暂不支持核验',
  unavailable: '核验工具未配置',
  error: '凭证读取失败或超时',
};

export function contentCredentialRows(result) {
  const warning = contentCredentialWarnings[result?.status];
  if (!warning && result?.status !== 'valid' && result?.status !== 'trusted') return [];
  const rows = warning ? [['核验状态', warning]] : [];
  if (result.declaration === 'ai_generated') rows.push(['来源声明', 'AI 生成']);
  if (result.declaration === 'ai_composite') rows.push(['来源声明', '包含 AI 生成素材']);
  if (result.declaration === 'ai_used') rows.push(['来源声明', '处理记录含 AI 生成来源']);
  if (result.producer) rows.push(['生产方声明', result.producer]);
  if (result.tool) rows.push(['记录工具', result.tool]);
  if (result.signer) rows.push(['签名方', result.signer]);
  return rows.length ? rows : [['凭证', '已读取内嵌凭证']];
}

export function contentCredentialReportText(result) {
  const rows = contentCredentialRows(result);
  return rows.length
    ? 'C2PA 来源凭证  ·  ' + rows.map(([label, value]) => label + '  ' + value).join('  ·  ')
    : '';
}

export function renderContentCredentials(result) {
  const rows = contentCredentialRows(result);
  if (!rows.length) return null;
  const section = document.createElement('section');
  section.className = 'aftersales-content-credentials';
  const heading = document.createElement('h4');
  heading.textContent = 'C2PA 来源凭证';
  const values = document.createElement('dl');
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    values.append(term, description);
  }
  section.append(heading, values);
  return section;
}
