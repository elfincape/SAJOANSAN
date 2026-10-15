const repository=process.env.GITHUB_REPOSITORY,token=process.env.GH_TOKEN;
if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!token)throw Error('Worker handoff settings missing');
const response=await fetch('https://api.github.com/repos/'+repository+'/actions/workflows/naver-browser-server.yml/dispatches',{
 method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
 body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(30000)
});
if(!response.ok)throw Error('Worker continuation failed: HTTP '+response.status);
console.log('Next server browser worker requested successfully');
