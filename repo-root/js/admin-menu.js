import { FEATURE_CATALOG, featureAvailable } from './feature-catalog.mjs';
import {
  isPrivateFeatureOwner,
  loadPrivateFeatures,
} from './private-features.js';

export function getAdminMenus(profile, centerCode) {
  const values = loadPrivateFeatures(profile);
  return FEATURE_CATALOG.filter(
    (feature) =>
      feature.href &&
      feature.hub !== false &&
      featureAvailable(feature, profile, centerCode) &&
      (!feature.ownerOnly || isPrivateFeatureOwner(profile)) &&
      (feature.fixed || values[feature.id]),
  ).map((feature) => ({
    ...feature,
    feature: feature.fixed ? undefined : feature.id,
  }));
}
