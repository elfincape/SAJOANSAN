const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token,GITHUB_TOKEN:github,GITHUB_REPOSITORY:repo,GITHUB_RUN_ID:own}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const management='https://api.supabase.com/v1/projects/'+ref;
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
async function api(path,body){
 const r=await fetch(management+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('Pause operation failed HTTP '+r.status);return r;
}
if(github&&repo){
 const ghHeaders={Authorization:'Bearer '+github,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 for(const status of ['in_progress','queued']){
  const r=await fetch('https://api.github.com/repos/'+repo+'/actions/runs?status='+status+'&per_page=100',{headers:ghHeaders});
  if(!r.ok)throw Error('Cannot list running sync jobs HTTP '+r.status);
  for(const run of (await r.json()).workflow_runs||[]){
   if(String(run.id)===own||!/^\.github\/workflows\/(deploy-notion-(health|graph|points)|notion-health-completion)\.yml$/.test(run.path))continue;
   const cancelled=await fetch('https://api.github.com/repos/'+repo+'/actions/runs/'+run.id+'/cancel',{method:'POST',headers:ghHeaders});
   if(!cancelled.ok&&cancelled.status!==409)throw Error('Cannot cancel sync job HTTP '+cancelled.status);
   console.log('Cancelled Notion workflow '+run.id);
  }
 }
}
await api('/secrets',[{name:'NOTION_SYNC_PAUSED',value:'true'}]);
const sql=`do $pause$
begin
 if to_regclass('cron.job') is not null then
  update cron.job set active=false where jobname like 'notion-%';
 end if;
end $pause$;
select jobname,active from cron.job where jobname like 'notion-%';`;
const jobs=await (await api('/database/query',{query:sql})).json();
if(jobs.some(j=>j.active!==false))throw Error('Notion scheduled jobs still active');
console.log('Notion scheduled jobs paused',JSON.stringify(jobs));
