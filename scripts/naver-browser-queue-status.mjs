import {query} from './naver-browser-db.mjs';
const rows=await query("select status,count(*)::int as jobs,sum(jsonb_array_length(addresses))::int as destinations,sum(cursor)::int as processed,min(created_at) as oldest,max(updated_at) as last_update from public.naver_browser_jobs group by status order by status");
console.log('Server queue status (no customer addresses): '+JSON.stringify(rows));
