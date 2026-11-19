import { mergeIndependentResultServices, runIndependentResultServices, setResultServiceState } from './result-render.js';

// 只重试当前送检快照的失败服务，已完成结果继续使用同一回执。
export function createResultRetry({ container, drafts, errorMessage, valid, onBusy = () => {} }) {
  let context = null, epoch = 0, running = false;
  const buttons = new Map();
  const paint = () => { for (const [id, button] of buttons) { button.hidden = !context || context.outcomes[id]?.status !== 'failed'; button.disabled = running || drafts.busy() || !valid(); } };
  for (const panel of container.querySelectorAll('[data-result-service-panel]')) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-secondary'; button.dataset.retryService = panel.dataset.resultServicePanel; button.textContent = '重试本项'; button.hidden = true;
    (panel.querySelector('[data-service-progress]') || panel).after(button); buttons.set(button.dataset.retryService, button);
    button.addEventListener('click', async () => {
      if (!context || running || drafts.busy() || !valid()) return;
      const token = epoch, snapshot = context, service = snapshot.services.find(item => item.id === button.dataset.retryService);
      if (!service || snapshot.outcomes[service.id]?.status !== 'failed') return;
      running = true; drafts.setBusy(true); onBusy(true); paint();
      try {
        const outcomes = await runIndependentResultServices([service], event => { if (token === epoch) setResultServiceState(container, service.id, event.status, event.status === 'running' ? '正在重试本项…' : event.status === 'completed' ? '本项已完成。' : `重试失败：${errorMessage(event.error)}`); });
        if (token !== epoch || !valid()) return;
        Object.assign(snapshot.outcomes, outcomes);
        await snapshot.onResult(mergeIndependentResultServices(snapshot.services, snapshot.outcomes, errorMessage));
      } finally { if (token === epoch) { running = false; drafts.setBusy(false); onBusy(false); paint(); } }
    });
  }
  drafts.subscribe(paint);
  return {
    configure(value) { epoch++; context = value; paint(); },
    clear() { epoch++; context = null; if (running) { running = false; drafts.setBusy(false); onBusy(false); } paint(); },
  };
}
