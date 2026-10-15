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
