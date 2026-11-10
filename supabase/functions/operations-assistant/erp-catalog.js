const failure = (code, status = 503) => Object.assign(new Error(code), { code, status });

export async function loadErpOperationsInputs(config, token, center, request = fetch) {
  const origin = new URL(config.catalogUrl);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username ||
      origin.password || origin.search || origin.hash) throw failure('CATALOG_NOT_CONFIGURED');
  const mapping = JSON.parse(config.catalogCenterMap || '{}');
  const selected = Object.hasOwn(mapping, center) ? mapping[center] : undefined;
  if (selected !== 'all' && selected !== 'unclassified' &&
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(selected || ''))
    throw failure('CATALOG_SELECTOR_NOT_CONFIGURED');
  async function list(kind, workspaces = false, filtered = true) {
    const url = new URL('/api/course-catalog', origin);
    url.searchParams.set('kind', kind);
    if (filtered && selected !== 'all') url.searchParams.set('center', selected);
    if (workspaces) url.searchParams.set('workspaces', 'true');
    const items = [], cursors = new Set();
    for (;;) {
      const response = await request(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw failure('CATALOG_QUERY_FAILED', response.status === 401 || response.status === 403 ? response.status : 502);
      const page = await response.json();
      if (!Array.isArray(page.items)) throw failure('CATALOG_INVALID_RESPONSE', 502);
      items.push(...page.items);
      if (!page.nextAfter) return items;
      if (typeof page.nextAfter !== 'string' || cursors.has(page.nextAfter)) throw failure('CATALOG_CURSOR_REPEATED', 502);
      cursors.add(page.nextAfter);
      url.searchParams.set('after', page.nextAfter);
    }
  }
  // Reference candidates keep the caller's policy, independent of the selected route filter.
  const [workspaces, points, drivers, vehicles, companies] = await Promise.all([
    list('route', true), list('delivery_point'), list('driver', false, false),
    list('vehicle', false, false), list('company', false, false),
  ]);
  const plain = entity => ({ ...entity.fields, id: entity.id });
  const routes = [], stops = [], courseRowsRaw = [];
  for (const { route, masters, effective } of workspaces) {
    const r = plain(route); routes.push(r);
    const master = id => masters[id]?.fields;
    for (const stop of r.stops) {
      stops.push({ ...stop, route_id: r.id });
      const point = master(stop.delivery_point_id);
      if (!point) continue;
      const value = key => effective[stop.id]?.[key]?.mode === 'clear' ? null : effective[stop.id]?.[key]?.value;
      const deadline = value('deadline');
      courseRowsRaw.push({
        ...point, route_id: r.id, route_name: r.name, car_number: r.car_number,
        company_name: master(r.company_id)?.name,
        primary_driver_name: master(r.primary_driver_id)?.name,
        secondary_driver_name: master(r.secondary_driver_id)?.name,
        primary_vehicle_plate: master(r.primary_vehicle_id)?.plate,
        primary_vehicle_tonnage: master(r.primary_vehicle_id)?.tonnage,
        stop_id: stop.id, stop_order: stop.stop_order, stop_memo: stop.memo,
        dp_name: point.name, dp_code: point.code, dp_address: point.address,
        dp_region: point.region, dp_contact: point.contact,
        delivery_method: value('delivery_method'), access_method: value('access_method'),
        delivery_location: value('delivery_location'),
        effective_deadline_business_min: deadline?.minute ?? null,
        effective_deadline_text: deadline?.text ?? null,
        effective_deadline_day_offset: deadline?.day_offset ?? null,
      });
    }
  }
  return { catalogScope: selected === 'all' ? '요청자에게 허용된 전체 공통 원장' : selected === 'unclassified' ? '요청자에게 허용된 미분류 공통 원장' : '요청자에게 허용된 지정 센터 속성의 공통 원장', routes, stops, points: points.map(plain), drivers: drivers.map(plain),
    companies: companies.map(plain), vehicles: vehicles.map(x => ({ ...plain(x), plate_number: x.fields.plate, pallet_count: x.fields.pallet_capacity })), courseRowsRaw };
}
