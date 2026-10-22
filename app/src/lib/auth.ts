import { supabase } from './supabase';
import type { PermissionContext } from './permissions';
import { clearSelectedCenter } from './center';

export interface Profile { id: string; email: string; display_name: string | null; role: 'viewer' | 'editor' | 'admin'; active: boolean }
export interface AuthContext { profile: Profile; permissions: PermissionContext }
let pending: Promise<AuthContext | null> | undefined;
let cached: AuthContext | undefined;

export function getLoadedAuthContext() { return cached; }

export function loadAuthContext(refresh = false) {
  if (refresh) cached = undefined;
  if (cached) return Promise.resolve(cached);
  if (!pending) pending = (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { location.replace('/login.html'); return null; }
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) return null;
    const { data: profile, error } = await supabase.from('user_profiles').select('id, email, display_name, role, active').eq('id', user.id).maybeSingle<Profile>();
    if (error) throw error;
    if (!profile?.active) {
      await supabase.auth.signOut(); clearSelectedCenter(); location.replace('/login.html?reason=inactive'); return null;
    }
    const result = await supabase.rpc('operations_permissions_context');
    if (result.error) throw result.error;
    cached = { profile, permissions: result.data };
    return cached;
  })().finally(() => { pending = undefined; });
  return pending;
}
export async function signOut() {
  try { await supabase.auth.signOut(); }
  finally { cached = undefined; pending = undefined; clearSelectedCenter(); location.replace('/login.html'); }
}
