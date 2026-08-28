export const VEHICLES=[
  {type:'1톤',capacity:2},{type:'2.5톤',capacity:4},{type:'3.5톤',capacity:6},
  {type:'5톤',capacity:10},{type:'8톤',capacity:14},{type:'11톤',capacity:16},{type:'18톤',capacity:18}
];

const GIMHAE={
  '광주':[312000,324000,342000,375000,385000,399000,466000],
  '전주':[312000,324000,342000,375000,385000,399000,456000],
  '김해':[101000,142000,163000,172000,183000,213000,246000],
  '동탄':[315000,356000,386000,406000,427000,457000,524000],
  '안산':[336000,386000,427000,457000,488000,508000,545000],
  '진천':[274000,325000,345000,366000,406000,427000,502000],
  '평택':[260000,308000,327000,342000,361000,380000,465000],
  '경산1':[150000,165000,180000,190000,210000,220000,260000],
  '경산':[155000,174000,189000,194000,232000,242000,291000]
};

const YANGSAN={
  '양천구':[340000,358000,377000,395000,414000,432000,533000],
  '영등포':[335000,354000,372000,390000,409000,427000,529000],
  '원주':[330000,377000,395000,422000,469000,496000,551000],
  '강릉':[344000,374000,414000,443000,492000,541000,607000],
  '안성':[275000,294000,312000,328000,335000,365000,496000],
  '용인':[303000,322000,340000,365000,377000,402000,518000],
  '여주':[307000,355000,374000,393000,443000,473000,532000],
  '이천':[307000,355000,374000,393000,443000,473000,532000],
  '하남':[317000,330000,349000,375000,385000,412000,528000],
  '남양주':[319000,337000,356000,379000,392000,418000,537000],
  '시흥':[322000,330000,358000,384000,395000,420000,542000],
  '김포':[367000,385000,404000,422000,441000,459000,561000],
  '인천':[349000,367000,385000,404000,422000,441000,542000],
  '청주':[247000,275000,294000,312000,330000,349000,395000],
  '서천':[340000,367000,404000,432000,459000,505000,570000],
  '세종':[247000,275000,294000,312000,322000,349000,395000],
  '대구':[174000,192000,202000,229000,257000,275000,330000],
  '칠곡':[192000,210000,220000,247000,275000,294000,349000],
  '구미':[202000,220000,229000,257000,285000,303000,358000],
  '김천':[229000,257000,275000,294000,312000,330000,385000],
  '창원':[147000,165000,183000,202000,220000,229000,294000],
  '양산':[97000,137000,157000,167000,177000,207000,237000],
  '사천':[202000,220000,238000,257000,285000,303000,358000],
  '부산':[128000,147000,170000,178000,192000,210000,257000],
  '양주':[329000,347000,366000,389000,402000,428000,547000],
  '이천쿠팡':[300000,350000,370000,380000,450000,480000,550000],
  '경산쿠팡':[160000,180000,195000,217000,245000,265000,328000],
  '평택(마켓컬리)':[300000,319000,339000,356000,363000,395000,532000],
  '김포(마켓컬리)':[397000,416000,436000,455000,474000,494000,600000],
  '창원쿠팡':[164000,184000,203000,222000,242000,251000,319000],
  '시흥쿠팡':[339000,358000,377000,405000,416000,443000,565000],
  '양산쿠팡':[113000,155000,176000,186000,196000,227000,260000],
  '인천쿠팡':[377000,397000,416000,436000,455000,474000,581000],
  '고양쿠팡':[406000,426000,445000,465000,484000,503000,610000],
  '천안쿠팡':[250000,280000,300000,320000,340000,360000,400000],
  '송파':[300000,320000,340000,360000,370000,400000,480000]
};

export const RATE_TABLES={김해:GIMHAE,양산:YANGSAN};
export function destinationsFor(origin){return Object.keys(RATE_TABLES[origin]||{})}
export function rateFor(origin,destination,type){const index=VEHICLES.findIndex(vehicle=>vehicle.type===type);return index<0?null:RATE_TABLES[origin]?.[destination]?.[index]??null}
export function usedSpace(frozen,chilled){if(frozen>0&&chilled>0)return roundEven(frozen)+roundEven(chilled);return frozen+chilled}
export function canLoad(capacity,frozen,chilled){return frozen>=0&&chilled>=0&&usedSpace(frozen,chilled)<=capacity}

