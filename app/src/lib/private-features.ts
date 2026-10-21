import { CONFIGURABLE_FEATURES } from '../domain/feature-catalog';
export const PRIVATE_FEATURE_OWNER = 'elfincape@gmail.com';
export const PRIVATE_FEATURE_DEFAULTS = Object.freeze(
  Object.fromEntries(
    CONFIGURABLE_FEATURES.map((feature) => [
      feature.id,
      feature.defaultEnabled,
    ]),
  ),
);
export const PRIVATE_FEATURE_STORAGE_KEY = 'sajo.privateFeatures.v1';
const CHANGE_EVENT = 'sajo:features-changed';
export function isPrivateFeatureOwner(profile: { email?: string } | null | undefined) {
  return (
    String(profile?.email || '')
      .trim()
      .toLowerCase() === PRIVATE_FEATURE_OWNER
  );
}
function normalized(values: unknown): Record<string, boolean> {
  const saved: Record<string, unknown> =
    values && typeof values === 'object' && !Array.isArray(values)
      ? values as Record<string, unknown>
      : {};
  return Object.fromEntries(
    CONFIGURABLE_FEATURES.map((feature) => [
      feature.id,
      typeof saved[feature.id] === 'boolean'
        ? saved[feature.id] as boolean
        : feature.legacyFeature &&
            typeof saved[feature.legacyFeature] === 'boolean'
          ? saved[feature.legacyFeature] as boolean
          : feature.defaultEnabled,
    ]),
  );
}
export function loadPrivateFeatures(profile: { email?: string } | null | undefined) {
  if (!isPrivateFeatureOwner(profile)) return { ...PRIVATE_FEATURE_DEFAULTS };
  try {
    return normalized(
      JSON.parse(localStorage.getItem(PRIVATE_FEATURE_STORAGE_KEY) || '{}'),
    );
  } catch {
    return { ...PRIVATE_FEATURE_DEFAULTS };
  }
}
export function savePrivateFeatures(profile: { email?: string } | null | undefined, features: Record<string, boolean>) {
  if (!isPrivateFeatureOwner(profile)) return false;
  try {
    localStorage.setItem(
      PRIVATE_FEATURE_STORAGE_KEY,
      JSON.stringify(normalized(features)),
    );
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}
export function subscribePrivateFeatures(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === PRIVATE_FEATURE_STORAGE_KEY || event.key === null)
      listener();
  };
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) listener();
  };
  window.addEventListener('pageshow', restore);
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener('pageshow', restore);
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', storage);
  };
}
