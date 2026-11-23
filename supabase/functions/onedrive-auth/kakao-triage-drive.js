import { inspectMailImage, MAIL_PHOTO_LIMITS } from './private-mail-images.js';

// Graph item IDs of the owner-selected collection. No sharing URL or guest token is stored.
const DRIVE = 'b!RsJN71IJ_Em20vLeVEYKc09qMOVIbb5Li8pf6TYEdFEUqncntoeKT5tQnLcDCT93';
const ROOT = '016FTHNDSYCVGQNJWFZNFK4AIK5AORUQ2J';
const FOLDERS = { batches: '016FTHNDTWL2CTDPUHBJFJX4YJEZIT3YT2', images: '016FTHNDXBCFK4PHC7RNAIA72N5UO7RIAR' };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SELECT = 'id,name,folder,file,remoteItem,parentReference,size,eTag';
const graphPath = id => '/drives/' + encodeURIComponent(DRIVE) + '/items/' + encodeURIComponent(id);
const invalid = (message, status = 409) => Object.assign(new Error(message), { status });

export function kakaoTriageOptions(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['cursor', 'batchId'].includes(key)) ||
      (body.cursor != null && (typeof body.cursor !== 'string' || !body.cursor.length || body.cursor.length > 8192)) ||
      (body.batchId != null && (typeof body.batchId !== 'string' || !UUID.test(body.batchId))) ||
      (body.cursor != null && body.batchId != null)) {
    throw invalid('카톡 수집 묶음 또는 페이지 위치를 확인해 주세요.', 400);
  }
  return body;
}

function ownedItem(item, parent, name) {
  return item && !item.remoteItem && item.parentReference?.driveId === DRIVE &&
    item.parentReference.id === parent && item.name === name && typeof item.id === 'string' && item.id.length > 0;
}

async function readFile(response, size) {
  const stream = response.body?.getReader();
  if (!stream) throw invalid('원본 파일을 읽을 수 없습니다.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await stream.read();
      if (done) break;
      if (value.length > size - offset) {
        await stream.cancel();
        throw invalid('원본 파일 크기가 변경됐습니다.');
      }
      bytes.set(value, offset);
      offset += value.length;
    }
  } finally {
    stream.releaseLock();
  }
  if (offset !== size) throw invalid('원본 파일 크기가 변경됐습니다.');
  return bytes;
}

export function createKakaoTriageDrive(graph, access) {
  const checked = new Map();
  const read = path => graph(path, access);
  async function folder(name) {
    if (!checked.has(name)) {
      const id = FOLDERS[name];
      const path = graphPath(id);
      const item = await (await read(path + '?$select=' + SELECT)).json();
      if (!ownedItem(item, ROOT, name) || item.id !== id || !item.folder) {
        throw invalid('선택한 카톡 수집 폴더의 위치가 변경됐습니다.');
      }
      checked.set(name, path);
    }
    return checked.get(name);
  }
  async function metadata(group, name) {
    const parent = await folder(group);
    const item = await (await read(parent + ':/' + encodeURIComponent(name) + '?$select=' + SELECT)).json();
    if (!ownedItem(item, FOLDERS[group], name) || !item.file || typeof item.eTag !== 'string' || !item.eTag) {
      throw invalid('선택한 폴더의 원본 파일을 확인할 수 없습니다.');
    }
    return item;
  }
  function batchName(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw invalid('잘못된 카톡 수집 묶음입니다.', 400);
    return id + '.json';
  }
  return {
    async list(cursor = null) {
      kakaoTriageOptions({ cursor });
      const parent = await folder('batches');
      const query = new URLSearchParams({ '$select': SELECT, '$top': '1' });
      if (cursor) query.set('$skiptoken', cursor);
      const result = await (await read(parent + '/children?' + query)).json();
      if (!Array.isArray(result.value)) throw invalid('카톡 수집 목록 응답을 확인해 주세요.');
      const batches = [];
      for (const item of result.value) {
        if (typeof item?.name !== 'string' || !item.name.endsWith('.json')) continue;
        const id = item.name.slice(0, -5);
        if (!UUID.test(id)) continue;
        if (!ownedItem(item, FOLDERS.batches, item.name) || !item.file || typeof item.eTag !== 'string' || !item.eTag) {
          throw invalid('카톡 수집 목록의 파일 식별값을 확인해 주세요.');
        }
        batches.push({ id, version: item.eTag });
      }
      let nextCursor = null;
      if (result['@odata.nextLink']) {
        const link = new URL(result['@odata.nextLink']);
        nextCursor = link.searchParams.get('$skiptoken') ?? link.searchParams.get('$skipToken');
        if (!nextCursor || link.origin !== 'https://graph.microsoft.com') throw invalid('카톡 수집 목록의 다음 페이지를 확인해 주세요.');
        kakaoTriageOptions({ cursor: nextCursor });
      }
      return { batches, nextCursor };
    },
    async stat(id) {
      const item = await metadata('batches', batchName(id));
      return { id, version: item.eTag };
    },
    async batch(id, version) {
      const name = batchName(id);
      const item = await metadata('batches', name);
      if (item.eTag !== version) throw invalid('카톡 수집 파일이 갱신됐습니다. 다시 읽어 주세요.');
      if (!Number.isSafeInteger(item.size) || item.size < 1 || item.size > 8 * 1024 * 1024) {
        throw invalid('카톡 수집 JSON의 크기를 확인해 주세요.');
      }
      const bytes = await readFile(await read(graphPath(item.id) + '/content'), item.size);
      const current = await metadata('batches', name);
      if (current.id !== item.id || current.eTag !== version) throw invalid('카톡 수집 파일이 갱신됐습니다. 다시 읽어 주세요.');
      const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (manifest?.batch_id !== id || !Array.isArray(manifest.messages)) throw invalid('카톡 수집 파일과 묶음 식별값이 일치하지 않습니다.');
      return manifest;
    },
    async photo(attachment) {
      const match = /^images\/([a-f0-9]{64})\.[a-z0-9]{1,10}$/.exec(attachment?.path);
      if (!match || match[1] !== attachment.sha256 || !Number.isSafeInteger(attachment.bytes) ||
          attachment.bytes < 1 || attachment.bytes > MAIL_PHOTO_LIMITS.perImageBytes) throw invalid('카톡 사진의 원본 경로·크기를 확인해 주세요.');
      const item = await metadata('images', attachment.path.slice('images/'.length));
      if (item.size !== attachment.bytes) throw invalid('카톡 사진의 원본 크기가 일치하지 않습니다.');
      const bytes = await readFile(await read(graphPath(item.id) + '/content'), item.size);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hex = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
      if (hex !== attachment.sha256) throw invalid('카톡 사진의 지문이 일치하지 않습니다.');
      const { width, height } = inspectMailImage(bytes);
      if (width !== attachment.width || height !== attachment.height) throw invalid('카톡 사진의 원본 해상도가 일치하지 않습니다.');
      return bytes;
    },
  };
}
