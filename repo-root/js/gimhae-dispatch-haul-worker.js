import { compareDispatchHaul } from './gimhae-dispatch-haul.js';

self.onmessage = ({ data }) => {
  try {
    if (!Array.isArray(data?.volumes) || !Array.isArray(data?.requests))
      throw new Error('물량과 요청 목록이 필요합니다.');
    self.postMessage({ results: compareDispatchHaul(data) });
  } catch {
    self.postMessage({ error: '차량 비교 요청을 처리하지 못했습니다.' });
  }
};
