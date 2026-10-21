import { supabase } from './supabase';
export interface AuditUser { id: string; email: string; display_name: string | null }
export interface AuditRow { id: string | number; table_name: string; action: string; changed_at: string; row_id: string; changed_by: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }
export interface AuditFilters { table: string; action: string; user: string; from: string; to: string }
export function auditUsers() { return supabase.from('user_profiles').select('id, email, display_name').order('display_name').returns<AuditUser[]>(); }
export function auditPage(center: string, filters: AuditFilters, page: number) {
  const from = page * 50;
  let query = supabase.from('audit_log').select('*', { count: 'exact' }).eq('center_code', center).order('changed_at', { ascending: false }).range(from, from + 49);
  if (filters.table) query = query.eq('table_name', filters.table);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.user) query = query.eq('changed_by', filters.user);
  if (filters.from) query = query.gte('changed_at', filters.from + 'T00:00:00');
  if (filters.to) query = query.lte('changed_at', filters.to + 'T23:59:59');
  return query.returns<AuditRow[]>();
}
