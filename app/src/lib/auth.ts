import { supabase } from './supabase';
import type { PermissionContext } from './permissions';
import { clearSelectedCenter } from './center';

export interface Profile { id: string; email: string; display_name: string | null; role: 'viewer' | 'editor' | 'admin'; active: boolean }
export interface AuthContext { profile: Profile; permissions: PermissionContext }
let pending: Promise<AuthContext | null> | undefined;
let cached: AuthContext | undefined;
let revision = 0;
let checkedAt = 0;
supabase.auth.onAuthStateChange?.((event) => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') invalidateContext();
});

function invalidateContext() {
  revision += 1;
  cached = undefined;
  pending = undefined;
}

type AuthBridge = { load: (refresh?: boolean) => Promise<AuthContext | null>; peek: () => AuthContext | undefined };
declare global { interface Window { workspaceAuth?: AuthBridge } }
function parentAuth(): AuthBridge | undefined {
  if (typeof window === 'undefined' || typeof parent === 'undefined' || parent === window || new URLSearchParams(location.search).get('linked_detail') !== '1') return;
  try { if (parent.location.origin === location.origin) return parent.workspaceAuth; } catch { /* An external frame never shares auth context. */ }
}
export function getLoadedAuthContext(): AuthContext | undefined { return parentAuth()?.peek() ?? (Date.now() - checkedAt < 30000 ? cached : undefined); }

export function loadAuthContext(refresh = false): Promise<AuthContext | null> {
  const bridge = parentAuth();
  if (bridge) return bridge.load(refresh);
  if (refresh) invalidateContext();
  if (cached && Date.now() - checkedAt < 30000) return Promise.resolve(cached);
  if (cached) invalidateContext();
  if (!pending) {
    const requestedRevision = revision;
    const request = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (requestedRevision !== revision) return null;
      if (!session) { location.replace('/login.html'); return null; }
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (requestedRevision !== revision) return null;
      if (authError) throw authError;
      if (!user) return null;
      const { data: profile, error } = await supabase.from('user_profiles').select('id, email, display_name, role, active').eq('id', user.id).maybeSingle<Profile>();
      if (requestedRevision !== revision) return null;
      if (error) throw error;
      if (!profile?.active) {
        await supabase.auth.signOut(); clearSelectedCenter(); location.replace('/login.html?reason=inactive'); return null;
      }
      const result = await supabase.rpc('operations_permissions_context');
      if (requestedRevision !== revision) return null;
      if (result.error) throw result.error;
      checkedAt = Date.now();
      cached = { profile, permissions: result.data };
      return cached;
    })().finally(() => { if (pending === request) pending = undefined; });
    pending = request;
  }
  return pending;
}
export async function signOut() {
  invalidateContext();
  try { await supabase.auth.signOut(); }
  finally { invalidateContext(); clearSelectedCenter(); location.replace('/login.html'); }
}

if (typeof window !== 'undefined') window.workspaceAuth = { load: loadAuthContext, peek: getLoadedAuthContext };
