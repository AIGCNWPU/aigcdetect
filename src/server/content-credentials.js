import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runC2paTool = promisify(execFile);
const c2paSettingsPath = fileURLToPath(new URL('./c2pa-settings.json', import.meta.url));
const credentialExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
};

function credentialText(value) {
  return typeof value === 'string'
    ? value.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim().slice(0, 160)
    : '';
}

function digitalSourceType(action) {
  return /^https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/([A-Za-z]+)$/
    .exec(action?.digitalSourceType)?.[1];
}

function readActiveCredential(report) {
  const label = report.active_manifest;
  if (typeof label !== 'string' || !Object.hasOwn(report.manifests ?? {}, label)) {
    return { status: 'error' };
  }
  const manifest = report.manifests[label];
  const status = {
    Trusted: 'trusted',
    Valid: 'valid',
    Invalid: 'invalid',
  }[report.validation_state] ?? 'unverified';
  const actions = (manifest.assertions ?? [])
    .filter(assertion => /^c2pa\.actions(?:\.v\d+)?(?:__\d+)?$/.test(assertion.label))
    .flatMap(assertion => Array.isArray(assertion.data?.actions) ? assertion.data.actions : []);
  const sourceTypes = actions.map(digitalSourceType);
  const created = actions.find(action => action?.action === 'c2pa.created');
  const declaration = digitalSourceType(created) === 'trainedAlgorithmicMedia' ? 'ai_generated'
    : sourceTypes.includes('compositeWithTrainedAlgorithmicMedia') ? 'ai_composite'
    : sourceTypes.includes('trainedAlgorithmicMedia') ? 'ai_used' : '';
  const generator = manifest.claim_generator_info?.[0]?.name ?? manifest.claim_generator;
  const actionTool = (created ?? actions.find(action => action?.softwareAgent))?.softwareAgent;
  return {
    status,
    declaration,
    producer: credentialText(generator),
    tool: credentialText(actionTool?.name ?? actionTool),
    signer: credentialText(manifest.signature_info?.issuer || manifest.signature_info?.common_name),
  };
}

/** Reads the original bytes using the CAI tool with remote lookups disabled. */
export async function inspectContentCredentials({ type, bytes, filename }, { signal } = {}) {
  const extension = credentialExtensions[type];
  if (!extension) return { status: 'unsupported' };
  let directory;
  try {
    signal?.throwIfAborted();
    if (bytes) {
      directory = await mkdtemp(join(tmpdir(), 'veritas-c2pa-'));
      filename = join(directory, 'evidence' + extension);
      await writeFile(filename, bytes, { mode: 0o600, signal });
    }
    const { stdout } = await runC2paTool(
      process.env.VERITAS_C2PATOOL || 'c2patool',
      ['--settings', c2paSettingsPath, filename],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 8000, signal, windowsHide: true },
    );
    return readActiveCredential(JSON.parse(stdout));
  } catch (error) {
    const detail = String(error.stderr ?? '').trim();
    if (error.code === 'ENOENT') return { status: 'unavailable' };
    if (/^Error: No claim found\.?$/i.test(detail)) return { status: 'absent' };
    if (/remote manifest/i.test(detail)) return { status: 'external' };
    return { status: 'error' };
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(error =>
        console.warn('C2PA 临时凭证清理失败', error.code));
    }
  }
}

export async function runDetectionWithCredentials(job, media, signal, detect) {
  const verification = inspectContentCredentials(media, { signal });
  try {
    return await detect();
  } finally {
    const result = await verification;
    if (!signal.aborted) job.contentCredentials = result;
  }
}
