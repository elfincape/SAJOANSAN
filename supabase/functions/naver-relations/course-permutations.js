export function coursePermutations(course) {
 const {stops,rotation}=course;
 if(course.rotations===2&&!rotation)throw Error('이전 통합 코스는 원본 엑셀을 다시 등록해 주세요.');
 if(!Array.isArray(stops)||stops.length<(rotation===2?3:4)||stops.length>7||stops.some(s=>typeof s!=='string'||!s.trim()))throw Error('코스 주소 또는 경유지 한도 확인 필요');
 const fixed=rotation===2?1:2,deliveries=stops.slice(fixed,-1),routes=[];
 function visit(prefix,remaining){
  if(!remaining.length){routes.push([...stops.slice(0,fixed),...prefix,stops.at(-1)]);return;}
  const used=new Set();
  for(let i=0;i<remaining.length;i++)if(!used.has(remaining[i])){used.add(remaining[i]);visit([...prefix,remaining[i]],remaining.filter((_,j)=>j!==i));}
 }
 visit([],deliveries);return routes;
}

