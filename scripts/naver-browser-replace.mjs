const repository=process.env.GITHUB_REPOSITORY,current=process.env.GITHUB_RUN_ID,token=process.env.GH_TOKEN;
if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!/^\d+$/.test(current||'')||!token)throw Error('Server replacement settings missing');
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const response=await fetch('https://api.github.com/repos/'+repository+'/actions/workflows/naver-browser-server.yml/runs?per_page=30',{headers,signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Server replacement check failed: HTTP '+response.status);
const data=await response.json();
for(const run of data.workflow_runs){
 if(String(run.id)===current||run.head_branch!=='main'||run.status==='completed')continue;
 const result=await fetch('https://api.github.com/repos/'+repository+'/actions/runs/'+run.id+'/force-cancel',{method:'POST',headers,signal:AbortSignal.timeout(30000)});
 if(!result.ok&&result.status!==409)throw Error('Older server cancellation failed: HTTP '+result.status);
}
console.log('Older server replacements requested');
