export function normalizeAddress(value) {
 return String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
}

export function groupAddresses(rows) {
 const groups=new Map();
 for(const row of rows) {
  const address=normalizeAddress(row.address);
  if(!address)continue;
  const name=String(row.name??'').trim();
  if(!groups.has(address))groups.set(address,{key:address,address,name,sources:[]});
  const group=groups.get(address);
  if(!group.name&&name)group.name=name;
  group.sources.push({...row});
 }
 return [...groups.values()];
}

export function pointIdentity(point) {
 return point&&[point.x,point.y].every(v=>v!==''&&v!=null&&Number.isFinite(Number(v)))?`${Number(point.x)},${Number(point.y)}`:null;
}

export function consolidateCoordinates(state) {
 if(state.phase==='directions'&&state.coordinateIdentityVersion===1)return;
 const original=state.points??[],points=[],byCoordinate=new Map(),indexes=new Map(),ids=new Map();
 state.aliases??={};
 for(const [index,point] of original.entries()) {
  const key=pointIdentity(point)??`id:${point.id}`;
  let representative=byCoordinate.get(key);
  if(representative==null){representative=points.length;byCoordinate.set(key,representative);points.push({...point,addresses:[...(point.addresses??[point.address])]});}
  const target=points[representative];
  target.addresses=[...new Set([...target.addresses,...(point.addresses??[point.address])])];
  indexes.set(index,representative);ids.set(point.id,target.id);
  if(point.id!==target.id)state.aliases[point.addressKey]=target.id;
 }
 for(const [address,id] of Object.entries(state.aliases))state.aliases[address]=ids.get(id)??id;
 const seen=new Set(),edges=[];let cursor=0;
 // Keep completed edges ahead of pending edges so an old job never restarts its saved prefix.
 for(const [index,edge] of (state.edges??[]).entries()) {
  const from=indexes.get(edge[0]),to=indexes.get(edge[1]),key=`${from}>${to}`;
  if(from==null||to==null||from===to||seen.has(key))continue;
  seen.add(key);edges.push([from,to,edge[2]]);if(index<(state.edgeCursor??0))cursor++;
 }
 state.mergedEdges=(state.mergedEdges??0)+(state.edges?.length??0)-edges.length;
 state.points=points;state.edges=edges;state.edgeCursor=cursor;
 for(const field of ['lastResults','routeIssues'])for(const result of state[field]??[]){result.fromId=ids.get(result.fromId)??result.fromId;result.toId=ids.get(result.toId)??result.toId;}
 if(state.phase==='directions')state.deferred=Math.max(0,edges.length-cursor);
 state.coordinateIdentityVersion=1;
}

const radians=value=>value*Math.PI/180;
function distanceBetween(from,to) {
 const latitude=radians(to.y-from.y),longitude=radians(to.x-from.x);
 const a=Math.sin(latitude/2)**2+Math.cos(radians(from.y))*Math.cos(radians(to.y))*Math.sin(longitude/2)**2;
 return 6371008.8*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
}

function compareIds(a,b) {
 const left=String(a.id),right=String(b.id);
 if(left!==right)return left<right?-1:1;
 return typeof a.id===typeof b.id?0:typeof a.id<typeof b.id?-1:1;
}

function deadline(value) {
 if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<1440)return value;
 if(typeof value!=='string')return null;
 const match=value.trim().match(/^(\d{1,2}):(\d{2})$/);
 return match&&Number(match[1])<24&&Number(match[2])<60?Number(match[1])*60+Number(match[2]):null;
}

function deadlineOrder(from,to) {
 const start=deadline(from.otd),end=deadline(to.otd);
 return start==null||end==null?1:end>=start?0:2;
}

export function buildCandidates(points,{limit=50,originId=null,preferred=[]}={}) {
 if(!Number.isInteger(limit)||limit<0)throw new RangeError('Candidate limit must be a nonnegative integer');
 const perStop=Math.min(limit,50),byId=new Map();
 for(const point of points) {
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>180||Math.abs(point.y)>90)throw new TypeError('Point coordinates must be finite longitude and latitude');
  if(!((typeof point.id==='string'&&point.id.trim())||(typeof point.id==='number'&&Number.isFinite(point.id)))||byId.has(point.id))throw new TypeError('Point IDs must be present and unique');
  byId.set(point.id,point);
 }
 const center=originId==null?null:byId.get(originId);
 if(originId!=null&&!center)throw new TypeError('Center origin ID must identify a point');
 const stops=[...byId.values()].filter(point=>point.id!==originId).sort(compareIds);
 const history=new Map();
 for(const pair of preferred) {
  if(!pair||pair.from===pair.to||!byId.has(pair.from)||!byId.has(pair.to)||pair.from===originId||pair.to===originId)continue;
  if(!history.has(pair.from))history.set(pair.from,new Set());
  history.get(pair.from).add(pair.to);
 }
 const edges=center?stops.map((to,index)=>({from:center.id,to:to.id,reason:'center',rank:index+1,distanceMeters:distanceBetween(center,to)})):[];
 if(!perStop)return edges;
 const candidates=stops.map(from=> {
  const ranked=stops.filter(to=>to.id!==from.id).map(to=> {
   const distanceMeters=distanceBetween(from,to),historical=history.get(from.id)?.has(to.id)??false;
   const region=!!from.regionKey&&from.regionKey===to.regionKey;
   // A bounded region discount keeps nearby cross-border stops ahead of distant same-region stops.
   return {to,distanceMeters,historical,region,score:distanceMeters*(region?0.8:1),otdOrder:deadlineOrder(from,to)};
  }).sort((a,b)=>Number(b.historical)-Number(a.historical)||a.score-b.score||a.otdOrder-b.otdOrder||compareIds(a.to,b.to));
  return ranked.slice(0,perStop).map((candidate,index)=>({from:from.id,to:candidate.to.id,reason:candidate.historical?'historical':candidate.region?'region':'nearby',rank:index+1,distanceMeters:candidate.distanceMeters}));
 });
 // Truncating this list to an external-request budget must not favor the first origin.
 for(let rank=0;rank<perStop;rank++)for(const origin of candidates)if(origin[rank])edges.push(origin[rank]);
 return edges;
}
