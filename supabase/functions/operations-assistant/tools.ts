export const TOOL_NAMES=['search_course_rows','list_routes','search_delivery_points','search_drivers','search_vehicles'] as const;
export type ToolName=typeof TOOL_NAMES[number];
export type Plan={tool:ToolName,args:Record<string,unknown>};
export function validatePlan(value:unknown):Plan{
  if(!value||typeof value!=='object')throw new Error('invalid plan');const v=value as Record<string,unknown>;
  if(!TOOL_NAMES.includes(v.tool as ToolName))throw new Error('unknown tool');
  const raw=v.args&&typeof v.args==='object'&&!Array.isArray(v.args)?v.args as Record<string,unknown>:{};const args:Record<string,unknown>={};
  const strings=['vehicleQuery','driverQuery','deliveryPointQuery','region','routeQuery','missingField','vehicleClass'];for(const k of strings)if(typeof raw[k]==='string')args[k]=String(raw[k]).trim().slice(0,100);
  const numbers=['deadlineBeforeBusinessMin','deadlineAfterBusinessMin'];for(const k of numbers)if(Number.isFinite(Number(raw[k])))args[k]=Math.max(0,Math.min(2879,Number(raw[k])));
  const booleans=['entryAllowed'];for(const k of booleans)if(typeof raw[k]==='boolean')args[k]=raw[k];
  args.limit=Math.max(1,Math.min(100,Number(raw.limit)||100));return {tool:v.tool as ToolName,args};
}
export function normalizeCenter(value:unknown){const v=String(value||'').trim().toLowerCase();if(['001','ansan','사조안산센터','안산'].includes(v))return'001';if(['002','pyeongtaek','사조평택센터','평택'].includes(v))return'002';return''}
export function maskPhone(value:unknown){const d=String(value||'').replace(/\D/g,'');if(d.length<7)return d?'***':'';return `${d.slice(0,3)}-****-${d.slice(-4)}`}
export function safeJsonArray(text:string){const clean=text.replace(/```(?:json)?/gi,'').replace(/```/g,'').trim(),a=clean.indexOf('{'),b=clean.lastIndexOf('}');if(a<0||b<a)throw new Error('model json missing');return JSON.parse(clean.slice(a,b+1))}
