import {readFile} from 'node:fs/promises';
import {query} from './naver-browser-db.mjs';
await query(await readFile(new URL('../repo-root/sql/naver-browser-jobs.sql',import.meta.url),'utf8'));
await query(await readFile(new URL('../repo-root/sql/naver-course-captures.sql',import.meta.url),'utf8'));
console.log('Authenticated owner-scoped Naver browser queue deployed');
