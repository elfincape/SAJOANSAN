import {coursePermutations} from './course-permutations.js';

export const SHORTLIST_POLICY='naver-directed-leg-meter-shortlist-v2';
export const SCORE_SCOPE='center-through-deliveries';
const allowedOptions=['traoptimal','trafast','tracomfort','traavoidtoll','traavoidcaronly'];
const fail=message=>Object.assign(Error(message),{code:'SHORTLIST_INVALID_INPUT'});
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const meters=value=>Number.isSafeInteger(value)&&value>=0;

function optionsList(options){
 if(!Array.isArray(options)||!options.length||options.length>3||new Set(options).size!==options.length||options.some(o=>!allowedOptions.includes(o)))throw fail('One to three distinct documented Naver options are required');
 return [...options];
}

/** Parse every returned route for every requested option; never substitute time or rounded km. */
export function minimumRouteMeters(response,requestedOptions,measuredAt){
 const options=optionsList(requestedOptions);
 if(response?.code!==0||!timestamp(measuredAt))throw fail('A successful response and explicit measurement timestamp are required');
 let selected;
 for(const option of options){
  const routes=response.route?.[option];
  if(!Array.isArray(routes)||!routes.length)throw fail('A requested route option is missing');
  for(const route of routes){
   const distanceMeters=route?.summary?.distance;
   if(!meters(distanceMeters))throw fail('Every route distance must be an integer number of meters');
   if(!selected||distanceMeters<selected.distanceMeters)selected={distanceMeters,option,measuredAt};
  }
 }
 return selected;
}

/**
 * pointsByStop is an address-keyed object or Map of already verified points:
 * {id?: string, coordinates: [longitude, latitude]}. This module resolves no addresses.
 * Settings participate in every directed coordinate cache key.
 */
export function createShortlistPlan(course,pointsByStop,settings={}){
 if(!course||course.rotations===2&&!course.rotation)throw fail('Two rotations require separate courses');
 if(![undefined,0,1,2].includes(course.rotation))throw fail('Unknown course rotation');
 const fixed=course.rotation===2?1:2,stops=course.stops;
 if(!Array.isArray(stops)||stops.length<fixed+2||stops.length>fixed+6||stops.some(s=>typeof s!=='string'||!s.trim()))throw fail('A course requires one to five deliveries and its fixed endpoints');
 const policySettings={apiVersion:settings.apiVersion??'directions5',options:optionsList(settings.options??['traoptimal','trafast','tracomfort']),cartype:settings.cartype??1,fueltype:settings.fueltype??'diesel'};
 if(!['directions5','directions15'].includes(policySettings.apiVersion)||!Number.isInteger(policySettings.cartype)||policySettings.cartype<1||policySettings.cartype>6||!['gasoline','highgradegasoline','diesel','lpg'].includes(policySettings.fueltype))throw fail('Unsupported routing settings');
 const points=new Map();
 for(const stop of new Set(stops)){
  const source=pointsByStop instanceof Map?pointsByStop.get(stop):Object.hasOwn(pointsByStop??{},stop)?pointsByStop[stop]:undefined;
  const coordinates=source?.coordinates;
  if(!Array.isArray(coordinates)||coordinates.length!==2||coordinates.some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(coordinates[0])>180||Math.abs(coordinates[1])>90||source.id!==undefined&&(typeof source.id!=='string'||!source.id))throw fail('Every stop requires verified numeric coordinates');
  points.set(stop,{id:source.id??stop,coordinates:[...coordinates]});
 }
 // The browser optimizer permits at most seven logical stops. Separating its fixed
 // garage prefix lets the same permutation generator score five deliveries, while
 // webEligible below still blocks six-waypoint courses from browser completion.
 const prefix=stops.slice(0,fixed-1),permutable={rotation:2,stops:stops.slice(fixed-1)};
 const routes=coursePermutations(permutable).map(route=>[...prefix,...route]);
 const settingsKey=JSON.stringify({...policySettings,options:[...policySettings.options].sort()});
 const edges=new Map();
 const candidates=routes.map((route,index)=>{
  const matrixKeys=[];
  // Rank only center -> delivery permutation -> last delivery. Fixed garage
  // departure and the final return remain in stops for full browser validation.
  for(let i=fixed;i<route.length-1;i++){
   const from=points.get(route[i-1]),to=points.get(route[i]);
   const key=JSON.stringify([SHORTLIST_POLICY,settingsKey,from.coordinates,to.coordinates]);
   const zeroCost=from.coordinates.every((n,j)=>n===to.coordinates[j]);
   if(!edges.has(key))edges.set(key,{key,from:{...from,coordinates:[...from.coordinates]},to:{...to,coordinates:[...to.coordinates]},zeroCost});
   matrixKeys.push(key);
  }
  return {index,stops:route,matrixKeys};
 });
 const webWaypoints=stops.length-2;
 return {policy:SHORTLIST_POLICY,scoreScope:SCORE_SCOPE,approximate:true,settings:policySettings,inputKey:JSON.stringify([SHORTLIST_POLICY,course.rotation??0,stops,settingsKey,[...points].map(([stop,p])=>[stop,p.id,p.coordinates])]),rotation:course.rotation??0,webWaypoints,webEligible:webWaypoints<=5,candidates,edges:[...edges.values()],globalMinimumGuaranteed:false};
}

