import { supabase } from './supabase';
import { accountRequest } from './login';
export interface UserProfile { id: string; username: string | null; email: string | null; display_name: string | null; role: 'admin' | 'editor' | 'viewer'; active: boolean; updated_at?: string }
export async function loadUsers() { const { data, error } = await supabase.from('user_profiles').select('*'); if (error) throw error; return (data || []) as UserProfile[]; }
export function updateUser(id: string, payload: { id?: string; email?: string | null; username?: string; display_name?: string | null; active: boolean }) { return supabase.from('user_profiles').update(payload).eq('id', id).select().single<UserProfile>(); }
export function toggleUser(id: string, active: boolean) { return supabase.from('user_profiles').update({ active }).eq('id', id); }
export function deleteUser(id: string) { return supabase.from('user_profiles').delete().eq('id', id); }
export function createUser(payload: { username: string; password: string; display_name: string; role: UserProfile['role']; active: boolean }): Promise<{ profile: UserProfile }> { return accountRequest(supabase, { action: 'create', ...payload }); }
