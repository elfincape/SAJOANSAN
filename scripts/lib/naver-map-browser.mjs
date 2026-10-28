export function distanceFromCard(text){
 if(!/거리\s*우선/.test(text))throw Error('거리우선 항목을 확인하지 못했습니다.');
 const match=text.split(/거리\s*우선/)[1].match(/([\d,]+(?:\.\d+)?)\s*(km|m)(?![a-z])/i);
 if(!match)throw Error('거리우선 주행거리를 읽지 못했습니다.');
 const value=Number(match[1].replaceAll(',',''))/(match[2].toLowerCase()==='m'?1000:1);
 if(!Number.isFinite(value)||value<0)throw Error('거리우선 주행거리 확인 필요');
 return {distanceKm:value,distanceText:match[0].replace(/\s/g,''),routeLabel:'거리우선',method:'naver-map-display'};
}
export function regionFromAddress(address){
 const parts=String(address).trim().split(/\s+/),province=parts[0]||'';
 const local=/^서울/.test(province)?parts.find(p=>/구$/.test(p)):parts.find(p=>/(시|군)$/.test(p));
 return local?{region:/^서울/.test(province)?'서울 '+local:local,regionKey:province.replace(/경기$/, '경기도')+'|'+local}:{region:'',regionKey:''};
}
export function addressSearch(value){
 const road=String(value).match(/([가-힣\d]+(?:대로|로)(?:\s*\d+(?:번|가|나|다|라)?길)?|[가-힣\d]+길)\s*,?\s*(\d+(?:-\d+)?)/);
 const city=String(value).match(/([가-힣]+(?:시|군))/)?.[1]?.replace(/특별자치시|특별시|광역시/,'')||'';
 const gu=/서울/.test(city)?String(value).match(/([가-힣]+구)/)?.[1]:'';
 if(!road)return {queries:[String(value).split(/[,(]/)[0].trim()],city,gu,road:null};
 const street=road[1].replace(/\s/g,''),number=road[2],short=street+' '+number;
 return {queries:[...new Set([String(value).slice(0,road.index+road[0].length).trim(),city+' '+short,short])],city,gu,road:{street,number}};
}
export async function browserDistance(page,origin,address,{diagnostic=false}={}){
 page.setDefaultTimeout(30000);
 try{
  await page.goto('https://map.naver.com/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('button',{name:'길찾기',exact:true}).click();
  await page.getByRole('tab',{name:'자동차',exact:true}).click();
  for(const [label,value] of [['출발지 입력',origin],['도착지 입력',address]]){
   const input=page.getByRole('combobox',{name:label,exact:true}),search=addressSearch(value);
   const options=page.locator('[id^="instant-search-item-poi-"]');
   let suggestion=null;
   for(const text of search.queries){
    await input.fill(text);
    const candidate=options.filter({hasText:search.city||/.*/}).filter({hasText:search.gu||/.*/}).filter({hasText:search.road?new RegExp(search.road.street.split('').join('\\s*')+'\\s*'+search.road.number+'(?:\\D|$)'):/.*/}).first();
    try{await candidate.waitFor({state:'visible',timeout:5000});suggestion=candidate;break;}catch{}
   }
   if(!suggestion){const error=Error('주소 검색 결과 확인 필요');error.code='ADDRESS_NOT_FOUND';throw error;}
   await suggestion.click();
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

export async function browserCourseCapture(page,stops) {
 if(!Array.isArray(stops)||stops.length<3||stops.length>7||stops.some(s=>typeof s!=='string'||!s.trim()||s.length>300))throw Error('코스 주소 또는 경유지 한도 확인 필요');
 page.setDefaultTimeout(30000);
 await page.setViewportSize({width:1280,height:1800});
 await page.goto('https://map.naver.com/',{waitUntil:'domcontentloaded',timeout:45000});
 await page.getByRole('button',{name:'길찾기',exact:true}).click();
 await page.getByRole('tab',{name:'자동차',exact:true}).click();
 for(let n=0;n<stops.length-2;n++){await page.getByRole('button',{name:'경유지',exact:true}).click();await page.waitForFunction(count=>document.querySelectorAll('[role=combobox]').length===count,n+3);}
 if(await page.getByRole('combobox').count()!==stops.length)throw Error('네이버 경유지 입력 개수 확인 필요');
 for(const [i,address] of stops.entries()) {
  const search=addressSearch(address);let found=false;
  for(const query of search.queries) {
   await page.getByRole('combobox').nth(i).fill(query);
   let candidates=page.locator('[id^="instant-search-item-poi-"]');
   if(search.city)candidates=candidates.filter({hasText:search.city});
   if(search.gu)candidates=candidates.filter({hasText:search.gu});
   if(search.road)candidates=candidates.filter({hasText:new RegExp(search.road.street.split('').join('\\s*')+'\\s*'+search.road.number+'(?:\\D|$)')});
   else candidates=candidates.filter({hasText:address});
   try {await candidates.first().waitFor({state:'visible',timeout:5000});}catch{continue;}
   if(await candidates.count()!==1)continue;
   await candidates.click();await page.waitForTimeout(700);found=true;break;
  }
  if(!found)throw Object.assign(Error(`${i+1}번째 방문지 주소를 한 곳으로 특정하지 못했습니다.`),{code:'ADDRESS_NOT_FOUND'});
 }
 if((await page.getByRole('combobox').evaluateAll(es=>es.map(e=>e.value))).some(v=>!v.trim()))throw Error('방문지 입력 누락 확인 필요');
 await page.getByRole('button',{name:'길찾기',exact:true}).click();
 const card=page.locator('.route_summary_box').filter({hasText:/거리\s*우선/});
 await card.waitFor({state:'visible',timeout:45000});
 await card.click();
 await page.mouse.move(1100,1700);await page.waitForTimeout(700);
 try {await page.waitForFunction(()=>{
  const el=[...document.querySelectorAll('.route_summary_box')].find(el=>/거리\s*우선/.test(el.textContent));
  const item=el?.closest('[role="button"]');return item?.getAttribute('aria-pressed')==='true';
 },null,{timeout:10000});}catch{throw Error('거리우선 경로 선택 확인 필요');}
 const result=distanceFromCard(await card.innerText());
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
