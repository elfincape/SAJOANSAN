import {activeIssues,clone} from './pyeongtaek-charter-model.js';
export function reviewDeletionPlan(trips){
 const plan=[];
 for(const trip of trips){
  const issues=activeIssues(trip);if(!issues.length)continue;
  const ids=new Set(issues.map(i=>i.deliveryId).filter(Boolean));
  const remaining=trip.deliveries.filter(d=>!ids.has(d.id));
  if(issues.some(i=>!i.deliveryId)||remaining.length===0){plan.push({trip,next:null,removedDeliveries:trip.deliveries.length});continue;}
  if(remaining.length===trip.deliveries.length)continue;
  const next=clone(trip);next.deliveries=next.deliveries.filter(d=>!ids.has(d.id));next.issues=next.issues.filter(i=>!ids.has(i.deliveryId));next.updatedAt=new Date().toISOString();
  plan.push({trip,next,removedDeliveries:trip.deliveries.length-next.deliveries.length});
 }
 return plan;
}
