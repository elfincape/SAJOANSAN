import {surveyFields} from './portal-model.js';
export function renderSurveyFields({form,survey,field,node}){
 let files,filesWrapper;
 for(const [key,label] of surveyFields){
  field(form,label,key,survey?.details?.[key]??'',key==='sequence'||key==='problems'?'textarea':'text');
  if(key==='handoff'){
   filesWrapper=node('div',undefined,'survey-files');form.append(filesWrapper);
   files=field(filesWrapper,'사용하는 파일','survey_attachments','','file');
   files.multiple=true;files.accept='.xlsx,.xls,.pdf,.docx,.doc,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp';
  }
 }
 return {files,filesWrapper,details(){
  const values=Object.fromEntries(surveyFields.map(([key])=>[key,form.elements[key].value]));
  const names=[survey?.details?.files,...Array.from(files.files).map(file=>file.name)].filter(Boolean);
  if(names.length)values.files=[...new Set(names)].join('\n');
  return values;
 }};
}
