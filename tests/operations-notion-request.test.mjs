import assert from 'node:assert/strict';
import {editRequestId} from '../supabase/functions/operations-notion/sync.js';
const page={id:'page-id',last_edited_time:'2026-10-11T00:00:00Z',last_edited_by:{id:'editor'}};
const first=await editRequestId(page,{status:'pending'},1);
assert.equal(await editRequestId(page,{status:'pending'},1),first);
assert.notEqual(await editRequestId(page,{status:'completed'},1),first,'Different changes inside the same Notion timestamp must not reuse a request');
assert.notEqual(await editRequestId(page,{status:'pending'},2),first,'A later server version is a distinct change');
assert.match(first,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
console.log('PASS: deterministic retry ID, same-timestamp distinct edits, server version and valid UUID');
