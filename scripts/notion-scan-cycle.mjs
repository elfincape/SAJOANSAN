// Candidate IDs stay in memory; public logs contain counts only.
export async function candidateCycle(call,center,kind){
  const candidates=new Set(),linked=new Map(),seen=new Set();let scanned=0;
  for(const phase of ['web','notion']){
    let cursor=null,done=false;
    for(let i=0;i<10000;i++){
      const r=await call('scan',{center,kind,phase,cursor});scanned+=r.scanned||0;
      for(const id of r.ids||[])candidates.add(id);
      for(const x of r.linked||[])linked.set(x.id,x.page);
      for(const id of r.seen||[])seen.add(id);
      if(!r.hasMore){done=true;break;}cursor=r.nextCursor;
    }
    if(!done)throw new Error('Candidate scan did not finish');
  }
  for(const [id,page] of linked)if(!seen.has(page))candidates.add(id);
  const totals={processed:0,created:0,updated:0,unchanged:0,imported:0,conflicts:0};
  for(const id of candidates){const r=await call('sync',{center,kind,id,scan:true});for(const k of Object.keys(totals))totals[k]+=r[k]||0;}
  // New Notion pages lack a web UUID; preserve the existing guarded importer.
  let cursor=null,done=false;
  for(let i=0;i<10000;i++){
    const r=await call('sync',{center,kind,phase:'notion',cursor,scan:true});for(const k of Object.keys(totals))totals[k]+=r[k]||0;
    if(!r.hasMore){done=true;break;}cursor=r.nextCursor;
  }
  if(!done)throw new Error('Notion import did not finish');
  return {scanned,candidates:candidates.size,...totals};
}
