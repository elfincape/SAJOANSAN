import { handleNodeDiagnostic } from '../server/private-mail-probe.mjs';

export const maxDuration = 30;
export default {
  fetch: (request) =>
    handleNodeDiagnostic(request, { region: process.env.VERCEL_REGION }),
};
