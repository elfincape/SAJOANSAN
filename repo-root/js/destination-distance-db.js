export const CENTER_ORIGINS={'001':'경기도 안산시 단원구 성곡로 125','002':'경기도 평택시 산단로 263'};
export async function centerDestinations(client,center){
 if(!CENTER_ORIGINS[center])throw Error('센터를 확인해 주세요.');const rows=[];
 for(let offset=0;;offset+=500){
  const {data,error}=await client.from('delivery_points').select('id,code,name,address').eq('center_code',center).order('name').order('id').range(offset,offset+499);
  if(error)throw Error('납품처 조회 실패: '+error.message);
  rows.push(...data.map(d=>{const address=String(d.address??'').trim();return {sourceRow:rows.length+data.indexOf(d)+1,name:d.name??'',address:/^#(?:N\/?A|VALUE!?|REF!?|DIV\/0!?)/i.test(address)?'':address,issue:!address||address.startsWith('#')?'주소 확인 필요':''};}));
  if(data.length<500)break;if(rows.length>=20000)throw Error('20,000개 이하로 조회해 주세요.');
 }
 if(!rows.length)throw Error('센터에 등록된 납품처가 없습니다.');return rows;
}
