const escapeCreditText = value =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export const DEFAULT_DETECTION_CREDITS = 1;

export function creditBadgeHtml(cost = DEFAULT_DETECTION_CREDITS) {
  const safeCost = escapeCreditText(cost);
  return `<i class="veritas-credit-badge" aria-hidden="true" title="消耗 ${safeCost} 积分"><svg class="veritas-credit-diamond" viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M7 1.2 12.8 7 7 12.8 1.2 7 7 1.2Z" fill="currentColor" fill-opacity=".24" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/></svg><b class="veritas-credit-num">${safeCost}</b></i>`;
}

export function renderCreditButtonHtml(label, { cost = DEFAULT_DETECTION_CREDITS, showCost = true } = {}) {
  const safeLabel = escapeCreditText(label);
  return showCost ? `${safeLabel}${creditBadgeHtml(cost)}` : safeLabel;
}

export function setCreditButtonContent(button, label, { cost = DEFAULT_DETECTION_CREDITS, showCost = true } = {}) {
  if (!button) return;
  if (!showCost) {
    button.textContent = String(label ?? '');
    return;
  }
  button.innerHTML = renderCreditButtonHtml(label, { cost, showCost: true });
}
