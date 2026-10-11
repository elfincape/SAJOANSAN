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
    permissions() { return unwrap(client.rpc('operations_permissions_context')); },
    updatePermission({requestId,config,read,write}) { return unwrap(client.rpc('operations_update_permission',{p_request_id:requestId,p_resource:config.resource,p_expected_version:config.version,p_read:read,p_write:write})); },
    context() { return unwrap(client.rpc('operations_portal_context')); },
    recordCjShare({ requestId, task, shared, note }) {
      return unwrap(client.rpc('operations_record_cj_share', { p_request_id: requestId, p_task_id: task.id,
        p_expected_version: task.version, p_shared: shared, p_note: note }));
    },
    members() { return unwrap(client.rpc('operations_members')); },
    updateMember({requestId,person,name,role,centers}) { return unwrap(client.rpc('operations_update_member',{p_request_id:requestId,p_user_id:person.id,p_expected:{display_name:person.display_name,role:person.role,centers:person.centers},p_name:name,p_role:role,p_centers:centers})); },
    participantOptions(center) { return unwrap(client.rpc('operations_participant_options',{p_center:center})); },
    setParticipants({requestId,task,handler,from=null,to=null,memo=''}) { return unwrap(client.rpc('operations_set_task_participants',{p_request_id:requestId,p_task_id:task.id,p_expected_version:task.version,p_handler:handler,p_from:from,p_to:to,p_memo:memo})); },
    staffAccess() { return unwrap(client.rpc('operations_staff_access')); },
    setMembership({ requestId, userId, center, expected, enabled }) {
      return unwrap(client.rpc('operations_set_membership', { p_request_id: requestId, p_user_id: userId,
        p_center: center, p_expected: expected, p_enabled: enabled }));
    },
    templates(center) {
      return allPages(() => client.from('operations_templates').select('*').eq('center_code', center)
        .order('version', { ascending: false }).order('id'));
    },
    retireCustom({requestId,template}) {return unwrap(client.rpc('operations_retire_custom_template',{p_request_id:requestId,p_template_id:template.id}));},
    publishCustom({requestId,center,title,spec,familyId=null}) { return unwrap(client.rpc('operations_publish_custom_template',{p_request_id:requestId,p_center:center,p_title:title,p_spec:spec,p_family_id:familyId})); },
    issuePeriod({requestId,templateId,date,endDate}) { return unwrap(client.rpc('operations_issue_task_period',{p_request_id:requestId,p_template_id:templateId,p_work_date:date,p_end_date:endDate})); },
    issueCustom({requestId,templateId,date}) { return unwrap(client.rpc('operations_issue_custom_task',{p_request_id:requestId,p_template_id:templateId,p_work_date:date})); },
    people(center) { return unwrap(client.rpc('operations_handoff_people', { p_center: center })); },
    events({ taskId, incidentId }) {
      return allPages(() => client.from('operations_task_events').select('id,action,occurred_at,actor_id,request_body,after_value')
        .eq(taskId ? 'task_id' : 'incident_id', taskId ?? incidentId).order('occurred_at').order('id'));
    },
    trashTask({requestId,task,restore=false}) { return unwrap(client.rpc('operations_task_trash',{p_request_id:requestId,p_task_id:task.id,p_expected_version:task.version,p_restore:restore})); },
    reopen({ requestId, task }) {
      return unwrap(client.rpc('operations_reopen_task', { p_request_id: requestId, p_task_id: task.id, p_expected_version: task.version }));
    },
    notifications() {
      return allPages(() => client.from('operations_notifications').select('*').order('created_at', { ascending: false }).order('id'));
    },
    async unreadCount() {
      const { count, error } = await client.from('operations_notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
      if (error) throw error;
      return count;
    },
    readNotification(id) { return unwrap(client.rpc('operations_read_notification', { p_id: id })); },
    surveys(center) {
      return allPages(() => {
        let query = client.from('operations_surveys').select('*').order('updated_at', { ascending: false }).order('id');
        return center ? query.eq('center_code', center) : query;
      });
    },
    surveyAction({ requestId, survey, action, data }) {
      return unwrap(client.rpc('operations_survey_action', { p_request_id: requestId, p_id: survey?.id ?? null,
        p_expected_version: survey?.version ?? null, p_action: action, p_data: data }));
    },
    save({ requestId, task, center, title, date, endDate, inputs = {}, status = 'pending' }) {
      if (!requestId) throw new Error('재시도에도 같은 요청 번호를 사용해야 합니다.');
      return unwrap(client.rpc('operations_save_task_period', {
        p_request_id: requestId, p_task_id: task?.id ?? null,
        p_expected_version: task?.version ?? null, p_center: center,
        p_title: title, p_work_date: date, p_end_date: endDate??task?.work_end_date??date, p_inputs: inputs, p_status: status
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
    async parentTasks(ids) {
      const rows=[];const unique=[...new Set(ids.filter(Boolean))];
      for(let offset=0;offset<unique.length;offset+=100)rows.push(...await unwrap(client.from('operations_tasks').select('id,title,center_code,status,work_date').in('id',unique.slice(offset,offset+100))));
      return rows;
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
    tasks({ center, from, through, includeCompleted = false, trash = false }) {
      if (includeCompleted && ![from, through].every(v => /^\d{4}-\d{2}-\d{2}$/.test(v))) {
        throw new Error('조회 기간을 확인해 주세요.');
      }
      return allPages(() => {
        let query = client.from('operations_tasks').select('*')
          .order('work_date').order('created_at').order('id');
        if (center) query = query.eq('center_code', center);
        query = trash ? query.not('deleted_at','is',null) : query.is('deleted_at',null);
        // Older incomplete tasks stay visible when the reporting period changes.
        query = trash ? query : includeCompleted ? query.or(`status.in.(pending,in_progress),and(work_date.lte.${through},work_end_date.gte.${from}),and(work_end_date.is.null,work_date.gte.${from},work_date.lte.${through})`)
          : query.in('status', ['pending', 'in_progress']);
        return query;
      });
    },
    dailyLog({ center, from, through, settlement }) {
      return allPages(() => {
        let query = client.from('operations_daily_log').select('*')
          .gte('report_date', from).lte('report_date', through).order('occurred_at').order('id');
        if (center) query = query.eq('center_code', center);
        if (settlement) query = query.eq('inputs->>정산방식', settlement);
        return query;
      });
    }
  };
}
