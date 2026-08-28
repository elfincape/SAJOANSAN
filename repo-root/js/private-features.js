export const PRIVATE_FEATURE_OWNER='elfincape@gmail.com';
export const PRIVATE_FEATURE_DEFAULTS=Object.freeze({haulPrices:false,imageStraightener:false,ansanGimhaeBusanAnsan:false,auditLog:false});
const STORAGE_KEY='sajo.privateFeatures.v1';

export function isPrivateFeatureOwner(profile){return String(profile?.email||'').trim().toLowerCase()===PRIVATE_FEATURE_OWNER}
export function loadPrivateFeatures(profile){
  if(!isPrivateFeatureOwner(profile))return{...PRIVATE_FEATURE_DEFAULTS};
  try{return{...PRIVATE_FEATURE_DEFAULTS,...JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}}catch{return{...PRIVATE_FEATURE_DEFAULTS}}
}
export function savePrivateFeatures(profile,features){
  if(!isPrivateFeatureOwner(profile))return false;
  localStorage.setItem(STORAGE_KEY,JSON.stringify({...PRIVATE_FEATURE_DEFAULTS,...features}));
  return true;
}
