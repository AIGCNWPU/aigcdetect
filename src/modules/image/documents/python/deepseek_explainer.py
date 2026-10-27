"""Explicit opt-in DeepSeek explanation of an allowlisted, text-free local summary."""
import hashlib,json,math,os,re,stat
from pathlib import Path
from urllib import request,error

ALLOWED_RULES={'net_plus_tax_equals_gross','displayed_rate_times_base','invoice_net_tax_gross','settlement_sum','displayed_calendar_date','field_comparison'}
ALLOWED_RULES.update({'identity_structure','identity_birth_date','identity_gender','identity_historical_region',
    'invoice_code_format','invoice_number_format','invoice_number_year','amount_words_numeric',
    'jurisdiction_specific_rules','scenario_applicability','institution_policy','field_extraction_coverage',
    'core_relationship_coverage','aggregate_selection','invoice_set_sum'})
STATUSES={'PASS','FAIL','NEI','NOT_APPLICABLE','ERROR','WARN'}

class ExplanationError(Exception):pass

def read_settings(path):
    path=Path(path)
    if path.is_symlink() or not path.is_file():raise ExplanationError('local_config_missing_or_symlink')
    if stat.S_IMODE(path.stat().st_mode)&0o077:raise ExplanationError('local_config_requires_mode_600')
    settings={}
    for line in path.read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#'):continue
        key,sep,value=line.partition('=')
        if not sep or not re.fullmatch(r'[A-Z_]+',key):raise ExplanationError('invalid_local_config_syntax')
        if key in settings:raise ExplanationError('duplicate_config_key')
        settings[key]=value.strip().strip('"').strip("'")
    return settings

def make_summary(detector,ocr=None,checks=()):
    if detector.get('status')!='succeeded':raise ExplanationError('detector_not_successful')
    score=detector.get('detector_score')
    if type(score) not in (float,int) or not math.isfinite(score) or not 0<=score<=1:raise ExplanationError('invalid_detector_score')
    width,height=detector['oriented_size']
    if width<=0 or height<=0:raise ExplanationError('invalid_image_size')
    # No free-form OCR/model strings, file paths, hashes, names, dates, IDs,
    # account numbers, amounts, image data or caller instructions leave the host.
    regions=[]
    for i,r in enumerate(detector.get('regions',[])[:24]):
        x1,y1,x2,y2=r['box']
        if not (0<=x1<x2<=width and 0<=y1<y2<=height):raise ExplanationError('invalid_region_geometry')
        regions.append({'region_id':f'region-{i+1}','relative_box':[round(x1/width,4),round(y1/height,4),round(x2/width,4),round(y2/height,4)],'evidence_type':'unverified_local_detector_region'})
    quality={'status':'not_available'}
    if ocr is not None:
        if ocr.get('input_sha256')!=detector.get('input_sha256'):raise ExplanationError('ocr_source_mismatch')
        rs=ocr.get('regions',[])
        quality={'status':'available' if ocr.get('status')=='succeeded' else 'failed','region_count':len(rs),
            'below_research_confidence_gate':sum(r['recognition_confidence']<.9 for r in rs),'raw_text_sent':False}
    rules=[]
    for c in checks[:32]:
        if c.get('rule') not in ALLOWED_RULES or c.get('status') not in STATUSES:continue
        rules.append({'rule_id':f'rule-{len(rules)+1}','kind':c['rule'],'status':c['status']})
    return {'schema':'redacted-receipt-summary/0.1','detector':{'provider':'SEED','uncalibrated_score':round(score,5),
        'all_region_count':len(detector.get('regions',[])),'regions_sent':len(regions)},'regions':regions,
        'ocr_quality':quality,'rules':rules,'image_sent':False,'raw_text_sent':False,'external_registry_checked':False}

