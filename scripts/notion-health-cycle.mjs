export async function syncManagementTargets(request,center) {
  const summary={processed:0,created:0,updated:0,closed:0,conflicts:0};
  let cursor=null;
  for(let batch=0;batch<50000;batch++) {
    const data=await request('sync',{center,cursor});
    if(data.center!==center || typeof data.hasMore!=='boolean' ||
      Object.keys(summary).some(key=>!Number.isInteger(data[key])||data[key]<0))
      throw new Error('Management sync response was invalid.');
    for(const key of Object.keys(summary))summary[key]+=data[key];
    if(!data.hasMore)return summary;
    if(typeof data.nextCursor!=='string'||!data.nextCursor||data.nextCursor===cursor)
      throw new Error('Management sync cursor did not advance.');
    cursor=data.nextCursor;
  }
  throw new Error('Management sync scan limit reached.');
}
export async function cycleRequest(fetcher,url,headers,action,body,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  for(let attempt=0;attempt<5;attempt++) {
    const response=await fetcher(url+'/'+action,{
      method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(140000)});
    const data=await response.json().catch(()=>({}));
    if(response.ok)return data;
    if(response.status===409 && data.code==='sync_busy' && attempt<4) {
      await wait((attempt+1)*3000);continue;
    }
    // Avoid repeating any uncertain write; the next scheduled run will reconcile it.
    throw new Error('Notion '+action+' failed ('+(data.code || response.status)+').');
  }
}