/**
 * Matrix rows: {key, distanceMeters, option, measuredAt, status?: 'ready'}.
 * The caller supplies `now` explicitly for deterministic freshness checks. Only a
 * complete fresh matrix can produce candidates. This is never a web-minimum proof.
 */
export function rankShortlist(plan,matrix,{now,maxAgeMs=1800000}={}){
 if(plan?.policy!==SHORTLIST_POLICY||!Array.isArray(matrix)||!timestamp(now)||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<0)throw fail('A valid plan, matrix and explicit comparison time are required');
 const rows=new Map(),duplicates=new Set(),required=new Set(plan.edges.filter(e=>!e.zeroCost).map(e=>e.key));
 for(const row of matrix){
  if(!required.has(row?.key))continue;
  if(rows.has(row.key))duplicates.add(row.key);
  rows.set(row.key,row);
 }
 const missingKeys=[],invalidKeys=[],timestamps=[],values=new Map();
 for(const edge of plan.edges){
  if(edge.zeroCost){values.set(edge.key,0);continue;}
  const row=rows.get(edge.key);
  if(!row){missingKeys.push(edge.key);continue;}
  const age=Date.parse(now)-Date.parse(row.measuredAt);
  if(duplicates.has(edge.key)||!meters(row.distanceMeters)||!plan.settings.options.includes(row.option)||!timestamp(row.measuredAt)||age<0||age>maxAgeMs||row.status!==undefined&&row.status!=='ready'){invalidKeys.push(edge.key);continue;}
  values.set(edge.key,row.distanceMeters);timestamps.push({key:edge.key,measuredAt:row.measuredAt,option:row.option});
 }
 const completeMatrix=missingKeys.length===0&&invalidKeys.length===0;
 const scores=completeMatrix?plan.candidates.map(candidate=>{
  const scoreMeters=candidate.matrixKeys.reduce((sum,key)=>sum+values.get(key),0);
  if(!meters(scoreMeters))throw fail('Route distance exceeds safe integer precision');
  return {...candidate,stops:[...candidate.stops],matrixKeys:[...candidate.matrixKeys],scoreMeters,apiPartialMeters:scoreMeters};
 }):[];
 const candidates=[...scores].sort((a,b)=>a.scoreMeters-b.scoreMeters||a.index-b.index).slice(0,3);
 return {policy:SHORTLIST_POLICY,scoreScope:SCORE_SCOPE,approximate:true,inputKey:plan.inputKey,completeMatrix,globalMinimumGuaranteed:false,webEligible:plan.webEligible,webWaypoints:plan.webWaypoints,totalPermutations:plan.candidates.length,missingKeys,invalidKeys,scores,candidates,matrixKeys:plan.edges.map(e=>e.key),timestamps,comparedAt:now,maxAgeMs};
}
