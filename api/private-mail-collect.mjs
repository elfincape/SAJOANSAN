import { handleOwnerCollect } from '../server/private-mail-owner-collect.mjs';
export default { fetch: (request) => handleOwnerCollect(request) };
