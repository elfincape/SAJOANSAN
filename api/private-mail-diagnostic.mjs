import { handleNodeDiagnostic } from '../server/private-mail-probe.mjs';

export default {
  fetch: (request) =>
    handleNodeDiagnostic(request, { region: process.env.VERCEL_REGION }),
};
