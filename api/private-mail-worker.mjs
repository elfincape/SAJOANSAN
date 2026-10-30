import { handlePrivateMailWorker } from '../server/private-mail-worker.mjs';
export default { fetch: (request) => handlePrivateMailWorker(request) };
