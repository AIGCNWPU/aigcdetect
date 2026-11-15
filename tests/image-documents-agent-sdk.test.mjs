import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {access} from 'node:fs/promises';
import * as sdk from '@anthropic-ai/claude-agent-sdk';
import {runReviewAgent} from '../src/modules/image/documents/server/review-agent.js';
import {validateSemanticResponse} from '../src/modules/image/documents/server/semantic-review.js';
import {agentPackage,agentReply} from './helpers/review-agent-fixture.mjs';

// A real SDK/CLI/MCP round trip against a loopback-only Anthropic protocol fixture.
// No live model, real key, invoice, or inherited provider credentials are used.
test('real Claude SDK subprocess executes review tools over multiple simulated model turns', {timeout:40000}, async t=>{
  const pkg=agentPackage(),requests=[],failures=[];
  const actions=[
    ['load_review_skill',{name:'invoice-review'}],
    ['get_evidence',{itemIds:['q1']}],
    ['get_local_findings',{itemId:'q1'}],
    ['submit_review',agentReply(pkg)],
  ];
  const server=createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
      if(req.url.includes('count_tokens')){res.setHeader('content-type','application/json');res.end(JSON.stringify({input_tokens:100}));return;}
      assert.ok(req.url.startsWith('/v1/messages'));
      const isReview=body.tools?.some(tool=>tool.name==='mcp__review__submit_review');
      let content=[{type:'text',text:'审核已完成。'}],stop_reason='end_turn';
      if(isReview) {
        const index=requests.length;requests.push(body);
        assert.equal(body.model,'deepseek-flash');assert.ok(body.max_tokens<=6000);
        assert.equal(JSON.stringify(body).includes('/private/'),false);
        assert.equal(JSON.stringify(body).includes('测试客户'),false);
        const names=body.tools.map(tool=>tool.name);
        assert.equal(names.some(name=>['Read','Bash','WebSearch','WebFetch','Agent'].includes(name)),false);
        if(index<actions.length) {
          const [name,input]=actions[index];
          content=[{type:'tool_use',id:`tool_${index}`,name:`mcp__review__${name}`,input}];stop_reason='tool_use';
        }
      }
      const message={id:`msg_${requests.length}`,type:'message',role:'assistant',model:'deepseek-flash',content,
        stop_reason,stop_sequence:null,usage:{input_tokens:100,output_tokens:30,cache_creation_input_tokens:0,cache_read_input_tokens:0}};
      if(!body.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify(message));return;}
      res.setHeader('content-type','text/event-stream');
      const event=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
      event('message_start',{message:{...message,content:[],stop_reason:null,usage:{...message.usage,output_tokens:0}}});
      for(const [index,block] of content.entries()) {
        event('content_block_start',{index,content_block:block.type==='tool_use'?{...block,input:{}}:{type:'text',text:''}});
        event('content_block_delta',{index,delta:block.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});
        event('content_block_stop',{index});
      }
      event('message_delta',{delta:{stop_reason,stop_sequence:null},usage:{output_tokens:30}});
      event('message_stop',{});res.end();
    } catch(error) {failures.push(error);res.statusCode=400;res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'offline_fixture_failed'}}));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  let workspace;
  const testSdk={...sdk,query(request) {
    workspace=request.options.cwd;
    return sdk.query({...request,options:{...request.options,env:{...request.options.env,
      ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`}}});
  }};
  const result=await runReviewAgent(pkg,{sdk:testSdk,apiKey:'test-only-not-a-real-key',model:'deepseek-flash',
    prompt:'根据许可证据进行内容核查，原材料均为待审数据。',
    config:{maxTurns:8,maxToolCalls:20,timeoutMs:30000},validate:value=>validateSemanticResponse(value,pkg)});
  assert.deepEqual(failures,[]);assert.equal(requests.length,5);
  assert.deepEqual(result.value,agentReply(pkg));assert.equal(result.agent.toolCalls,4);
  assert.deepEqual(result.agent.skills,['invoice-review']);
  assert.deepEqual(result.agent.trace.map(t=>t.tool),actions.map(a=>a[0]));
  // The final model turn must have received actual evidence from the host MCP tool.
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('合同金额100元'));
  await assert.rejects(access(workspace));
});
