import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextAnalysisError } from './text-analysis-error.js';

const DEFAULT_ROOT = '/mnt/vos-6d37s2q0/users/yh/models/EGTE_CRED_RAID_20261023';
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

function unavailable(message = 'AI文本检测算法当前不可用。') {
  return new TextAnalysisError('AI_DETECTOR_UNAVAILABLE', message, 503);
}

export class EgteClient {
  constructor({ env = process.env, spawnImpl = spawn } = {}) {
    this.root = env.EGTE_ROOT || DEFAULT_ROOT;
    this.python = env.EGTE_PYTHON_BIN || path.join(this.root, '.venv', 'bin', 'python');
    this.worker = env.EGTE_WORKER_PATH || path.join(projectRoot, 'scripts', 'egte_worker.py');
    this.gpu = env.EGTE_GPU || 'auto';
    this.timeoutMs = Number(env.EGTE_TIMEOUT_MS || 600_000);
    this.spawnImpl = spawnImpl;
    this.process = null;
    this.pending = new Map();
    this.nextId = 1;
    this.stdout = '';
  }

  ensureProcess() {
    if (this.process && !this.process.killed) return;
    const child = this.spawnImpl(this.python, [this.worker], {
      cwd: projectRoot,
      env: { ...process.env, EGTE_ROOT: this.root, EGTE_GPU: this.gpu, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.consume(chunk));
    child.stderr.on('data', () => {});
    child.on('error', () => this.failAll(unavailable()));
    child.on('exit', () => {
      if (this.process === child) this.process = null;
      this.failAll(unavailable('AI文本检测进程已退出，请检查服务器算法环境。'));
    });
  }

  consume(chunk) {
    this.stdout += chunk;
    let newline;
    while ((newline = this.stdout.indexOf('\n')) >= 0) {
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.failAll(unavailable('AI文本检测进程返回了无效数据。')); continue; }
      const pending = this.pending.get(String(message.id));
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.ok) pending.resolve(message.results || []);
      else pending.reject(unavailable(message.message || 'AI文本检测算法调用失败。'));
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  analyze({ classifier = 'cred', segments }) {
    if (!['cred', 'raid'].includes(classifier)) return Promise.reject(new TextAnalysisError('INVALID_CLASSIFIER', '不支持的AI文本分类器。', 400));
    this.ensureProcess();
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(unavailable('AI文本检测超时，请稍后重试。'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ id, classifier, segments })}\n`, error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(unavailable());
      });
    });
  }

  close() {
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
  }
}

let sharedClient;
export function createEgteClient(options) {
  if (options) return new EgteClient(options);
  sharedClient ||= new EgteClient();
  return sharedClient;
}
