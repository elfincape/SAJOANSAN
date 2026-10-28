import {query} from './naver-browser-db.mjs';
const rows=await query("select pg_get_functiondef(to_regprocedure('public.naver_capture_enqueue(text,jsonb,uuid)')) as definition");
const definition=rows[0]?.definition,oldRule="(c->>'sourceRow')::int<2",newRule="(c->>'sourceRow')::int<1";
if(!definition)throw Error('Naver browser initial setup is required before deployment');
if(definition.includes(oldRule)) {
 if(definition.split(oldRule).length!==2)throw Error('Unexpected source-row validation; manual review required');
 await query(definition.replace(oldRule,newRule));
} else if(!definition.includes(newRule))throw Error('Unexpected source-row validation; manual review required');
console.log('Existing Naver queue verified; Excel source rows start at 1. Storage policies and execution grants were not reapplied.');
