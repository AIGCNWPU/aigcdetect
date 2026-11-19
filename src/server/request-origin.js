/** Keep local adapters private unless an exact public deployment origin is configured. */
export function allowSameOriginRequest(request, publicOrigin=process.env.VERITAS_PUBLIC_ORIGIN||'') {
  const host=String(request.headers.host||'').toLowerCase();
  if(request.headers['sec-fetch-site']==='cross-site')return false;
  const local=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  let expected=local?`http://${host}`:'';
  if(!local && publicOrigin) {
    try {
      const url=new URL(publicOrigin);
      if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||host!==url.host)return false;
      expected=url.origin;
    } catch {return false;}
  }
  return Boolean(expected)&&(!request.headers.origin||request.headers.origin===expected);
}