def validate_outbound(summary):
    if isinstance(summary,dict) and summary.get('schema')=='redacted-target-review/0.2':
        extra={'region_rule_links','region_ocr_support'}
        if not extra.issubset(summary):raise ExplanationError('outbound_support_missing')
        base={k:v for k,v in summary.items() if k not in extra};base['schema']='redacted-receipt-summary/0.1'
        validate_outbound(base)
        region_ids={r['region_id'] for r in base['regions']};rule_ids={r['rule_id'] for r in base['rules']}
        links=summary['region_rule_links'];support=summary['region_ocr_support']
        if not isinstance(links,list) or len(links)>768 or not isinstance(support,list) or len(support)>24:raise ExplanationError('outbound_support_limit')
        for link in links:
            if set(link)!={'region_id','rule_id','association'} or link['region_id'] not in region_ids or link['rule_id'] not in rule_ids or link['association']!='bounding_boxes_overlap_not_proof':raise ExplanationError('outbound_link_rejected')
        seen=set()
        for item in support:
            if set(item)!={'region_id','overlapping_ocr_regions','low_confidence_regions'} or item['region_id'] not in region_ids or item['region_id'] in seen:raise ExplanationError('outbound_ocr_support_rejected')
            seen.add(item['region_id'])
            if any(type(item[k]) is not int or not 0<=item[k]<=100000 for k in ('overlapping_ocr_regions','low_confidence_regions')) or item['low_confidence_regions']>item['overlapping_ocr_regions']:raise ExplanationError('outbound_ocr_support_counts')
        return
    if not isinstance(summary,dict) or set(summary)!={'schema','detector','regions','ocr_quality','rules','image_sent','raw_text_sent','external_registry_checked'}:raise ExplanationError('outbound_schema_rejected')
    if summary['schema']!='redacted-receipt-summary/0.1' or any(summary[k] is not False for k in ('image_sent','raw_text_sent','external_registry_checked')):raise ExplanationError('outbound_privacy_flags_rejected')
    d=summary['detector']
    if set(d)!={'provider','uncalibrated_score','all_region_count','regions_sent'} or d['provider']!='SEED':raise ExplanationError('outbound_detector_rejected')
    if type(d['uncalibrated_score']) not in (int,float) or not math.isfinite(d['uncalibrated_score']) or not 0<=d['uncalibrated_score']<=1:raise ExplanationError('outbound_score_rejected')
    if any(type(d[k]) is not int or not 0<=d[k]<=1000000 for k in ('all_region_count','regions_sent')):raise ExplanationError('outbound_counts_rejected')
    if not isinstance(summary['regions'],list) or len(summary['regions'])>24:raise ExplanationError('outbound_regions_rejected')
    for i,r in enumerate(summary['regions']):
        if set(r)!={'region_id','relative_box','evidence_type'} or r['region_id']!=f'region-{i+1}' or r['evidence_type']!='unverified_local_detector_region':raise ExplanationError('outbound_region_rejected')
        b=r['relative_box']
        if not isinstance(b,list) or len(b)!=4 or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in b):raise ExplanationError('outbound_box_rejected')
    q=summary['ocr_quality']
    if q.get('status') not in {'not_available','available','failed'}:raise ExplanationError('outbound_ocr_rejected')
    expected={'status'} if q['status']=='not_available' else {'status','region_count','below_research_confidence_gate','raw_text_sent'}
    if set(q)!=expected:raise ExplanationError('outbound_ocr_keys_rejected')
    if q['status']!='not_available' and (q['raw_text_sent'] is not False or any(type(q[k]) is not int or not 0<=q[k]<=100000 for k in ('region_count','below_research_confidence_gate'))):raise ExplanationError('outbound_ocr_counts_rejected')
    if not isinstance(summary['rules'],list) or len(summary['rules'])>32:raise ExplanationError('outbound_rules_rejected')
    for i,r in enumerate(summary['rules']):
        if set(r)!={'rule_id','kind','status'} or r['rule_id']!=f'rule-{i+1}' or r['kind'] not in ALLOWED_RULES or r['status'] not in STATUSES:raise ExplanationError('outbound_rule_rejected')

class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ExplanationError('redirect_refused')

