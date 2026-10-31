declare module '*private-mail-work.js' {
  export function applyOwnerWorkCorrection(
    item: import('./lib/portal-mail').DailyWork,
    overrides: Record<string, unknown>,
    day?: string,
  ): import('./lib/portal-mail').DailyWork;
}
