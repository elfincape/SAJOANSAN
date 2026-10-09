import {batch as pointBatch,dbClient,pointsNotionClient} from '../notion-points/sync.js';
import {batch} from './sync.js';
import {summaryBatch} from './summary.js';
import {fail,plain} from './model.js';
export async function verifyRoundTrip(env,key,center,fetcher=fetch){
  const db=dbClient(env,key,fetcher),request=pointsNotionClient(env,fetcher),token=crypto.randomUUID();
  if(await db('rpc/notion_points_acquire','POST',{p_token:token})!==true)throw fail('다른 동기화가 진행 중입니다.',409,'sync_busy');
  const id=crypto.randomUUID(),driver2=crypto.randomUUID(),ids={companies:[id],drivers:[id,driver2],routes:[id],points:[id]},pages=[];
  const scope='&center_code=eq.'+center,opts={lockToken:token},name=(kind,n)=>'[관계 검증] '+kind+' '+n;
  const sync=async(kind,n=id)=>{const r=await batch(env,key,{kind,center,id:n},fetcher,opts);if(r.conflicts)throw fail('관계 검증 중 충돌이 발생했습니다.',502,'graph_probe_failed');};
  const state=async(kind,n=id)=>(await db((kind==='points'?'notion_points_state':'notion_graph_state')+'?select=notion_id&web_id=eq.'+n+scope+(kind==='points'?'':'&kind=eq.'+kind)))[0]?.notion_id;
  const assert=(ok)=>{if(!ok)throw fail('관계 양방향 검증에 실패했습니다.',502,'graph_probe_failed');};
  try{
    await db('delivery_points','POST',{id,center_code:center,name:name('points',id),code:'SYNCGRAPH-'+id,photos:[],memo:'graph-probe'});
    await pointBatch(env,key,{center,id},fetcher,opts);
    await db('companies','POST',{id,center_code:center,name:name('companies',id),memo:'graph-probe'});await sync('companies');
    for(const n of ids.drivers){await db('drivers','POST',{id:n,center_code:center,name:name('drivers',n),company_id:id,memo:'graph-probe'});await sync('drivers',n);}
    await db('routes','POST',{id,center_code:center,name:name('routes',id),car_number:'SYNCGRAPH-'+id,active:true,closed_days:[],company_id:id,primary_driver_id:id});
    await db('route_stops','POST',{route_id:id,delivery_point_id:id,stop_order:1,arrival_text:'09:00',arrival_business_min:540,memo:'graph-stop-probe'});await sync('routes');
    const originalStops=await db('route_stops?select=*&route_id=eq.'+id+'&order=id.asc');
    await db('route_stops?route_id=eq.'+id,'PATCH',{memo:'graph-concurrent-probe'});
    assert(await db('rpc/notion_graph_apply','POST',{p_kind:'routes',p_center:center,p_id:id,p_expected:{_stops:originalStops},p_values:{stops:[]}})===null);
    assert((await db('route_stops?select=memo&route_id=eq.'+id))[0]?.memo==='graph-concurrent-probe');
    await db('route_stops?route_id=eq.'+id,'PATCH',{memo:'graph-stop-probe'});
    const routePage=await state('routes'),pointPage=await state('points'),a=await state('drivers'),b=await state('drivers',driver2);
    await request('pages/'+routePage,'PATCH',{properties:{'주기사':{relation:[{id:b}]}}});await sync('routes');
    assert((await db('routes?select=primary_driver_id&id=eq.'+id+scope))[0]?.primary_driver_id===driver2);
    await request('pages/'+routePage,'PATCH',{properties:{'납품처':{relation:[]}}});await sync('routes');
    assert((await db('route_stops?select=id&route_id=eq.'+id)).length===0);
    await request('pages/'+routePage,'PATCH',{properties:{'납품처':{relation:[{id:pointPage}]}}});await sync('routes');
    const restored=(await db('route_stops?select=arrival_text,arrival_business_min,memo&route_id=eq.'+id))[0];
    assert(restored?.arrival_text==='09:00'&&restored.arrival_business_min===540&&restored.memo==='graph-stop-probe');
    await db('routes?id=eq.'+id+scope,'PATCH',{primary_driver_id:id});await sync('routes');
    assert((await request('pages/'+routePage)).properties['주기사'].relation[0]?.id===a);
    for(const kind of ['companies','drivers']){
      const page=await state(kind);await request('pages/'+page,'PATCH',{properties:{'비고':{rich_text:[{text:{content:'graph-pull'}}]}}});await sync(kind);
      assert((await db(kind+'?select=memo&id=eq.'+id+scope))[0]?.memo==='graph-pull');
      await db(kind+'?id=eq.'+id+scope,'PATCH',{memo:'graph-push'});await sync(kind);
      assert(plain((await request('pages/'+page)).properties['비고'])==='graph-push');
    }
    for(const kind of ['routes','points']){
      const r=await summaryBatch(env,key,{kind,center,id},fetcher,opts);assert(r.updated===1&&!r.conflicts);
      const page=await state(kind),blocks=await request('blocks/'+page+'/children?page_size=100');
      const root=blocks.results.find(x=>x.type==='callout');assert(!!root);
      const branches=await request('blocks/'+root.id+'/children?page_size=100');
      assert(branches.results.some(x=>x.bulleted_list_item?.rich_text.some(t=>t.type==='mention')));
    }
    return {verified:true,center,webToNotion:true,notionToWeb:true,stopDetailsPreserved:true,nativeMentions:true,concurrentStopEditsPreserved:true};
  }finally{
    try{
      for(const kind of ['routes','drivers','companies','points'])for(const n of ids[kind]){
        const p=await state(kind,n);if(p){const page=await request('pages/'+p);const title=kind==='points'?'납품처명':kind==='routes'?'코스명':kind==='drivers'?'기사명':'운수사명';
          if(plain(page.properties[title])!==name(kind,n))throw fail('검증 데이터 식별 확인에 실패했습니다.',502,'probe_identity_failed');
          await request('pages/'+p,'PATCH',{in_trash:true});pages.push(p);}
      }
      await db('route_stops?route_id=eq.'+id,'DELETE');
      await db('notion_graph_stop_archive?route_id=eq.'+id+scope,'DELETE');
      for(const kind of ['routes','drivers','companies','points'])for(const n of ids[kind]){
        await db((kind==='points'?'delivery_points':kind)+'?id=eq.'+n+scope+'&name=eq.'+encodeURIComponent(name(kind,n)),'DELETE');
        await db((kind==='points'?'notion_points_state':'notion_graph_state')+'?web_id=eq.'+n+scope+(kind==='points'?'':'&kind=eq.'+kind),'DELETE');
      }
    }finally{await db('rpc/notion_points_release','POST',{p_token:token});}
  }
}
