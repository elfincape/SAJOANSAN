import { supabase } from './supabase';
import type { PermissionContext } from './permissions';
import { clearSelectedCenter } from './center';

export interface Profile { id: string; email: string; display_name: string | null; role: 'viewer' | 'editor' | 'admin'; active: boolean }
export interface AuthContext { profile: Profile; permissions: PermissionContext }
let pending: Promise<AuthContext | null> | undefined;
let cached: AuthContext | undefined;
let revision = 0;
let checkedAt = 0;
let boundToken = '';
const cacheKey = 'sajo.auth-context.v1';
const maxAge = 30000;
supabase.auth.onAuthStateChange?.((event, session) => {
  if (event === 'TOKEN_REFRESHED' && !boundToken && !cached) { clearStoredContext(); return; }
  if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED' ||
      event === 'SIGNED_IN' && (!session || cached && cached.profile.id !== session.user.id || boundToken && boundToken !== session.access_token)) invalidateContext();
});

function clearStoredContext() {
  try { window.sessionStorage.removeItem(cacheKey); } catch { /* Storage is optional. */ }
}
function validContext(value: unknown): value is AuthContext {
  if (!value || typeof value !== 'object') return false;
  const { profile, permissions } = value as AuthContext;
  if (!profile || typeof profile.id !== 'string' || typeof profile.email !== 'string' ||
      !(profile.display_name === null || typeof profile.display_name === 'string') || profile.active !== true ||
      !['viewer', 'editor', 'admin'].includes(profile.role) || !permissions?.access || typeof permissions.access !== 'object' || Array.isArray(permissions.access)) return false;
  return Object.values(permissions.access).every(access => access && typeof access === 'object' &&
    ['read', 'edit', 'read_unclassified', 'edit_unclassified'].every(key => !(key in access) || typeof access[key as keyof typeof access] === 'boolean') &&
    ['read_centers', 'edit_centers'].every(key => !(key in access) || Array.isArray(access[key as keyof typeof access]) && (access[key as 'read_centers']!).every(center => typeof center === 'string')));
}
async function sessionFingerprint(token: string | undefined) {
  if (!token) return '';
  try { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join(''); }
  catch { return ''; }
}
function storedContext(userId: string, fingerprint: string): { context: AuthContext; checkedAt: number } | undefined {
  if (!fingerprint) return;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(cacheKey) || 'null');
    if (value && value.fingerprint === fingerprint && typeof value.checkedAt === 'number' &&
        Date.now() >= value.checkedAt && Date.now() - value.checkedAt < maxAge &&
        validContext(value.context) && value.context.profile.id === userId) return value;
  } catch { /* Malformed or unavailable storage requires a fresh server check. */ }
  clearStoredContext();
}
function storeContext(context: AuthContext, fingerprint: string) {
  if (!fingerprint) return;
  try { window.sessionStorage.setItem(cacheKey, JSON.stringify({ context, fingerprint, checkedAt })); } catch { /* Keep the verified memory context. */ }
}

function invalidateContext() {
  revision += 1;
  cached = undefined;
  pending = undefined;
  boundToken = '';
  clearStoredContext();
}

type AuthBridge = { load: (refresh?: boolean) => Promise<AuthContext | null>; peek: () => AuthContext | undefined };
declare global { interface Window { workspaceAuth?: AuthBridge } }
function parentAuth(): AuthBridge | undefined {
  if (typeof window === 'undefined' || typeof parent === 'undefined' || parent === window || new URLSearchParams(location.search).get('linked_detail') !== '1') return;
  try { if (parent.location.origin === location.origin) return parent.workspaceAuth; } catch { /* An external frame never shares auth context. */ }
}
export function getLoadedAuthContext(): AuthContext | undefined { return parentAuth()?.peek() ?? (Date.now() - checkedAt < maxAge ? cached : undefined); }

export function loadAuthContext(refresh = false): Promise<AuthContext | null> {
  const bridge = parentAuth();
  if (bridge) return bridge.load(refresh);
  if (refresh) invalidateContext();
  if (cached && Date.now() - checkedAt < maxAge) return Promise.resolve(cached);
  if (cached) invalidateContext();
  if (!pending) {
    const requestedRevision = revision;
    const request = (async () => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (requestedRevision !== revision) return null;
      if (sessionError) { clearStoredContext(); throw sessionError; }
      if (!session) { clearStoredContext(); location.replace('/login.html'); return null; }
      boundToken = session.access_token;
      const fingerprint = await sessionFingerprint(session.access_token);
      if (requestedRevision !== revision) return null;
      const restored = storedContext(session.user.id, fingerprint);
      if (restored) { cached = restored.context; checkedAt = restored.checkedAt; return cached; }
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (requestedRevision !== revision) return null;
      if (authError) throw authError;
      if (!user || user.id !== session.user.id) { clearStoredContext(); return null; }
      const { data: profile, error } = await supabase.from('user_profiles').select('id, email, display_name, role, active').eq('id', user.id).maybeSingle<Profile>();
      if (requestedRevision !== revision) return null;
      if (error) throw error;
      if (!profile?.active) {
        clearStoredContext(); await supabase.auth.signOut(); clearSelectedCenter(); location.replace('/login.html?reason=inactive'); return null;
      }
      const result = await supabase.rpc('operations_permissions_context');
      if (requestedRevision !== revision) return null;
      if (result.error) throw result.error;
      checkedAt = Date.now();
      cached = { profile, permissions: result.data };
      storeContext(cached, fingerprint);
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
