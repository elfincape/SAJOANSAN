import { supabase } from './supabase';
import type { Center } from './center';
import type { NormalizedImport, ImportPoint } from '../domain/course-import';
const centerPayload = <T extends object>(row:T, center:Center) => ({...row,center_code:center.code});
export async function executeImport(n:NormalizedImport,selectedCenter:Center,dryRun:boolean,replaceStops:boolean,log:(message:string,cls?:string)=>void){
      /* 1) 회사 */
      log(`회사 ${n.companies.length}건 처리…`);
      const companyMap = new Map<string,string>();
      if (!dryRun && n.companies.length) {
        // 운영 DB에 (center_code, name) unique 제약이 아직 없어도 동작하도록
        // ON CONFLICT 대신 센터별 기존 행 조회 후 없는 회사만 삽입한다.
        const { data: existing, error: selectError } = await supabase
          .from('companies').select('id, name').eq('center_code', selectedCenter.code);
        if (selectError) throw new Error(`companies select: ${selectError.message}`);
        (existing || []).forEach(c => { if (!companyMap.has(c.name)) companyMap.set(c.name, c.id); });
        const missing = n.companies.filter(c => !companyMap.has(c.name));
        if (missing.length) {
          const { data: inserted, error: insertError } = await supabase
            .from('companies').insert(missing.map(row => centerPayload(row, selectedCenter)))
            .select('id, name');
          if (insertError) throw new Error(`companies insert: ${insertError.message}`);
          (inserted || []).forEach(c => companyMap.set(c.name, c.id));
        }
      }

      /* 2) 기사 — unique 제약이 없을 수 있으므로 검색-후-삽입 방식 */
      log(`기사 ${n.drivers.length}건 처리…`);
      const driverMap = new Map<string,string>();
      if (!dryRun) {
        for (const d of n.drivers) {
          const compId = companyMap.get(d.company_name) || null;
          let driverQuery = supabase
            .from('drivers')
            .select('id, center_code')
            .eq('center_code', selectedCenter.code)
            .eq('name', d.name)
            .limit(1);
          driverQuery = compId == null ? driverQuery.is('company_id',null) : driverQuery.eq('company_id',compId);
          let { data: driverRows, error: driverSelectError } = await driverQuery;
          if (driverSelectError) throw new Error(`drivers select: ${driverSelectError.message}`);
          let ex = driverRows?.[0] || null;
          // 과거 전역 unique(company_id,name) 시절에 center_code가 잘못 들어간 행을 복구한다.
          if (!ex) {
            let legacyQuery = supabase.from('drivers').select('id, center_code').eq('name', d.name).limit(1);
            legacyQuery = compId == null ? legacyQuery.is('company_id',null) : legacyQuery.eq('company_id',compId);
            const { data: legacyRows, error: legacyError } = await legacyQuery;
            if (legacyError) throw new Error(`drivers legacy select: ${legacyError.message}`);
            ex = legacyRows?.[0] || null;
          }
          let driverId;
          if (ex) {
            const { error } = await supabase.from('drivers')
              .update(centerPayload({ phone: d.phone, contact: d.contact }, selectedCenter))
              .eq('id', ex.id);
            if (error) throw new Error(`drivers update: ${error.message}`);
            driverId = ex.id;
          } else {
            const { data: ins, error } = await supabase.from('drivers')
              .insert(centerPayload({ name: d.name, phone: d.phone, contact: d.contact, company_id: compId }, selectedCenter))
              .select('id').single();
            if (error) throw new Error(`drivers insert: ${error.message}`);
            driverId = ins.id;
          }
          driverMap.set(`${d.name}|${d.company_name}`, driverId);
        }
      }

      /* 3) 차량 */
      log(`차량 ${n.vehicles.length}건 처리…`);
      const vehicleMap = new Map<string,string>();
      if (!dryRun) {
        for (const v of n.vehicles) {
          const compId = companyMap.get(v.company_name) || null;
          let vehicleQuery = supabase
            .from('vehicles').select('id, center_code')
            .eq('center_code', selectedCenter.code)
            .eq('plate_number', v.plate_number)
            .limit(1);
          vehicleQuery = compId == null ? vehicleQuery.is('company_id',null) : vehicleQuery.eq('company_id',compId);
          let { data: vehicleRows, error: vehicleSelectError } = await vehicleQuery;
          if (vehicleSelectError) throw new Error(`vehicles select: ${vehicleSelectError.message}`);
          let ex = vehicleRows?.[0] || null;
          // vehicles_company_plate_unique에 걸리는 기존 행이 다른/NULL 센터면 선택 센터로 복구한다.
          if (!ex) {
            let legacyQuery = supabase.from('vehicles').select('id, center_code')
              .eq('plate_number', v.plate_number).limit(1);
            legacyQuery = compId == null ? legacyQuery.is('company_id',null) : legacyQuery.eq('company_id',compId);
            const { data: legacyRows, error: legacyError } = await legacyQuery;
            if (legacyError) throw new Error(`vehicles legacy select: ${legacyError.message}`);
            ex = legacyRows?.[0] || null;
          }
          let vehicleId;
          if (ex) {
            const { error } = await supabase.from('vehicles')
              .update(centerPayload({ tonnage: v.tonnage, company_id: compId }, selectedCenter))
              .eq('id', ex.id);
            if (error) throw new Error(`vehicles update: ${error.message}`);
            vehicleId = ex.id;
          } else {
            const { data: ins, error } = await supabase.from('vehicles')
              .insert(centerPayload({ plate_number: v.plate_number, tonnage: v.tonnage, company_id: compId }, selectedCenter))
              .select('id').single();
            if (error) throw new Error(`vehicles insert: ${error.message}`);
            vehicleId = ins.id;
          }
          vehicleMap.set(v.key, vehicleId);
        }
      }

      /* 4) 납품처 */
      log(`납품처 ${n.points.length}건 처리…`);
      const pointMap = new Map<string,string>();
      if (!dryRun) {
        // delivery_points의 복합 unique 제약 유무와 무관하게 기존 행을 먼저 찾는다.
        const { data: existingPoints, error: pointSelectError } = await supabase
          .from('delivery_points').select('id, code').eq('center_code', selectedCenter.code);
        if (pointSelectError) throw new Error(`delivery_points select: ${pointSelectError.message}`);
        (existingPoints || []).forEach(p => { if (!pointMap.has(p.code)) pointMap.set(p.code, p.id); });
        for (let i = 0; i < n.points.length; i += 100) {
          const batch = n.points.slice(i, i + 100).map(row => centerPayload(row, selectedCenter));
          const inserts: (ImportPoint & {center_code:string})[] = [];
          for (const row of batch) {
            const existingId = pointMap.get(row.code);
            if (existingId) {
              const { error } = await supabase.from('delivery_points').update(row)
                .eq('center_code', selectedCenter.code).eq('id', existingId);
              if (error) throw new Error(`delivery_points update(${row.code}): ${error.message}`);
            } else {
              inserts.push(row);
            }
          }
          if (inserts.length) {
            const { data: inserted, error } = await supabase.from('delivery_points')
              .insert(inserts).select('id, code');
            if (error) throw new Error(`delivery_points insert[${i}]: ${error.message}`);
            (inserted || []).forEach(p => pointMap.set(p.code, p.id));
          }
          log(`  납품처 ${Math.min(i+100, n.points.length)}/${n.points.length}`);
        }
      }

      /* 5) 코스 */
      log(`코스 ${n.routes.length}건 처리…`);
      const routeMap = new Map<string,string>();
      if (!dryRun) {
        for (const r of n.routes) {
          const compId    = companyMap.get(r.company_name);
          const driverId  = r.driver_name ? driverMap.get(`${r.driver_name}|${r.company_name}`) : null;
          const vehicleId = r.vehicle_key ? vehicleMap.get(r.vehicle_key) : null;
          const payload = centerPayload({
            name: r.name,
            car_number: r.car_number,
            company_id: compId,
            primary_driver_id: driverId,
            primary_vehicle_id: vehicleId,
            active: true,
          }, selectedCenter);
          const { data: ex } = await supabase.from('routes').select('id')
            .eq('center_code', selectedCenter.code).eq('company_id', compId).eq('car_number', r.car_number).eq('name', r.name)
            .maybeSingle();
          let routeId;
          if (ex) {
            const { error } = await supabase.from('routes').update(payload).eq('center_code', selectedCenter.code).eq('id', ex.id);
            if (error) throw new Error(`routes update: ${error.message}`);
            routeId = ex.id;
          } else {
            const { data: ins, error } = await supabase.from('routes').insert(payload).select('id').single();
            if (error) throw new Error(`routes insert: ${error.message}`);
            routeId = ins.id;
          }
          routeMap.set(r.key, routeId);
        }
      }

      /* 6) 납품처 항목 */
      log(`납품처 항목 ${n.stops.length}건 처리…`);
      if (!dryRun && n.stops.length) {
        if (replaceStops) {
          const ids = [...routeMap.values()];
          if (ids.length) {
            const { error } = await supabase.from('route_stops').delete().in('route_id', ids);
            if (error) throw new Error(`route_stops delete: ${error.message}`);
            log(`  기존 납품처 항목 삭제 완료`);
          }
        }
        const payloads = n.stops.map(s => ({
          route_id: routeMap.get(s.route_key),
          delivery_point_id: pointMap.get(s.point_code),
          stop_order: s.stop_order,
          arrival_text:                 s.arrival_text,
          arrival_business_min:         s.arrival_business_min,
          unloading_start_text:         s.unloading_start_text,
          unloading_start_business_min: s.unloading_start_business_min,
          unloading_end_text:           s.unloading_end_text,
          unloading_end_business_min:   s.unloading_end_business_min,
          deadline_text:                s.deadline_text,
          deadline_business_min:        s.deadline_business_min,
          memo:                         s.memo,
        })).filter(p => p.route_id && p.delivery_point_id);

        for (let i = 0; i < payloads.length; i += 100) {
          const batch = payloads.slice(i, i + 100);
          const { error } = await supabase.from('route_stops').insert(batch);
          if (error) throw new Error(`route_stops insert[${i}]: ${error.message}`);
          log(`  납품처 항목 ${Math.min(i+100, payloads.length)}/${payloads.length}`);
        }
      }

 log('✅ 완료!', 'text-emerald-400 font-bold');
}
