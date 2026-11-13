import { centerAttribute, centerAttributeLabel, centerAccessKey } from '../domain/catalog-attributes';
import { permissionAllowed, type PermissionContext } from '../lib/permissions';

export function CenterAttributeFilter({ value, change }: { value: string; change: (value: string) => void }) {
  return <label className="app-label">센터 속성 필터<select className="app-select" aria-label="센터 속성 필터" value={value} onChange={event=>change(event.target.value)}><option value="">전체</option>{centerAttribute.values.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}<option value="unclassified">미분류</option>{value && value!=='unclassified' && !centerAttribute.values.some(item=>item.value===value)?<option value={value}>{centerAttributeLabel(value)}</option>:null}</select></label>;
}
export function CenterAttributeInput({ value, change, permissions, resource }: { value: string | null; change: (value: string | null) => void; permissions: PermissionContext; resource: typeof centerAttribute.targets[number] }) {
  const allowed=(next:string|null)=>permissionAllowed(permissions,resource,'edit',centerAccessKey(next));
  return <label className="app-label">원본 센터 속성<select className="app-select" aria-label="원본 센터 속성" value={value ?? 'unclassified'} onChange={event=>change(event.target.value==='unclassified'?null:event.target.value)}><option value="unclassified" disabled={!allowed(null)}>미분류</option>{centerAttribute.values.map(item=><option key={item.value} value={item.value} disabled={!allowed(item.value)}>{item.label}</option>)}{value!==null && !centerAttribute.values.some(item=>item.value===value)?<option value={value}>{centerAttributeLabel(value)}</option>:null}</select></label>;
}
