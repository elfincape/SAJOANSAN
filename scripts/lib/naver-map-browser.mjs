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
  return {index,routeLabel:option.routeLabel.trim(),distanceKm,distanceText:option.distanceText.replace(/\s/g,'')};
 });
 return parsed.reduce((best,option)=>option.distanceKm<best.distanceKm?option:best);
}
export function regionFromAddress(address){
 const parts=String(address).trim().split(/\s+/),province=parts[0]||'';
 const local=/^서울/.test(province)?parts.find(p=>/구$/.test(p)):parts.find(p=>/(시|군)$/.test(p));
 return local?{region:/^서울/.test(province)?'서울 '+local:local,regionKey:province.replace(/경기$/, '경기도')+'|'+local}:{region:'',regionKey:''};
}
const provinces={서울특별시:'서울',서울:'서울',부산광역시:'부산',부산:'부산',대구광역시:'대구',대구:'대구',인천광역시:'인천',인천:'인천',광주광역시:'광주',광주:'광주',대전광역시:'대전',대전:'대전',울산광역시:'울산',울산:'울산',세종특별자치시:'세종',세종시:'세종',세종:'세종',경기도:'경기',경기:'경기',강원특별자치도:'강원',강원도:'강원',강원:'강원',충청북도:'충북',충북:'충북',충청남도:'충남',충남:'충남',전북특별자치도:'전북',전라북도:'전북',전북:'전북',전라남도:'전남',전남:'전남',경상북도:'경북',경북:'경북',경상남도:'경남',경남:'경남',제주특별자치도:'제주',제주도:'제주',제주:'제주'};
const provincePattern=new RegExp('(?:^|\\s)('+Object.keys(provinces).sort((a,b)=>b.length-a.length).join('|')+')(?:\\s|$)');
const provinceOf=text=>provinces[text.match(provincePattern)?.[1]]||'';
export function addressSearch(value){
 value=String(value).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();
 value=value.replace(/^(경기도|인천광역시|서울특별시)\s+\1\s+/,'$1 ');
 const road=String(value).match(/([가-힣\d]+(?:대로|로)(?:\s*\d+(?:번|가|나|다|라)?길)?|[가-힣\d]+길)\s*,?\s*(\d+(?:-\d+)?)/);
 const city=String(value).match(/([가-힣]+(?:시|군))/)?.[1]?.replace(/특별자치시|특별시|광역시/,'')||'';
 const gu=String(value).match(/(?:^|\s)([가-힣]+구)(?:\s|$)/)?.[1]||'';
 const town=String(value).match(/(?:^|\s)([가-힣]+(?:읍|면))(?:\s|$)/)?.[1]||'';
 const province=provinceOf(value);
 if(!road){
  const parcel=String(value).match(/(?:^|\s)([가-힣\d]+(?:동|리|가))\s*(산\s*)?(\d+(?:-\d+)?)(?:번지)?(?=\s|$|[,()])/);
  const query=String(value).split(/[,(]/)[0].trim();
  return {queries:[...new Set([query,query.replace(/(\d)번지(?=\s|$)/,'$1')])],province,city,gu,town,road:null,parcel:parcel?{land:parcel[1],mountain:!!parcel[2],number:parcel[3]}:null,original:value,addressOnly:!!parcel&&!String(value).slice(parcel.index+parcel[0].length).trim()};
 }
 const street=road[1].replace(/\s/g,''),number=road[2],short=street+' '+number;
 return {queries:[...new Set([String(value).slice(0,road.index+road[0].length).trim(),city+' '+short,short])],province,city,gu,town,road:{street,number},original:value,addressOnly:!String(value).slice(road.index+road[0].length).trim()};
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
export async function selectAddress(page,input,address,{checkActive=async()=>{}}={}){
 const search=addressSearch(address),options=page.locator('[id^="instant-search-item-poi-"]'),reasons=new Set();
 for(const query of search.queries){
  await checkActive();
  await input.fill('');
  try{await page.waitForFunction(()=>document.querySelectorAll('[id^="instant-search-item-poi-"]').length===0,null,{timeout:5000});}catch{reasons.add('SEARCH_REFRESH_FAILED');continue;}
  const refreshed=page.waitForResponse(response=>{try{const url=new URL(response.url());return url.pathname==='/p/api/search/instant-search'&&url.searchParams.get('query')===query;}catch{return false;}},{timeout:8000}).catch(()=>null);
  await input.fill(query);
  const response=await refreshed;
  if(!response?.ok()){reasons.add('SEARCH_REFRESH_FAILED');continue;}
  try{if(await response.finished()){reasons.add('SEARCH_REFRESH_FAILED');continue;}}catch{reasons.add('SEARCH_REFRESH_FAILED');continue;}await checkActive();
  try{await options.first().waitFor({state:'visible',timeout:5000});}catch{reasons.add('SEARCH_NO_CANDIDATES');continue;}
  const candidates=await options.evaluateAll(es=>es.map(e=>({text:e.innerText,addressOnly:!e.querySelector('.place_category,.place_text.sub')})));
  const index=chooseAddressCandidate(search,candidates);
  if(index<0){reasons.add(candidates.filter(c=>addressCandidateMatches(search,c.text)).length>1?'SAME_ADDRESS_DUPLICATES':'MULTIPLE_LOCATIONS');continue;}
  await checkActive();await options.nth(index).click();await page.waitForTimeout(700);return;
 }
 const messages={SAME_ADDRESS_DUPLICATES:'같은 주소의 중복 후보를 안전하게 구분하지 못했습니다. 주소 후보를 확인해 주세요.',MULTIPLE_LOCATIONS:'입력 주소와 다른 위치의 후보가 표시됩니다. 원본 주소와 네이버 결과를 확인해 주세요.',SEARCH_REFRESH_FAILED:'네이버 검색 결과 갱신을 확인하지 못했습니다. 재시도해 주세요.',SEARCH_NO_CANDIDATES:'이번 네이버 자동완성에서 검색 후보를 받지 못했습니다. 직접 검색 결과와 주소를 확인해 주세요.'};
 const reason=Object.keys(messages).find(r=>reasons.has(r))||'SEARCH_NO_CANDIDATES';
 throw Object.assign(Error(messages[reason]),{code:'ADDRESS_NOT_FOUND',reason});
}
export async function browserDistance(page,origin,address,{diagnostic=false}={}){
 page.setDefaultTimeout(30000);
 try{
  await page.goto('https://map.naver.com/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('button',{name:'길찾기',exact:true}).click();
  await page.getByRole('tab',{name:'자동차',exact:true}).click();
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

export async function browserCourseCapture(page,stops,{screenshot=true,checkActive=async()=>{}}={}) {
 if(!Array.isArray(stops)||stops.length<3||stops.length>7||stops.some(s=>typeof s!=='string'||!s.trim()||s.length>300))throw Error('코스 주소 또는 경유지 한도 확인 필요');
 page.setDefaultTimeout(30000);
 await page.setViewportSize({width:1280,height:1800});
 await page.goto('https://map.naver.com/',{waitUntil:'domcontentloaded',timeout:45000});
 await page.getByRole('button',{name:'길찾기',exact:true}).click();
 await page.getByRole('tab',{name:'자동차',exact:true}).click();
 for(let n=0;n<stops.length-2;n++){await page.getByRole('button',{name:'경유지',exact:true}).click();await page.waitForFunction(count=>document.querySelectorAll('[role=combobox]').length===count,n+3);}
 if(await page.getByRole('combobox').count()!==stops.length)throw Error('네이버 경유지 입력 개수 확인 필요');
 for(const [i,address] of stops.entries()) {
  await checkActive();
  try{await selectAddress(page,page.getByRole('combobox').nth(i),address,{checkActive});}
  catch(e){if(e.code==='ADDRESS_NOT_FOUND')e.message=`${i+1}번째 방문지: ${e.message}`;throw e;}
 }
 if((await page.getByRole('combobox').evaluateAll(es=>es.map(e=>e.value))).some(v=>!v.trim()))throw Error('방문지 입력 누락 확인 필요');
 await page.getByRole('button',{name:'길찾기',exact:true}).click();
 const cards=page.locator('.route_summary_box');
 await cards.first().waitFor({state:'visible',timeout:45000});
 const routeOptions=await cards.evaluateAll(es=>es.map(e=>({routeLabel:e.querySelector('.summary_label_text')?.textContent?.trim()||'',distanceText:e.querySelector('.item_distance')?.textContent?.trim()||''})));
 const selected=shortestRouteOption(routeOptions),card=cards.nth(selected.index);
 await card.click();
 await page.mouse.move(1100,1700);await page.waitForTimeout(700);
 try {await page.waitForFunction(index=>{
  const el=document.querySelectorAll('.route_summary_box')[index];
  const item=el?.closest('[role="button"]');return item?.getAttribute('aria-pressed')==='true';
 },selected.index,{timeout:10000});}catch{throw Error('네이버 최단 표시거리 경로 선택 확인 필요');}
 await checkActive();
 const current=shortestRouteOption(await cards.evaluateAll(es=>es.map(e=>({routeLabel:e.querySelector('.summary_label_text')?.textContent?.trim()||'',distanceText:e.querySelector('.item_distance')?.textContent?.trim()||''}))));
 if(current.index!==selected.index||current.distanceKm!==selected.distanceKm||current.routeLabel!==selected.routeLabel)throw Error('네이버 경로 옵션이 갱신되어 다시 조회해야 합니다.');
 const {index,...distance}=selected;
 const result={...distance,routeOptions,method:'naver-map-display',requestedStops:[...stops],resolvedStops:await page.getByRole('combobox').evaluateAll(es=>es.map(e=>e.value)),sourceUrl:page.url(),measuredAt:new Date().toISOString()};
 if(!screenshot)return result;
 // Use the actual Naver result panel, including its filled stop list and all route alternatives.
 const panel=await card.evaluateHandle((el,stopsCount)=>{
  let node=el;
  while(node.parentElement) {
   if(node.querySelectorAll('[role="combobox"]').length===stopsCount && node.getBoundingClientRect().width<700)return node;
   node=node.parentElement;
  }
  return null;
 },stops.length);
 const element=panel.asElement();if(!element)throw Error('네이버 코스 결과 패널을 확인하지 못했습니다.');
 await element.evaluate(el=>{for(const node of [el,...el.querySelectorAll('*')]){const style=getComputedStyle(node);if(['auto','scroll'].includes(style.overflowY)){node.style.maxHeight='none';node.style.height='auto';node.style.overflowY='visible';}}});
 const box=await element.boundingBox();
 const bottom=await page.locator('.direction_summary_list > li').last().evaluate(el=>el.getBoundingClientRect().bottom);
 if(!box||box.width>700||bottom-box.y<400||bottom-box.y>8000)throw Error('네이버 캡처 영역 확인 필요');
 const png=await page.screenshot({type:'png',clip:{x:box.x,y:Math.max(0,box.y),width:box.width,height:bottom-Math.max(0,box.y)+12},timeout:30000});
 return {...result,png,sourceUrl:page.url(),measuredAt:new Date().toISOString()};
}
