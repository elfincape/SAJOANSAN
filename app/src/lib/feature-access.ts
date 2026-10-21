import type { Feature } from '../domain/feature-catalog';
import { featureAvailable } from '../domain/feature-catalog';
import type { Profile } from './auth';
import { permissionAllowed } from './permissions';
import type { PermissionContext } from './permissions';
import { isPrivateFeatureOwner } from './private-features';

// The hub, sidebar and quick navigation must make the same visibility decision.
export function featureAccessible(
  feature: Feature,
  profile: Profile,
  permissions: PermissionContext,
  center: string,
  enabled: Record<string, boolean>,
) {
  return featureAvailable(feature, profile, center)
    && (!feature.ownerOnly || isPrivateFeatureOwner(profile))
    && (feature.fixed || enabled[feature.id] === true)
    && (!feature.resource || permissionAllowed(permissions, feature.resource, 'read', center));
}
