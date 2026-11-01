declare module '*private-mail-isolated-storage.js' {
  export function prepareIsolatedMailCase(
    caseId: string,
    dependencies: Record<string, unknown>,
  ): Promise<{
    queued: boolean;
    receipt: Record<string, unknown>;
    finish(result: Record<string, unknown>): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  }>;
  export function replayIsolatedCase(
    result: Record<string, unknown>,
    dependencies: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

declare module '*private-mail-briefing-model.js' {
  export function renderDailyBriefing(input: Record<string, unknown>): {
    managedHtml: string;
  };
}
declare module '*private-mail-stress-fixtures.js' {
  export function fixtureById(id: string): { now: string };
}
