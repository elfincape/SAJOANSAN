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
export async function browserDistance(page,origin,address){
 page.setDefaultTimeout(30000);
 try{
  await page.goto('https://map.naver.com/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('button',{name:'길찾기',exact:true}).click();
  await page.getByRole('tab',{name:'자동차',exact:true}).click();
  for(const [label,value] of [['출발지 입력',origin],['도착지 입력',address]]){
   const input=page.getByRole('combobox',{name:label,exact:true});await input.fill(value);
   const suggestion=page.locator('[id^="instant-search-item-poi-"]').first();await suggestion.waitFor({state:'visible'});
   const candidate=await suggestion.innerText();
   // Address-only requests must keep the requested road/lot number, rather than choose an unrelated POI.
   const road=value.match(/([가-힣\d]+(?:대로|로|길))\s*(\d+(?:-\d+)?)/);
   if(road&&(!candidate.replace(/\s/g,'').includes(road[1]+road[2])))throw Error('검색된 주소가 요청한 도로명·번지와 다릅니다.');
   await suggestion.click();
  }
  await page.getByRole('button',{name:'길찾기',exact:true}).click();
  const card=page.getByRole('checkbox',{name:/거리\s*우선/});await card.waitFor({state:'visible',timeout:45000});
  const result=distanceFromCard(await card.innerText());
  return {...result,...regionFromAddress(address),measuredAt:new Date().toISOString()};
 }catch(e){
  if(/도로명|거리우선|주행거리/.test(e.message)&&!e.message.includes('Call log'))throw e;
  throw Error('네이버 지도 조회 확인 필요: 접근 제한 또는 거리우선 결과 미표시');
 }
}
