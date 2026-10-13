export function canGenerateSurveyDraft(profile){
 return profile?.active===true&&profile.role==='admin'&&String(profile.email??'').trim().toLowerCase()==='elfincape@gmail.com';
}