export function calculateHaulCombinations({origin,destination,frozen,chilled,limit=10}){
  frozen=toPallets(frozen);chilled=toPallets(chilled);limit=Math.max(1,Math.floor(Number(limit)||10));
  if(!RATE_TABLES[origin]?.[destination])throw new Error('선택한 구간의 하불단가가 없습니다.');
  if(frozen+chilled===0)throw new Error('냉동 또는 냉장 파레트 수량을 입력해 주세요.');
  const rates=RATE_TABLES[origin][destination],total=frozen+chilled,maxVehicles=total;
  const heap=new MinHeap(compareSearchNode),results=[];
  heap.push({types:[],last:0,cost:0,capacity:0});
  let cutoff=Infinity;
  while(heap.size){
    const node=heap.pop();
    if(node.cost>cutoff)break;
    if(node.types.length&&node.capacity>=total){
      const allocation=findBestAllocation(node.types,frozen,chilled);
      if(allocation){
        results.push(makeResult(node,allocation,rates,frozen,chilled));
        results.sort(compareResult);
        if(results.length>=limit)cutoff=results[limit-1].totalCost;
      }
    }
    if(node.types.length>=maxVehicles)continue;
    for(let index=node.last;index<VEHICLES.length;index++){
      heap.push({types:[...node.types,index],last:index,cost:node.cost+rates[index],capacity:node.capacity+VEHICLES[index].capacity});
    }
  }
  return results.sort(compareResult).slice(0,limit).map((result,index)=>({...result,rank:index+1,extraCost:result.totalCost-results[0].totalCost}));
}

function findBestAllocation(types,targetFrozen,targetChilled){
  let states=new Map([['0,0',{frozen:0,chilled:0,idle:0,mixed:0,loads:[]}]]);
  for(const typeIndex of types){
    const vehicle=VEHICLES[typeIndex],next=new Map();
    for(const state of states.values()){
      const maxFrozen=Math.min(vehicle.capacity,targetFrozen-state.frozen);
      const maxChilled=Math.min(vehicle.capacity,targetChilled-state.chilled);
      for(let frozen=0;frozen<=maxFrozen;frozen++)for(let chilled=0;chilled<=maxChilled;chilled++){
        if(frozen+chilled===0||!canLoad(vehicle.capacity,frozen,chilled))continue;
        const used=usedSpace(frozen,chilled),candidate={frozen:state.frozen+frozen,chilled:state.chilled+chilled,idle:state.idle+vehicle.capacity-used,mixed:state.mixed+(frozen>0&&chilled>0?1:0),loads:[...state.loads,{typeIndex,frozen,chilled,used,remaining:vehicle.capacity-used}]};
        const key=`${candidate.frozen},${candidate.chilled}`,current=next.get(key);
        if(!current||compareAllocation(candidate,current)<0)next.set(key,candidate);
      }
    }
    states=next;if(!states.size)return null;
  }
  return states.get(`${targetFrozen},${targetChilled}`)||null;
}

function makeResult(node,allocation,rates,totalFrozen,totalChilled){return{totalCost:node.cost,vehicleCount:node.types.length,idleSpace:allocation.idle,mixedCount:allocation.mixed,totalFrozen,totalChilled,vehicles:allocation.loads.map(load=>{const vehicle=VEHICLES[load.typeIndex];return{type:vehicle.type,capacity:vehicle.capacity,rate:rates[load.typeIndex],frozen:load.frozen,chilled:load.chilled,usedSpace:load.used,remainingSpace:load.remaining,mode:load.frozen&&load.chilled?'혼적':load.frozen?'냉동 전용':'냉장 전용'}})}}
function compareResult(a,b){return a.totalCost-b.totalCost||a.vehicleCount-b.vehicleCount||a.idleSpace-b.idleSpace||a.mixedCount-b.mixedCount||signature(a).localeCompare(signature(b),'ko')}
function compareSearchNode(a,b){return a.cost-b.cost||a.types.length-b.types.length||(a.capacity-b.capacity)}
function compareAllocation(a,b){return a.idle-b.idle||a.mixed-b.mixed}
function signature(result){return result.vehicles.map(vehicle=>vehicle.type).join('+')}
function roundEven(value){return value%2?value+1:value}
function toPallets(value){const number=Number(value);if(!Number.isInteger(number)||number<0)throw new Error('파레트 수량은 0 이상의 정수로 입력해 주세요.');return number}

class MinHeap{
  constructor(compare){this.items=[];this.compare=compare}
  get size(){return this.items.length}
  push(value){const items=this.items;items.push(value);let index=items.length-1;while(index>0){const parent=(index-1)>>1;if(this.compare(items[parent],value)<=0)break;items[index]=items[parent];index=parent}items[index]=value}
  pop(){const items=this.items,root=items[0],last=items.pop();if(items.length&&last){let index=0;while(true){let child=index*2+1;if(child>=items.length)break;if(child+1<items.length&&this.compare(items[child+1],items[child])<0)child++;if(this.compare(items[child],last)>=0)break;items[index]=items[child];index=child}items[index]=last}return root}
}
