import { PAGE_RESOURCES } from '../domain/feature-catalog';

export interface Access {
  read?: boolean; edit?: boolean; read_centers?: string[]; edit_centers?: string[];
}
export interface PermissionContext { access: Record<string, Access> }
export function permissionAllowed(context: PermissionContext | null | undefined, resource: string, action: 'read' | 'edit' = 'read', center?: string) {
  const access = context?.access?.[resource];
  if (!access || !['read', 'edit'].includes(action)) return false;
  const allows = (key: 'read' | 'edit') => center ? (access[`${key}_centers`] ?? []).includes(center) : access[key] === true;
  return allows(action) || (action === 'read' && allows('edit'));
}
export const resourceForPath = (path: string) => path.startsWith('/admin/') ? PAGE_RESOURCES[path.split('/').at(-1)!] : undefined;
