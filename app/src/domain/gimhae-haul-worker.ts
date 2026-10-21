import { compareDispatchHaul } from './gimhae-haul';
self.onmessage = ({ data }) => {
  try {
    if (!Array.isArray(data?.requests) || !Array.isArray(data?.volumes))
      throw Error('비교 입력을 확인해 주세요.');
    self.postMessage({ results: compareDispatchHaul(data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
