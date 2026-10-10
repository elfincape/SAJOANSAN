// Shared authenticated backend adapter. Notion/web integrations use the same task ID.
// Pass the existing Supabase client; do not create another auth session.
export function createOperationsApi(client) {
  async function unwrap(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  async function allPages(build) {
    const rows = [], pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const page = await unwrap(build().range(offset, offset + pageSize - 1));
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }
  return {
    save({ requestId, task, center, title, date, inputs = {}, status = 'pending' }) {
      if (!requestId) throw new Error('재시도에도 같은 요청 번호를 사용해야 합니다.');
      return unwrap(client.rpc('operations_save_task', {
        p_request_id: requestId, p_task_id: task?.id ?? null,
        p_expected_version: task?.version ?? null, p_center: center,
        p_title: title, p_work_date: date, p_inputs: inputs, p_status: status
      }));
    },
    taskAction({ requestId, task, action, data }) {
      return unwrap(client.rpc('operations_task_action', { p_request_id: requestId,
        p_task_id: task.id, p_expected_version: task.version, p_action: action, p_data: data }));
    },
    incidentAction({ requestId, incident, action, data = {} }) {
      return unwrap(client.rpc('operations_incident_action', { p_request_id: requestId,
        p_incident_id: incident?.id ?? null, p_expected_version: incident?.version ?? null,
        p_action: action, p_data: data }));
    },
    templateAction({ requestId, template, action, data = {} }) {
      return unwrap(client.rpc('operations_template_action', { p_request_id: requestId,
        p_template_id: template?.id ?? null, p_action: action, p_data: data }));
    },
    fromTemplate({ requestId, templateId, date, inputs = {}, ownerId = null, recurring = false }) {
      return unwrap(client.rpc('operations_task_from_template', { p_request_id: requestId,
        p_template_id: templateId, p_work_date: date, p_inputs: inputs,
        p_owner_id: ownerId, p_recurring: recurring }));
    },
    incidents({ center, hqSupport = false, includeResolved = false }) {
      return allPages(() => {
        let query = client.from('operations_incidents').select('*').order('created_at', { ascending: false }).order('id');
        if (center) query = query.eq('center_code', center);
        if (!includeResolved) query = query.eq('status', 'open');
        if (hqSupport) query = query.in('support_state', ['requested', 'supporting']);
        return query;
      });
    },
    tasks({ center, from, through, includeCompleted = false }) {
      if (includeCompleted && ![from, through].every(v => /^\d{4}-\d{2}-\d{2}$/.test(v))) {
        throw new Error('조회 기간을 확인해 주세요.');
      }
      return allPages(() => {
        let query = client.from('operations_tasks').select('*').eq('center_code', center)
          .order('work_date').order('created_at').order('id');
        // Older incomplete tasks stay visible when the reporting period changes.
        query = includeCompleted ? query.or(`status.in.(pending,in_progress),and(work_date.gte.${from},work_date.lte.${through})`)
          : query.in('status', ['pending', 'in_progress']);
        return query;
      });
    },
    dailyLog({ center, from, through, settlement }) {
      return allPages(() => {
        let query = client.from('operations_daily_log').select('*').eq('center_code', center)
          .gte('report_date', from).lte('report_date', through).order('occurred_at').order('id');
        if (settlement) query = query.eq('inputs->>정산방식', settlement);
        return query;
      });
    }
  };
}
