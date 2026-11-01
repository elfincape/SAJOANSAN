import {decodeNaverDirections,matchNaverRouteOptions,routeSettingsKey} from './naver-route-evidence.mjs';
export function distanceFromCard(text){
 if(!/거리\s*우선/.test(text))throw Error('거리우선 항목을 확인하지 못했습니다.');
 const match=text.split(/거리\s*우선/)[1].match(/([\d,]+(?:\.\d+)?)\s*(km|m)(?![a-z])/i);
 if(!match)throw Error('거리우선 주행거리를 읽지 못했습니다.');
 const value=Number(match[1].replaceAll(',',''))/(match[2].toLowerCase()==='m'?1000:1);
 if(!Number.isFinite(value)||value<0)throw Error('거리우선 주행거리 확인 필요');
 return {distanceKm:value,distanceText:match[0].replace(/\s/g,''),routeLabel:'거리우선',method:'naver-map-display'};
}
export function shortestRouteOption(options){
 if(!Array.isArray(options)||!options.length)throw Error('네이버 경로 옵션 확인 필요');
 const parsed=options.map((option,index)=>{
  const match=option.distanceText?.trim().match(/^([\d,]+(?:\.\d+)?)\s*(km|m)$/i);
  const distanceKm=match?Number(match[1].replaceAll(',',''))/(match[2].toLowerCase()==='m'?1000:1):NaN;
  if(!option.routeLabel?.trim()||!Number.isFinite(distanceKm)||distanceKm<0)throw Error('네이버 경로 옵션 거리 확인 필요');
  if(option.distanceMeters!==undefined&&(!Number.isSafeInteger(option.distanceMeters)||option.distanceMeters<0))throw Error('네이버 원시 주행거리 확인 필요');
  return {index,routeLabel:option.routeLabel.trim(),distanceKm:option.distanceMeters===undefined?distanceKm:option.distanceMeters/1000,distanceText:option.distanceText.replace(/\s/g,'')};
 });
 return parsed.reduce((best,option)=>option.distanceKm<best.distanceKm?option:best);
}
export function regionFromAddress(address){
 const parts=String(address).trim().split(/\s+/),province=parts[0]||'';
 const local=/^서울/.test(province)?parts.find(p=>/구$/.test(p)):parts.find(p=>/(시|군)$/.test(p));
 return local?{region:/^서울/.test(province)?'서울 '+local:local,regionKey:province.replace(/경기$/, '경기도')+'|'+local}:{region:'',regionKey:''};
}
const provinces={서울특별시:'서울',서울:'서울',부산광역시:'부산',부산:'부산',대구광역시:'대구',대구:'대구',인천광역시:'인천',인천:'인천',광주광역시:'광주',광주:'광주',대전광역시:'대전',대전:'대전',울산광역시:'울산',울산:'울산',세종특별자치시:'세종',세종시:'세종',세종:'세종',경기도:'경기',경기:'경기',강원특별자치도:'강원',강원도:'강원',강원:'강원',충청북도:'충북',충북:'충북',충청남도:'충남',충남:'충남',전북특별자치도:'전북',전라북도:'전북',전북:'전북',전라남도:'전남',전남:'전남',경상북도:'경북',경북:'경북',경상남도:'경남',경남:'경남',제주특별자치도:'제주',제주도:'제주',제주:'제주'};
Object.assign(provinces,{서울시:'서울',부산시:'부산',대구시:'대구',인천시:'인천',대전시:'대전',울산시:'울산'});
const provincePattern=new RegExp('(?:^|\\s)('+Object.keys(provinces).sort((a,b)=>b.length-a.length).join('|')+')(?:\\s|$)');
const provinceOf=text=>provinces[text.match(provincePattern)?.[1]]||'';
export function addressSearch(value){
 value=String(value).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();
 value=value.replace(/^(경기도|인천광역시|서울특별시)\s+\1\s+/,'$1 ');
 const road=String(value).match(/([가-힣\d]+(?:대로|로)(?:\s*\d+\s*(?:(?:번|가|나|다|라)\s*)?길)?|[가-힣\d]+길)\s*,?\s*(\d+(?:-\d+)?)/);
 const cityLabel=String(value).match(/([가-힣]+(?:시|군))/)?.[1]||'',city=provinces[cityLabel]||cityLabel.replace(/특별자치시|특별시|광역시/,'');
 const gu=String(value).match(/(?:^|\s)([가-힣]+구)(?:\s|$)/)?.[1]||'';
 const town=String(value).match(/(?:^|\s)([가-힣]+(?:읍|면))(?:\s|$)/)?.[1]||'';
 const province=provinceOf(value);
 if(!road){
  const parcel=String(value).match(/(?:^|\s)([가-힣\d]+(?:동|리|가))\s*(산\s*)?(\d+(?:-\d+)?)(?:번지)?(?=\s|$|[,()])/);
  const query=String(value).split(/[,(]/)[0].trim();
  return {queries:[...new Set([query,query.replace(/(\d)번지(?=\s|$)/,'$1')])],province,city,gu,town,road:null,parcel:parcel?{land:parcel[1],mountain:!!parcel[2],number:parcel[3]}:null,original:value,addressOnly:!!parcel&&!String(value).slice(parcel.index+parcel[0].length).trim()};
 }
 const street=road[1].replace(/\s/g,''),number=road[2],short=street+' '+number;
 const tail=String(value).slice(road.index+road[0].length).trim(),unitOnly=/^(?:[가-힣A-Za-z0-9]+동\s*)?(?:지하\s*)?\d+\s*층(?:\s*[\d-]+(?:호)?)?$/.test(tail);
 return {queries:[...new Set([String(value).slice(0,road.index+road[0].length).trim(),city+' '+short,short])],province,city,gu,town,road:{street,number},original:value,addressOnly:!tail||unitOnly};
}
export function addressCandidateMatches(search,text){
 if(search.province&&provinceOf(text)!==search.province)return false;
 const token=value=>new RegExp('(?:^|\\s)'+value+'(?:\\s|$)').test(text);
 if(search.city&&search.city!==search.province&&!token(search.city)||search.town&&!token(search.town))return false;
 // Incheon 2026-07-01 district split: https://www.incheon.go.kr/IC01070101 — exact road/parcel identity is still required below.
 const formerIncheonSeo=search.province==='인천'&&search.gu==='서구'&&(search.road||search.parcel)&&/(?:^|\s)(검단구|서해구)(?:\s|$)/.test(text);
 if(search.gu&&!token(search.gu)&&!formerIncheonSeo)return false;
 if(!search.road){
  if(search.parcel)return new RegExp('(?:^|[^가-힣\\d])'+search.parcel.land+'\\s*'+(search.parcel.mountain?'산\\s*':'')+search.parcel.number+'(?:번지)?(?:[^\\d-]|$)').test(text);
  const normalize=v=>v.replace(/경기도/g,'경기').replace(/서울특별시/g,'서울').replace(/인천광역시/g,'인천').replace(/\s+/g,' ').trim();
  return normalize(text).includes(normalize(search.original));
 }
 const street=search.road.street.split('').join('\\s*');
 return new RegExp('(?:^|[^가-힣\\d])'+street+'\\s*'+search.road.number+'(?:[^\\d-]|$)').test(text);
}
export function chooseAddressCandidate(search,options){
 const matching=options.flatMap((o,i)=>addressCandidateMatches(search,o.text)?[i]:[]);
 if(matching.length===1)return matching[0];
 const addresses=search.addressOnly?matching.filter(i=>options[i].addressOnly):[];
 return addresses.length===1?addresses[0]:-1;
}
function pointCoordinates(fields){
 let coordinates;
 if(fields.slice(0,2).every(s=>/^-?\d+(?:\.\d+)?$/.test(s))){const [x,y]=fields.map(Number),radius=6378137;coordinates=[x/radius*180/Math.PI,Math.atan(Math.sinh(y/radius))*180/Math.PI];}
 else{const alphabet='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';coordinates=fields.slice(0,2).map(s=>{if(!/^[A-Za-z0-9]{1,12}$/.test(s))throw Error('네이버 위치 좌표 형식 확인 필요');let n=0n;for(const c of s)n=n*62n+BigInt(alphabet.indexOf(c));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('네이버 위치 좌표 형식 확인 필요');return (Number(n)-2000000000)/1e7;});}
 if(coordinates.some(n=>!Number.isFinite(n))||Math.abs(coordinates[0])>180||Math.abs(coordinates[1])>90)throw Error('네이버 위치 좌표 범위 확인 필요');return coordinates;
}
export function naverPointFromUrl(url,address,selection){
 const source=new URL(url),parts=source.pathname.split('/'),token=parts[3],fields=token?.split(',')??[];
 if(source.origin!=='https://map.naver.com'||parts[1]!=='p'||parts[2]!=='directions'||parts[6]!=='car'||fields.length!==5||!fields.slice(0,2).every(v=>/^[-A-Za-z0-9.]{1,32}$/.test(v))||!/^[-A-Za-z0-9_]{0,80}$/.test(fields[3])||!['ADDRESS_POI','PLACE_POI','SIMPLE_POI','BUS_STATION','SUBWAY_STATION'].includes(fields[4])||!selection?.text||!addressCandidateMatches(addressSearch(address),selection.text))throw Error('네이버 확인 주소의 위치 토큰 검증 실패');
 const label=decodeURIComponent(fields[2]);if(!label||label!==selection.label?.trim())throw Error('네이버 확인 주소의 위치 토큰 검증 실패');
 return {token,label,text:selection.text,coordinates:pointCoordinates(fields)};
}
const cachedPoint=(address,cache)=>cache.get(address)??cache.get(addressSearch(address).original);
export function consecutivePointPlan(stops,points){
 if(stops.length!==points.length||points.some(p=>!Array.isArray(p?.coordinates)||p.coordinates.length!==2||p.coordinates.some(n=>!Number.isFinite(n))))throw Error('확인된 방문지 좌표가 필요합니다.');
 const mapStops=[],logicalToMap=[];let before;
 for(const [i,stop] of stops.entries()){
  const coordinates=points[i].coordinates;
  if(!before||coordinates.some((n,j)=>n!==before[j]))mapStops.push(stop);
  logicalToMap.push(mapStops.length-1);before=coordinates;
 }
 return {mapStops,logicalToMap};
}
export function expandLogicalLegs(legs,logicalToMap){
 if(!Array.isArray(legs)||logicalToMap[0]!==0||logicalToMap.at(-1)!==legs.length||logicalToMap.some((n,i)=>!Number.isInteger(n)||i&&(n<logicalToMap[i-1]||n>logicalToMap[i-1]+1)))throw Error('지도 구간과 원본 방문 순서가 일치하지 않습니다.');
 return logicalToMap.slice(1).map((n,i)=>n===logicalToMap[i]?0:legs[n-1]);
}
export function naverCourseUrl(stops,cache){
 const points=stops.map(s=>cachedPoint(s,cache));if(points.some(p=>!p))return null;
 const tokens=points.map((p,i)=>naverPointFromUrl('https://map.naver.com/p/directions/'+p.token+'/-/-/car',stops[i],p).token);
 return 'https://map.naver.com/p/directions/'+tokens[0]+'/'+tokens.at(-1)+'/'+(tokens.slice(1,-1).join(':')||'-')+'/car?c=9.00,0,0,0,dh';
}
const routePointKey=url=>{try{const p=new URL(url).pathname.split('/');return p[6]==='car'?JSON.stringify(p.slice(3,6)):null;}catch{return null;}};
export function naverCourseRequestMatches(request,stops,cache,{startedAt,frame,url}){
 try{
  if(request.frame()!==frame||request.timing().startTime<startedAt||!Number.isFinite(request.timing().startTime)||!routePointKey(url)||routePointKey(frame.url())!==routePointKey(url))return false;
  const actual=new URL(request.url());if(actual.origin!=='https://map.naver.com'||actual.pathname!=='/p/api/directions/car'||actual.searchParams.get('crs')!=='EPSG:4326'||actual.searchParams.get('respversion')!=='4'||actual.searchParams.get('output')!=='pbf')return false;
  const parts=[actual.searchParams.get('start'),...(actual.searchParams.get('waypoints')?.split('|')??[]),actual.searchParams.get('goal')];
  return parts.length===stops.length&&parts.every((value,i)=>{
   if(!value)return false;const pair=value.split(',').slice(0,2),point=cachedPoint(stops[i],cache);if(!point||pair.some(s=>!s.trim()))return false;
   const expected=point.coordinates??pointCoordinates(point.token.split(',')),coordinates=pair.map(Number),name=Buffer.from(value.match(/(?:^|,)name=([^,]+)/)?.[1]||'','base64url').toString('utf8');
   return name===point.label&&coordinates.every((n,j)=>Number.isFinite(n)&&Math.abs(n-expected[j])<=1e-7);
  });
 }catch{return false;}
}
const routeSettings=url=>{const q=new URL(url).searchParams;return Object.fromEntries(['cartype','fueltype','mileage','mainoption','restrictvolume','departuretime','respversion','crs','rptype','output'].map(k=>[k,q.get(k)]));};
export function courseLocalRouteFailure(error){
 return error?.code==='NAVER_ROUTE_UNAVAILABLE'&&error.reason==='PROVIDER_HTTP_ERROR'&&error.httpStatus===400&&error.routeDiagnostics?.responseEvidence?.restrictionConfirmed===false&&!['access','captcha','limit'].some(key=>error.routeDiagnostics.responseEvidence.markers?.[key]);
}
function providerRequestShape(response){
 const url=new URL(response.url()),q=url.searchParams,route=url.pathname==='/p/api/directions/car';
 const shape={path:url.pathname,requestKind:route?'route':'search',queryLength:route?null:q.get('query')?.length??0,queryEncodingValid:decodeURIComponent((url.search.match(/[?&]query=([^&]*)/)?.[1]??'').replace(/\+/g,' '))===(q.get('query')??''),paramKeys:[...q.keys()].filter(k=>/^(query|coords|types|searchCoord|boundary|x|y|longitude|latitude|start|goal|waypoints|crs|respversion|output|cartype|fueltype|mileage|mainoption|restrictvolume|departuretime|rptype)$/.test(k)).sort()};
 if(route){const points=[q.get('start'),...(q.get('waypoints')?.split('|')??[]),q.get('goal')];shape.pointCount=points.length;shape.coordinatesValid=points.every(value=>{const pair=value?.split(',').slice(0,2);return pair?.length===2&&pair.every((n,i)=>n.trim()&&Number.isFinite(Number(n))&&Math.abs(Number(n))<=(i===0?180:90));});}
 else shape.types=q.get('types')?.split(',').filter(v=>/^(place|address|bus)$/.test(v));
 const method=response.request?.()?.method?.();if(['GET','POST'].includes(method))shape.method=method;
 return shape;
}
const responseEvidence=new WeakMap();
export async function searchResponseEvidence(response){
 if(!response)return {status:null,bodyReadFailed:true,bodyBytes:null};
 if(responseEvidence.has(response))return responseEvidence.get(response);
 const pending=(async()=>{
  const evidence={status:response.status?.()??null,bodyBytes:null,bodyReadFailed:false};
  try{const u=new URL(response.url()),q=u.searchParams,raw=q.get('coords');Object.assign(evidence,providerRequestShape(response));if(raw){const parts=raw.split(',').map(Number);if(parts.length===2&&parts.every(Number.isFinite)){evidence.coords=parts;evidence.latitudeFirstInWorldBounds=Math.abs(parts[0])<=90&&Math.abs(parts[1])<=180;}else evidence.coordinateNonFinite=true;}}catch{}
  try{const headers=await response.headers?.(),mime=headers?.['content-type']?.split(';')[0].trim().toLowerCase();if(['application/json','text/html','text/plain','application/octet-stream'].includes(mime))evidence.contentType=mime;const length=headers?.['content-length'];if(/^\d{1,12}$/.test(length??''))evidence.declaredBodyBytes=Number(length);const after=headers?.['retry-after'];if(/^\d{1,8}$/.test(after??''))evidence.retryAfterSeconds=Number(after);evidence.responseHeaderNames=Object.keys(headers??{}).filter(k=>!/cookie|auth|token|key|secret|session/i.test(k)).slice(0,40);evidence.serverFamily=['nginx','envoy','cloudflare','cloudfront','nserver'].find(s=>String(headers?.server??'').toLowerCase().includes(s))??(headers?.server?'other':'not-provided');}catch{}
  try{const request=response.request?.(),headers=await request?.headers?.();if(headers){evidence.requestHeaderNames=Object.keys(headers).filter(k=>!/cookie|auth|token|key|secret|session/i.test(k)).slice(0,40);evidence.cookiePresent=!!headers.cookie;evidence.acceptsJson=/json/i.test(headers.accept??'');evidence.userAgentClass=/HeadlessChrome/.test(headers['user-agent']??'')?'headless-chromium':/Chrome/.test(headers['user-agent']??'')?'chromium':'other';if(['same-origin','same-site','cross-site','none'].includes(headers['sec-fetch-site']))evidence.fetchSite=headers['sec-fetch-site'];if(['cors','same-origin','no-cors','navigate'].includes(headers['sec-fetch-mode']))evidence.fetchMode=headers['sec-fetch-mode'];for(const key of ['origin','referer'])if(headers[key])try{evidence[key+'Origin']=new URL(headers[key]).origin;}catch{}}}catch{}
  try{evidence.fromServiceWorker=!!response.fromServiceWorker?.();}catch{}
  try{if(response.finished)evidence.finished=!(await response.finished());}catch{evidence.finished=false;}
  let text='';try{text=response.text?await response.text():response.body?(await response.body()).toString('utf8'):JSON.stringify(await response.json());evidence.bodyBytes=Buffer.byteLength(text);evidence.bodyFormat=!text?'empty':/^\s*</.test(text)?'html':'text';}catch{evidence.bodyReadFailed=true;evidence.bodyFormat='unavailable';}
  if(text){try{const json=JSON.parse(text),code=json?.error?.code??json?.code;evidence.bodyFormat='json';if(/^(?:\d{1,6}|INVALID_[A-Z_]{1,60}|BAD_REQUEST|TOO_MANY_REQUESTS|ACCESS_DENIED|FORBIDDEN)$/.test(String(code??'')))evidence.providerCode=String(code);}catch{}}
  // Classify a bounded in-memory body; never retain raw messages, HTML, headers, cookies or tokens.
  const sample=text.slice(0,16384);evidence.markers={access:/access\s+denied|request\s+blocked|접근.{0,12}제한|비정상.{0,12}접근/i.test(sample),captcha:/captcha|자동\s*입력\s*방지|로봇.{0,12}확인/i.test(sample),limit:/too\s+many\s+requests|rate.?limit|quota.{0,12}exceed/i.test(sample),coordinates:/coord|latitude|longitude|boundary|위도|경도|좌표/i.test(sample),parameters:/invalid.{0,20}(?:parameter|argument)|파라미터|인자/i.test(sample)};
  evidence.restrictionConfirmed=[403,429].includes(evidence.status)||['ACCESS_DENIED','FORBIDDEN','TOO_MANY_REQUESTS'].includes(evidence.providerCode)||evidence.bodyFormat!=='json'&&(evidence.markers.access||evidence.markers.captcha);
  return evidence;
 })();responseEvidence.set(response,pending);return pending;
}
async function providerFailure(response,diagnostics,stage='search'){
 const status=response?.status?.(),detail=diagnostics?.at(-1);let providerCode,coordinateState='not-provided';
 try{const q=new URL(response.url()).searchParams,coordinates=[...q].filter(([k])=>/coord|boundary|^(?:x|y|longitude|latitude)$/i.test(k)).map(([,v])=>v);if(coordinates.length)coordinateState=coordinates.every(v=>v.trim()&&v.split(/[;,\s]+/).every(s=>s&&Number.isFinite(Number(s))))?'valid':'invalid';}catch{}
 let requestShape,responseShape;
 try{requestShape=providerRequestShape(response);}catch{}
 try{const data=await response?.json?.(),error=data?.error,code=error?.code??data?.code,message=String(error?.message??data?.message??'');if(/^(?:\d{1,6}|INVALID_[A-Z_]{1,60}|BAD_REQUEST|TOO_MANY_REQUESTS|ACCESS_DENIED|FORBIDDEN)$/.test(String(code??'')))providerCode=String(code);responseShape={format:'json',hasError:!!error,errorCategory:/coord|latitude|longitude|boundary|위도|경도|좌표/i.test(message)?'coordinates':/parameter|argument|파라미터|인자/i.test(message)?'parameters':/limit|too many|quota|제한/i.test(message)?'limit':/denied|forbidden|access|접근/i.test(message)?'access':'other'};}catch{responseShape={format:'non-json-or-unavailable'};}
 const evidence=await searchResponseEvidence(response);
 if(detail){detail.coordinateState=coordinateState;if(providerCode)detail.providerCode=providerCode;if(requestShape)detail.requestShape=requestShape;detail.responseShape=responseShape;detail.responseEvidence=evidence;}
 return Object.assign(Error(`네이버 ${stage==='search'?'주소 검색':'길찾기'} ${evidence.restrictionConfirmed?'접근 제한 응답을 확인해 중단했습니다.':status?'요청이 HTTP '+status+' 응답으로 거절되었습니다.':'응답을 받지 못했습니다.'} 주소 부재로 판정하지 않았습니다.`),{code:stage==='search'?'NAVER_SEARCH_UNAVAILABLE':'NAVER_ROUTE_UNAVAILABLE',reason:evidence.restrictionConfirmed?'PROVIDER_ACCESS_RESTRICTED':status?'PROVIDER_HTTP_ERROR':'PROVIDER_RESPONSE_TIMEOUT',httpStatus:status,searchDiagnostics:diagnostics?structuredClone(diagnostics):undefined,...(stage==='route'?{routeDiagnostics:{responseEvidence:evidence,...(requestShape?{requestShape}:{})}}:{})});
}
export async function selectAddress(page,input,address,{checkActive=async()=>{},timings}={}){
 const search=addressSearch(address),options=page.locator('[id^="instant-search-item-poi-"]'),reasons=new Set(),searchDiagnostics=[],candidateSummaries=new Set();
 for(const query of search.queries){
  const refreshStarted=performance.now();if(timings)timings.addressQueries++;
  const detail={queryIndex:searchDiagnostics.length+1};searchDiagnostics.push(detail);
  await checkActive();
  await input.fill('');
  try{await page.waitForFunction(()=>document.querySelectorAll('[id^="instant-search-item-poi-"]').length===0,null,{timeout:5000});detail.cleared=true;}catch{detail.cleared=false;reasons.add('SEARCH_REFRESH_FAILED');continue;}
  let received;
  const refreshed=page.waitForResponse(response=>{try{const url=new URL(response.url());return url.pathname==='/p/api/search/instant-search'&&url.searchParams.get('query')===query;}catch{return false;}},{timeout:5000}).then(response=>{received=response;detail.status=response.status?.();return response;}).catch(()=>null);
  await input.fill(query);
  const visible=options.first().waitFor({state:'visible',timeout:5000});
  try{await Promise.race([visible,refreshed.then(async response=>{if(response&&(!response.ok()||(await searchResponseEvidence(response)).restrictionConfirmed))throw await providerFailure(response,searchDiagnostics);return visible;})]);detail.visible=true;}catch(e){detail.visible=false;if(e.code==='NAVER_SEARCH_UNAVAILABLE')throw e;const response=await refreshed;if(timings)timings.searchRefreshMs+=performance.now()-refreshStarted;if(!response||!response.ok())throw await providerFailure(response,searchDiagnostics);reasons.add('SEARCH_NO_CANDIDATES');continue;}
  if(timings)timings.searchRefreshMs+=performance.now()-refreshStarted;
  if(received){
   if(!received.ok()||(await searchResponseEvidence(received)).restrictionConfirmed)throw await providerFailure(received,searchDiagnostics);
   try{if(await received.finished()){detail.responseFinished=false;throw Error('Response failed');}detail.responseFinished=true;}catch{detail.responseFinished=false;throw await providerFailure(received,searchDiagnostics);}
  }
  await checkActive();
  detail.inputMatches=await input.evaluate(e=>e.value)===query;if(!detail.inputMatches){reasons.add('SEARCH_REFRESH_FAILED');continue;}
  const candidates=await options.evaluateAll(es=>es.map(e=>({text:e.innerText,addressOnly:!e.querySelector('.place_category,.place_text.sub')})));
  detail.candidates=candidates.length;detail.matches=candidates.filter(c=>addressCandidateMatches(search,c.text)).length;
  const index=chooseAddressCandidate(search,candidates);
  if(index<0){reasons.add(candidates.filter(c=>addressCandidateMatches(search,c.text)).length>1?'SAME_ADDRESS_DUPLICATES':'MULTIPLE_LOCATIONS');for(const c of candidates.slice(0,6))if(candidateSummaries.size<6)candidateSummaries.add(c.text.slice(0,500));continue;}
  await checkActive();await options.nth(index).click();await page.waitForTimeout(700);return candidates[index];
 }
 const messages={SAME_ADDRESS_DUPLICATES:'같은 주소의 중복 후보를 안전하게 구분하지 못했습니다. 주소 후보를 확인해 주세요.',MULTIPLE_LOCATIONS:'입력 주소와 다른 위치의 후보가 표시됩니다. 원본 주소와 네이버 결과를 확인해 주세요.',SEARCH_REFRESH_FAILED:'네이버 검색 결과 갱신을 확인하지 못했습니다. 재시도해 주세요.',SEARCH_NO_CANDIDATES:'이번 네이버 자동완성에서 검색 후보를 받지 못했습니다. 직접 검색 결과와 주소를 확인해 주세요.'};
 const reason=Object.keys(messages).find(r=>reasons.has(r))||'SEARCH_NO_CANDIDATES';
 throw Object.assign(Error(messages[reason]),{code:'ADDRESS_NOT_FOUND',reason,searchDiagnostics,candidateSummaries:[...candidateSummaries]});
}
async function resolveAddressPoint(page,input,address,cache,{checkActive,timings}){
 const before=new URL(page.url()).pathname.split('/')[3],selection=await selectAddress(page,input,address,{checkActive,timings}),label=(await input.evaluate(e=>e.value)).trim();
 const allowSame=[...cache.values()].some(p=>p.token===before&&addressCandidateMatches(addressSearch(address),p.text));
 await page.waitForFunction(({label,before,allowSame})=>{const token=location.pathname.split('/')[3];return token&&token!=='-'&&(allowSame||token!==before)&&decodeURIComponent(token.split(',')[2]||'')===label;},{label,before,allowSame});
 const point=naverPointFromUrl(page.url(),address,{...selection,label});cache.set(address,point);cache.set(addressSearch(address).original,point);return point;
}
export function addressValidationFailure(query,error){
 const ambiguous=['SAME_ADDRESS_DUPLICATES','MULTIPLE_LOCATIONS'].includes(error.reason);
 return {query,status:error.code==='ADDRESS_NOT_FOUND'&&error.reason!=='SEARCH_REFRESH_FAILED'?(ambiguous?'ambiguous':'not_found'):'network_error',issue:String(error.message??'주소 검색 응답을 확인하지 못했습니다.').split('\n')[0].slice(0,300),reason:error.reason??error.code??error.name,candidates:error.candidateSummaries??[],...(error.httpStatus?{httpStatus:error.httpStatus}:{}),...(error.searchDiagnostics?{addressDiagnostics:error.searchDiagnostics}:{}),measuredAt:new Date().toISOString()};
}
export async function browserValidateAddress(page,address,{checkActive=async()=>{},addressCache=new Map(),routeContext={}}={}){
 const query=address.trim();if(!query||query.length>300)throw Error('검증할 주소를 1~300자로 입력해 주세요.');
 await checkActive();
 try{
  const cached=cachedPoint(query,addressCache);let point,source='naver';
  if(cached){point=naverPointFromUrl('https://map.naver.com/p/directions/'+cached.token+'/-/-/car',query,cached);source='cache';}
  else{
   if(!routeContext.validationReady){await openCarDirections(page);routeContext.validationReady=true;}
   point=await resolveAddressPoint(page,page.getByRole('combobox').first(),query,addressCache,{checkActive});
  }
  return {query,status:'valid',source,point,confirmedAddress:point.text.split('\n').map(s=>s.trim()).find(s=>addressCandidateMatches(addressSearch(query),s))||point.text,measuredAt:new Date().toISOString()};
 }catch(error){if(error.code==='CAPTURE_PAUSED')throw error;return addressValidationFailure(query,error);}
}
export async function openCarDirections(page){
 await page.goto('https://map.naver.com/p/directions/-/-/-/car',{waitUntil:'load',timeout:45000});
 await page.getByRole('tab',{name:'자동차',exact:true}).click();
 await page.getByRole('combobox').first().waitFor({state:'visible'});
}
export async function browserDistance(page,origin,address,{diagnostic=false}={}){
 page.setDefaultTimeout(30000);
 try{
  await openCarDirections(page);
  for(const [label,value] of [['출발지 입력',origin],['도착지 입력',address]]){
   const input=page.getByRole('combobox',{name:label,exact:true});
   await selectAddress(page,input,value);
   const position=label==='출발지 입력'?3:4;
   await page.waitForURL(url=>{const value=url.pathname.split('/')[position];return !!value&&value!=='-';});
   // Route selection replaces the React input panel; let that transition finish before filling the next field.
   await page.waitForTimeout(700);
  }
  await page.getByRole('button',{name:'길찾기',exact:true}).click();
  const card=page.locator('.route_summary_box').filter({hasText:/거리\s*우선/});await card.waitFor({state:'visible',timeout:45000});
  const result=distanceFromCard(await card.innerText());
  return {...result,...regionFromAddress(address),measuredAt:new Date().toISOString()};
 }catch(e){
  if(diagnostic)throw e;
  if(e.code==='ADDRESS_NOT_FOUND')throw e;
  if(/도로명|거리우선|주행거리/.test(e.message)&&!e.message.includes('Call log'))throw e;
  throw Error('네이버 지도 조회 확인 필요: 접근 제한 또는 거리우선 결과 미표시');
 }
}

export async function browserCourseCapture(page,stops,{screenshot=true,captureIf,checkActive=async()=>{},addressCache=new Map(),routeContext={}}={}) {
 if(!Array.isArray(stops)||stops.length<3||stops.length>7||stops.some(s=>typeof s!=='string'||!s.trim()||s.length>300))throw Error('코스 주소 또는 경유지 한도 확인 필요');
 const started=performance.now(),timings={addressResolutionMs:0,searchRefreshMs:0,routeRequestMs:0,optionCompareMs:0,captureMs:0,addressQueries:0,addressCacheHits:0,routeRequests:0,networkAddressRequests:0};
 const countRequest=request=>{try{const path=new URL(request.url()).pathname;if(path==='/p/api/directions/car')timings.routeRequests++;if(path==='/p/api/search/instant-search')timings.networkAddressRequests++;}catch{}};
 page.on('request',countRequest);let watchRoute;
 try{
 page.setDefaultTimeout(30000);
 await page.setViewportSize({width:1280,height:1800});
 const addressStarted=performance.now();let resolving=false;
 for(const [i,address] of stops.entries()) {
  await checkActive();
  if(cachedPoint(address,addressCache)){timings.addressCacheHits++;continue;}
  if(!resolving){
   await openCarDirections(page);resolving=true;
  }
  try{
   await resolveAddressPoint(page,page.getByRole('combobox').first(),address,addressCache,{checkActive,timings});
  }
  catch(e){if(e.code==='ADDRESS_NOT_FOUND')e.message=`${i+1}번째 방문지: ${e.message}`;throw e;}
 }
 timings.addressResolutionMs=performance.now()-addressStarted;
 // Keep logical visits and later center returns; only fold adjacent exact coordinates.
 if(!naverCourseUrl(stops,addressCache))throw Error('방문지 입력 누락 확인 필요');
 const plan=consecutivePointPlan(stops,stops.map(s=>cachedPoint(s,addressCache))),mapStops=plan.mapStops,folded=mapStops.length!==stops.length;
 if(mapStops.length<2)throw Error('모든 방문지가 동일한 좌표여서 네이버 주행 경로를 표시할 수 없습니다.');
 const url=naverCourseUrl(mapStops,addressCache);
 const routeStarted=performance.now(),navigation={startedAt:Date.now(),frame:page.mainFrame(),url};let revision=0;const responses=new Set();
 const matches=response=>{try{return naverCourseRequestMatches(response.request(),mapStops,addressCache,navigation);}catch{return false;}};
 watchRoute=response=>{if(matches(response)&&!responses.has(response.request())){responses.add(response.request());revision++;}};
 page.on('response',watchRoute);
 const routeResponse=page.waitForResponse(matches,{timeout:45000}).then(async response=>{
  if(!response.ok())throw await providerFailure(response,undefined,'route');
  const settings=routeSettings(response.url());if(routeContext.settings&&routeSettingsKey(routeContext.settings)!==routeSettingsKey(settings))throw Object.assign(Error('저장된 비교와 차량·주행 옵션이 다릅니다. 기존 진행은 보존했습니다.'),{code:'OPTIMIZATION_SETTINGS_CHANGED'});routeContext.settings=settings;
  return decodeNaverDirections(await response.body());
 }).catch(error=>({error}));
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 const cards=page.locator('.direction_summary_list .route_summary_box');
 // A provider rejection must not be hidden by the panel's later timeout.
 const raw=await routeResponse;if(raw.error)throw raw.error;
 try{await cards.first().waitFor({state:'visible',timeout:45000});}catch(error){
  error.routeDiagnostics={stage:'route-panel',responseStatus:200,rawRouteCount:raw.routes.length,rawOptionCount:raw.options.length};
  try{error.routeDiagnostics.visibleCards=await cards.count();const text=await page.locator('body').innerText();error.routeDiagnostics.uiIndicators={sameAdjacent:/동일한\s*장소가\s*연속/.test(text),access:/접근.{0,8}제한|Access Denied|요청이.{0,8}차단/i.test(text),captcha:/자동입력\s*방지|captcha/i.test(text),noRoute:/경로.{0,20}(?:없|찾을 수 없)/.test(text)};}catch{}
  if(error.routeDiagnostics.uiIndicators?.access||error.routeDiagnostics.uiIndicators?.captcha)Object.assign(error,{code:'NAVER_ROUTE_UNAVAILABLE',reason:'PROVIDER_ACCESS_RESTRICTED',httpStatus:200});
  throw error;
 }
 if(revision!==1)throw Error('네이버 경로 응답이 변경되어 동일 결과 검증을 중단했습니다.');const measuredRevision=revision;
 timings.routeRequestMs=performance.now()-routeStarted;
 const mapResolvedStops=await page.getByRole('combobox').evaluateAll(es=>es.map(e=>e.value));
 if(mapResolvedStops.length!==mapStops.length||mapResolvedStops.some((label,i)=>label.trim()!==cachedPoint(mapStops[i],addressCache).label))throw Error('네이버 경유지 입력 순서 확인 필요');
 const resolvedStops=stops.map(address=>cachedPoint(address,addressCache).label);
 const optionStarted=performance.now();
 const rendered=await cards.evaluateAll(es=>es.map(e=>({routeLabel:e.querySelector('.summary_label_text')?.textContent?.trim()||'',distanceText:e.querySelector('.item_distance')?.textContent?.trim()||''})));
 const expand=options=>options.map(option=>folded?{...option,legDistancesMeters:expandLogicalLegs(option.legDistancesMeters,plan.logicalToMap)}:option);
 const routeOptions=expand(matchNaverRouteOptions(raw,rendered,mapStops.length));
 const selected=shortestRouteOption(routeOptions),card=cards.nth(selected.index);
 await card.click();
 await page.mouse.move(1100,1700);
 try {await page.waitForFunction(index=>{
  const el=document.querySelectorAll('.route_summary_box')[index];
  const item=el?.closest('[role="button"]');return item?.getAttribute('aria-pressed')==='true';
 },selected.index,{timeout:10000});}catch{throw Error('네이버 최단 표시거리 경로 선택 확인 필요');}
 await checkActive();
 const current=shortestRouteOption(expand(matchNaverRouteOptions(raw,await cards.evaluateAll(es=>es.map(e=>({routeLabel:e.querySelector('.summary_label_text')?.textContent?.trim()||'',distanceText:e.querySelector('.item_distance')?.textContent?.trim()||''}))),mapStops.length)));
 if(current.index!==selected.index||current.distanceKm!==selected.distanceKm||current.routeLabel!==selected.routeLabel)throw Error('네이버 경로 옵션이 갱신되어 다시 조회해야 합니다.');
 const {index,...distance}=selected;
 timings.optionCompareMs=performance.now()-optionStarted;
 const chosen=routeOptions[index],legEvidence={source:'naver-same-route-response',verified:chosen.legsVerified,distancesMeters:chosen.legDistancesMeters,totalMeters:chosen.distanceMeters,rawRouteIndex:chosen.rawRouteIndex,pathIdentity:chosen.pathIdentity,providerOption:chosen.providerOption,...(chosen.legIssue?{issue:chosen.legIssue}:{})};
 if(folded)legEvidence.logicalPointMapping={mapStops,logicalToMap:plan.logicalToMap,coordinates:stops.map(s=>cachedPoint(s,addressCache).coordinates),mapDistancesMeters:raw.routes[chosen.rawRouteIndex].legDistancesMeters};
 const result={...distance,distanceMeters:chosen.distanceMeters,legEvidence,routeOptions,method:'naver-map-display',requestedStops:[...stops],resolvedStops,confirmedAddresses:stops.map(address=>cachedPoint(address,addressCache).text.split('\n').map(line=>line.trim()).find(line=>addressCandidateMatches(addressSearch(address),line))||cachedPoint(address,addressCache).text),sourceUrl:page.url(),measuredAt:new Date().toISOString(),timings,requestSettings:routeContext.settings};
 if(revision!==measuredRevision)throw Error('네이버 경로 응답이 변경되어 동일 결과 검증을 중단했습니다.');
 timings.totalMs=performance.now()-started;
 if(!screenshot&&!captureIf?.(result))return result;
 const captureStarted=performance.now();
 // Use the actual Naver result panel, including its filled stop list and all route alternatives.
 const panel=await card.evaluateHandle((el,stopsCount)=>{
  let node=el;
  while(node.parentElement) {
   if(node.querySelectorAll('[role="combobox"]').length===stopsCount && node.getBoundingClientRect().width<700)return node;
   node=node.parentElement;
  }
  return null;
 },mapStops.length);
 const element=panel.asElement();if(!element)throw Error('네이버 코스 결과 패널을 확인하지 못했습니다.');
 await element.evaluate(el=>{for(const node of [el,...el.querySelectorAll('*')]){const style=getComputedStyle(node);if(['auto','scroll'].includes(style.overflowY)){node.style.maxHeight='none';node.style.height='auto';node.style.overflowY='visible';}}});
 const box=await element.boundingBox();
 const bottom=await page.locator('.direction_summary_list > li').last().evaluate(el=>el.getBoundingClientRect().bottom);
 if(!box||box.width>700||bottom-box.y<400||bottom-box.y>8000)throw Error('네이버 캡처 영역 확인 필요');
 const png=await page.screenshot({type:'png',clip:{x:box.x,y:Math.max(0,box.y),width:box.width,height:bottom-Math.max(0,box.y)+12},timeout:30000});
 if(revision!==measuredRevision)throw Error('네이버 경로 응답이 변경되어 동일 결과 검증을 중단했습니다.');
 timings.captureMs=performance.now()-captureStarted;timings.totalMs=performance.now()-started;
 return {...result,png,sourceUrl:page.url(),measuredAt:new Date().toISOString()};
 }finally{page.off('request',countRequest);if(watchRoute)page.off('response',watchRoute);}
}
