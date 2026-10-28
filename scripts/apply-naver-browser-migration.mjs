import {query} from './naver-browser-db.mjs';
import {upgradeCaptureContract} from './lib/naver-capture-contract.mjs';
const rows=await query("select pg_get_functiondef(to_regprocedure('public.naver_capture_enqueue(text,jsonb,uuid)')) as definition");
const definition=rows[0]?.definition,updated=upgradeCaptureContract(definition);
if(updated!==definition)await query(updated);
console.log('Naver queue validates each rotation separately. Storage policies and execution grants were not reapplied.');
