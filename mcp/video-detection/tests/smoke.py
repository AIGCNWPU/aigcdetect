import asyncio,sys,os,json,tempfile,importlib.util,time
from pathlib import Path
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client
root=Path(__file__).resolve().parents[3]; server=root/'mcp/video-detection/server.py'
async def protocol():
 async with stdio_client(StdioServerParameters(command=sys.executable,args=[str(server)])) as (r,w):
  async with ClientSession(r,w) as s:
   await s.initialize(); names={t.name for t in (await s.list_tools()).tools};assert len(names)==4,names
   res=await s.call_tool('get_detection_status',{});assert not res.isError
   res=await s.call_tool('submit_video_detection',{'video_path':'/etc/hosts'});assert res.isError
   print('PASS: stdio initialize, four tools, status, path rejection')
asyncio.run(protocol())
with tempfile.TemporaryDirectory() as td:
 os.environ['VIDEO_INPUT_ROOT']=td;os.environ['VIDEO_OUTPUT_ROOT']=td+'/out'
 spec=importlib.util.spec_from_file_location('adapter',server);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 def fake(args):
  d=Path(args.output);d.mkdir(parents=True);j=d/'result.json';r=d/'report.md';j.write_text('{"risk":"low","summary":"test"}');r.write_text('test report');print(json.dumps({'json':str(j),'report':str(r)}))
 for mod in m.MODULES.values():mod.detect=fake
 video=Path(td)/'test.mp4';video.write_bytes(b'test')
 jid=m.submit_video_detection(str(video))['job_id'];m.jobs[jid].result(timeout=5)
 assert m.get_detection_result(jid)['status']=='completed';assert m.get_detection_report(jid)=='test report'
 def fail(args):raise RuntimeError('backend unavailable')
 m.MODULES['general'].detect=fail
 jid=m.submit_video_detection(str(video),'general')['job_id'];m.jobs[jid].result(timeout=5)
 assert m.get_detection_result(jid)['status']=='failed'
 print('PASS: both-module queue, persistence, reports, failure propagation (stub inference)')
