import {query} from './naver-browser-db.mjs';
import {upgradeCaptureContract} from './lib/naver-capture-contract.mjs';
import {readFile} from 'node:fs/promises';
const rows=await query("select pg_get_functiondef(to_regprocedure('public.naver_capture_enqueue(text,jsonb,uuid)')) as definition");
const definition=rows[0]?.definition,updated=upgradeCaptureContract(definition);
if(updated!==definition)await query(updated);
const validation=await query("select pg_get_functiondef(to_regprocedure('public.naver_address_validate_enqueue(text,jsonb,uuid,jsonb)')) as validation,pg_get_functiondef(to_regprocedure('public.naver_capture_validated_enqueue(text,jsonb,uuid,uuid)')) as capture");
if(!validation[0]?.validation?.includes('address-prevalidation-v1')||!validation[0]?.capture?.includes('address-prevalidation-v1'))await query('begin;\n'+await readFile(new URL('../repo-root/sql/naver-address-validation.sql',import.meta.url),'utf8')+'\ncommit;');
console.log('Naver queue validates each rotation separately. Storage policies and execution grants were not reapplied.');
