import { database, syncBatch } from './sync.js';
import { completionBatch } from './completion.js';
import { notionError } from './notion-api.js';

// Each invocation resumes durable progress and stays below the free Edge wall limit.
export async function scheduledTick(env,service,fetcher,options={}) {
  const db=options.db || database(env,service,fetcher);
  const token=crypto.randomUUID();
  let state=await db('rpc/notion_health_schedule_claim',{p_token:token});
  if(!state)return {scheduled:true,running:false};
  const start=Date.now(),budget=options.budgetMs ?? 45000;
  let batches=0,retry=0;
  try {
    while(Date.now()-start<budget) {
      const run=state.phase==='sync'?(options.sync || syncBatch):(options.complete || completionBatch);
      const result=await run(env,service,fetcher,{center:state.center_code,cursor:state.cursor});
      if(typeof result.hasMore!=='boolean'||(result.hasMore&&(!result.nextCursor||result.nextCursor===state.cursor)))
        throw notionError('예약 동기화 조회 위치를 확인해 주세요.',502,'scheduled_cursor');
      let phase=state.phase,center=state.center_code,cursor=result.hasMore?result.nextCursor:null;
      if(!result.hasMore) {
        if(phase==='sync')phase='complete';
        else if(center==='001'){center='002';phase='sync';}
        else phase='idle';
      }
      state=await db('rpc/notion_health_schedule_checkpoint',{
        p_token:token,p_center:center,p_phase:phase,p_cursor:cursor
      });
      batches++;
      if(phase==='idle')return {scheduled:true,running:false,completed:true,batches,lastUpdatedAt:state.last_finished_at};
    }
    return {scheduled:true,running:true,batches};
  } catch(error) {
    retry=error.extra?.uncertainWrite?180:60;
    // Successful rows before a failed write do not need to be repeated.
    const cursor=error.extra?.summary?.nextCursor;
    if(state.phase==='sync'&&cursor&&cursor!==state.cursor)
      await db('rpc/notion_health_schedule_checkpoint',{
        p_token:token,p_center:state.center_code,p_phase:state.phase,p_cursor:cursor
      });
    await db('rpc/notion_health_schedule_error',{p_token:token,p_error:error.code || 'scheduled_error'});
    throw error;
  } finally {
    await db('rpc/notion_health_schedule_release',{p_token:token,p_retry:retry});
  }
}
