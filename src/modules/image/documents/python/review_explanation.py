"""Bounded debug explanations. No credentials are read by this module."""
import fcntl
import hashlib
import json
from pathlib import Path
from deepseek_explainer import ExplanationError, explain, validate_outbound, validate_response, make_summary, ALLOWED_RULES, STATUSES


def make_target_summary(detector, ocr, checks, *, material_id, page):
    """Add local geometry support without text, values, identities or file hashes.

    A bounding-box association is weaker than mask/pixel evidence; explicitly
    label this limitation so the language model cannot turn overlap into proof.
    """
    summary=make_summary(detector,ocr,checks)
    summary['schema']='redacted-target-review/0.2'
    summary['region_rule_links']=[]
    summary['region_ocr_support']=[]
    included=[c for c in checks[:32] if c.get('rule') in ALLOWED_RULES and c.get('status') in STATUSES]

    def overlaps(box, polygon):
        if not isinstance(polygon,list) or len(polygon)!=4:return False
        try:
            xs=[p[0] for p in polygon];ys=[p[1] for p in polygon]
            return min(box[2],max(xs))>max(box[0],min(xs)) and min(box[3],max(ys))>max(box[1],min(ys))
        except (TypeError,IndexError):return False

    for i,region in enumerate(detector.get('regions',[])[:24]):
        rid='region-'+str(i+1);box=region['box']
        matched=[r for r in (ocr or {}).get('regions',[]) if overlaps(box,r.get('polygon'))]
        summary['region_ocr_support'].append({'region_id':rid,'overlapping_ocr_regions':len(matched),
            'low_confidence_regions':sum(r['recognition_confidence']<.9 for r in matched)})
        for j,check in enumerate(included):
            for e in check.get('evidence',[]):
                source=e.get('source',{})
                if e.get('materialId')==material_id and source.get('page')==page and source.get('renderedSha256')==detector.get('input_sha256') and overlaps(box,source.get('polygon')):
                    summary['region_rule_links'].append({'region_id':rid,'rule_id':'rule-'+str(j+1),'association':'bounding_boxes_overlap_not_proof'})
                    break
    validate_outbound(summary)
    return summary


class ExplanationBudget:
    """A persistent experiment budget, spent before sending (also on timeout).

    Reusing the directory cannot reset the budget. No automatic retry. Cache keys
    include the provider model and exact prompt/summary, never secret values.
    """
    def __init__(self, directory, max_calls=0):
        if type(max_calls) is not int or not 0 <= max_calls <= 3:
            raise ExplanationError('debug_budget_must_be_0_to_3')
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.max_calls = max_calls

    def run(self, summary, settings, prompt_path, *, enabled=False, sender=explain):
        validate_outbound(summary)
        if not enabled:
            return {'status': 'not_run', 'reason': 'debug_disabled', 'api_called': False}
        if summary['detector']['uncalibrated_score'] < .5:
            return {'status': 'not_run', 'reason': 'no_local_tamper_alarm', 'api_called': False}
        if settings.get('DEEPSEEK_ENABLED') != 'true' or not settings.get('DEEPSEEK_API_KEY'):
            return {'status': 'not_run', 'reason': 'provider_not_configured', 'api_called': False}
        prompt_hash = hashlib.sha256(Path(prompt_path).read_bytes()).hexdigest()
        key = hashlib.sha256(json.dumps({'summary': summary, 'prompt': prompt_hash,
            'model': settings.get('DEEPSEEK_MODEL', 'deepseek-flash')}, sort_keys=True).encode()).hexdigest()
        cache = self.directory / (key + '.json')
        with (self.directory / 'budget.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state_path = self.directory / 'budget.json'
            state = json.loads(state_path.read_text()) if state_path.exists() else {'limit': self.max_calls, 'spent': 0}
            if state['limit'] != self.max_calls:
                raise ExplanationError('existing_experiment_budget_cannot_change')
            if cache.exists():
                result = json.loads(cache.read_text())
                validate_response(result['explanation'], summary)
                return {**result, 'cache_hit': True, 'api_called': False}
            if state['spent'] >= state['limit']:
                return {'status': 'not_run', 'reason': 'debug_budget_exhausted', 'api_called': False}
            state['spent'] += 1
            state_path.write_text(json.dumps(state))
            state_path.chmod(0o600)
            try:
                result = sender(summary, settings, prompt_path)
                if result.get('status') == 'succeeded':
                    validate_response(result['explanation'], summary)
                    with cache.open('x') as stream:
                        json.dump(result, stream, ensure_ascii=False)
                    cache.chmod(0o600)
                return {**result, 'api_called': True, 'cache_hit': False}
            except Exception:
                # Never persist or echo raw provider exceptions or secret settings.
                return {'status': 'failed', 'reason': 'explanation_failed', 'api_called': True}
