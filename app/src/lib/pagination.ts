import type { PostgrestError } from '@supabase/supabase-js';

export async function fetchAllRows<T>(makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }> }) {
  const rows: T[] = [];
  for (let offset = 0; ; ) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data); offset += data.length;
  }
}