def validate_response(value,summary):
    if not isinstance(value,dict) or set(value)!={'summary','observations','rule_explanations','limitations'}:raise ExplanationError('response_schema_invalid')
    if not isinstance(value['summary'],str) or len(value['summary'])>4000:raise ExplanationError('invalid_summary')
    if not isinstance(value['limitations'],list) or len(value['limitations'])>20 or any(not isinstance(x,str) or len(x)>2000 for x in value['limitations']):raise ExplanationError('invalid_limitations')
    allowed_regions={r['region_id'] for r in summary['regions']};allowed_rules={r['rule_id'] for r in summary['rules']}
    for group,keys,idkey,allowed in [('observations',{'region_id','explanation','limitations'},'region_id',allowed_regions),('rule_explanations',{'rule_id','explanation'},'rule_id',allowed_rules)]:
        items=value[group]
        if not isinstance(items,list) or len(items)>32:raise ExplanationError('invalid_explanation_list')
        seen=set()
        for item in items:
            if not isinstance(item,dict) or set(item)!=keys or any(not isinstance(v,str) or len(v)>4000 for v in item.values()):raise ExplanationError('invalid_explanation_item')
            if item[idkey] not in allowed or item[idkey] in seen:raise ExplanationError('unknown_or_duplicate_evidence_reference')
            seen.add(item[idkey])
    return value

def explain(summary,settings,prompt_path):
    if settings.get('DEEPSEEK_ENABLED')!='true':return {'status':'not_run','reason':'disabled'}
    validate_outbound(summary)
    key=settings.get('DEEPSEEK_API_KEY','')
    if not key:return {'status':'not_run','reason':'api_key_missing'}
    if settings.get('DEEPSEEK_BASE_URL','https://api.deepseek.com')!='https://api.deepseek.com':raise ExplanationError('only_official_https_endpoint_allowed')
    model=settings.get('DEEPSEEK_MODEL','deepseek-flash')
    if model not in {'deepseek-flash','deepseek-v4-pro'}:raise ExplanationError('model_not_configured_for_this_adapter')
    try:tokens=int(settings.get('DEEPSEEK_MAX_TOKENS','1200'));timeout=int(settings.get('DEEPSEEK_TIMEOUT_SECONDS','60'))
    except ValueError:raise ExplanationError('invalid_limits') from None
    if not 128<=tokens<=4096 or not 1<=timeout<=120:raise ExplanationError('request_limits_out_of_range')
    prompt=Path(prompt_path).read_text()
    if key in prompt:raise ExplanationError('credential_in_prompt_rejected')
    body={'model':model,'messages':[{'role':'system','content':prompt},{'role':'user','content':json.dumps(summary,ensure_ascii=False)}],
          'response_format':{'type':'json_object'},'thinking':{'type':'disabled'},'max_tokens':tokens,'stream':False}
    req=request.Request('https://api.deepseek.com/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    opener=request.build_opener(request.ProxyHandler({}),NoRedirect())
    try:
        with opener.open(req,timeout=timeout) as response:raw=response.read(256*1024+1)
    except error.HTTPError as e:raise ExplanationError(f'provider_http_{e.code}') from None
    except (error.URLError,TimeoutError,OSError):raise ExplanationError('provider_connection_failed') from None
    if len(raw)>256*1024:raise ExplanationError('provider_response_too_large')
    # Never persist provider error bodies, auth headers or credentials.
    if key in raw.decode('utf-8',errors='replace'):raise ExplanationError('credential_echo_response_rejected')
    try:
        parsed=json.loads(raw);choice=parsed['choices'][0]
        if choice['finish_reason']!='stop':raise ExplanationError('provider_output_incomplete')
        value=validate_response(json.loads(choice['message']['content']),summary)
        usage={k:v for k,v in parsed.get('usage',{}).items() if k in ('prompt_tokens','completion_tokens','total_tokens') and type(v) is int}
    except (KeyError,TypeError,ValueError,IndexError):raise ExplanationError('provider_response_invalid') from None
    return {'status':'succeeded','provider':'DeepSeek','model':model,'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest(),
        'summary_sha256':hashlib.sha256(json.dumps(summary,sort_keys=True).encode()).hexdigest(),'usage':usage,
        'explanation':value,'interpretation':'unverified_generated_explanation_not_additional_forensic_evidence','image_sent':False,'raw_text_sent':False}
