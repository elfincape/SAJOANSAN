declare module '*private-mail-work.js' {
  export function workSummaryForDisplay(item: Pick<import('./lib/portal-mail').DailyWork,'summary'|'serviceDate'>): string[];
  export function applyOwnerWorkCorrection(
    item: import('./lib/portal-mail').DailyWork,
    overrides: Record<string, unknown>,
    day?: string,
  ): import('./lib/portal-mail').DailyWork;
}
