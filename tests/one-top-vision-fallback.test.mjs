import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../repo-root/admin/one-top-two-room-work.html',import.meta.url),'utf8');

assert.match(source,/const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'/,'Haiku 4.5 must remain the default model');
assert.match(source,/const OPUS_FALLBACK_MODEL = 'claude-opus-5'/,'Opus 5 fallback model must be explicit');
assert.match(source,/const VISION_MAX_WIDTH = 1600/,'vision image width should be capped at 1600px');
assert.match(source,/const VISION_MAX_BYTES = 1024 \* 1024/,'vision image should be capped at 1MB');
assert.doesNotMatch(source,/VISION_MAX_HEIGHT = 200|VISION_MAX_BYTES = 100 \* 1024/,'legacy 300x200/100KB vision compression must be removed');
assert.match(source,/findMissingReceiptFields\(result\)/,'all required receipt fields should be validated');
assert.match(source,/const temperatureMissing=record\?\.a==null&&record\?\.b==null/,'single-channel receipts should pass when either A or B temperature exists');
assert.doesNotMatch(source,/record\?\.a==null\?'A 온도'|record\?\.b==null\?'B 온도'/,'an absent second channel must not trigger Opus fallback');
assert.match(source,/err\.code='VISION_JSON_INVALID'/,'invalid model JSON should trigger fallback');
assert.match(source,/callVisionWithRateLimitRetry\(dataUrl,index,total,OPUS_FALLBACK_MODEL\)/,'incomplete Haiku results should be retried with Opus 5');
assert.match(source,/const EXCEL_IMAGE_MAX_WIDTH = 960;[\s\S]*const EXCEL_IMAGE_MAX_BYTES = 200 \* 1024/,'Excel image compression settings must remain unchanged');

console.log('one-top vision image and Opus fallback checks passed');
